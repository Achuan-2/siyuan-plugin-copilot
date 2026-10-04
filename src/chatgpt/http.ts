import { i18n } from '../utils/i18n';

export function isChatGPTDesktop(): boolean {
    return typeof window !== 'undefined' && typeof (window as any).require === 'function';
}

export function nativeModule(name: string): any {
    if (!isChatGPTDesktop()) throw new Error(i18n('chatgptDesktopOnly'));
    return (window as any).require(name);
}

export class ChatGPTHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string, readonly requestId = '') {
        super(`${message}${code ? ` (${code})` : ''}${requestId ? ` [${requestId}]` : ''}`);
    }
}

/** Node HTTPS avoids renderer CORS and never proxies credentials through SiYuan. */
export function request(url: string, options: {
    method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal;
} = {}): Promise<any> {
    if (options.signal?.aborted) return Promise.reject(new Error('Request aborted'));
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['auth.openai.com', 'api.openai.com'].includes(target.hostname)) {
        return Promise.reject(new Error(i18n('chatgptInvalidEndpoint')));
    }
    return new Promise((resolve, reject) => {
        const req = nativeModule('https').request(target, {
            method: options.method || 'GET', headers: options.headers,
        }, (response: any) => {
            response.once('close', cleanup);
            resolve(response);
        });
        const abort = () => req.destroy(new Error('Request aborted'));
        const cleanup = () => options.signal?.removeEventListener('abort', abort);
        req.on('error', (error: Error) => {
            cleanup();
            reject(options.signal?.aborted ? new Error('Request aborted') : error);
        });
        req.setTimeout(60000, () => req.destroy(new Error(i18n('chatgptTimeout'))));
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        else req.end(options.body);
    });
}

export async function readJson(response: any): Promise<any> {
    const Buffer = nativeModule('buffer').Buffer;
    const chunks: any[] = [];
    let size = 0;
    for await (const chunk of response) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
            response.destroy();
            throw new Error(i18n('chatgptInvalidResponse'));
        }
        chunks.push(Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString('utf8');
    let result: any;
    try { result = text ? JSON.parse(text) : {}; }
    catch { throw new ChatGPTHttpError(response.statusCode, '', i18n('chatgptInvalidResponse')); }
    if (response.statusCode < 200 || response.statusCode >= 300) {
        const code = typeof result.error === 'string' ? result.error : result.error?.code || '';
        const message = result.error?.message || result.error_description || result.detail || `HTTP ${response.statusCode}`;
        throw new ChatGPTHttpError(response.statusCode, code, message, response.headers?.['x-request-id']);
    }
    return result;
}

export async function requestJson(url: string, options: Parameters<typeof request>[1] = {}): Promise<any> {
    return readJson(await request(url, options));
}
