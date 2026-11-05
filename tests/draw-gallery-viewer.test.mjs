import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/DrawImageGallery.svelte', import.meta.url), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile('viewer.ts', source, ts.ScriptTarget.Latest, true);
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(ast)).join('\n');
const reactions = ast.statements.filter(ts.isLabeledStatement).map(node => node.getText(ast)).join('\n');
const image = name => ({ key: name, prompt: `prompt ${name}`, referenceImages: [],
    image: { type: 'image', name, path: `/data/${name}.png`, data: `blob:${name}` } });

function fixture() {
    let focusRestored = 0;
    const trigger = { focus: () => { focusRestored++; } };
    const state = {
        disabled: false, dispatch() {}, pendingTasks: [],
        selected: null, preview: '', previewRequest: 0, isFullscreen: false,
        items: [image('a'), { key: 'failed', prompt: 'failed', error: 'error', referenceImages: [] }, image('b'), image('c')],
        imageItems: [], selectedIndex: -1, previousFocus: null, previousSession: 'session', sessionKey: 'session',
        document: { activeElement: trigger }, getComputedStyle: node => ({ visibility: node.visibility || 'visible' }),
        dialog: { focus() {}, querySelectorAll: () => [] }, console,
        tick: async () => {}, resolveReferences: async references => references,
    };
    vm.runInNewContext(compile(functions), state);
    const flush = () => vm.runInNewContext(compile(reactions), state);
    flush();
    return { state, flush, restored: () => focusRestored };
}

function key(value, extra = {}) {
    return { key: value, preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; }, ...extra };
}

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function pendingTask(name) {
    return { key: name, prompt: `pending ${name}`, count: 2, status: 'editing',
        referenceImages: [{ name: `reference ${name}`, path: `/data/${name}-ref.png` }],
        generation: { modelId: 'gemini-image', createdAt: 123,
            settings: { aspectRatio: '3:4', resolution: '4K', quality: 'high', count: 2 },
            history: ['previous prompt', `pending ${name}`] } };
}

test('生成中的卡片打开同一个详情，保留任务的提示词、参数和参考图且不参与结果图切换', async () => {
    const { state, flush, restored } = fixture();
    const task = pendingTask('a');
    state.pendingTasks = [task, pendingTask('b')];
    state.resolveReferences = async references => references.map(image => ({ ...image, data: 'blob:reference' }));
    await state.view(task);
    flush();
    assert.equal(state.selected.prompt, 'pending a');
    assert.equal(state.selected.generation, task.generation);
    assert.equal(state.selected.generation.settings.resolution, '4K');
    assert.equal(state.selected.referenceImages[0].data, 'blob:reference');
    assert.equal(task.referenceImages[0].data, undefined);
    assert.equal(state.preview, '');
    assert.equal(state.selectedIndex, -1);
    await state.switchImage(1);
    assert.equal(state.selected.key, task.key);
    state.close();
    assert.equal(restored(), 1);
    assert.equal(state.pendingTasks.length, 2);
});

test('查看任务完成后自动展示同一批次的结果，迟到的参考图不会覆盖结果详情', async () => {
    const { state, flush } = fixture();
    const task = pendingTask('a');
    state.pendingTasks = [task];
    let resolvePending;
    state.resolveReferences = () => new Promise(resolve => { resolvePending = resolve; });
    const opening = state.view(task);
    await settle();
    const result = { ...image('result'), generation: task.generation };
    state.items = [image('unrelated'), result, ...state.items];
    flush();
    assert.equal(state.selected.key, task.key);
    state.resolveReferences = async references => references;
    state.pendingTasks = [];
    flush();
    await settle();
    assert.equal(state.selected.image.name, 'result');
    assert.equal(state.preview, 'blob:result');
    resolvePending(task.referenceImages);
    await opening;
    assert.equal(state.selected.image.name, 'result');
});

test('取消只发送当前任务标识并关闭其详情，外部取消或失败也会清理等待详情', async () => {
    const { state, flush } = fixture();
    const a = pendingTask('a');
    const b = pendingTask('b');
    const events = [];
    state.pendingTasks = [a, b];
    state.dispatch = (...args) => events.push(args);
    await state.view(a);
    state.cancelTask(b.key);
    assert.equal(state.selected.key, a.key);
    state.cancelTask(a.key);
    assert.equal(state.selected, null);
    assert.deepEqual(events, [['cancel', 'b'], ['cancel', 'a']]);
    await state.view(a);
    state.pendingTasks = [b];
    flush();
    assert.equal(state.selected, null);
    assert.equal(state.preview, '');
});

