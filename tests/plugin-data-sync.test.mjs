import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function compile(source) {
    return ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
}

const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/ai-sidebar.svelte', import.meta.url), 'utf8')
    .split('<script lang="ts">')[1].split('</script>')[0];
const sidebarAst = ts.createSourceFile('sidebar.ts', sidebarSource, ts.ScriptTarget.Latest, true);

// 执行源码中的函数/响应式语句，避免复制实现；仅替换思源、DOM 和文件接口。
function sidebarCode(name) {
    const node = sidebarAst.statements.find(statement =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    assert.ok(node, `Missing sidebar function: ${name}`);
    return node.getText(sidebarAst);
}

function createPlugin(files = {}, transport = {}) {
    const writes = [];
    const events = [];
    let latestSettings;
    class Plugin {
        name = 'siyuan-plugin-copilot';
        async loadData(file) { return files[file]; }
        async saveData(file, value) {
            if (transport.beforeSave) await transport.beforeSave(file, value);
            if (transport.saveResult && transport.saveResult.code !== 0) return transport.saveResult;
            files[file] = structuredClone(value);
            // SDK 将 JSON 写入文件，undefined 字段不会持久化。
            files[file] = JSON.parse(JSON.stringify(files[file]));
            writes.push(file);
            return { code: 0 };
        }
    }
    const sandbox = {
        exports: {}, console, AbortController, clearTimeout, navigator: transport.navigator,
        setTimeout: (...args) => transport.setTimeout ? transport.setTimeout(...args) : setTimeout(...args),
        async fetch(_url, init) {
            if (transport.beforeRead) await transport.beforeRead(init);
            if (transport.error) throw transport.error;
            const path = JSON.parse(init.body).path;
            const filename = path.split('/').at(-1);
            const value = Object.hasOwn(transport, 'value') ? transport.value : files[filename];
            const status = transport.status || (value === undefined ? 404 : 200);
            return {
                ok: status >= 200 && status < 300, status,
                async json() {
                    if (transport.invalidJson) throw new SyntaxError('invalid JSON');
                    return value === undefined ? { code: 404, msg: 'Not found', data: null } : structuredClone(value);
                },
            };
        },
        window: { dispatchEvent: event => events.push(event.type) },
        CustomEvent: class { constructor(type) { this.type = type; } },
        require(id) {
            if (id === 'siyuan') return { Plugin };
            if (id === './defaultSettings') return {
                getDefaultSettings: () => ({ aiProviders: {}, webApps: [{ id: 'default-app' }], translateTemperature: undefined }),
            };
            if (id === './stores/settings') return {
                updateSettings: value => { latestSettings = value; },
                PLUGIN_DATA_CHANGED_EVENT: 'copilot-data-changed',
            };
            if (id === './utils/settingsStorage') return storageExports;
            if (id === './utils/modelCapabilities') return {
                getModelCapabilities: () => ({ supportsVision: true }),
            };
            if (id === './api') return { pushMsg() {}, pushErrMsg() {} };
            return {};
        },
    };
    const storageSandbox = { ...sandbox, exports: {} };
    vm.runInNewContext(compile(readFileSync(new URL('../src/utils/settingsStorage.ts', import.meta.url), 'utf8')), storageSandbox);
    const storageExports = storageSandbox.exports;
    vm.runInNewContext(compile(indexSource), sandbox);
    const plugin = new sandbox.exports.default();
    plugin.syncWebAppDocks = () => {};
    plugin.syncWebAppCollectionDock = () => {};
    plugin.registerWebAppIcon = () => {};
    return { plugin, writes, events, files, transport, storage: storageExports, get settings() { return latestSettings; } };
}

test('首次安装和缺少默认小程序的现代配置，反复初始化不写文件', async () => {
    for (const stored of [undefined, {
        webApps: [], dataTransfer: { autoSetModelCapabilities: true, sessionData: true },
    }]) {
        const fixture = createPlugin({ 'settings.json': stored });
        await fixture.plugin.loadSettings({ persistMigrations: true });
        await fixture.plugin.loadSettings();
        assert.equal(fixture.settings.webApps.length, 1);
        assert.deepEqual(fixture.writes, []);
    }
});

test('两个实例收到数据更新时只刷新内存，不重载、不回写', async () => {
    const files = { 'settings.json': {
        webApps: [], lastUsedChatMode: 'agent',
        dataTransfer: { autoSetModelCapabilities: true, sessionData: true },
    } };
    const instances = [createPlugin(files), createPlugin(files)];
    for (const fixture of instances) {
        fixture.plugin.onunload = () => assert.fail('Data update must not unload the plugin');
        for (let i = 0; i < 3; i++) await fixture.plugin.onDataChanged();
        assert.deepEqual(fixture.writes, []);
        assert.deepEqual(fixture.events, Array(3).fill('copilot-data-changed'));
        assert.equal(fixture.settings.lastUsedChatMode, 'agent');
    }
});

test('只读加载旧配置不迁移文件、不修改 SDK 缓存', async () => {
    const stored = { aiProviders: { v3: { models: [{ id: 'legacy', name: 'Legacy' }] } } };
    const snapshot = structuredClone(stored);
    const fixture = createPlugin({ 'settings.json': stored });
    await fixture.plugin.loadSettings();
    assert.deepEqual(stored, snapshot);
    assert.deepEqual(fixture.writes, []);
    assert.equal(fixture.settings.aiProviders.customProviders[0].id, 'v3');
});

test('旧平台和模型能力迁移只保存一次，再次初始化不写', async () => {
    const fixture = createPlugin({ 'settings.json': {
        aiProviders: { v3: { models: [{ id: 'legacy', name: 'Legacy' }] } },
    } });
    await fixture.plugin.loadSettings({ persistMigrations: true });
    assert.deepEqual(fixture.writes, ['settings.json']);
    assert.equal(fixture.files['settings.json'].aiProviders.v3, undefined);
    await fixture.plugin.loadSettings({ persistMigrations: true });
    assert.deepEqual(fixture.writes, ['settings.json']);
});

test('旧会话完整迁移后统一保存设置，保留消息，再次初始化不写', async () => {
    const messages = [{ role: 'user', content: '保留原始会话' }];
    const fixture = createPlugin({
        'settings.json': { dataTransfer: { autoSetModelCapabilities: true } },
        'chat-sessions.json': { sessions: [{ id: 'old', messages }] },
    });
    await fixture.plugin.loadSettings({ persistMigrations: true });
    assert.deepEqual(fixture.writes, ['sessions/old.json', 'chat-sessions.json', 'settings.json']);
    assert.equal(fixture.files['sessions/old.json'].messages[0].content, messages[0].content);
    await fixture.plugin.loadSettings({ persistMigrations: true });
    assert.equal(fixture.writes.length, 3);
});

test('接收其他窗口的模式不回写，本地切换模式仍然保存', () => {
    const statement = sidebarAst.statements.find(node =>
        ts.isLabeledStatement(node) && node.getText(sidebarAst).includes('lastRememberedChatMode'));
    assert.ok(statement);
    const writes = [];
    const context = vm.createContext({
        chatMode: 'ask', lastRememberedChatMode: 'ask', isInitialLoading: false,
        settings: { lastUsedChatMode: 'agent' }, tempModelSettings: {},
        selectedToolsAsk: [], selectedTools: [], toolAutoApproveSettingsAsk: {},
        toolAutoApproveSettings: {}, plugin: { saveSettings: value => writes.push(value) },
    });
    const code = compile(statement.getText(sidebarAst));
    vm.runInContext(code, context);
    assert.equal(writes.length, 0);
    context.chatMode = 'draw';
    vm.runInContext(code, context);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].lastUsedChatMode, 'draw');
});

