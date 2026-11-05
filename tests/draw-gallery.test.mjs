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

test('重启后只有已发送的生图请求时恢复失败卡片，保留原始记录且不修改历史', () => {
    const sessionModule = { exports: {} };
    vm.runInNewContext(compile(read('../src/utils/sessionState.ts')), sessionModule);
    const original = [{ role: 'user', content: 'original', drawGeneration: context(), attachments: [image('reference')] }];
    const saved = sessionModule.exports.createChatSessionSnapshot(original, 'draw', false, true);
    const reopened = sessionModule.exports.recoverChatSession(JSON.parse(JSON.stringify(saved))).snapshot;
    const before = JSON.stringify(reopened.messages);
    const cards = gallery.getDrawGalleryCards(reopened.messages);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].interrupted, true);
    assert.equal(cards[0].prompt, 'original');
    assert.equal(cards[0].generation.modelId, 'gemini-3-pro-image-4k');
    assert.equal(cards[0].generation.settings.resolution, '4K');
    assert.equal(cards[0].referenceImages[0].path, '/data/assets/original-reference.png');
    assert.equal('image' in cards[0], false);
    assert.equal(JSON.stringify(reopened.messages), before);
    assert.equal(gallery.getDrawGalleryItems(reopened.messages).length, 0);
});

test('当前生图请求运行中不显示失败卡片，较早中断的请求仍然可重试', () => {
    const messages = [
        { role: 'user', content: 'interrupted', drawGeneration: context('interrupted') },
        { role: 'user', content: 'running', drawGeneration: context('running') },
    ];
    const running = gallery.getDrawGalleryCards(messages, true);
    assert.deepEqual(plain(running).map(card => card.prompt), ['interrupted']);
    const stopped = gallery.getDrawGalleryCards(messages, false);
    assert.deepEqual(plain(stopped).map(card => card.prompt), ['running', 'interrupted']);
    assert.equal(new Set(stopped.map(card => card.key)).size, 2);
});

test('接口失败与旧格式错误只显示一张失败卡片，重试成功的新图排在失败记录前', () => {
    for (const error of [{ drawGenerationError: 'upstream unavailable', content: '❌ failed' }, { content: '❌ legacy error' }]) {
        const messages = [
            { role: 'user', content: 'failed prompt', drawGeneration: context('failed prompt') },
            { role: 'assistant', ...error },
            { role: 'user', content: 'retry prompt', drawGeneration: context('retry prompt') },
            { role: 'assistant', content: '', attachments: [image('success-a'), image('success-b')] },
        ];
        const cards = gallery.getDrawGalleryCards(messages);
        assert.equal(cards.length, 3);
        assert.deepEqual(plain(cards).map(card => card.image?.name || card.prompt), ['success-a', 'success-b', 'failed prompt']);
        assert.equal(cards[2].error, error.drawGenerationError || error.content);
        assert.equal(cards[2].interrupted, false);
        assert.equal(cards[2].generation.prompt, 'failed prompt');
        assert.equal(cards[2].referenceImages[0].name, 'original-reference');
    }
});

test('普通已完成文字对话和空会话不产生失败卡片，空的助手占位不算完成', () => {
    assert.equal(gallery.getDrawGalleryCards([{ role: 'system', content: 'system' }]).length, 0);
    assert.equal(gallery.getDrawGalleryCards([
        { role: 'user', content: 'question' }, { role: 'assistant', content: 'answer' },
    ]).length, 0);
    const incomplete = gallery.getDrawGalleryCards([
        { role: 'user', content: 'legacy image request', attachments: [image('legacy reference')] },
        { role: 'assistant', content: '' },
    ]);
    assert.equal(incomplete[0].interrupted, true);
    assert.equal(incomplete[0].referenceImages[0].name, 'legacy reference');
});

