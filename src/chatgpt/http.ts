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

/** Desktop uses Node HTTPS; mobile uses its SiYuan kernel to avoid WebView CORS. */
export function request(url: string, options: {
    method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal;
} = {}): Promise<any> {
    if (options.signal?.aborted) return Promise.reject(new Error('Request aborted'));
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['auth.openai.com', 'api.openai.com'].includes(target.hostname)) {
        return Promise.reject(new Error(i18n('chatgptInvalidEndpoint')));
    }
    if (!isChatGPTDesktop()) return requestThroughKernel(target.href, options);
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

/** The kernel buffers SSE; expose the same response lifecycle as desktop without Node modules. */
class BufferedResponse {
    private closed = false;
    private onClose: Array<() => void> = [];
    private abort = () => this.destroy();
    constructor(readonly statusCode: number, readonly headers: Record<string, string>, private body: string,
        private signal?: AbortSignal) {
        signal?.addEventListener('abort', this.abort, { once: true });
        if (signal?.aborted) this.destroy();
    }
    once(event: string, callback: () => void): void {
        if (event !== 'close') return;
        if (this.closed) callback();
        else this.onClose.push(callback);
    }
    setEncoding(_encoding: string): void {}
    resume(): void { this.destroy(); }
    destroy(): void {
        if (this.closed) return;
        this.closed = true;
        this.body = '';
        this.signal?.removeEventListener('abort', this.abort);
        this.onClose.splice(0).forEach(callback => callback());
    }
    async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        try {
            if (this.signal?.aborted) throw new Error('Request aborted');
            if (!this.closed) yield this.body;
            if (this.signal?.aborted) throw new Error('Request aborted');
        }
        finally { this.destroy(); }
    }
}

async function requestThroughKernel(url: string, options: Parameters<typeof request>[1]): Promise<BufferedResponse> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timeout = new URL(url).pathname === '/v1/responses' ? 300000 : 60000;
    const timer = setTimeout(abort, timeout);
    try {
        // Credentials travel in the POST body, never in proxy URLs or browser storage.
        const response = await fetch('/api/network/forwardProxy', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
            signal: controller.signal,
            body: JSON.stringify({ url, method: options.method || 'GET', timeout, redirect: false,
                headers: Object.entries(options.headers || {}).map(([key, value]) => ({ [key]: value })),
                contentType: options.headers?.['Content-Type'] || 'application/json',
                payload: options.body || '', payloadEncoding: 'json', responseEncoding: 'text' }),
        });
        if (!response.ok) throw new Error(i18n('chatgptTransportFailed'));
        const result = await response.json();
        if (options.signal?.aborted) throw new Error('Request aborted');
        if (result?.code !== 0 || !Number.isInteger(result.data?.status) || typeof result.data?.body !== 'string') {
            throw new Error(i18n('chatgptTransportFailed'));
        }
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(result.data.headers || {})) {
            headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        }
        return new BufferedResponse(result.data.status, headers, result.data.body, options.signal);
    } catch (error) {
        if (options.signal?.aborted) throw new Error('Request aborted');
        if (controller.signal.aborted) throw new Error(i18n('chatgptTimeout'));
        throw error;
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
    }
}

export async function readJson(response: any): Promise<any> {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let text = '';
    let size = 0;
    for await (const chunk of response) {
        size += typeof chunk === 'string' ? encoder.encode(chunk).length : chunk.length;
        if (size > 8 * 1024 * 1024) {
            response.destroy();
            throw new Error(i18n('chatgptInvalidResponse'));
        }
        text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
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