test('自动恢复模型预设不写设置或工具配置，用户应用仍保存', async () => {
    const writes = [];
    const originalSettings = { currentProvider: 'old', currentModelId: 'old-model' };
    const context = vm.createContext({
        settings: originalSettings, tempModelSettings: {}, chatMode: 'ask', previousChatMode: 'ask',
        lastRememberedChatMode: 'ask', selectedToolsAsk: [], selectedTools: [],
        toolAutoApproveSettingsAsk: {}, toolAutoApproveSettings: {},
        tick: () => Promise.resolve(), saveToolsConfig: () => writes.push('tools'),
        cloneSettings: value => structuredClone(value),
        plugin: { saveSettings: async () => writes.push('settings') },
    });
    vm.runInContext(compile(sidebarCode('handleApplyModelSettings')), context);
    const detail = {
        persist: false, chatMode: 'agent', modelSelectionEnabled: true,
        selectedModels: [{ provider: 'new', modelId: 'new-model' }],
        toolSelectionEnabled: true, selectedTools: [{ name: 'new-tool' }],
    };
    await context.handleApplyModelSettings({ detail });
    assert.deepEqual(writes, []);
    assert.equal(context.currentProvider, 'new');
    assert.equal(originalSettings.currentProvider, 'old');
    assert.equal(context.lastRememberedChatMode, 'agent');
    await context.handleApplyModelSettings({ detail: { ...detail, persist: true } });
    await Promise.resolve();
    assert.deepEqual(writes, ['settings', 'tools']);
});

