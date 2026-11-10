import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const utility = { exports: {} };
vm.runInNewContext(compile(read('../src/utils/drawImageConfig.ts')), utility);
const config = utility.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const source = read('../src/ai-sidebar.svelte').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile('sidebar.ts', source, ts.ScriptTarget.Latest, true);
const functions = [
    'roundToDrawSizeUnit', 'normalizeDrawImagePixelSize', 'parseDrawImageSizeValue',
    'findKnownDrawRatioLabel', 'formatDrawRatio', 'createDrawImageSizeOption',
    'createDrawImageSizeOptionFromRatio', 'getPromptImageSizeMatch', 'getPromptImageRatioMatch',
    'applyPromptDrawImageSize', 'requestGeminiDrawImages', 'requestDrawImages', 'requestSingleDrawImages', 'isGeminiImageApi',
    'getCurrentDrawImageSettings',
];

function fixture(model = 'gemini-3-pro-image-4k', isGemini = true) {
    const requests = [];
    const capabilities = config.getDrawImageCapabilities(model, isGemini);
    const sandbox = {
        ...config, DOMException, FormData, File, currentProvider: 'custom', DRAW_IMAGE_SIZE_STEP: 16,
        DRAW_IMAGE_BASE_UNIT: 640, drawImageCount: 1, drawImageAspectRatio: 'auto',
        drawImageResolution: capabilities.defaultResolution, drawImageResolutionExplicit: false,
        drawIsGemini: isGemini, drawCapabilities: capabilities, drawImageQuality: 'auto',
        i18n: key => key, tf: (key, ...args) => `${key}: ${args.join(' ')}`,
        getGeminiImageEndpointUrl: () => `https://example.invalid/v1beta/models/${model}:generateContent`,
        getOpenAIImageEndpointUrl: (_, endpoint) => `https://example.invalid/v1${endpoint}`,
        buildGeminiImageParts: async prompt => [{ text: prompt }],
        imageAttachmentToBlob: async () => new Blob(['fixture'], { type: 'image/png' }),
        extractGeminiImagesFromResponse: data => data,
        saveGeneratedImageFromApiResult: async image => image,
        fetch: async (url, options) => {
            const body = options.body instanceof FormData
                ? Object.fromEntries(options.body.entries()) : JSON.parse(options.body);
            requests.push({ url, ...options, body });
            return { ok: true, json: async () => ({ images: [{ data: 'fixture' }] }) };
        },
    };
    const declarations = functions.map(name => {
        const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
        assert.ok(node, `Missing ${name}`);
        return node.getText(ast);
    }).join('\n');
    vm.runInNewContext(compile(declarations), sandbox);
    return { sandbox, requests, request: async (images = []) => {
        await sandbox.requestDrawImages({ apiKey: 'fixture-key' }, { id: model },
            '封面', images, new AbortController().signal, sandbox.getCurrentDrawImageSettings(),
            sandbox.currentProvider, () => {}, () => {});
        return requests;
    } };
}

test('自动识别的 3008×4016 在 Gemini 请求中同时携带 3:4 与 4K', async () => {
    const { sandbox, request } = fixture();
    sandbox.applyPromptDrawImageSize('画一张 3008x4016 3:4 竖版封面');
    const requests = await request();
    assert.deepEqual(requests[0].body.generationConfig.imageConfig, { aspectRatio: '3:4', imageSize: '4K' });
    assert.equal(requests[0].body.quality, undefined);
});

test('手动设置比例和分辨率优先，单独识别比例不覆盖 4K', async () => {
    const { sandbox, request } = fixture();
    sandbox.applyPromptDrawImageSize('3:4 竖版封面');
    assert.equal(sandbox.drawImageResolution, '4K');
    sandbox.drawImageAspectRatio = '16:9';
    sandbox.drawImageResolution = '2K';
    sandbox.drawImageResolutionExplicit = true;
    sandbox.applyPromptDrawImageSize('3008x4016 3:4 竖版封面');
    const requests = await request();
    assert.deepEqual(requests[0].body.generationConfig.imageConfig, { aspectRatio: '16:9', imageSize: '2K' });
});

test('独立的 4:5 提示词可以自动识别为比例', () => {
    const { sandbox } = fixture();
    sandbox.applyPromptDrawImageSize('4:5 竖版封面');
    assert.equal(sandbox.drawImageAspectRatio, '4:5');
    assert.equal(sandbox.drawImageResolution, '4K');
});

test('Gemini 自动比例仍传分辨率，多张生成复用所选配置', async () => {
    const { sandbox, request } = fixture();
    sandbox.drawImageCount = 3;
    const requests = await request();
    assert.equal(requests.length, 3);
    for (const item of requests) assert.deepEqual(item.body.generationConfig.imageConfig, { imageSize: '4K' });
});

test('Gemini 2.5 不传 imageSize，0.5K 仅向支持的模型提供', () => {
    assert.deepEqual(plain(config.buildGeminiDrawImageConfig('gemini-2.5-flash-image', '3:4', '4K')), { aspectRatio: '3:4' });
    assert.equal(config.buildGeminiDrawImageConfig('gemini-2.5-flash-image', 'auto', '1K'), null);
    assert.deepEqual(plain(config.getDrawImageCapabilities('gemini-3-pro-image', true).resolutions), ['1K', '2K', '4K']);
    assert.deepEqual(plain(config.buildGeminiDrawImageConfig('gemini-3.1-flash-image', '4:5', '512')), { aspectRatio: '4:5', imageSize: '512' });
    assert.deepEqual(plain(config.getDrawImageCapabilities('gemini-3.1-flash-lite-image', true).resolutions), ['1K']);
});

