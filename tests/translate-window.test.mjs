import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const origin = 'http://127.0.0.1:6806';
const name = 'siyuan-plugin-copilot';
const helperSource = read('src/utils/translateWindow.ts');
const indexAst = ts.createSourceFile('index.ts', read('src/index.ts'), ts.ScriptTarget.Latest, true);
const pluginClass = indexAst.statements.find(ts.isClassDeclaration);
const openMethod = pluginClass.members.find(node => node.name?.getText(indexAst) === 'openTranslateWindow');
const sidebarScript = read('src/ai-sidebar.svelte').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const sidebarAst = ts.createSourceFile('sidebar.ts', sidebarScript, ts.ScriptTarget.Latest, true);
const openDialog = sidebarAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'openTranslateDialog');

function helperFixture(windows = []) {
    const sandbox = {
        exports: {}, URL,
        window: { require: () => ({ BrowserWindow: { getAllWindows: () => windows } }) },
    };
    vm.runInNewContext(compile(helperSource), sandbox);
    return { ...sandbox.exports, sandbox };
}

function nativeWindow({ kernelOrigin = origin, pluginName = name, type = 'copilot-translate', destroyed = false } = {}) {
    const url = new URL('/stage/build/app/window.html', kernelOrigin);
    url.searchParams.set('json', JSON.stringify([{ children: {
        instance: 'Custom', customModelType: pluginName + type,
        customModelData: { provider: 'custom_test', modelId: 'test-model' },
    } }]));
    const calls = [];
    return {
        calls, isDestroyed: () => destroyed, isMinimized: () => true,
        restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus'),
        webContents: { getURL: () => url.href },
    };
}

test('只有桌面客户端打开独立窗口，浏览器与手机保留内置翻译', () => {
    const helpers = helperFixture();
    for (const frontend of ['desktop', 'desktop-window', 'browser-desktop', 'browser-mobile', 'mobile']) {
        const calls = [];
        const state = {
            ...helpers, getFrontend: () => frontend,
            plugin: { openTranslateWindow: (...args) => calls.push(args) },
            currentProvider: 'custom_test', currentModelId: 'test-model',
            translateProvider: '', translateModelId: '', isTranslateDialogOpen: false, showTranslateHistory: true,
        };
        vm.runInNewContext(compile(openDialog.getText(sidebarAst)), state);
        state.openTranslateDialog();
        const desktop = frontend === 'desktop' || frontend === 'desktop-window';
        assert.equal(calls.length, desktop ? 1 : 0);
        assert.equal(state.isTranslateDialogOpen, !desktop);
        if (desktop) assert.deepEqual(calls[0], ['custom_test', 'test-model']);
        else {
            assert.equal(state.showTranslateHistory, false);
            assert.equal(state.translateProvider, 'custom_test');
        }
    }
});

test('只复用同一内核、同一插件的翻译窗口，忽略其他窗口和失效窗口', () => {
    const target = nativeWindow();
    const otherWindows = [
        nativeWindow({ kernelOrigin: 'http://127.0.0.1:6807' }),
        nativeWindow({ pluginName: 'another-plugin' }), nativeWindow({ type: 'ai-chat-tab' }),
        nativeWindow({ destroyed: true }), { isDestroyed: () => false, webContents: { getURL: () => 'about:blank' } },
    ];
    const helpers = helperFixture([...otherWindows, target]);
    assert.equal(helpers.findTranslateWindow(name, origin), target);
    helpers.focusTranslateWindow(target);
    assert.deepEqual(target.calls, ['restore', 'show', 'focus']);
    helpers.sandbox.window.require = undefined;
    assert.equal(helpers.findTranslateWindow(name, origin), null);
});