test('初始化等待期间销毁视图，后续不执行迁移或访问 DOM', async () => {
    let resolveSettings;
    const context = vm.createContext({
        isDestroyed: false,
        plugin: { loadSettings: () => new Promise(resolve => { resolveSettings = resolve; }) },
        migrateOldSettings: () => assert.fail('Destroyed view must not continue initialization'),
    });
    vm.runInContext(compile(sidebarCode('initializeSidebar')), context);
    const pending = context.initializeSidebar();
    context.isDestroyed = true;
    resolveSettings({});
    await pending;
});

test('工具配置加载失败保留原值，不开启自动保存；销毁后丢弃读取结果', async () => {
    const context = vm.createContext({
        isDestroyed: false, isToolConfigLoaded: false,
        selectedTools: [{ name: 'existing' }], lastSavedToolsConfigSnapshot: 'existing',
        plugin: { loadData: async () => { throw new Error('offline'); } },
        console: { error() {} },
    });
    vm.runInContext(compile(sidebarCode('loadToolsConfig')), context);
    await context.loadToolsConfig();
    assert.equal(context.selectedTools[0].name, 'existing');
    assert.equal(context.isToolConfigLoaded, false);
    context.isDestroyed = true;
    context.plugin.loadData = async () => ({ selectedTools: [{ name: 'late' }] });
    await context.loadToolsConfig();
    assert.equal(context.selectedTools[0].name, 'existing');
    assert.equal(context.isToolConfigLoaded, false);
});

function configuredSettings(key = 'original-key') {
    return {
        aiProviders: { openai: { apiKey: key, models: [{ id: 'm', name: 'Model' }] }, customProviders: [] },
        dataTransfer: { autoSetModelCapabilities: true, sessionData: true },
        messageFontSize: 18,
    };
}

test('读取失败保留上次有效设置，普通保存也不能覆盖文件', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings() });
    await fixture.plugin.loadSettings();
    fixture.transport.error = new Error('offline');
    const originalError = console.error;
    console.error = () => {};
    try {
        await fixture.plugin.onDataChanged();
        assert.equal(fixture.settings.aiProviders.openai.apiKey, 'original-key');
        const edit = fixture.storage.cloneSettings(fixture.settings);
        edit.messageFontSize = 20;
        await assert.rejects(fixture.plugin.saveSettings(edit), /无法读取/);
        assert.equal(fixture.settings.messageFontSize, 18);
        assert.equal(fixture.files['settings.json'].messageFontSize, 18);
        assert.deepEqual(fixture.writes, []);
    } finally { console.error = originalError; }
});

