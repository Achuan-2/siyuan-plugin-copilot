import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compile(read('../src/utils/drawGallery.ts')), module);
const gallery = module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const image = (name, path = `/data/assets/${name}.png`) => ({ type: 'image', name, path, data: `blob:${name}`, mimeType: 'image/png' });
const settings = { aspectRatio: '3:4', resolution: '4K', quality: 'high', count: 3 };
const context = (prompt = 'original') => gallery.createDrawGenerationContext(prompt, `system + ${prompt}`, [],
    [image('original-reference')], 'original-provider', 'gemini-3-pro-image-4k', settings);

test('画廊合并全部生成结果，附件和 generatedImages 不重复，旧 Markdown 图片仍可见', () => {
    const messages = [
        { role: 'user', content: 'first prompt', attachments: [image('reference')] },
        { role: 'assistant', content: 'done', generatedImages: [image('a'), image('b')], attachments: [image('a'), image('b')] },
        { role: 'user', content: 'second prompt' },
        { role: 'assistant', content: '![legacy](/data/legacy.png)' },
    ];
    const cards = gallery.getDrawGalleryItems(messages);
    assert.equal(cards.length, 3);
    assert.equal(cards[0].prompt, 'first prompt');
    assert.equal(cards[1].prompt, 'first prompt');
    assert.equal(cards[2].prompt, 'second prompt');
    assert.equal(cards[2].image.path, '/data/legacy.png');
    assert.equal(new Set(cards.map(card => card.key)).size, 3);
});

test('生成记录持久化后保留各自的对话和参考图，不依赖最近一条用户消息', () => {
    const a = context('branch A');
    const b = context('branch B');
    b.history.unshift('earlier B');
    const saved = JSON.parse(JSON.stringify([
        { role: 'user', content: 'unrelated last prompt' },
        { role: 'assistant', content: '', generatedImages: [image('a')], drawGeneration: a },
        { role: 'assistant', content: '', generatedImages: [image('b')], drawGeneration: b },
    ]));
    const cards = gallery.getDrawGalleryItems(saved);
    assert.equal(cards[0].prompt, 'branch A');
    assert.deepEqual(cards[1].generation.history, ['earlier B', 'branch B']);
    assert.equal(cards[0].referenceImages[0].path, '/data/assets/original-reference.png');
    assert.ok(!JSON.stringify(saved).includes('blob:original-reference'));
});

test('编辑某张卡片使用该结果和原始参考图，原结果不会随编辑链无限叠加', () => {
    const generation = context();
    generation.referenceImages.unshift(image('previous-result'));
    const refs = gallery.getDrawEditReferences({ image: image('selected-result'), generation, referenceImages: generation.referenceImages });
    assert.deepEqual(plain(refs).map(item => item.name), ['selected-result', 'original-reference']);
    assert.equal(refs[0].drawEditSource, true);
    assert.equal(generation.referenceImages.length, 2);
    const next = gallery.createDrawGenerationContext('next edit', 'request', generation.history, refs, 'p', 'm', settings);
    assert.deepEqual(plain(next.originalReferenceImages).map(item => item.name), ['original-reference']);
    assert.deepEqual(plain(next.history), ['original', 'next edit']);
});

test('生成快照独立于输入框后续修改，并以资源路径恢复参考图', () => {
    const inputSettings = { ...settings };
    const refs = [image('input')];
    const generation = gallery.createDrawGenerationContext('prompt', 'request', ['before'], refs, 'p', 'm', inputSettings);
    inputSettings.resolution = '1K';
    refs[0].name = 'changed';
    assert.equal(generation.settings.resolution, '4K');
    assert.equal(generation.referenceImages[0].name, 'input');
    assert.equal(generation.referenceImages[0].data, '');
    assert.match(gallery.buildDrawBranchPrompt('current edit', generation.history), /before[\s\S]*prompt[\s\S]*current edit/);
    assert.equal(gallery.buildDrawBranchPrompt('new image', []), 'new image');
});

