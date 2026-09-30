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

function createPlugin(files = {}) {
    const writes = [];
    const events = [];
    let latestSettings;
    class Plugin {
        name = 'siyuan-plugin-copilot';
        async loadData(file) { return files[file]; }
        async saveData(file, value) {
            files[file] = structuredClone(value);
            writes.push(file);
        }
    }
    const sandbox = {
        exports: {}, console,
        window: { dispatchEvent: event => events.push(event.type) },
        CustomEvent: class { constructor(type) { this.type = type; } },
        require(id) {
            if (id === 'siyuan') return { Plugin };
            if (id === './defaultSettings') return {
                getDefaultSettings: () => ({ aiProviders: {}, webApps: [{ id: 'default-app' }] }),
            };
            if (id === './stores/settings') return {
                updateSettings: value => { latestSettings = value; },
                PLUGIN_DATA_CHANGED_EVENT: 'copilot-data-changed',
            };
            if (id === './utils/modelCapabilities') return {
                getModelCapabilities: () => ({ supportsVision: true }),
            };
            if (id === './api') return { pushMsg() {} };
            return {};
        },
    };
    vm.runInNewContext(compile(indexSource), sandbox);
    const plugin = new sandbox.exports.default();
    plugin.syncWebAppDocks = () => {};
    plugin.syncWebAppCollectionDock = () => {};
    plugin.registerWebAppIcon = () => {};
    return { plugin, writes, events, files, get settings() { return latestSettings; } };
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