test('启动读取失败或文件缺失时，旧会话不能触发默认配置回写', async () => {
    for (const fail of [true, false]) {
        const files = { 'chat-sessions.json': { sessions: [{ id: 'old', messages: [{ role: 'user', content: 'history' }] }] } };
        if (fail) files['settings.json'] = configuredSettings();
        const fixture = createPlugin(files, fail ? { error: new Error('offline') } : {});
        const originalError = console.error;
        console.error = () => {};
        try { await fixture.plugin.loadSettings({ persistMigrations: true }); }
        finally { console.error = originalError; }
        assert.deepEqual(fixture.writes, []);
        assert.equal(files['chat-sessions.json'].sessions[0].messages[0].content, 'history');
        if (fail) await assert.rejects(fixture.plugin.saveSettings(fixture.settings), /尚未成功加载/);
    }
});

test('首次安装允许显式修改，缺失文件恢复后只合并修改项', async () => {
    const fixture = createPlugin();
    const edit = await fixture.plugin.loadSettings();
    // 首次启动时配置尚未同步下来；保存前已经恢复，不能用默认平台覆盖它。
    fixture.files['settings.json'] = configuredSettings('synced-key');
    edit.messageFontSize = 22;
    await fixture.plugin.saveSettings(edit);
    assert.equal(fixture.files['settings.json'].aiProviders.openai.apiKey, 'synced-key');
    assert.equal(fixture.files['settings.json'].messageFontSize, 22);
    const fresh = createPlugin();
    const firstEdit = await fresh.plugin.loadSettings();
    firstEdit.messageFontSize = 16;
    await fresh.plugin.saveSettings(firstEdit);
    assert.equal(fresh.files['settings.json'].messageFontSize, 16);
});

test('错误响应、空文件、无效 JSON 和错误类型均不能变成可保存的默认设置', async () => {
    for (const transport of [
        { status: 202, value: { code: -1, msg: 'read failed' } },
        { status: 403, value: { code: 404, msg: 'forbidden' } },
        { value: { code: -1, msg: 'read failed', data: null } },
        { value: '' }, { value: null }, { value: [] }, { value: {} }, { invalidJson: true },
    ]) {
        const fixture = createPlugin({ 'settings.json': configuredSettings() }, transport);
        const originalError = console.error;
        console.error = () => {};
        let edit;
        try { edit = await fixture.plugin.loadSettings({ persistMigrations: true }); }
        finally { console.error = originalError; }
        await assert.rejects(fixture.plugin.saveSettings(edit), /尚未成功加载/);
        assert.deepEqual(fixture.writes, []);
    }
});

test('已存在的配置暂时消失时保留内存且阻止重新创建，恢复后可以保存', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings() });
    const edit = await fixture.plugin.loadSettings();
    delete fixture.files['settings.json'];
    edit.messageFontSize = 20;
    await assert.rejects(fixture.plugin.saveSettings(edit), /无法读取/);
    assert.deepEqual(fixture.writes, []);
    fixture.files['settings.json'] = configuredSettings('restored-key');
    await fixture.plugin.saveSettings(edit);
    assert.equal(fixture.files['settings.json'].aiProviders.openai.apiKey, 'restored-key');
});

test('旧视图修改字体保留同步后的 API Key、新增平台和默认内存值', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings('old-key') });
    const panel = fixture.storage.cloneSettings(await fixture.plugin.loadSettings());
    fixture.files['settings.json'] = configuredSettings('synced-key');
    fixture.files['settings.json'].aiProviders.deepseek = { apiKey: 'new-provider' };
    await fixture.plugin.onDataChanged();
    panel.messageFontSize = 22;
    const saved = await fixture.plugin.saveSettings({ ...panel });
    assert.equal(fixture.files['settings.json'].aiProviders.openai.apiKey, 'synced-key');
    assert.equal(fixture.files['settings.json'].aiProviders.deepseek.apiKey, 'new-provider');
    assert.equal(fixture.files['settings.json'].messageFontSize, 22);
    assert.equal(saved.webApps.length, 1);
});