test('画廊合并全部生成结果，附件和 generatedImages 不重复，旧 Markdown 图片仍可见', () => {
    const messages = [
        { role: 'user', content: 'first prompt', attachments: [image('reference')] },
        { role: 'assistant', content: 'done', generatedImages: [image('a'), image('b')], attachments: [image('a'), image('b')] },
        { role: 'user', content: 'second prompt' },
        { role: 'assistant', content: '![legacy](/data/legacy.png)' },
    ];
    const originalMessages = JSON.stringify(messages);
    const cards = gallery.getDrawGalleryItems(messages);
    assert.equal(cards.length, 3);
    assert.equal(cards[0].prompt, 'second prompt');
    assert.equal(cards[1].prompt, 'first prompt');
    assert.equal(cards[2].prompt, 'first prompt');
    assert.equal(cards[0].image.path, '/data/legacy.png');
    assert.deepEqual(plain(cards).map(card => card.image.name), ['legacy', 'a', 'b']);
    assert.equal(new Set(cards.map(card => card.key)).size, 3);
    assert.equal(JSON.stringify(messages), originalMessages);
    const reopened = gallery.getDrawGalleryItems(JSON.parse(originalMessages));
    assert.deepEqual(plain(reopened).map(card => card.key), plain(cards).map(card => card.key));
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
    assert.equal(cards[1].prompt, 'branch A');
    assert.deepEqual(cards[0].generation.history, ['earlier B', 'branch B']);
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
        ...gallery, AbortController, console, currentProvider: 'current-provider', currentModelId: 'gpt-image-2', chatMode: 'draw',
        isLoading: false, isAborted: false, currentSessionId: 'session', drawEditingContext: null,
        drawDraftIsRegeneration: false, drawDraftRestoreVersion: 0, isDestroyed: false,
        messages: [{ role: 'user', content: 'old prompt' }, { role: 'assistant', content: '', attachments: [image('unrelated')] }],
        currentInput: 'create a new image', currentAttachments: [], contextDocuments: [], protyle: null,
        i18n: key => key, pushErrMsg: text => notices.push(text), hasUnsavedChanges: false,
        transformEditorMarkdownForSend: value => value, normalizeDrawImageCount() {}, applyPromptDrawImageSize() {},
        modelSupportsImageGeneration: model => !!model,
        getCurrentDrawImageSettings: () => ({ aspectRatio: '16:9', resolution: '1K', quality: 'low', count: 2 }),
        getProviderAndModelConfig: (provider, model) => ({ providerConfig: { id: provider }, modelConfig: { id: model } }),
        getCurrentProviderConfig: () => ({ id: 'current-provider' }),
        getCurrentModelConfig: () => ({ id: 'gpt-image-2' }),
        getMessageText: content => typeof content === 'string' ? content : '',
        tick: async () => {},
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
        handleModelSelect: event => { state.currentProvider = event.detail.provider; state.currentModelId = event.detail.modelId; },
        setProtyleContent: content => { state.editorContent = content; },
        clearProtyle() {},
        loadAsset: async path => `loaded:${path}`, scrollToBottom: async () => {}, scrollToTop: async () => {},
        collectDrawModeContextDocuments: async () => [], buildDrawPromptWithContext: prompt => prompt,
        buildDrawPromptWithSystemPrompt: prompt => `system + ${prompt}`,
        buildDrawAssistantContent: () => 'done', createGeneratedImageFileName: () => 'result.png',
        saveCurrentSession: async () => {}, autoRenameSession() {},
        requestDrawImages: async (...args) => {
            requests.push(args);
            return [{ name: 'result.png', mimeType: 'image/png', path: '/data/result.png', previewUrl: 'blob:result' }];
        },
    };
    const functions = ['hydrateDrawReferenceImages', 'createDrawAssistantMessage', 'regenerateDrawGalleryImage', 'sendDrawModeMessage', 'regenerateMessage'];
    const code = functions.map(name => {
        const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
        assert.ok(node, name);
        return node.getText(ast);
    }).join('\n');
    vm.runInNewContext(compile(code), state);
    return { state, requests, notices };
}

test('点击重新生成只恢复原提示词、参考图和参数，不请求接口或修改历史', async () => {
    const { state, requests } = fixture();
    const generation = context();
    const before = plain(generation);
    const originalMessages = [...state.messages];
    let focused = false;
    state.protyle = { focus: () => { focused = true; } };
    await state.regenerateDrawGalleryImage({ image: image('selected'), prompt: 'original', generation });
    assert.equal(requests.length, 0);
    assert.equal(state.isLoading, false);
    assert.equal(state.currentInput, 'original');
    assert.equal(state.editorContent, 'original');
    assert.equal(focused, true);
    assert.equal(state.currentProvider, 'original-provider');
    assert.equal(state.currentModelId, 'gemini-3-pro-image-4k');
    assert.equal(state.drawImageAspectRatio, '3:4');
    assert.equal(state.drawImageResolution, '4K');
    assert.equal(state.drawImageQuality, 'high');
    assert.equal(state.drawImageCount, 1);
    assert.equal(state.currentAttachments[0].name, 'original-reference');
    assert.equal(state.currentAttachments[0].data, 'loaded:/data/assets/original-reference.png');
    originalMessages.forEach((message, index) => assert.equal(state.messages[index], message));
    assert.deepEqual(plain(generation), before);
});

test('没有结果图的失败卡片也能恢复提示词和参考图，点击重试不调用接口', async () => {
    const { state, requests } = fixture();
    state.messages = [{ role: 'user', content: 'failed original', drawGeneration: context('failed original') }];
    const failed = gallery.getDrawGalleryCards(state.messages)[0];
    assert.equal('image' in failed, false);
    await state.regenerateDrawGalleryImage(failed);
    assert.equal(requests.length, 0);
    assert.equal(state.currentInput, 'failed original');
    assert.equal(state.currentAttachments[0].data, 'loaded:/data/assets/original-reference.png');
    assert.equal(state.drawImageResolution, '4K');
    assert.equal(state.messages.length, 1);
});

