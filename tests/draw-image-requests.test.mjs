import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/ai-sidebar.svelte', import.meta.url), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile('sidebar.ts', source, ts.ScriptTarget.Latest, true);
const functions = ['requestDrawImages', 'requestSingleDrawImages', 'requestGeminiDrawImages', 'extractGeminiImagesFromResponse']
    .map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast))
    .join('\n');
const compiled = ts.transpileModule(functions, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function fixture(gemini = false, references = []) {
    const requests = [];
    const published = [];
    const saveGates = new Map();
    const controller = new AbortController();
    let settled = 0;
    const state = {
        DOMException, FormData, File, Blob,
        isGeminiImageApi: () => gemini,
        getGeminiImageEndpointUrl: () => 'https://example.test/generateContent',
        getOpenAIImageEndpointUrl: (_, endpoint) => `https://example.test${endpoint}`,
        buildGeminiDrawImageConfig: () => ({ aspectRatio: '3:4', imageSize: '2K' }),
        buildGeminiImageParts: async prompt => [{ text: prompt }, ...references.map(image => ({ image: image.name }))],
        getOpenAIDrawImageSize: () => '1024x1536',
        getDrawImageCapabilities: () => ({ qualities: ['high'] }),
        imageAttachmentToBlob: async () => new Blob(['reference'], { type: 'image/png' }),
        getImageApiError: async () => 'upstream error', i18n: key => key, tf: (key, value) => `${key}: ${value}`,
        fetch: (url, options) => {
            const pending = deferred();
            requests.push({ url, options, ...pending });
            return pending.promise;
        },
        saveGeneratedImageFromApiResult: async image => {
            const id = image.id || image.data;
            if (saveGates.has(id)) await saveGates.get(id).promise;
            return { id, path: `/data/assets/${id}.png` };
        },
    };
    vm.runInNewContext(compiled, state);
    return {
        requests, published, saveGates, controller, settled: () => settled,
        start: (count = 3) => state.requestDrawImages(
            { apiKey: 'test-key' }, { id: gemini ? 'gemini-image' : 'gpt-image' }, 'same prompt', references,
            controller.signal, { count, quality: 'high', aspectRatio: '3:4', resolution: '2K' }, 'provider',
            image => published.push(image.id), () => { settled++; }
        ),
        respond(index, id) {
            requests[index].resolve({ ok: true, json: async () => gemini
                ? { candidates: [{ content: { parts: [{ inlineData: { data: id, mimeType: 'image/png' } }] } }] }
                : { data: [{ id }] },
            });
        },
    };
}

for (const gemini of [false, true]) {
    const provider = gemini ? 'Gemini' : 'OpenAI 兼容';
    test(`${provider} 三张图并发请求，每张保存后立即发布，不等待其他图片或资源保存`, async () => {
        const f = fixture(gemini);
        const batch = f.start();
        await flush();
        assert.equal(f.requests.length, 3);
        for (const request of f.requests) {
            const body = JSON.parse(request.options.body);
            assert.equal(request.options.signal, f.controller.signal);
            if (gemini) {
                assert.equal(body.contents[0].parts[0].text, 'same prompt');
                assert.equal(body.generationConfig.imageConfig.imageSize, '2K');
            } else {
                assert.equal(body.n, 1);
                assert.equal(body.prompt, 'same prompt');
                assert.equal(body.quality, 'high');
            }
        }
        const gate = deferred();
        f.saveGates.set('second', gate);
        f.respond(1, 'second');
        f.respond(0, 'first');
        await flush();
        assert.deepEqual(f.published, ['first']);
        assert.equal(f.settled(), 1);
        gate.resolve();
        await flush();
        assert.deepEqual(f.published, ['first', 'second']);
        assert.equal(f.settled(), 2);
        f.respond(2, 'third');
        await batch;
        assert.deepEqual(f.published, ['first', 'second', 'third']);
        assert.equal(f.settled(), 3);
    });

    test(`${provider} 一张失败后其他请求继续发布，全部结束再汇总错误`, async () => {
        const f = fixture(gemini);
        const batch = f.start();
        let finished = false;
        const checked = assert.rejects(batch, /upstream unavailable/).then(() => { finished = true; });
        await flush();
        f.requests[0].reject(new Error('upstream unavailable'));
        f.respond(1, 'success');
        await flush();
        assert.deepEqual(f.published, ['success']);
        assert.equal(f.settled(), 2);
        assert.equal(finished, false);
        f.respond(2, 'last');
        await checked;
        assert.deepEqual(f.published, ['success', 'last']);
        assert.equal(f.settled(), 3);
    });
}

test('OpenAI 兼容编辑按张提交 n=1，每个请求保留全部参考图', async () => {
    const f = fixture(false, [{ name: 'base.png' }, { name: 'reference.png' }]);
    const batch = f.start(2);
    await flush();
    assert.equal(f.requests.length, 2);
    for (const { url, options } of f.requests) {
        assert.ok(url.endsWith('/images/edits'));
        assert.equal(options.body.get('n'), '1');
        assert.equal(options.body.get('prompt'), 'same prompt');
        assert.deepEqual(options.body.getAll('image').map(image => image.name), ['base.png', 'reference.png']);
    }
    f.respond(0, 'edit-a');
    await flush();
    assert.deepEqual(f.published, ['edit-a']);
    f.respond(1, 'edit-b');
    await batch;
});

test('取消后忽略迟到的网络和保存结果，保留取消前已发布的图片', async () => {
    const f = fixture();
    const batch = f.start();
    const checked = assert.rejects(batch, error => error.name === 'AbortError');
    await flush();
    f.respond(0, 'completed');
    await flush();
    const gate = deferred();
    f.saveGates.set('saving', gate);
    f.respond(1, 'saving');
    await flush();
    f.controller.abort();
    gate.resolve();
    f.respond(2, 'late-network');
    await checked;
    assert.deepEqual(f.published, ['completed']);
    assert.equal(f.settled(), 1);
});

test('只生成一张仍只发起一次请求，空结果报告错误且不发布图片', async () => {
    const f = fixture();
    const batch = f.start(1);
    const checked = assert.rejects(batch, /aiSidebarDrawNoImages/);
    await flush();
    assert.equal(f.requests.length, 1);
    f.requests[0].resolve({ ok: true, json: async () => ({ data: [] }) });
    await checked;
    assert.equal(f.published.length, 0);
    assert.equal(f.settled(), 1);
});