test('平台、模型数组按 id 合并，保留同步修改的密钥和新增项目', async () => {
    const stored = configuredSettings();
    stored.aiProviders.customProviders = [{ id: 'custom', apiKey: 'old', models: [{ id: 'a', name: 'A', temperature: 1 }] }];
    const fixture = createPlugin({ 'settings.json': stored });
    const edit = await fixture.plugin.loadSettings();
    fixture.files['settings.json'] = structuredClone(stored);
    const remote = fixture.files['settings.json'].aiProviders.customProviders;
    remote[0].apiKey = 'synced';
    remote[0].models.push({ id: 'b', name: 'B' });
    remote.push({ id: 'new', apiKey: 'new-key', models: [] });
    edit.aiProviders.customProviders[0].models[0].temperature = 0.5;
    await fixture.plugin.saveSettings(edit);
    const saved = fixture.files['settings.json'].aiProviders.customProviders;
    assert.equal(saved[0].apiKey, 'synced');
    assert.equal(saved[0].models[0].temperature, 0.5);
    assert.equal(saved[0].models[1].id, 'b');
    assert.equal(saved[1].id, 'new');
});

test('显式删除平台、调整数组顺序和清空字段仍然生效', async () => {
    const stored = configuredSettings();
    stored.translateTemperature = 1;
    stored.aiProviders.customProviders = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const fixture = createPlugin({ 'settings.json': stored });
    const edit = await fixture.plugin.loadSettings();
    fixture.files['settings.json'].aiProviders.customProviders.push({ id: 'remote' });
    delete edit.aiProviders.openai;
    edit.translateTemperature = undefined;
    edit.aiProviders.customProviders = [{ id: 'c' }, { id: 'a' }];
    await fixture.plugin.saveSettings(edit);
    assert.equal(fixture.files['settings.json'].aiProviders.openai, undefined);
    assert.equal(fixture.files['settings.json'].translateTemperature, undefined);
    assert.deepEqual(fixture.files['settings.json'].aiProviders.customProviders.map(item => item.id), ['c', 'a', 'remote']);
});

test('迁移等待期间同步新配置，取消旧设置回写并加载同步结果', async () => {
    const fixture = createPlugin({ 'settings.json': { aiProviders: { v3: { apiKey: 'old', models: [] } } } });
    fixture.plugin.migrateSessions = async () => {
        fixture.files['settings.json'] = configuredSettings('synced-key');
        return false;
    };
    const loaded = await fixture.plugin.loadSettings({ persistMigrations: true });
    assert.equal(loaded.aiProviders.openai.apiKey, 'synced-key');
    assert.equal(fixture.files['settings.json'].aiProviders.openai.apiKey, 'synced-key');
    assert.deepEqual(fixture.writes, []);
});

test('失败保存不更新 store，重试仍保留编辑内容', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings() });
    const edit = await fixture.plugin.loadSettings();
    edit.aiProviders.openai.apiKey = 'edited-key';
    fixture.transport.saveResult = { code: -1, msg: 'write failed' };
    await assert.rejects(fixture.plugin.saveSettings(edit), /保存失败/);
    assert.equal(fixture.settings.aiProviders.openai.apiKey, 'original-key');
    assert.equal(fixture.files['settings.json'].aiProviders.openai.apiKey, 'original-key');
    fixture.transport.saveResult = undefined;
    await fixture.plugin.saveSettings(edit);
    assert.equal(fixture.files['settings.json'].aiProviders.openai.apiKey, 'edited-key');
});