function openerFixture({ existing = null, deferTab = false, fail = false } = {}) {
    let resolveTab;
    const calls = [];
    const tab = { close: () => calls.push('close-tab') };
    const state = {
        exports: {}, window: { location: { origin } }, Date,
        console: { error() {} }, setTimeout: callback => { existing ||= nativeWindow(); callback(); },
        findTranslateWindow: () => existing,
        focusTranslateWindow: win => calls.push(['focus', win]),
        TRANSLATE_TAB_TYPE: 'copilot-translate', i18n: () => '翻译', pushErrMsg: error => calls.push(['error', error]),
        openTab: options => {
            calls.push(['tab', options]);
            if (fail) throw new Error('open failed');
            return deferTab ? new Promise(resolve => { resolveTab = resolve; }) : Promise.resolve(tab);
        },
        openWindow: options => calls.push(['window', options]),
    };
    vm.runInNewContext(compile(`class Opener { name = '${name}'; app = {}; ${openMethod.getText(indexAst)} }
        exports.Opener = Opener;`), state);
    return { plugin: new state.exports.Opener(), calls, tab, resolveTab: () => resolveTab(tab) };
}

test('原生窗口携带当前模型；连续点击仅创建一次，已有窗口只唤起', async () => {
    const f = openerFixture({ deferTab: true });
    const first = f.plugin.openTranslateWindow('custom_test', 'test-model');
    const second = f.plugin.openTranslateWindow('another', 'another-model');
    assert.equal(first, second);
    f.resolveTab();
    await first;
    assert.equal(f.calls.filter(call => call[0] === 'tab').length, 1);
    const options = f.calls.find(call => call[0] === 'tab')[1];
    assert.equal(options.custom.id, name + 'copilot-translate');
    assert.equal(options.custom.data.provider, 'custom_test');
    assert.equal(options.custom.data.modelId, 'test-model');
    assert.equal(f.calls.find(call => call[0] === 'window')[1].tab, f.tab);
    await f.plugin.openTranslateWindow();
    assert.equal(f.calls.filter(call => call[0] === 'tab').length, 1);
    assert.equal(f.calls.filter(call => call[0] === 'focus').length, 1);
});

test('打开失败后可重试；卸载期间不再创建窗口并关闭临时标签页', async () => {
    const failing = openerFixture({ fail: true });
    await failing.plugin.openTranslateWindow();
    assert.equal(failing.plugin.translateWindowOpening, null);
    assert.equal(failing.calls.filter(call => call[0] === 'error').length, 1);
    await failing.plugin.openTranslateWindow();
    assert.equal(failing.calls.filter(call => call[0] === 'tab').length, 2);

    const f = openerFixture({ deferTab: true });
    const opening = f.plugin.openTranslateWindow();
    f.plugin.translateWindowDisposed = true;
    f.resolveTab();
    await opening;
    assert.equal(f.calls.includes('close-tab'), true);
    assert.equal(f.calls.some(call => call[0] === 'window'), false);
    await f.plugin.openTranslateWindow();
    assert.equal(f.calls.filter(call => call[0] === 'tab').length, 1);
});

test('销毁翻译组件会取消请求，迟到的流式回调不再写历史或弹错误', async () => {
    const script = read('src/components/TranslateDialog.svelte').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    const ast = ts.createSourceFile('translator.ts', script, ts.ScriptTarget.Latest, true);
    // 执行组件脚本，剔除模块导入和响应式入口，由夹具控制挂载与请求生命周期。
    const body = ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isLabeledStatement(node))
        .map(node => node.getText(ast).replace(/^export /, '')).join('\n');
    let onDestroy;
    let request;
    const writes = [];
    const notices = [];
    const state = {
        exports: {}, AbortController, console, createEventDispatcher: () => () => {},
        onDestroy: callback => { onDestroy = callback; },
        i18n: key => key, tf: key => key,
        pushMsg: message => notices.push(message), pushErrMsg: message => notices.push(message),
        chat: async (_provider, options) => { request = options; },
    };
    vm.runInNewContext(compile(body + `
        plugin = { saveData: async (...args) => writes.push(args) };
        providers = { custom_test: { apiKey: 'test', models: [{ id: 'model' }] } };
        translateProvider = 'custom_test'; translateModelId = 'model'; translateInputText = 'hello';
        exports.start = performTranslate;
    `), { ...state, writes });
    await state.exports.start();
    assert.equal(request.signal.aborted, false);
    onDestroy();
    assert.equal(request.signal.aborted, true);
    request.onChunk('迟到的片段');
    await request.onComplete('迟到的结果');
    request.onError(new Error('迟到的错误'));
    assert.deepEqual(writes, []);
    assert.deepEqual(notices, []);
});