test('修改恢复的提示词和参考图后发送才生成，旧图及后续结果保留', async () => {
    const { state, requests } = fixture();
    const generation = context('original image prompt');
    state.messages = [
        { role: 'user', content: 'original image prompt', drawGeneration: generation },
        { role: 'assistant', content: '', drawGeneration: generation, attachments: [image('original-a'), image('original-b')] },
        { role: 'user', content: 'later prompt' },
        { role: 'assistant', content: '', attachments: [image('later-result')] },
    ];
    const originals = [...state.messages];
    await state.regenerateMessage(1);
    assert.equal(requests.length, 0);
    assert.equal(state.currentInput, 'original image prompt');
    assert.equal(state.messages.length, 4);
    state.currentInput = 'modified prompt';
    state.currentAttachments = [image('replacement-reference')];
    state.isLoading = true;
    await state.sendDrawModeMessage({ id: state.currentProvider }, { id: state.currentModelId });
    assert.equal(requests.length, 1);
    assert.equal(requests[0][2], 'system + modified prompt');
    assert.equal(requests[0][3][0].name, 'replacement-reference');
    originals.forEach((message, index) => assert.equal(state.messages[index], message));
    assert.deepEqual(plain(gallery.getDrawGalleryItems(state.messages)).map(card => card.image.name),
        ['result.png', 'later-result', 'original-a', 'original-b']);
    assert.equal(gallery.getDrawGalleryItems(JSON.parse(JSON.stringify(state.messages))).length, 4);
});

test('无参考图的新提示词直接创建新图，不自动携带上一张结果或其他分支对话', async () => {
    const { state, requests } = fixture();
    state.isLoading = true;
    await state.sendDrawModeMessage({ id: 'current-provider' }, { id: 'gpt-image-2' });
    assert.equal(requests[0][3].length, 0);
    assert.equal(requests[0][2], 'system + create a new image');
    assert.deepEqual(plain(state.messages.at(-1).drawGeneration.history), ['create a new image']);
});

test('重新生成编辑分支只恢复原参考图，修改本轮提示词不重复历史或替换为结果图', async () => {
    const { state, requests } = fixture();
    const original = context('old edit');
    original.history = ['first prompt', 'old edit'];
    original.referenceImages = [image('previous-result'), image('original-reference')];
    await state.regenerateDrawGalleryImage({ image: image('selected-result'), prompt: 'old edit', generation: original });
    assert.deepEqual(plain(state.currentAttachments).map(image => image.name), ['previous-result', 'original-reference']);
    assert.equal(state.currentAttachments[0].drawEditSource, true);
    assert.deepEqual(plain(state.drawEditingContext.history), ['first prompt']);
    state.currentInput = 'new edit';
    state.isLoading = true;
    await state.sendDrawModeMessage({ id: state.currentProvider }, { id: state.currentModelId });
    assert.ok(requests[0][2].includes('first prompt'));
    assert.ok(requests[0][2].includes('new edit'));
    assert.ok(!requests[0][2].includes('old edit'));
    const saved = state.messages.at(-1).drawGeneration;
    assert.deepEqual(plain(saved.history), ['first prompt', 'new edit']);
    assert.deepEqual(plain(saved.originalReferenceImages).map(image => image.name), ['original-reference']);
});

test('恢复参考图期间切换会话，迟到的结果不覆盖新会话输入', async () => {
    const { state, requests } = fixture();
    let finish;
    state.loadAsset = () => new Promise(resolve => { finish = resolve; });
    const restoring = state.regenerateDrawGalleryImage({ image: image('selected'), prompt: 'original', generation: context() });
    state.currentSessionId = 'new-session';
    state.currentInput = 'new session draft';
    finish('loaded:old-reference');
    await restoring;
    assert.equal(state.currentInput, 'new session draft');
    assert.equal(state.currentAttachments.length, 0);
    assert.equal(requests.length, 0);
});

test('从用户消息入口重新生成也只填回草稿，不立即发起请求', async () => {
    const { state, requests } = fixture();
    state.messages = [
        { role: 'user', content: 'original', drawGeneration: context() },
        { role: 'assistant', content: '', drawGeneration: context(), attachments: [image('original')] },
    ];
    const originals = state.messages;
    await state.regenerateMessage(0);
    assert.equal(state.messages, originals);
    assert.equal(state.currentInput, 'original');
    assert.equal(requests.length, 0);
});

test('无参考图的文生图重新生成会清除输入区旧参考图，保留可修改提示词', async () => {
    const { state, requests } = fixture();
    const generation = context('text to image');
    generation.referenceImages = [];
    generation.originalReferenceImages = [];
    state.currentAttachments = [image('unrelated-draft')];
    await state.regenerateDrawGalleryImage({ image: image('selected'), prompt: generation.prompt, generation });
    assert.equal(state.currentAttachments.length, 0);
    assert.equal(state.currentInput, 'text to image');
    assert.equal(state.drawDraftIsRegeneration, true);
    assert.equal(requests.length, 0);
});

test('参考图加载失败时保留草稿和原图，不请求生图接口', async () => {
    const { state, requests, notices } = fixture();
    const originals = state.messages;
    state.loadAsset = async () => { throw new Error('reference unavailable'); };
    await state.regenerateDrawGalleryImage({ image: image('selected'), prompt: 'original', generation: context() });
    assert.equal(state.messages, originals);
    assert.equal(state.currentInput, 'create a new image');
    assert.equal(requests.length, 0);
    assert.equal(notices.at(-1), 'reference unavailable');
});