test('连续保存捕获各次编辑快照并按顺序执行，迟到的旧读取不能倒退 store', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings() });
    const edit = await fixture.plugin.loadSettings();
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    fixture.transport.beforeSave = async () => {
        fixture.transport.beforeSave = undefined;
        entered();
        await new Promise(resolve => { release = resolve; });
    };
    edit.messageFontSize = 20;
    const first = fixture.plugin.saveSettings(edit);
    await started;
    edit.messageFontSize = 24;
    const second = fixture.plugin.saveSettings(edit);
    const refresh = fixture.plugin.loadSettings();
    release();
    await Promise.all([first, second, refresh]);
    assert.equal(fixture.files['settings.json'].messageFontSize, 24);
    assert.equal(fixture.settings.messageFontSize, 24);
    assert.equal(fixture.writes.length, 2);
});

test('恢复默认设置只有显式 replace 才整份替换，普通未加载对象禁止保存', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings() });
    await fixture.plugin.loadSettings();
    await assert.rejects(fixture.plugin.saveSettings({ aiProviders: {} }), /尚未成功加载/);
    await fixture.plugin.saveSettings({ aiProviders: {}, messageFontSize: 12 }, { replace: true });
    assert.deepEqual(fixture.files['settings.json'], { aiProviders: {}, messageFontSize: 12 });
});

test('自动迁移保存失败仍能加载原配置，且不发出成功通知', async () => {
    const fixture = createPlugin({ 'settings.json': { aiProviders: { v3: { apiKey: 'legacy-key', models: [] } } } },
        { saveResult: { code: -1 } });
    const originalError = console.error;
    console.error = () => {};
    let loaded;
    try { loaded = await fixture.plugin.loadSettings({ persistMigrations: true }); }
    finally { console.error = originalError; }
    assert.equal(loaded.aiProviders.customProviders[0].apiKey, 'legacy-key');
    assert.equal(fixture.files['settings.json'].aiProviders.v3.apiKey, 'legacy-key');
    assert.deepEqual(fixture.writes, []);
});

test('读取仍从磁盘获取，不使用 SDK 返回的旧缓存', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings('disk-key') });
    fixture.plugin.loadData = async () => configuredSettings('stale-sdk-key');
    const loaded = await fixture.plugin.loadSettings();
    assert.equal(loaded.aiProviders.openai.apiKey, 'disk-key');
});

test('无改动的普通保存不写文件，视图和 store 的嵌套对象相互独立', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings() });
    const edit = await fixture.plugin.loadSettings();
    assert.equal('translateTemperature' in edit, true);
    assert.equal('translateTemperature' in fixture.settings, true);
    await fixture.plugin.saveSettings(edit);
    assert.deepEqual(fixture.writes, []);
    edit.aiProviders.openai.apiKey = 'unsaved';
    assert.equal(fixture.settings.aiProviders.openai.apiKey, 'original-key');
    assert.equal(fixture.files['settings.json'].aiProviders.openai.apiKey, 'original-key');
});

test('SDK 保存超时后阻止后续写入，迟到的完成结果不更新 store', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings() });
    const edit = await fixture.plugin.loadSettings();
    let complete;
    fixture.transport.beforeSave = () => new Promise(resolve => { complete = resolve; });
    fixture.transport.setTimeout = callback => setTimeout(callback, 5);
    edit.messageFontSize = 20;
    await assert.rejects(fixture.plugin.saveSettings(edit), /超时/);
    assert.equal(fixture.settings.messageFontSize, 18);
    edit.messageFontSize = 24;
    await assert.rejects(fixture.plugin.saveSettings(edit), /上次设置保存尚未确认/);
    complete();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fixture.settings.messageFontSize, 18);
    assert.equal(fixture.writes.length, 1);
});

test('排队的设置请求在插件卸载后停止执行', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings() });
    const edit = await fixture.plugin.loadSettings();
    fixture.plugin.getSettingsStorage().dispose();
    edit.messageFontSize = 20;
    await assert.rejects(fixture.plugin.saveSettings(edit), /已卸载/);
    assert.deepEqual(fixture.writes, []);
});

