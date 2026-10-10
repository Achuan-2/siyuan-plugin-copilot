import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as jose from 'jose';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
const jwk = { ...await jose.exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const issuer = 'https://auth.openai.com';
const scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

function response(body, statusCode = 200, headers = {}) {
    const stream = Readable.from(Array.isArray(body) ? body : [Buffer.from(JSON.stringify(body))]);
    stream.statusCode = statusCode;
    stream.headers = headers;
    return stream;
}

// Node has Blob/fetch but no FileReader; emulate its asynchronous read and abort events.
class TestFileReader {
    aborted = false;
    readAsDataURL(blob) {
        blob.arrayBuffer().then(bytes => {
            if (this.aborted) return;
            this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}`;
            this.onload?.();
        }).catch(error => { this.error = error; this.onerror?.(); });
    }
    abort() { this.aborted = true; this.onabort?.(); }
}

function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'siyuan-chatgpt-test-'));
    let workspace = path.join(directory, 'workspace');
    let saveCode = 0;
    const writes = [];
    const plugin = {
        name: 'siyuan-plugin-copilot',
        async saveData(filename, data) {
            if (saveCode !== 0) return { code: saveCode };
            const target = path.join(workspace, 'data', 'storage', 'petal', this.name, filename);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, JSON.stringify(data));
            writes.push(filename);
            return { code: 0 };
        },
    };
    const requests = [];
    let opened;
    let browser = async () => {};
    let route = async url => {
        if (url.pathname === '/.well-known/openid-configuration') return response({ issuer,
            jwks_uri: `${issuer}/.well-known/jwks.json`, revocation_endpoint: `${issuer}/api/accounts/oauth/revoke` });
        if (url.pathname === '/.well-known/jwks.json') return response({ keys: [jwk] });
        throw new Error('Unexpected fixture endpoint');
    };
    const native = name => {
        if (name === 'process') return { env: { LOCALAPPDATA: directory } };
        if (name === 'electron') return { shell: { openExternal: async value => { opened = new URL(value); await browser(opened); } } };
        if (name === 'https') return { request(url, options, callback) {
            const req = new EventEmitter();
            let incoming;
            let destroyed = false;
            req.setTimeout = () => {};
            req.end = body => {
                requests.push({ url, ...options, body });
                Promise.resolve().then(() => route(url, options, body)).then(value => {
                    if (destroyed) { value.destroy(); return; }
                    incoming = value;
                    callback(value);
                }).catch(error => req.emit('error', error));
            };
            req.destroy = error => { destroyed = true; incoming?.destroy(error); req.emit('error', error); };
            return req;
        } };
        return require(name);
    };
    const cache = new Map();
    const context = vm.createContext({ console, URL, URLSearchParams, AbortController, fetch, FileReader: TestFileReader, setTimeout, clearTimeout,
        setInterval, clearInterval, Date, Error, window: { require: native,
            siyuan: { config: { system: { workspaceDir: workspace } } } } });
    function load(relative) {
        const filename = path.resolve(root, relative);
        if (cache.has(filename)) return cache.get(filename);
        const module = { exports: {} };
        cache.set(filename, module.exports);
        const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        const localRequire = name => {
            if (name.endsWith('/utils/i18n')) return { i18n: key => key };
            if (name === 'jose') return jose;
            if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)));
            throw new Error(`Unexpected import ${name}`);
        };
        vm.runInContext(`(function(require, module, exports) { ${code}\n})`, context, { filename })(localRequire, module, module.exports);
        return module.exports;
    }
    const storageModule = load('src/chatgpt/storage.ts');
    storageModule.configureChatGPTStorage(plugin);
    const storage = new storageModule.ChatGPTStorage();
    const clients = [];
    const client = () => { const value = new (load('src/chatgpt/client.ts').ChatGPTClient)(); clients.push(value); return value; };
    t.after(() => {
        clients.forEach(value => value.dispose());
        assert.equal(path.dirname(directory), path.resolve(tmpdir()));
        assert.ok(path.basename(directory).startsWith('siyuan-chatgpt-test-'));
        rmSync(directory, { recursive: true, force: true });
    });
    const defaultRoute = route;
    return { load, storage, requests, client, writes, directory, get workspace() { return workspace; },
        newStorage() { return new storageModule.ChatGPTStorage(); },
        setSaveCode(code) { saveCode = code; },
        switchWorkspace(target) { workspace = target; context.window.siyuan.config.system.workspaceDir = target; },
        get opened() { return opened; },
        route(handler) { route = async (url, options, body) => await handler(url, options, body) ?? defaultRoute(url, options, body); },
        browser(handler) { browser = handler; } };
}

async function identity(clientId, nonce, overrides = {}) {
    return new jose.SignJWT({ nonce, email: 'test@example.com', ...overrides }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(issuer).setAudience(clientId).setSubject('test-subject').setIssuedAt().setExpirationTime('1h').sign(privateKey);
}

async function saved(f, expiresAt = Date.now() + 3600000) {
    await f.storage.write({ activeId: 'issued-client', profiles: [{ id: 'issued-client', clientId: 'issued-client', issuer,
        subject: 'test-subject', email: 'test@example.com', accessToken: 'fake-access', refreshToken: 'fake-refresh',
        scopes: scope.split(' '), expiresAt }] });
}

function events(...values) {
    return values.map(value => Buffer.from(`data: ${JSON.stringify(value)}\r\n\r\n`));
}

test('existing local credentials migrate once through SiYuan without syncing the host identity or lock', async t => {
    const f = fixture(t);
    const legacy = path.join(f.directory, 'siyuan-plugin-copilot', 'chatgpt', 'accounts.json');
    const data = { activeId: 'legacy-client', profiles: [{ id: 'legacy-client', clientId: 'legacy-client',
        accessToken: 'legacy-access', refreshToken: 'legacy-refresh' }] };
    writeFileSync(legacy, JSON.stringify(data));
    const hostId = f.storage.hostId();
    const accounts = await Promise.all([f.storage.read(), f.newStorage().read()]);
    for (const account of accounts) assert.equal(account.profiles[0].refreshToken, 'legacy-refresh');
    assert.deepEqual(f.writes, ['chatgpt/accounts.json']);
    assert.equal(existsSync(legacy), false);
    assert.equal(f.newStorage().hostId(), hostId);
    assert.deepEqual(require('fs').readdirSync(f.storage.directory), ['accounts.json']);
});

test('failed migration retains local credentials and retries; existing synced data takes precedence', async t => {
    const f = fixture(t);
    const legacy = path.join(f.directory, 'siyuan-plugin-copilot', 'chatgpt', 'accounts.json');
    writeFileSync(legacy, JSON.stringify({ profiles: [{ id: 'legacy', clientId: 'legacy', accessToken: 'old' }] }));
    f.setSaveCode(403);
    await assert.rejects(f.storage.read(), /Failed to save ChatGPT accounts/);
    assert.equal(existsSync(legacy), true);
    f.setSaveCode(0);
    assert.equal((await f.storage.read()).profiles[0].accessToken, 'old');
    await f.storage.write({ profiles: [{ id: 'synced', clientId: 'synced' }] });
    writeFileSync(legacy, JSON.stringify({ profiles: [{ id: 'legacy', clientId: 'legacy', accessToken: 'old' }] }));
    const writesBefore = f.writes.length;
    const account = (await f.newStorage().read()).profiles[0];
    assert.equal(account.id, 'synced');
    assert.equal(account.accessToken, undefined);
    assert.equal(f.writes.length, writesBefore);
});

test('another workspace can use synced credentials; open clients observe synced account selection and logout', async t => {
    const f = fixture(t);
    await saved(f);
    const originalWorkspace = f.workspace;
    const sourceClient = f.client();
    const secondWorkspace = path.join(f.directory, 'other-workspace');
    cpSync(originalWorkspace, secondWorkspace, { recursive: true });
    f.switchWorkspace(secondWorkspace);
    const syncedClient = f.client();
    assert.equal((await syncedClient.account()).sharing, true);
    f.route(async url => {
        if (url.pathname === '/v1/models') return response({ models: [] });
        if (url.pathname.endsWith('/oauth/revoke')) return response({});
    });
    await syncedClient.models();
    assert.equal(f.requests.some(request => request.url.pathname.endsWith('/oauth/token')), false);
    const remoteStorage = f.newStorage();
    const data = await remoteStorage.read();
    data.profiles.push({ ...data.profiles[0], id: 'second-client', clientId: 'second-client' });
    await remoteStorage.write(data);
    await syncedClient.selectAccount('second-client');
    cpSync(secondWorkspace, originalWorkspace, { recursive: true });
    assert.equal((await sourceClient.account()).id, 'second-client');
    assert.equal(await syncedClient.logout(), true);
    cpSync(secondWorkspace, originalWorkspace, { recursive: true });
    assert.equal((await sourceClient.account()).connected, false);
    assert.equal((await f.storage.read()).profiles[1].refreshToken, undefined);
});

test('browser PKCE validates state, exchanges issued client id and saves verified credentials through SiYuan', async t => {
    const f = fixture(t);
    f.browser(async url => {
        assert.equal(url.origin, issuer);
        assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
        assert.equal(url.searchParams.get('agent_name_hint'), 'SiYuan Copilot');
        assert.match(url.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
        assert.equal(url.searchParams.get('scope'), scope);
        const callback = new URL(url.searchParams.get('redirect_uri'));
        assert.equal(callback.hostname, '127.0.0.1');
        callback.search = new URLSearchParams({ code: 'fake-code', client_id: 'issued-client', state: 'wrong-state' });
        assert.equal((await fetch(callback)).status, 400);
        callback.searchParams.set('state', url.searchParams.get('state'));
        assert.equal((await fetch(callback)).status, 200);
    });
    f.route(async (url, options, body) => {
        if (!url.pathname.endsWith('/oauth/token')) return;
        const form = new URLSearchParams(body);
        assert.equal(form.get('client_id'), 'issued-client');
        assert.equal(form.get('redirect_uri'), f.opened.searchParams.get('redirect_uri'));
        const hash = require('crypto').createHash('sha256').update(form.get('code_verifier')).digest('base64url');
        assert.equal(hash, f.opened.searchParams.get('code_challenge'));
        return response({ access_token: 'fake-access', refresh_token: 'fake-refresh', token_type: 'Bearer', expires_in: 3600,
            scope, id_token: await identity('issued-client', f.opened.searchParams.get('nonce')) });
    });
    const client = f.client();
    await client.login(new AbortController().signal);
    assert.equal((await client.account()).email, 'test@example.com');
    assert.equal((await client.account()).sharing, true);
    assert.equal('accessToken' in await client.account(), false);
    assert.equal((await f.storage.read()).profiles[0].clientId, 'issued-client');
    assert.ok(f.writes.every(filename => filename === 'chatgpt/accounts.json'));
});

test('identity signature, audience and nonce are required; failed exchange retains inactive registration', async t => {
    const f = fixture(t);
    const oauth = f.load('src/chatgpt/oauth.ts');
    const token = await identity('issued-client', 'good-nonce');
    await assert.rejects(oauth.verifyIdentity(token, 'another-client', 'good-nonce'));
    await assert.rejects(oauth.verifyIdentity(token, 'issued-client', 'bad-nonce'), /chatgptInvalidIdentity/);
    const segments = token.split('.');
    segments[2] = 'invalid';
    await assert.rejects(oauth.verifyIdentity(segments.join('.'), 'issued-client', 'good-nonce'));
    f.browser(async url => {
        const callback = new URL(url.searchParams.get('redirect_uri'));
        callback.search = new URLSearchParams({ code: 'fake-code', client_id: 'issued-client', state: url.searchParams.get('state') });
        await fetch(callback);
    });
    f.route(async url => url.pathname.endsWith('/oauth/token') ? response({ error: 'invalid_grant' }, 400) : undefined);
    await assert.rejects(f.client().login(new AbortController().signal), /invalid_grant/);
    assert.equal((await f.storage.read()).activeId, undefined);
    assert.equal((await f.storage.read()).profiles[0].clientId, 'issued-client');
    assert.equal((await f.storage.read()).profiles[0].accessToken, undefined);
});

test('cancelled authorization closes callback listener and performs no token exchange', async t => {
    const f = fixture(t);
    const controller = new AbortController();
    f.browser(async () => controller.abort());
    await assert.rejects(f.client().login(controller.signal), /Request aborted/);
    await assert.rejects(fetch(f.opened.searchParams.get('redirect_uri')));
    assert.equal(f.requests.length, 0);
});

test('rotating refresh is serialized across windows; account model order and visibility are respected', async t => {
    const f = fixture(t);
    await saved(f, 0);
    let refreshes = 0;
    f.route(async (url, options, body) => {
        if (url.pathname.endsWith('/oauth/token')) {
            refreshes++;
            assert.equal(new URLSearchParams(body).get('refresh_token'), 'fake-refresh');
            await new Promise(resolve => setTimeout(resolve, 20));
            return response({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 3600 });
        }
        if (url.pathname === '/v1/models') {
            assert.equal(options.headers.Authorization, 'Bearer rotated-access');
            return response({ models: [{ slug: 'second', display_name: 'Second', visibility: 'list' },
                { slug: 'hidden', visibility: 'hide' }, { slug: 'first', display_name: 'First', visibility: 'list' }] });
        }
    });
    const lists = await Promise.all([f.client().models(), f.client().models()]);
    assert.equal(refreshes, 1);
    assert.equal(lists[0].map(model => model.id).join(','), 'second,first,gpt-6.1-sol,gpt-6.1-luna');
    assert.equal((await f.storage.read()).profiles[0].refreshToken, 'rotated-refresh');
    f.route(async url => url.pathname === '/v1/models' ? response({ models: [
        { slug: 'gpt-6.1-sol', display_name: 'Official Sol', visibility: 'list' },
        { slug: 'first', display_name: 'First', visibility: 'list' },
    ] }) : undefined);
    const current = await f.client().models();
    assert.equal(current.map(model => model.id).join(','), 'gpt-6.1-sol,first,gpt-6.1-luna');
    assert.equal(current[0].name, 'Official Sol');
    f.route(async url => url.pathname === '/v1/models' ? response({ models: [
        { slug: 'gpt-6.1-luna', display_name: 'Official Luna', visibility: 'list' },
        { slug: 'gpt-6.1-sol', display_name: 'Official Sol', visibility: 'list' },
    ] }) : undefined);
    const listed = await f.client().models();
    assert.equal(listed.map(model => model.id).join(','), 'gpt-6.1-luna,gpt-6.1-sol');
    assert.equal(listed[0].name, 'Official Luna');
});

test('invalid refresh clears tokens but retains account mapping; transient failure preserves session', async t => {
    const f = fixture(t);
    await saved(f, 0);
    f.route(async url => url.pathname.endsWith('/oauth/token') ? response({ error: 'server_error' }, 503) : undefined);
    await assert.rejects(f.client().models(), /server_error/);
    assert.equal((await f.storage.read()).profiles[0].refreshToken, 'fake-refresh');
    f.route(async url => url.pathname.endsWith('/oauth/token') ? response({ error: 'invalid_grant' }, 400) : undefined);
    await assert.rejects(f.client().models(), /chatgptSignInRequired/);
    assert.equal((await f.storage.read()).profiles[0].refreshToken, undefined);
    assert.equal((await f.storage.read()).profiles[0].clientId, 'issued-client');
});

test('missing plan consent blocks inference and logout syncs cleared credentials after revocation failure', async t => {
    const f = fixture(t);
    await saved(f);
    const data = await f.storage.read();
    data.profiles[0].scopes = ['openid'];
    await f.storage.write(data);
    await assert.rejects(f.client().models(), /chatgptPermissionRequired/);
    assert.equal(f.requests.length, 0);
    f.route(async url => url.pathname.endsWith('/oauth/revoke') ? response({ error: 'server_error' }, 503) : undefined);
    assert.equal(await f.client().logout(), false);
    assert.equal((await f.storage.read()).profiles[0].accessToken, undefined);
    assert.equal((await f.storage.read()).profiles[0].clientId, 'issued-client');
});

test('Responses body preserves images and tool-round reasoning with ordered results and no unsupported fields', t => {
    const f = fixture(t);
    const chat = f.load('src/chatgpt/chat.ts');
    const first = { type: 'function_call', call_id: 'call-1', name: 'siyuan', arguments: '{}', namespace: 'siyuan_copilot' };
    const second = { ...first, call_id: 'call-2' };
    const reasoning = { type: 'reasoning', encrypted_content: 'fake-encrypted-context', summary: [] };
    const body = chat.buildResponsesBody({ model: 'account-model', temperature: 0.3, maxTokens: 100,
        customBody: { store: true, previous_response_id: 'unsafe' }, tools: [{ type: 'function', function: { name: 'siyuan' } }],
        messages: [{ role: 'system', content: 'Instructions' },
            { role: 'user', content: [{ type: 'text', text: 'Inspect this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
            { role: 'assistant', content: '', tool_calls: [{ id: 'call-1' }, { id: 'call-2' }],
                openaiResponseTurns: [[reasoning, first], [reasoning, second]], finalReply: 'Done' },
            { role: 'tool', tool_call_id: 'call-1', content: 'first result' },
            { role: 'tool', tool_call_id: 'call-2', content: 'second result' }] });
    assert.equal(body.instructions, 'Instructions');
    assert.equal(body.input[0].content[1].type, 'input_image');
    assert.equal(body.input.map(item => item.type || item.role).join(','),
        'user,reasoning,function_call,function_call_output,reasoning,function_call,function_call_output,assistant');
    assert.equal(body.input[1].encrypted_content, 'fake-encrypted-context');
    assert.equal(body.tools[0].type, 'namespace');
    assert.equal(body.tools[0].tools[0].name, 'siyuan');
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    for (const field of ['temperature', 'max_output_tokens', 'previous_response_id', 'customBody']) assert.equal(field in body, false);
});

test('ChatGPT sends blob image bytes with the original MIME type, including history, without mutating messages', async t => {
    const f = fixture(t);
    await saved(f);
    const { chatChatGPT } = f.load('src/chatgpt/chat.ts');
    t.after(() => f.load('src/chatgpt/client.ts').getChatGPTClient().dispose());
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'base64');
    const types = ['image/png', 'image/jpeg', 'image/webp'];
    const urls = types.map(type => URL.createObjectURL(new Blob([bytes], { type })));
    t.after(() => urls.forEach(url => URL.revokeObjectURL(url)));
    const image = url => ({ type: 'image_url', image_url: { url } });
    const remote = 'https://example.com/image.png';
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
    const messages = [
        { role: 'user', content: [{ type: 'text', text: '历史图片' }, image(urls[0])] },
        { role: 'assistant', content: '收到' },
        { role: 'user', content: [{ type: 'text', text: '翻译图片' }, ...urls.map(image), image(dataUrl), image(remote)] },
    ];
    const original = JSON.stringify(messages);
    let requests = 0;
    f.route(async (url, options, body) => {
        if (url.pathname !== '/v1/responses') return;
        requests++;
        const { input } = JSON.parse(body);
        assert.equal(input[0].content[1].image_url, dataUrl);
        assert.equal(input[2].content[0].text, '翻译图片');
        types.forEach((type, index) => {
            const part = input[2].content[index + 1];
            assert.equal(part.type, 'input_image');
            assert.equal(part.image_url, `data:${type};base64,${bytes.toString('base64')}`);
        });
        assert.equal(input[2].content[4].image_url, dataUrl);
        assert.equal(input[2].content[5].image_url, remote);
        return response(events({ type: 'response.completed', response: { status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'Translation' }] }] } }));
    });
    let answer = '';
    await chatChatGPT({ model: 'account-model', messages, onComplete: text => { answer = text; } });
    assert.equal(requests, 1);
    assert.equal(answer, 'Translation');
    assert.equal(JSON.stringify(messages), original);
});

test('unreadable or empty blob images report an error before sending a ChatGPT request', async t => {
    const f = fixture(t);
    const { chatChatGPT } = f.load('src/chatgpt/chat.ts');
    const revoked = URL.createObjectURL(new Blob(['image'], { type: 'image/png' }));
    URL.revokeObjectURL(revoked);
    const empty = URL.createObjectURL(new Blob([], { type: 'image/png' }));
    t.after(() => URL.revokeObjectURL(empty));
    for (const url of [revoked, empty]) {
        let failure;
        await chatChatGPT({ model: 'account-model', messages: [{ role: 'user',
            content: [{ type: 'image_url', image_url: { url } }] }],
            onError: error => { failure = error; },
            onComplete: () => assert.fail('An unreadable image cannot succeed'),
        });
        assert.ok(failure instanceof Error);
        assert.match(failure.message, /fetch failed|Image is empty/);
    }
    assert.equal(f.requests.length, 0);
});

test('aborting image preparation does not send a ChatGPT request', async t => {
    const f = fixture(t);
    const { chatChatGPT } = f.load('src/chatgpt/chat.ts');
    const url = URL.createObjectURL(new Blob(['image'], { type: 'image/png' }));
    t.after(() => URL.revokeObjectURL(url));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(chatChatGPT({ model: 'account-model', signal: controller.signal,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }],
    }), /Request aborted/);
    assert.equal(f.requests.length, 0);
});

test('fragmented UTF-8 SSE completes text and preserves tool output for sidebar approval', async t => {
    const f = fixture(t);
    const { consumeResponses } = f.load('src/chatgpt/chat.ts');
    const text = Buffer.concat(events({ type: 'response.output_text.delta', delta: '中文' },
        { type: 'response.completed', response: { status: 'completed', output: [] } }));
    let streamed = '';
    let completed;
    await consumeResponses(response(Array.from(text, byte => Buffer.from([byte]))), {
        onChunk: chunk => streamed += chunk, onComplete: value => completed = value,
    });
    assert.equal(streamed, '中文');
    assert.equal(completed, '中文');
    const items = [{ type: 'reasoning', encrypted_content: 'fake-context' },
        { type: 'function_call', name: 'siyuan', namespace: 'siyuan_copilot', call_id: 'call-id', arguments: '{}' }];
    let toolCompleted = false;
    await consumeResponses(response(events({ type: 'response.completed', response: { status: 'completed', output: items } })), {
        tools: [{ function: { name: 'siyuan' } }],
        onComplete: () => assert.fail('Tool turns must wait for tool results'),
        onToolCallComplete: async (calls, raw) => { assert.equal(calls[0].id, 'call-id'); assert.equal(raw[0].encrypted_content, 'fake-context'); toolCompleted = true; },
    });
    assert.equal(toolCompleted, true);
});

test('stream failures after partial text and unconfirmed termination never report success', async t => {
    const f = fixture(t);
    const { consumeResponses } = f.load('src/chatgpt/chat.ts');
    for (const terminal of [{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } },
        { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }, null]) {
        const values = [{ type: 'response.output_text.delta', delta: 'partial' }, ...(terminal ? [terminal] : [])];
        await assert.rejects(consumeResponses(response(events(...values), 200, { 'x-request-id': 'test-request' }), {
            onComplete: () => assert.fail('Failed stream cannot succeed'),
        }), terminal?.type === 'response.failed' ? /chatgptUsageLimit.*test-request/ : /max_output_tokens|chatgptIncompleteStream/);
    }
});

test('item completion events preserve tools and reasoning when the terminal output is empty', async t => {
    const f = fixture(t);
    const { consumeResponses, buildResponsesInput } = f.load('src/chatgpt/chat.ts');
    const reasoning = { type: 'reasoning', id: 'reasoning-id', encrypted_content: 'final-context', summary: [] };
    const call = { type: 'function_call', id: 'item-id', name: 'siyuan', namespace: 'siyuan_copilot',
        call_id: 'call-id', arguments: '{"action":"search"}' };
    let executions = 0;
    await consumeResponses(response(events(
        { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, encrypted_content: 'partial-context' } },
        { type: 'response.output_item.done', output_index: 1, item: call },
        { type: 'response.output_item.done', output_index: 0, item: reasoning },
        { type: 'response.completed', response: { status: 'completed', output: [] } },
    )), {
        tools: [{ function: { name: 'siyuan' } }],
        onComplete: () => assert.fail('A tool turn must not become an empty answer'),
        onToolCallComplete: async (calls, raw) => {
            executions++;
            assert.equal(calls[0].function.arguments, call.arguments);
            assert.equal(raw[0].encrypted_content, 'final-context');
            const next = buildResponsesInput([
                { role: 'assistant', content: '', tool_calls: calls, openaiResponseTurns: [raw] },
                { role: 'tool', tool_call_id: 'call-id', content: 'search result' },
            ]);
            assert.equal(next.input.map(item => item.type).join(','), 'reasoning,function_call,function_call_output');
            assert.equal(next.input[2].output, 'search result');
        },
    });
    assert.equal(executions, 1);
});

test('item and terminal output are merged without executing a tool twice', async t => {
    const f = fixture(t);
    const { consumeResponses } = f.load('src/chatgpt/chat.ts');
    const item = { type: 'function_call', name: 'siyuan', call_id: 'call-id', arguments: '{}' };
    await consumeResponses(response(events(
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { status: 'completed', output: [item] } },
    )), { tools: [{ function: { name: 'siyuan' } }], onToolCallComplete: (calls, raw) => {
        assert.equal(calls.length, 1);
        assert.equal(raw.length, 1);
    } });
});

test('ChatGPT request continues with an approved tool result and produces the final answer', async t => {
    const f = fixture(t);
    await saved(f);
    const { chatChatGPT } = f.load('src/chatgpt/chat.ts');
    t.after(() => f.load('src/chatgpt/client.ts').getChatGPTClient().dispose());
    let turns = 0;
    f.route(async (url, options, body) => {
        if (url.pathname !== '/v1/responses') return;
        turns++;
        const request = JSON.parse(body);
        assert.equal(request.tools[0].tools[0].name, 'siyuan');
        if (turns === 1) return response(events(
            { type: 'response.output_item.done', output_index: 0, item: {
                type: 'reasoning', encrypted_content: 'final-context', summary: [],
            } },
            { type: 'response.output_item.done', output_index: 1, item: {
                type: 'function_call', name: 'siyuan', namespace: 'siyuan_copilot', call_id: 'call-id', arguments: '{}',
            } },
            { type: 'response.completed', response: { status: 'completed', output: [] } },
        ));
        assert.equal(turns, 2);
        assert.equal(request.input[1].encrypted_content, 'final-context');
        assert.equal(request.input[2].call_id, 'call-id');
        assert.equal(request.input[3].type, 'function_call_output');
        assert.equal(request.input[3].output, 'approved result');
        return response(events(
            { type: 'response.output_text.delta', delta: '查找完成' },
            { type: 'response.completed', response: { status: 'completed', output: [] } },
        ));
    });
    let answer = '';
    let approved = 0;
    const options = { model: 'account-model', messages: [{ role: 'user', content: '查找笔记' }],
        tools: [{ function: { name: 'siyuan' } }],
        onComplete: value => { answer = value; },
        onToolCallComplete: async (calls, raw) => {
            approved++;
            options.messages.push({ role: 'assistant', content: '', tool_calls: calls, openaiResponseTurns: [raw] },
                { role: 'tool', tool_call_id: calls[0].id, content: 'approved result' });
            await chatChatGPT(options);
        },
    };
    await chatChatGPT(options);
    assert.equal(approved, 1);
    assert.equal(turns, 2);
    assert.equal(answer, '查找完成');
});

test('item-only text or refusal produces a final answer and awaits its callback', async t => {
    const f = fixture(t);
    const { consumeResponses } = f.load('src/chatgpt/chat.ts');
    for (const part of [{ type: 'output_text', text: '中文回复' }, { type: 'refusal', refusal: '无法执行' }]) {
        let saved = false;
        await consumeResponses(response(events(
            { type: 'response.output_item.done', output_index: 0, item: { type: 'message', content: [part] } },
            { type: 'response.completed', response: { status: 'completed', output: [] } },
        )), { onComplete: async text => {
            assert.equal(text, part.text || part.refusal);
            await new Promise(resolve => setTimeout(resolve, 10));
            saved = true;
        } });
        assert.equal(saved, true);
    }
});

test('empty and reasoning-only completions report an error instead of saving a blank reply', async t => {
    const f = fixture(t);
    const { consumeResponses } = f.load('src/chatgpt/chat.ts');
    for (const output of [[], [{ type: 'reasoning', summary: [] }]]) {
        await assert.rejects(consumeResponses(response(events(
            { type: 'response.completed', response: { status: 'completed', output } },
        ), 200, { 'x-request-id': 'empty-request' }), {
            onComplete: () => assert.fail('Empty responses cannot succeed'),
        }), /chatgptEmptyResponse.*empty-request/);
    }
});

test('item-only tools remain blocked on failure, missing completion or unknown namespace', async t => {
    const f = fixture(t);
    const { consumeResponses } = f.load('src/chatgpt/chat.ts');
    const item = { type: 'function_call', name: 'siyuan', namespace: 'other_namespace', call_id: 'call-id', arguments: '{}' };
    for (const terminal of [null, { type: 'response.failed', response: { error: { message: 'failed turn' } } },
        { type: 'response.completed', response: { status: 'completed', output: [] } }]) {
        await assert.rejects(consumeResponses(response(events(
            { type: 'response.output_item.done', output_index: 0, item }, ...(terminal ? [terminal] : []),
        )), { tools: [{ function: { name: 'siyuan' } }],
            onComplete: () => assert.fail('Invalid tool turn cannot succeed'),
            onToolCallComplete: () => assert.fail('Invalid tool turn cannot execute'),
        }), /chatgptIncompleteStream|failed turn|chatgptUnknownTool/);
    }
});

test('unknown function namespaces are rejected before tool execution', async t => {
    const f = fixture(t);
    const { consumeResponses } = f.load('src/chatgpt/chat.ts');
    await assert.rejects(consumeResponses(response(events({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'function_call', name: 'siyuan', namespace: 'other_namespace', call_id: 'call-id', arguments: '{}' },
    ] } })), { tools: [{ function: { name: 'siyuan' } }], onToolCallComplete: () => assert.fail('Unknown tool executed') }), /chatgptUnknownTool/);
});
