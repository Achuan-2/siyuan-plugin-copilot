import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
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

function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'siyuan-chatgpt-test-'));
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
    const context = vm.createContext({ console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
        setInterval, clearInterval, Date, Error, window: { require: native } });
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
    const storage = new (load('src/chatgpt/storage.ts').ChatGPTStorage)();
    const clients = [];
    const client = () => { const value = new (load('src/chatgpt/client.ts').ChatGPTClient)(); clients.push(value); return value; };
    t.after(() => {
        clients.forEach(value => value.dispose());
        assert.equal(path.dirname(directory), path.resolve(tmpdir()));
        assert.ok(path.basename(directory).startsWith('siyuan-chatgpt-test-'));
        rmSync(directory, { recursive: true, force: true });
    });
    const defaultRoute = route;
    return { load, storage, requests, client, get opened() { return opened; },
        route(handler) { route = async (url, options, body) => await handler(url, options, body) ?? defaultRoute(url, options, body); },
        browser(handler) { browser = handler; } };
}

async function identity(clientId, nonce, overrides = {}) {
    return new jose.SignJWT({ nonce, email: 'test@example.com', ...overrides }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(issuer).setAudience(clientId).setSubject('test-subject').setIssuedAt().setExpirationTime('1h').sign(privateKey);
}

function saved(f, expiresAt = Date.now() + 3600000) {
    f.storage.write({ activeId: 'issued-client', profiles: [{ id: 'issued-client', clientId: 'issued-client', issuer,
        subject: 'test-subject', email: 'test@example.com', accessToken: 'fake-access', refreshToken: 'fake-refresh',
        scopes: scope.split(' '), expiresAt }] });
}

function events(...values) {
    return values.map(value => Buffer.from(`data: ${JSON.stringify(value)}\r\n\r\n`));
}

test('browser PKCE validates state, exchanges issued client id and stores verified credentials locally', async t => {
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
    assert.equal(client.account().email, 'test@example.com');
    assert.equal(client.account().sharing, true);
    assert.equal('accessToken' in client.account(), false);
    assert.equal(f.storage.read().profiles[0].clientId, 'issued-client');
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
    assert.equal(f.storage.read().activeId, undefined);
    assert.equal(f.storage.read().profiles[0].clientId, 'issued-client');
    assert.equal(f.storage.read().profiles[0].accessToken, undefined);
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
    saved(f, 0);
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
    assert.equal(f.storage.read().profiles[0].refreshToken, 'rotated-refresh');
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
    saved(f, 0);
    f.route(async url => url.pathname.endsWith('/oauth/token') ? response({ error: 'server_error' }, 503) : undefined);
    await assert.rejects(f.client().models(), /server_error/);
    assert.equal(f.storage.read().profiles[0].refreshToken, 'fake-refresh');
    f.route(async url => url.pathname.endsWith('/oauth/token') ? response({ error: 'invalid_grant' }, 400) : undefined);
    await assert.rejects(f.client().models(), /chatgptSignInRequired/);
    assert.equal(f.storage.read().profiles[0].refreshToken, undefined);
    assert.equal(f.storage.read().profiles[0].clientId, 'issued-client');
});

test('missing plan consent blocks inference and logout clears local credentials after revocation failure', async t => {
    const f = fixture(t);
    saved(f);
    const data = f.storage.read();
    data.profiles[0].scopes = ['openid'];
    f.storage.write(data);
    await assert.rejects(f.client().models(), /chatgptPermissionRequired/);
    assert.equal(f.requests.length, 0);
    f.route(async url => url.pathname.endsWith('/oauth/revoke') ? response({ error: 'server_error' }, 503) : undefined);
    assert.equal(await f.client().logout(), false);
    assert.equal(f.storage.read().profiles[0].accessToken, undefined);
    assert.equal(f.storage.read().profiles[0].clientId, 'issued-client');
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

test('unknown function namespaces are rejected before tool execution', async t => {
    const f = fixture(t);
    const { consumeResponses } = f.load('src/chatgpt/chat.ts');
    await assert.rejects(consumeResponses(response(events({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'function_call', name: 'siyuan', namespace: 'other_namespace', call_id: 'call-id', arguments: '{}' },
    ] } })), { tools: [{ function: { name: 'siyuan' } }], onToolCallComplete: () => assert.fail('Unknown tool executed') }), /chatgptUnknownTool/);
});