test('同源窗口使用共享锁，交错保存不同字段不会互相覆盖', async () => {
    let lockQueue = Promise.resolve();
    const navigator = { locks: { request(_name, action) {
        const result = lockQueue.then(action);
        lockQueue = result.catch(() => {});
        return result;
    } } };
    const files = { 'settings.json': configuredSettings() };
    const first = createPlugin(files, { navigator });
    const second = createPlugin(files, { navigator });
    const firstEdit = await first.plugin.loadSettings();
    const secondEdit = await second.plugin.loadSettings();
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    first.transport.beforeSave = async () => {
        entered();
        await new Promise(resolve => { release = resolve; });
    };
    firstEdit.aiProviders.openai.apiKey = 'first-window-key';
    const pending = first.plugin.saveSettings(firstEdit);
    await started;
    secondEdit.messageFontSize = 24;
    const other = second.plugin.saveSettings(secondEdit);
    release();
    await Promise.all([pending, other]);
    assert.equal(files['settings.json'].aiProviders.openai.apiKey, 'first-window-key');
    assert.equal(files['settings.json'].messageFontSize, 24);
});

test('读取超时会取消请求并保留有效配置，恢复后能继续加载', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings() });
    await fixture.plugin.loadSettings();
    fixture.transport.setTimeout = callback => setTimeout(callback, 5);
    let aborted = false;
    fixture.transport.beforeRead = ({ signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    });
    const originalError = console.error;
    console.error = () => {};
    try { await fixture.plugin.loadSettings(); }
    finally { console.error = originalError; }
    assert.equal(aborted, true);
    assert.equal(fixture.settings.aiProviders.openai.apiKey, 'original-key');
    fixture.transport.beforeRead = undefined;
    fixture.files['settings.json'] = configuredSettings('recovered-key');
    await fixture.plugin.loadSettings();
    assert.equal(fixture.settings.aiProviders.openai.apiKey, 'recovered-key');
});

test('设置面板同步刷新使用独立副本，初始化补全不会覆盖后续远端禁用平台', async () => {
    const fixture = createPlugin({ 'settings.json': configuredSettings() });
    const loaded = await fixture.plugin.loadSettings();
    const panelSource = readFileSync(new URL('../src/SettingsPannel.svelte', import.meta.url), 'utf8')
        .split('<script lang="ts">')[1].split('</script>')[0];
    const ast = ts.createSourceFile('panel.ts', panelSource, ts.ScriptTarget.Latest, true);
    const functions = ['handleSettingsUpdate', 'normalizeProviderSettings', 'saveSettings'].map(name =>
        ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast));
    const context = vm.createContext({
        settings: {}, selectedProviderId: '', pendingSettingsSaves: 0, settingsSaveVersion: 0,
        isDestroyed: false, cloneSettings: fixture.storage.cloneSettings, rebaseSettings: fixture.storage.rebaseSettings,
        updateGroupItems() {}, plugin: fixture.plugin,
    });
    vm.runInContext(compile(functions.join('\n')), context);
    context.handleSettingsUpdate(loaded);
    assert.equal(context.settings.aiProviders.openai.enabled, true);
    assert.equal(loaded.aiProviders.openai.enabled, undefined);
    fixture.files['settings.json'].aiProviders.openai.enabled = false;
    fixture.files['settings.json'].aiProviders.openai.apiKey = 'remote-key';
    context.settings.messageFontSize = 22;
    await context.saveSettings();
    assert.equal(fixture.files['settings.json'].aiProviders.openai.enabled, false);
    assert.equal(fixture.files['settings.json'].aiProviders.openai.apiKey, 'remote-key');
    assert.equal(context.settings.aiProviders.openai.enabled, false);
    context.pendingSettingsSaves = 1;
    context.settings.messageFontSize = 26;
    context.handleSettingsUpdate(loaded);
    assert.equal(context.settings.messageFontSize, 26);
    context.pendingSettingsSaves = 0;
    context.handleSettingsUpdate(await fixture.plugin.loadSettings());
    assert.equal(context.settings.messageFontSize, 22);
});
