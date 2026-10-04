import { createLocalJWKSet, jwtVerify } from 'jose';
import { nativeModule, requestJson } from './http';
import type { ChatGPTProfile } from './storage';
import { i18n } from '../utils/i18n';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`;
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

export async function verifyIdentity(token: string, clientId: string, nonce?: string, signal?: AbortSignal) {
    const discovery = await requestJson(`${ISSUER}/.well-known/openid-configuration`, { signal });
    if (discovery.issuer !== ISSUER) throw new Error(i18n('chatgptInvalidIdentity'));
    const jwks = await requestJson(discovery.jwks_uri, { signal });
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
        issuer: ISSUER, audience: clientId, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat'],
    });
    if (!payload.sub || (nonce !== undefined && payload.nonce !== nonce)
        || Number(payload.iat) > Date.now() / 1000 + 60) throw new Error(i18n('chatgptInvalidIdentity'));
    return payload;
}

export async function exchangeTokens(form: URLSearchParams, signal?: AbortSignal): Promise<any> {
    return requestJson(TOKEN_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(), signal,
    });
}

/** Public-client PKCE with a temporary loopback callback, as documented by OpenAI. */
export async function authorize(hostId: string, profile: ChatGPTProfile | undefined, signal: AbortSignal) {
    if (signal.aborted) throw new Error('Request aborted');
    const crypto = nativeModule('crypto');
    const Buffer = nativeModule('buffer').Buffer;
    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    let redirectUri = '';
    let consumed = false;
    let timer: ReturnType<typeof setTimeout>;
    let resolveCallback: (result: { code: string; clientId: string }) => void;
    let rejectCallback: (error: Error) => void;
    const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
    });
    callback.catch(() => {});
    const abort = () => rejectCallback(new Error('Request aborted'));
    const server = nativeModule('http').createServer((req: any, res: any) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET' || url.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
        const received = Buffer.from(url.searchParams.get('state') || '');
        const expected = Buffer.from(state);
        if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
            res.writeHead(400).end('Invalid authorization state.'); return;
        }
        if (consumed) { res.writeHead(409).end(); return; }
        consumed = true;
        if (url.searchParams.has('error')) {
            res.writeHead(400).end('Authorization was declined. Return to SiYuan.');
            rejectCallback(new Error(i18n('chatgptAuthorizationDenied')));
            return;
        }
        const code = url.searchParams.get('code');
        const returnedId = url.searchParams.get('client_id');
        const clientId = returnedId || profile?.clientId;
        if (!code || !clientId || clientId === 'dynamic_agent_client'
            || (profile && returnedId && returnedId !== profile.clientId)) {
            res.writeHead(400).end('Invalid registration. Return to SiYuan.');
            rejectCallback(new Error(i18n('chatgptInvalidRegistration')));
            return;
        }
        res.end('Authorization received. Return to SiYuan to finish connecting your account.');
        resolveCallback({ code, clientId });
    });
    server.on('error', (error: Error) => rejectCallback(error));
    signal.addEventListener('abort', abort, { once: true });
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
        });
        if (signal.aborted) throw new Error('Request aborted');
        redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
        const url = new URL(`${ISSUER}/api/accounts/authorize`);
        const parameters: Record<string, string> = {
            client_id: profile?.clientId || 'dynamic_agent_client', ext_agent_host_id: hostId,
            response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE,
            state, nonce, code_challenge_method: 'S256', code_challenge: challenge,
        };
        if (!profile) parameters.agent_name_hint = 'SiYuan Copilot';
        else {
            if (profile.idToken) parameters.id_token_hint = profile.idToken;
            if (profile.email) parameters.login_hint = profile.email;
            if (profile.subject && !profile.scopes?.includes('chatgpt.tokens.use.direct')) parameters.prompt = 'consent';
        }
        for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
        timer = setTimeout(() => rejectCallback(new Error(i18n('chatgptTimeout'))), 5 * 60 * 1000);
        // Never log this URL: returning authorization may contain an ID-token hint.
        await nativeModule('electron').shell.openExternal(url.href);
        const result = await callback;
        return { ...result, redirectUri, nonce, verifier };
    } finally {
        clearTimeout(timer!);
        signal.removeEventListener('abort', abort);
        server.close();
        server.closeAllConnections?.();
    }
}
