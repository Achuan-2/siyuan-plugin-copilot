import { authorize, exchangeTokens, verifyIdentity, ISSUER, RESOURCE } from './oauth';
import { ChatGPTStorage, type ChatGPTProfile } from './storage';
import { nativeModule, request, requestJson, readJson, ChatGPTHttpError } from './http';
import { i18n } from '../utils/i18n';

const UNUSABLE_REFRESH_CODES = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired',
    'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
const DEFAULT_MODELS = [
    { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
    { id: 'gpt-6.1-luna', name: 'GPT-6.1-Luna' },
];

export interface ChatGPTAccount {
    id: string;
    email?: string;
    name?: string;
    connected: boolean;
    sharing: boolean;
}

function publicAccount(profile: ChatGPTProfile): ChatGPTAccount {
    const connected = !!profile.accessToken && !profile.signingOut;
    return { id: profile.id, email: profile.email, name: profile.name, connected,
        sharing: connected && !!profile.scopes?.includes('chatgpt.tokens.use.direct') };
}

export class ChatGPTClient {
    private storage = new ChatGPTStorage();
    private controllers = new Set<AbortController>();
    private loginInProgress = false;

    private operation(signal?: AbortSignal) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort();
        this.controllers.add(controller);
        return { signal: controller.signal, cleanup: () => {
            signal?.removeEventListener('abort', abort);
            this.controllers.delete(controller);
        } };
    }

    async accounts(): Promise<{ activeId?: string; profiles: ChatGPTAccount[] }> {
        const data = await this.storage.read();
        return { activeId: data.activeId, profiles: data.profiles.map(publicAccount) };
    }

    async account(): Promise<ChatGPTAccount | null> {
        const data = await this.accounts();
        return data.profiles.find(profile => profile.id === data.activeId) || null;
    }

    async selectAccount(id: string): Promise<void> {
        this.dispose();
        await this.storage.locked(async () => {
            const data = await this.storage.read();
            if (!data.profiles.some(profile => profile.id === id)) throw new Error(i18n('chatgptSignInRequired'));
            data.activeId = id;
            await this.storage.write(data);
        });
    }

    async login(signal: AbortSignal, profileId?: string): Promise<void> {
        if (this.loginInProgress) throw new Error(i18n('chatgptWaitingLogin'));
        this.loginInProgress = true;
        const operation = this.operation(signal);
        try {
            const { hostId, selected } = await this.storage.locked(async () => ({
                hostId: this.storage.hostId(), selected: (await this.storage.read()).profiles.find(profile => profile.id === profileId),
            }), operation.signal);
            if (profileId && !selected) throw new Error(i18n('chatgptInvalidRegistration'));
            const registration = await authorize(hostId, selected, operation.signal);
            // Retain the issued client even if code exchange fails; never make it active before validation.
            await this.storage.locked(async () => {
                const data = await this.storage.read();
                if (!data.profiles.some(profile => profile.id === registration.clientId)) {
                    data.profiles.push({ id: registration.clientId, clientId: registration.clientId });
                    await this.storage.write(data);
                }
            }, operation.signal);
            const tokens = await exchangeTokens(new URLSearchParams({
                grant_type: 'authorization_code', client_id: registration.clientId, code: registration.code,
                code_verifier: registration.verifier, redirect_uri: registration.redirectUri, resource: RESOURCE,
            }), operation.signal);
            if (!tokens.id_token) throw new Error(i18n('chatgptInvalidIdentity'));
            const identity = await verifyIdentity(tokens.id_token, registration.clientId, registration.nonce, operation.signal);
            if (selected?.subject && (selected.subject !== identity.sub || selected.issuer !== identity.iss)) {
                throw new Error(i18n('chatgptAccountMismatch'));
            }
            await this.storage.locked(async () => {
                const data = await this.storage.read();
                const previous = data.profiles.find(profile => profile.id === registration.clientId)!;
                Object.assign(previous, this.tokenUpdate(tokens), {
                    issuer: identity.iss, subject: identity.sub, signingOut: false,
                    email: typeof identity.email === 'string' ? identity.email : undefined,
                    name: typeof identity.name === 'string' ? identity.name : undefined,
                });
                data.activeId = previous.id;
                await this.storage.write(data);
            }, operation.signal);
        } finally {
            operation.cleanup();
            this.loginInProgress = false;
        }
    }

    private tokenUpdate(tokens: any, previous?: ChatGPTProfile): Partial<ChatGPTProfile> {
        if (!tokens.access_token || tokens.token_type?.toLowerCase() !== 'bearer'
            || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error(i18n('chatgptInvalidResponse'));
        return {
            accessToken: tokens.access_token, refreshToken: tokens.refresh_token || previous?.refreshToken,
            idToken: tokens.id_token || previous?.idToken,
            scopes: typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : previous?.scopes || [],
            expiresAt: Date.now() + tokens.expires_in * 1000,
        };
    }

    private async accessToken(id: string, signal: AbortSignal, force = false): Promise<string> {
        return this.storage.locked(async () => {
            const data = await this.storage.read();
            const profile = data.profiles.find(item => item.id === id);
            if (!profile?.accessToken || profile.signingOut) throw new Error(i18n('chatgptSignInRequired'));
            if (!profile.scopes?.includes('chatgpt.tokens.use.direct')) throw new Error(i18n('chatgptPermissionRequired'));
            if (!force && (profile.expiresAt || 0) > Date.now() + 60000) return profile.accessToken;
            if (!profile.refreshToken) throw new Error(i18n('chatgptSignInRequired'));
            try {
                const tokens = await exchangeTokens(new URLSearchParams({ grant_type: 'refresh_token',
                    client_id: profile.clientId, refresh_token: profile.refreshToken, resource: RESOURCE }), signal);
                if (tokens.id_token) {
                    const identity = await verifyIdentity(tokens.id_token, profile.clientId, undefined, signal);
                    if (identity.sub !== profile.subject || identity.iss !== profile.issuer) throw new Error(i18n('chatgptAccountMismatch'));
                }
                Object.assign(profile, this.tokenUpdate(tokens, profile));
                await this.storage.write(data);
                if (!profile.scopes?.includes('chatgpt.tokens.use.direct')) throw new Error(i18n('chatgptPermissionRequired'));
                return profile.accessToken!;
            } catch (error) {
                if (error instanceof ChatGPTHttpError && UNUSABLE_REFRESH_CODES.has(error.code)) {
                    this.clearTokens(profile);
                    await this.storage.write(data);
                    throw new Error(i18n('chatgptSignInRequired'));
                }
                throw error;
            }
        }, signal);
    }

    async authenticatedRequest(endpoint: 'models' | 'responses', options: {
        body?: string; signal?: AbortSignal;
    } = {}): Promise<any> {
        const id = (await this.storage.read()).activeId;
        if (!id) throw new Error(i18n('chatgptSignInRequired'));
        const operation = this.operation(options.signal);
        try {
            for (let attempt = 0; attempt < 2; attempt++) {
                const token = await this.accessToken(id, operation.signal, attempt > 0);
                const response = await request(`${RESOURCE}/${endpoint}`, {
                    method: options.body ? 'POST' : 'GET', body: options.body, signal: operation.signal,
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                });
                if (response.statusCode === 401 && attempt === 0) { response.resume(); continue; }
                if (response.statusCode < 200 || response.statusCode >= 300) await readJson(response);
                response.once('close', operation.cleanup);
                return response;
            }
            throw new Error(i18n('chatgptSignInRequired'));
        } catch (error) { operation.cleanup(); throw error; }
    }

    async models(signal?: AbortSignal): Promise<Array<{ id: string; name: string; provider: string }>> {
        const result = await readJson(await this.authenticatedRequest('models', { signal }));
        if (!Array.isArray(result.models)) throw new Error(i18n('chatgptInvalidResponse'));
        const models = result.models.filter(model => model.visibility === 'list' && typeof model.slug === 'string')
            .map(model => ({ id: model.slug, name: model.display_name || model.slug, provider: 'ChatGPT' }));
        // 按用户要求补充目录未返回的新模型；调用权限仍由服务端验证。
        for (const model of DEFAULT_MODELS) {
            if (!models.some(item => item.id === model.id)) {
                models.push({ ...model, provider: 'ChatGPT' });
            }
        }
        return models;
    }

    private clearTokens(profile: ChatGPTProfile): void {
        delete profile.accessToken;
        delete profile.refreshToken;
        delete profile.idToken;
        delete profile.scopes;
        delete profile.expiresAt;
        delete profile.signingOut;
    }

    async logout(): Promise<boolean> {
        this.dispose();
        const profile = await this.storage.locked(async () => {
            const data = await this.storage.read();
            const profile = data.profiles.find(item => item.id === data.activeId);
            if (!profile) return undefined;
            const snapshot = { ...profile };
            profile.signingOut = true; // Block new requests across windows while retaining the token for revocation.
            await this.storage.write(data);
            return snapshot;
        });
        if (!profile) return true;
        const operation = this.operation();
        try {
            if (!profile.refreshToken) return true;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const discovery = await requestJson(`${ISSUER}/.well-known/openid-configuration`, { signal: operation.signal });
                    if (discovery.issuer !== ISSUER) throw new Error(i18n('chatgptInvalidIdentity'));
                    await requestJson(discovery.revocation_endpoint, {
                        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ token: profile.refreshToken, token_type_hint: 'refresh_token',
                            client_id: profile.clientId }).toString(), signal: operation.signal,
                    });
                    return true;
                } catch {
                    if (operation.signal.aborted) return false;
                    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            return false;
        } finally {
            operation.cleanup();
            await this.storage.locked(async () => {
                const data = await this.storage.read();
                const current = data.profiles.find(item => item.id === profile.id);
                // A successful concurrent reauthorization creates a fresh session; preserve it.
                if (current?.signingOut && current.accessToken === profile.accessToken) {
                    this.clearTokens(current);
                    await this.storage.write(data);
                }
            });
        }
    }

    openUsage(): Promise<void> { return nativeModule('electron').shell.openExternal('https://chatgpt.com/settings/usage'); }

    dispose(): void {
        for (const controller of this.controllers) controller.abort();
        this.controllers.clear();
    }
}

let client: ChatGPTClient | null = null;
export function getChatGPTClient(): ChatGPTClient { return client ||= new ChatGPTClient(); }
export function disposeChatGPTClient(): void { client?.dispose(); client = null; }