test('GPT 文生图发送 size 与 quality，比例不再与质量混合', async () => {
    const { sandbox, request } = fixture('gpt-image-2.5-sunburst', false);
    sandbox.drawImageAspectRatio = '3:4';
    sandbox.drawImageQuality = 'max';
    sandbox.drawImageCount = 3;
    const requests = await request();
    assert.equal(requests[0].body.size, '1152x1536');
    assert.equal(requests[0].body.quality, 'max');
    assert.equal(requests.length, 3);
    for (const item of requests) assert.equal(item.body.n, 1);
    assert.equal(requests[0].body.generationConfig, undefined);
    assert.ok(requests[0].url.endsWith('/images/generations'));
});

test('GPT 图生图表单使用同一比例和质量，并保留原图上传', async () => {
    const { sandbox, request } = fixture('gpt-image-2', false);
    sandbox.drawImageAspectRatio = '16:9';
    sandbox.drawImageQuality = 'high';
    const requests = await request([{ name: 'fixture.png' }]);
    assert.ok(requests[0].url.endsWith('/images/edits'));
    assert.equal(requests[0].body.size, '1536x864');
    assert.equal(requests[0].body.quality, 'high');
    assert.equal(requests[0].body.image.name, 'fixture.png');
});

test('切换模型只提供支持的比例和质量，旧 GPT 不发送 max', async () => {
    const caps = plain(config.getDrawImageCapabilities('gpt-image-1.5', false));
    assert.deepEqual(caps.aspectRatios, ['auto', '1:1', '3:2', '2:3']);
    assert.deepEqual(caps.qualities, ['auto', 'low', 'medium', 'high']);
    const { sandbox, request } = fixture('gpt-image-1.5', false);
    sandbox.drawImageQuality = 'max';
    const requests = await request();
    assert.equal(requests[0].body.quality, 'auto');
    assert.equal(config.getOpenAIDrawImageSize('gpt-image-1.5', '2:3'), '1024x1536');
    assert.equal(config.getOpenAIDrawImageSize('dall-e-3', '16:9'), '1792x1024');
});

test('自动识别自定义像素尺寸的分辨率在横竖版一致', () => {
    for (const [width, height, expected] of [[3008, 4016, '4K'], [1792, 2400, '2K'], [896, 1200, '1K']]) {
        assert.equal(config.inferDrawImageResolution(width, height), expected);
        assert.equal(config.inferDrawImageResolution(height, width), expected);
        assert.equal(config.getClosestDrawAspectRatio(width, height), '3:4');
        assert.equal(config.getClosestDrawAspectRatio(height, width), '4:3');
    }
});

test('图片快照请求不受当前面板的模型平台、数量和质量影响', async () => {
    const { sandbox, requests } = fixture('gpt-image-2.5-sunburst', false);
    sandbox.currentProvider = 'gemini';
    sandbox.drawImageCount = 10;
    sandbox.drawImageAspectRatio = '1:1';
    sandbox.drawImageQuality = 'low';
    const snapshot = { aspectRatio: '3:4', resolution: '4K', quality: 'max', count: 1 };
    await sandbox.requestDrawImages({ apiKey: 'fixture' }, { id: 'gpt-image-2.5-sunburst' }, 'saved prompt', [],
        new AbortController().signal, snapshot, 'openai', () => {}, () => {});
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.size, '1152x1536');
    assert.equal(requests[0].body.quality, 'max');
    assert.equal(requests[0].body.n, 1);
    assert.equal(requests[0].body.generationConfig, undefined);
});

test('ChatGPT 绘图使用账号通道并携带原始参考图、比例、质量与取消信号', async () => {
    const { sandbox, requests } = fixture('gpt-image-2.6-flare', false);
    const imageRequests = [];
    sandbox.currentProvider = 'codex';
    sandbox.blobToBase64String = async () => 'AQIDBA==';
    sandbox.getChatGPTImageClient = () => ({ generate: async options => {
        imageRequests.push(options);
        return [{ b64_json: 'result' }];
    } });
    const controller = new AbortController();
    const results = [];
    await sandbox.requestDrawImages({}, { id: 'gpt-image-2.6-flare' }, 'cat', [{ path: 'assets/original.png' }],
        controller.signal, { count: 2, aspectRatio: '9:16', quality: 'max', resolution: '1K' }, 'codex',
        image => results.push(image), () => {});
    assert.equal(requests.length, 0);
    assert.equal(imageRequests.length, 2);
    assert.equal(results.length, 2);
    for (const request of imageRequests) {
        assert.equal(request.prompt, 'cat');
        assert.equal(request.size, '864x1536');
        assert.equal(request.quality, 'max');
        assert.equal(request.signal, controller.signal);
        assert.deepEqual(plain(request.images), ['data:image/png;base64,AQIDBA==']);
    }
});

test('ChatGPT 绘图控件仅展示订阅通道支持的比例和质量', () => {
    const caps = plain(config.getDrawImageCapabilities('gpt-image-2.6-flare', false, 'codex'));
    assert.deepEqual(caps.aspectRatios, ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16']);
    assert.deepEqual(caps.qualities, ['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
    assert.deepEqual(caps.resolutions, []);
    assert.equal(config.getOpenAIDrawImageSize('gpt-image-2.6-flare', '21:9', 'codex'), 'auto');
    assert.equal(config.getOpenAIDrawImageSize('gpt-image-2.6-flare', '9:16', 'codex'), '864x1536');
});