const sidebar = read('../src/ai-sidebar.svelte').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile('sidebar.ts', sidebar, ts.ScriptTarget.Latest, true);
function fixture() {
    const requests = [];
    const notices = [];
    const state = {
        ...gallery, AbortController, console, currentProvider: 'current-provider', currentModelId: 'gpt-image-2',
        isLoading: false, isAborted: false, currentSessionId: 'session', drawEditingContext: null,
        messages: [{ role: 'user', content: 'old prompt' }, { role: 'assistant', content: '', attachments: [image('unrelated')] }],
        currentInput: 'create a new image', currentAttachments: [], contextDocuments: [], protyle: null,
        i18n: key => key, pushErrMsg: text => notices.push(text), hasUnsavedChanges: false,
        transformEditorMarkdownForSend: value => value, normalizeDrawImageCount() {}, applyPromptDrawImageSize() {},
        modelSupportsImageGeneration: model => !!model,
        getCurrentDrawImageSettings: () => ({ aspectRatio: '16:9', resolution: '1K', quality: 'low', count: 2 }),
        getProviderAndModelConfig: (provider, model) => ({ providerConfig: { id: provider }, modelConfig: { id: model } }),
        loadAsset: async path => `loaded:${path}`, scrollToBottom: async () => {},
        collectDrawModeContextDocuments: async () => [], buildDrawPromptWithContext: prompt => prompt,
        buildDrawPromptWithSystemPrompt: prompt => `system + ${prompt}`,
        buildDrawAssistantContent: () => 'done', createGeneratedImageFileName: () => 'result.png',
        saveCurrentSession: async () => {}, autoRenameSession() {},
        requestDrawImages: async (...args) => {
            requests.push(args);
            return [{ name: 'result.png', mimeType: 'image/png', path: '/data/result.png', previewUrl: 'blob:result' }];
        },
    };
    const functions = ['hydrateDrawReferenceImages', 'createDrawAssistantMessage', 'regenerateDrawGalleryImage', 'sendDrawModeMessage'];
    const code = functions.map(name => {
        const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
        assert.ok(node, name);
        return node.getText(ast);
    }).join('\n');
    vm.runInNewContext(compile(code), state);
    return { state, requests, notices };
}

test('重新生成读取卡片保存的模型、提示词、参考图和参数，每次新增一张且不改输入框', async () => {
    const { state, requests } = fixture();
    const generation = context();
    const before = plain(generation);
    state.currentAttachments = [image('current-input')];
    await state.regenerateDrawGalleryImage({ image: image('selected'), prompt: 'original', generation });
    assert.equal(requests[0][0].id, 'original-provider');
    assert.equal(requests[0][1].id, 'gemini-3-pro-image-4k');
    assert.equal(requests[0][2], 'system + original');
    assert.equal(requests[0][3][0].data, 'loaded:/data/assets/original-reference.png');
    assert.deepEqual(plain(requests[0][5]), { ...settings, count: 1 });
    assert.equal(requests[0][6], 'original-provider');
    assert.equal(state.messages.length, 3);
    assert.equal(state.currentInput, 'create a new image');
    assert.equal(state.currentAttachments[0].name, 'current-input');
    assert.deepEqual(plain(generation), before);
});

test('无参考图的新提示词直接创建新图，不自动携带上一张结果或其他分支对话', async () => {
    const { state, requests } = fixture();
    state.isLoading = true;
    await state.sendDrawModeMessage({ id: 'current-provider' }, { id: 'gpt-image-2' });
    assert.equal(requests[0][3].length, 0);
    assert.equal(requests[0][2], 'system + create a new image');
    assert.deepEqual(plain(state.messages.at(-1).drawGeneration.history), ['create a new image']);
    assert.equal(state.messages.at(-1).drawGeneration.referenceImages.length, 0);
});

test('编辑分支保留自身历史，结果和原始参考图一起发送并随新结果保存', async () => {
    const { state, requests } = fixture();
    state.drawEditingContext = context('branch A');
    state.currentInput = 'edit A';
    state.currentAttachments = [{ ...image('selected-A'), drawEditSource: true }, image('original-reference')];
    state.isLoading = true;
    await state.sendDrawModeMessage({ id: 'current-provider' }, { id: 'gpt-image-2' });
    assert.match(requests[0][2], /branch A[\s\S]*edit A/);
    assert.equal(requests[0][3][0].name, 'selected-A');
    const saved = state.messages.at(-1).drawGeneration;
    assert.deepEqual(plain(saved.history), ['branch A', 'edit A']);
    assert.deepEqual(plain(saved.originalReferenceImages).map(image => image.name), ['original-reference']);
});

test('取消卡片生成后不会提交旧结果或覆盖随后启动的新请求状态', async () => {
    const { state } = fixture();
    let finish;
    state.requestDrawImages = () => new Promise(resolve => { finish = resolve; });
    const pending = state.regenerateDrawGalleryImage({ image: image('selected'), prompt: 'original', generation: context() });
    await new Promise(resolve => setImmediate(resolve));
    state.abortController.abort();
    const nextController = new AbortController();
    state.abortController = nextController;
    state.streamingMessage = 'new request';
    state.isLoading = true;
    finish([{ name: 'old.png', path: '/data/old.png', previewUrl: 'blob:old' }]);
    await pending;
    assert.equal(state.messages.length, 2);
    assert.equal(state.abortController, nextController);
    assert.equal(state.isLoading, true);
    assert.equal(state.streamingMessage, 'new request');
});
