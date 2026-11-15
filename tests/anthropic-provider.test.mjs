import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../src/ai-chat.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// 运行完整请求模块，仅替换网络与思源宿主；不读取真实凭据或请求线上服务。
function fixture(response) {
    const requests = [];
    const request = transport => async (url, options) => {
        requests.push({ transport, url, ...options });
        return { ok: true, json: async () => response };
    };
    const sandbox = {
        exports: {}, console,
        fetch: request('fetch'),
        require(id) {
            if (id === './api') return { forwardProxyFetch: request('proxy') };
            if (id === './utils/i18n') return { i18n: key => key };
            return {};
        },
    };
    vm.runInNewContext(compiled, sandbox);
    return { api: sandbox.exports, requests };
}

test('Anthropic 模型列表默认使用原生鉴权并读取显示名称', async () => {
    const { api, requests } = fixture({ data: [{ id: 'claude-fixture', display_name: 'Claude Fixture' }] });
    assert.equal(api.getDefaultChatInterface('anthropic'), 'anthropic');
    const models = await api.fetchModels('anthropic', 'fixture-key');
    assert.equal(requests[0].url, 'https://api.anthropic.com/v1/models');
    assert.equal(requests[0].headers['x-api-key'], 'fixture-key');
    assert.equal(requests[0].headers['anthropic-version'], '2023-06-01');
    assert.equal(requests[0].headers.Authorization, undefined);
    assert.equal(models[0].id, 'claude-fixture');
    assert.equal(models[0].name, 'Claude Fixture');
    assert.equal(models[0].provider, 'Anthropic');
});

test('Anthropic 默认通过 Messages API 发送对话，支持直连和思源代理', async () => {
    for (const useForwardProxy of [false, true]) {
        const { api, requests } = fixture({ content: [{ type: 'text', text: 'Reply' }] });
        let completed;
        await api.chat('anthropic', {
            apiKey: 'fixture-key', model: 'claude-fixture', stream: false, useForwardProxy,
            messages: [{ role: 'system', content: 'System' }, { role: 'user', content: 'Hello' }],
            onComplete: text => { completed = text; },
        });
        const request = requests[0];
        assert.equal(request.transport, useForwardProxy ? 'proxy' : 'fetch');
        assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
        assert.equal(request.headers['x-api-key'], 'fixture-key');
        const body = JSON.parse(request.body);
        assert.equal(body.system, 'System');
        assert.deepEqual(body.messages, [{ role: 'user', content: 'Hello' }]);
        assert.equal(body.model, 'claude-fixture');
        assert.equal(completed, 'Reply');
    }
});
