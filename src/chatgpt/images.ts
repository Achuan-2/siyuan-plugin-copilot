import { decodeJwt } from 'jose';
import { authorize, IMAGE_CLIENT_ID, IMAGE_TOKEN_ENDPOINT, verifyIdentity } from './oauth';
import { ChatGPTStorage, type ChatGPTImageSession } from './storage';
import { ChatGPTHttpError, isChatGPTDesktop, readJson, request, requestJson } from './http';
import { i18n } from '../utils/i18n';

// Same Codex image protocol as dsh-image-gen; keep its tokens separate from SIWC chat tokens.
export const CHATGPT_IMAGE_MODEL = 'gpt-image-2.6-flare';
const IMAGE_BASE = 'https://chatgpt.com/backend-api/codex/images';
const INVALID_REFRESH_CODES = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired',
    'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);

export interface ChatGPTImageOptions {
    prompt: string;
    size?: string;
    quality?: string;
    /** Original reference images encoded as data URLs, without preview annotations. */
    images?: string[];
    signal?: AbortSignal;
}

export interface ChatGPTImageAccount { connected: boolean; email?: string }

export function buildChatGPTImageBody(options: ChatGPTImageOptions) {
    if (!options.prompt.trim()) throw new Error(i18n('aiSidebarDrawEmptyResponse'));
    if ((options.images?.length || 0) > 16) throw new Error(i18n('chatgptImageTooManyReferences'));
    if (options.images?.some(image => !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image))) {
        throw new Error(i18n('chatgptInvalidResponse'));
    }
    const dimensions = /^(\d+)x(\d+)$/.exec(options.size || '');
    let prompt = options.prompt;
    if (dimensions) {
        const width = Number(dimensions[1]), height = Number(dimensions[2]);
        if (width > 0 && height > 0 && Number.isSafeInteger(width) && Number.isSafeInteger(height)) {
            const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
            const divisor = gcd(width, height);
            prompt += `\n\n输出图片的画布宽高比必须为${width / divisor}:${height / divisor}，完整画面铺满画布。`;
        }
    }
    return {
        model: CHATGPT_IMAGE_MODEL, prompt,
        ...(options.size ? { size: options.size } : {}),
        ...(options.quality ? { quality: options.quality } : {}),
        ...(options.images?.length ? { images: options.images.map(image_url => ({ image_url })) } : {}),
    };
}

export class ChatGPTImageClient {
    private storage = new ChatGPTStorage();
    private controllers = new Set<AbortController>();
    private loggingIn = false;

    private async operation<T>(signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort();
        this.controllers.add(controller);
        try { return await action(controller.signal); }
        finally {
            signal?.removeEventListener('abort', abort);
            this.controllers.delete(controller);
        }
    }

    async account(): Promise<ChatGPTImageAccount> {
        const session = (await this.storage.read()).imageSession;
        return { connected: !!session?.accessToken, email: session?.email };
    }

    private async tokenSession(tokens: any, signal: AbortSignal, previous?: ChatGPTImageSession, nonce?: string): Promise<ChatGPTImageSession> {
        if (typeof tokens.access_token !== 'string' || !tokens.access_token
            || tokens.token_type?.toLowerCase() !== 'bearer'
            || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
            throw new Error(i18n('chatgptInvalidResponse'));
        }
        // Verify signed identity on login/refresh; access-token decoding only reads the routing account ID.
        const identity = tokens.id_token
            ? await verifyIdentity(tokens.id_token, IMAGE_CLIENT_ID, nonce, signal) : undefined;
        if (!previous && !identity) throw new Error(i18n('chatgptInvalidIdentity'));
        if (previous && identity && identity.sub !== previous.subject) throw new Error(i18n('chatgptAccountMismatch'));
        let claims: any = identity;
        if (!claims?.['https://api.openai.com/auth']?.chatgpt_account_id && !claims?.chatgpt_account_id) {
            try { claims = decodeJwt(tokens.access_token); } catch { claims = undefined; }
        }
        const accountId = claims?.['https://api.openai.com/auth']?.chatgpt_account_id
            || claims?.chatgpt_account_id || previous?.accountId;
        if (typeof accountId !== 'string' || !accountId) throw new Error(i18n('chatgptInvalidIdentity'));
        if (previous && accountId !== previous.accountId) throw new Error(i18n('chatgptAccountMismatch'));
        return {
            accessToken: tokens.access_token, refreshToken: tokens.refresh_token || previous?.refreshToken,
            expiresAt: Date.now() + tokens.expires_in * 1000, accountId,
            subject: identity?.sub || previous!.subject,
            email: typeof identity?.email === 'string' ? identity.email : previous?.email,
        };
    }

