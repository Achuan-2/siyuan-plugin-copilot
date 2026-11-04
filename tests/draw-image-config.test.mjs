import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/ai-sidebar.svelte', import.meta.url), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile('sidebar.ts', source, ts.ScriptTarget.Latest, true);
const functions = [
    'roundToDrawSizeUnit', 'normalizeDrawImagePixelSize', 'parseDrawImageSizeValue',
    'findKnownDrawRatioLabel', 'formatDrawRatio', 'createDrawImageSizeOption',
    'getPromptImageSizeMatch', 'geminiModelSupportsImageSize',
    'getClosestGeminiAspectRatio', 'getGeminiImageConfig', 'requestGeminiDrawImages',
];

function fixture() {
    const requests = [];
    const sandbox = {
        DRAW_IMAGE_SIZE_STEP: 16, DRAW_IMAGE_SIZE_OPTIONS: [], drawImageCount: 1,
        i18n: key => key, tf: (key, ...args) => `${key}: ${args.join(' ')}`,
        getGeminiImageEndpointUrl: () => 'https://example.invalid/v1beta/models/gemini-3-pro-image-4k:generateContent',
        buildGeminiImageParts: async prompt => [{ text: prompt }],
        extractGeminiImagesFromResponse: data => data,
        saveGeneratedImageFromApiResult: async image => image,
        fetch: async (url, options) => {
            requests.push({ url, ...options, body: JSON.parse(options.body) });
            return { ok: true, json: async () => ({ images: [{ data: 'fixture' }] }) };
        },
    };
    const declarations = functions.map(name => {
        const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
        assert.ok(node, `Missing ${name}`);
        return node.getText(ast);
    }).join('\n');
    vm.runInNewContext(ts.transpileModule(declarations, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, sandbox);
    return { sandbox, requests, config: (model, size) =>
        JSON.parse(JSON.stringify(sandbox.getGeminiImageConfig(model, size))) };
}

test('自动识别的 3008×4016 在 Gemini 原生请求中同时携带 3:4 与 4K', async () => {
    const { sandbox, requests } = fixture();
    const detected = sandbox.getPromptImageSizeMatch('画一张 3008x4016 3:4 竖版封面');
    assert.equal(detected.value, '3008x4016');
    sandbox.drawImageSize = detected.value;
    const signal = new AbortController().signal;
    await sandbox.requestGeminiDrawImages({ apiKey: 'fixture-key' },
        { id: 'gemini-3-pro-image-4k' }, '封面', [], signal);
    assert.deepEqual(requests[0].body.generationConfig.imageConfig, {
        aspectRatio: '3:4', imageSize: '4K',
    });
    assert.equal(requests[0].signal, signal);
});

test('自定义尺寸推断分辨率，横竖版一致，并保留已有预设档位', () => {
    const { config } = fixture();
    for (const [size, aspectRatio, imageSize] of [
        ['4016x3008', '4:3', '4K'], ['3072x4096', '3:4', '4K'],
        ['1504x2000', '3:4', '2K'], ['1792x2400', '3:4', '2K'],
        ['896x1200', '3:4', '1K'], ['4096x4096', '1:1', '4K'],
        ['2048x2048', '1:1', '2K'], ['3840x2160', '16:9', '4K'],
    ]) {
        assert.deepEqual(config('gemini-3-pro-image-preview', size), { aspectRatio, imageSize }, size);
    }
    assert.deepEqual(config('gemini-3-pro-image-4k', '1536x1024'), { aspectRatio: '3:2' });
});

test('Gemini 2.5 保持仅发送比例，自动尺寸继续交由服务端决定', () => {
    const { config } = fixture();
    assert.deepEqual(config('gemini-2.5-flash-image', '3008x4016'), { aspectRatio: '3:4' });
    assert.equal(config('gemini-3-pro-image-4k', 'auto'), null);
    assert.equal(config('gemini-3-pro-image-4k', 'invalid'), null);
});
