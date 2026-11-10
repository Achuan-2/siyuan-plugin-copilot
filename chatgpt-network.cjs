const { net } = require('electron');

/** Register network listeners in the main process before Chromium emits response data. */
exports.startRequest = function startRequest(options, onEvent) {
    const url = new URL(options.url);
    const imageEndpoint = url.hostname === 'chatgpt.com'
        && /^\/backend-api\/codex\/images\/(generations|edits)$/.test(url.pathname);
    if (url.protocol !== 'https:' || (!['auth.openai.com', 'api.openai.com'].includes(url.hostname) && !imageEndpoint)) {
        throw new Error('Unsupported ChatGPT endpoint');
    }
    const owner = options.owner;
    if (!owner || owner.isDestroyed()) throw new Error('ChatGPT request owner is unavailable');
    if (imageEndpoint && typeof owner.session.fetch === 'function') {
        return startImageRequest(options, onEvent);
    }
    const request = net.request({
        url: url.href, method: options.method || 'GET', session: owner.session,
        redirect: 'error', credentials: 'omit', useSessionCookies: false,
    });
    let finished = false;
    const cleanup = () => owner.removeListener('destroyed', abort);
    const send = (type, value) => {
        if (owner.isDestroyed()) { abort(); return; }
        try { onEvent(type, value); } catch { abort(); }
    };
    const fail = error => {
        if (finished) return;
        finished = true;
        cleanup();
        send('error', { message: error?.message || String(error) });
        request.abort();
    };
    const abort = () => {
        if (finished) return;
        finished = true;
        cleanup();
        request.abort();
    };
    owner.once('destroyed', abort);
    request.on('error', fail);
    request.on('abort', () => fail(new Error('Request aborted')));
    // ClientRequest close can precede response delivery in Chromium. Completion
    // belongs to IncomingMessage; the renderer also enforces an inactivity timeout.
    request.on('response', response => {
        if (finished) return;
        send('response', { statusCode: response.statusCode, headers: response.headers });
        response.on('end', () => {
            if (finished) return;
            finished = true;
            cleanup();
            send('end');
        });
        response.on('error', fail);
        response.on('aborted', () => fail(new Error('ChatGPT response aborted')));
        response.on('close', () => {
            if (!finished) fail(new Error('ChatGPT connection closed before the response completed'));
        });
        response.on('data', chunk => { if (!finished) send('data', chunk); });
    });
    try {
        for (const [key, value] of Object.entries(options.headers || {})) request.setHeader(key, value);
        request.end(options.body);
    } catch (error) { fail(error); }
    return { abort };
};

/** Send image JSON uploads through Chromium Fetch while keeping the response streaming. */
function startImageRequest(options, onEvent) {
    const owner = options.owner;
    const controller = new AbortController();
    const cleanup = () => owner.removeListener('destroyed', abort);
    const abort = () => { controller.abort(); cleanup(); };
    const send = (type, value) => {
        if (controller.signal.aborted) return;
        if (owner.isDestroyed()) { abort(); return; }
        try { onEvent(type, value); } catch { abort(); }
    };
    owner.once('destroyed', abort);
    void (async () => {
        try {
            const response = await owner.session.fetch(options.url, {
                method: options.method || 'GET', headers: options.headers || {}, body: options.body,
                signal: controller.signal, credentials: 'omit', redirect: 'error',
            });
            send('response', { statusCode: response.status, headers: Object.fromEntries(response.headers) });
            if (response.body) {
                const reader = response.body.getReader();
                try {
                    while (!controller.signal.aborted) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        send('data', Buffer.from(value));
                    }
                } finally {
                    if (controller.signal.aborted) await reader.cancel().catch(() => {});
                    reader.releaseLock();
                }
            }
            send('end');
        } catch (error) {
            if (!controller.signal.aborted) send('error', { message: error?.message || String(error) });
        } finally { cleanup(); }
    })();
    return { abort };
}