    async login(signal: AbortSignal): Promise<void> {
        if (!isChatGPTDesktop()) throw new Error(i18n('chatgptDesktopOnly'));
        if (this.loggingIn) throw new Error(i18n('chatgptWaitingLogin'));
        this.loggingIn = true;
        try {
            await this.operation(signal, async signal => {
                const registration = await authorize('', undefined, signal, 'images');
                const tokens = await requestJson(IMAGE_TOKEN_ENDPOINT, {
                    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal,
                    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: IMAGE_CLIENT_ID,
                        code: registration.code, code_verifier: registration.verifier, redirect_uri: registration.redirectUri }).toString(),
                });
                const session = await this.tokenSession(tokens, signal, undefined, registration.nonce);
                await this.storage.locked(async () => {
                    const data = await this.storage.read();
                    data.imageSession = session;
                    await this.storage.write(data);
                }, signal);
            });
        } finally { this.loggingIn = false; }
    }

    private async session(signal: AbortSignal, force = false): Promise<ChatGPTImageSession> {
        return this.storage.locked(async () => {
            const data = await this.storage.read();
            const previous = data.imageSession;
            if (!previous?.accessToken) throw new Error(i18n('chatgptImageSignInRequired'));
            if (!force && previous.expiresAt > Date.now() + 60000) return previous;
            if (!previous.refreshToken) throw new Error(i18n('chatgptImageSignInRequired'));
            try {
                const tokens = await requestJson(IMAGE_TOKEN_ENDPOINT, {
                    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal,
                    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: IMAGE_CLIENT_ID,
                        refresh_token: previous.refreshToken }).toString(),
                });
                data.imageSession = await this.tokenSession(tokens, signal, previous);
                await this.storage.write(data);
                return data.imageSession;
            } catch (error) {
                if (error instanceof ChatGPTHttpError && INVALID_REFRESH_CODES.has(error.code)) {
                    delete data.imageSession;
                    await this.storage.write(data);
                    throw new Error(i18n('chatgptImageSignInRequired'));
                }
                throw this.safeError(error, previous);
            }
        }, signal);
    }

    private safeError(error: unknown, session: ChatGPTImageSession): Error {
        let message = error instanceof Error ? error.message : String(error);
        for (const secret of [session.accessToken, session.refreshToken, session.accountId, session.email]) {
            if (secret) message = message.split(secret).join('[redacted]');
        }
        return new Error(message.slice(0, 1000));
    }

    async generate(options: ChatGPTImageOptions): Promise<Array<{ b64_json: string; mime_type: string; revised_prompt?: string }>> {
        const body = JSON.stringify(buildChatGPTImageBody(options));
        return this.operation(options.signal, async signal => {
            for (let attempt = 0; attempt < 2; attempt++) {
                const session = await this.session(signal, attempt > 0);
                try {
                    const response = await request(`${IMAGE_BASE}/${options.images?.length ? 'edits' : 'generations'}`, {
                        method: 'POST', body, signal, timeoutMs: 300000,
                        headers: { Authorization: `Bearer ${session.accessToken}`, 'chatgpt-account-id': session.accountId,
                            originator: 'codex_cli_rs', 'Content-Type': 'application/json', Accept: 'application/json' },
                    });
                    if (response.statusCode === 401 && attempt === 0) { response.resume(); continue; }
                    // Image payloads can exceed the 8 MiB JSON limit used by chat and OAuth.
                    const payload = await readJson(response, 64 * 1024 * 1024);
                    if (signal.aborted) throw new Error('Request aborted');
                    const images = Array.isArray(payload.data)
                        ? payload.data.filter(image => typeof image.b64_json === 'string' && image.b64_json.length) : [];
                    if (!images.length) throw new Error(i18n('aiSidebarDrawNoImages'));
                    return images.map(image => ({ b64_json: image.b64_json, revised_prompt: image.revised_prompt,
                        mime_type: image.b64_json.startsWith('/9j/') ? 'image/jpeg'
                            : image.b64_json.startsWith('UklGR') ? 'image/webp' : 'image/png' }));
                } catch (error) { throw this.safeError(error, session); }
            }
            throw new Error(i18n('chatgptImageSignInRequired'));
        });
    }

    async logout(): Promise<void> {
        this.dispose();
        await this.storage.locked(async () => {
            const data = await this.storage.read();
            delete data.imageSession;
            await this.storage.write(data);
        });
    }

    dispose(): void {
        for (const controller of this.controllers) controller.abort();
        this.controllers.clear();
    }
}

let client: ChatGPTImageClient | undefined;
export function getChatGPTImageClient(): ChatGPTImageClient { return client ||= new ChatGPTImageClient(); }
export function disposeChatGPTImageClient(): void { client?.dispose(); client = undefined; }