test('放大视图左右切换只遍历成功图片，到达两端不越界，关闭后回到原始入口', async () => {
    const { state, flush, restored } = fixture();
    await state.view(state.items[0]);
    flush();
    await state.switchImage(-1);
    assert.equal(state.selected.image.name, 'a');
    await state.switchImage(1);
    flush();
    assert.equal(state.selected.image.name, 'b');
    assert.equal(state.selected.prompt, 'prompt b');
    assert.equal(state.preview, 'blob:b');
    await state.switchImage(1);
    flush();
    assert.equal(state.selected.image.name, 'c');
    await state.switchImage(1);
    assert.equal(state.selected.image.name, 'c');
    state.close();
    assert.equal(state.selected, null);
    assert.equal(restored(), 1);
});

test('全屏中可以用方向键换图，Esc 先退出全屏，再关闭预览', async () => {
    const { state, flush } = fixture();
    await state.view(state.items[0]);
    flush();
    state.toggleFullscreen();
    const right = key('ArrowRight');
    state.handleKeydown(right);
    await Promise.resolve();
    flush();
    assert.equal(right.defaultPrevented, true);
    assert.equal(right.stopped, true);
    assert.equal(state.selected.image.name, 'b');
    assert.equal(state.isFullscreen, true);
    state.handleKeydown(key('Escape'));
    assert.equal(state.isFullscreen, false);
    assert.equal(state.selected.image.name, 'b');
    state.handleKeydown(key('Escape'));
    assert.equal(state.selected, null);
});

test('后台完成导致卡片下标变化后仍从当前图片切换，参考图预览不会串到下一张', async () => {
    const { state, flush } = fixture();
    await state.view(state.items[2]);
    state.preview = 'blob:reference';
    state.items = [image('new'), ...state.items.map(item => ({ ...item, key: `shifted:${item.key}` }))];
    flush();
    await state.switchImage(1);
    flush();
    assert.equal(state.selected.image.name, 'c');
    assert.equal(state.preview, 'blob:c');
    await state.switchImage(-1);
    assert.equal(state.selected.image.name, 'b');
});

test('快速切换、关闭或更换会话后，迟到的参考图读取不会覆盖或重新打开预览', async () => {
    const { state, flush } = fixture();
    const pending = [];
    state.resolveReferences = () => new Promise(resolve => pending.push(resolve));
    const first = state.view(state.items[0]);
    await settle();
    const second = state.view(state.items[2]);
    await settle();
    pending[1]([{ name: 'reference b' }]);
    await second;
    pending[0]([{ name: 'reference a' }]);
    await first;
    assert.equal(state.selected.image.name, 'b');
    assert.equal(state.selected.referenceImages[0].name, 'reference b');
    const closing = state.view(state.items[3]);
    await settle();
    state.close();
    pending[2]([]);
    await closing;
    assert.equal(state.selected, null);
    const switchingSession = state.view(state.items[0]);
    await settle();
    state.toggleFullscreen();
    state.sessionKey = 'another session';
    flush();
    pending[3]([]);
    await switchingSession;
    assert.equal(state.selected, null);
    assert.equal(state.isFullscreen, false);
});

test('隐藏会话、输入法组合、长按或已处理的按键不会关闭预览或退出其他浮层', async () => {
    const { state } = fixture();
    await state.view(state.items[0]);
    state.toggleFullscreen();
    for (const options of [{ defaultPrevented: true }, { repeat: true }, { isComposing: true }]) {
        state.handleKeydown(key('Escape', options));
        assert.equal(state.isFullscreen, true);
    }
    state.dialog.visibility = 'hidden';
    const hiddenEscape = key('Escape');
    state.handleKeydown(hiddenEscape);
    assert.equal(hiddenEscape.defaultPrevented, undefined);
    assert.equal(state.isFullscreen, true);
});

test('全屏焦点循环跳过隐藏的详情控件', async () => {
    const { state } = fixture();
    await state.view(state.items[0]);
    const focused = [];
    const control = (name, visible) => ({ getClientRects: () => visible ? [{}] : [], focus: () => focused.push(name) });
    const first = control('fullscreen', true);
    const last = control('next', true);
    state.dialog.querySelectorAll = () => [first, last, control('hidden edit', false)];
    state.document.activeElement = last;
    state.handleKeydown(key('Tab'));
    assert.deepEqual(focused, ['fullscreen']);
    state.document.activeElement = first;
    state.handleKeydown(key('Tab', { shiftKey: true }));
    assert.deepEqual(focused, ['fullscreen', 'next']);
});

test('放大图片删除时关闭预览并发送对应图片，提交锁定时不触发删除', async () => {
    const { state } = fixture();
    const events = [];
    state.dispatch = (...args) => events.push(args);
    const target = state.items[2];
    await state.view(target);
    state.disabled = true;
    state.deleteImage(target);
    assert.equal(state.selected.image.name, 'b');
    assert.equal(events.length, 0);
    state.disabled = false;
    state.deleteImage(target);
    assert.equal(state.selected, null);
    assert.deepEqual(events, [['delete', target]]);
});
