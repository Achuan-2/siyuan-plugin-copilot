import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { compile, preprocess } from 'svelte/compiler';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const transpile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const prompts = { exports: {} };
vm.runInNewContext(transpile(read('../src/systemPromptDefaults.ts')), prompts);
const defaults = { exports: {}, require: () => prompts.exports };
vm.runInNewContext(transpile(read('../src/defaultSettings.ts')), defaults);
const { getDefaultSettings } = defaults.exports;
const translations = JSON.parse(read('../i18n/zh_CN.json'));
const panelSource = read('../src/SettingsPannel.svelte').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const panelAst = ts.createSourceFile('settings.ts', panelSource, ts.ScriptTarget.Latest, true);

// 直接执行设置面板的配置处理和响应式列表逻辑，只替换思源宿主接口。
function createPanel(settings = getDefaultSettings()) {
    const functions = [
        'generateCustomPlatformId', 'normalizeProviderSettings', 'addBuiltInPlatform',
        'addCustomPlatform', 'removePlatform', 'updateProviderEnabled',
    ];
    const declarations = functions.map(name => {
        const node = panelAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
        assert.ok(node, `Missing function: ${name}`);
        return node.getText(panelAst);
    }).join('\n');
    const names = panelAst.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(panelAst) === 'builtInProviderNames'));
    const options = panelAst.statements.find(node => ts.isLabeledStatement(node) &&
        node.statement.getText(panelAst).startsWith('allProviderOptions ='));
    let saves = 0;
    let opened = 0;
    const sandbox = {
        settings: plain(settings), selectedProviderId: '', platformSearchQuery: 'old search',
        getDefaultSettings, rebaseSettings: value => value,
        i18n: key => translations[key] || key, tf: key => key,
        pushMsg() {}, pushErrMsg() {},
        saveSettings() { saves++; },
        openMobileModelPanel() { opened++; },
        confirm(_title, _message, callback) { callback(); },
    };
    vm.createContext(sandbox);
    vm.runInContext(transpile(`${names.getText(panelAst)}\n${declarations}`), sandbox);
    const refresh = () => vm.runInContext(transpile(options.statement.getText(panelAst)), sandbox);
    sandbox.normalizeProviderSettings();
    refresh();
    return { sandbox, refresh, get saves() { return saves; }, get opened() { return opened; } };
}

test('新用户只显示并选中 A API，其他预设不启用；重复加载不注入其他平台', () => {
    const panel = createPanel();
    const { sandbox } = panel;
    assert.deepEqual(plain(sandbox.allProviderOptions).map(provider => provider.id), ['Achuan']);
    assert.equal(sandbox.selectedProviderId, 'Achuan');
    assert.equal(sandbox.settings.currentProvider, 'Achuan');
    for (const id of sandbox.settings.aiProviders.disabledBuiltInProviders) {
        assert.equal(sandbox.settings.aiProviders[id].enabled, false);
    }
    sandbox.normalizeProviderSettings();
    panel.refresh();
    assert.deepEqual(plain(sandbox.allProviderOptions).map(provider => provider.id), ['Achuan']);
    assert.deepEqual(plain(sandbox.settings.aiProviders.providerOrder), ['Achuan']);
    assert.equal(panel.saves, 0);
});

test('无平台配置时使用新默认值，旧配置保留平台、禁用状态和用户排序', () => {
    const empty = createPanel({});
    assert.deepEqual(plain(empty.sandbox.allProviderOptions).map(provider => provider.id), ['Achuan']);

    const settings = getDefaultSettings();
    settings.aiProviders.disabledBuiltInProviders = ['minimax'];
    settings.aiProviders.providerOrder = ['gemini', 'openai'];
    settings.aiProviders.openai.enabled = false;
    settings.aiProviders.gemini = { apiKey: 'saved-key', models: [{ id: 'saved-model' }] };
    settings.currentProvider = 'gemini';
    settings.selectedProviderId = 'gemini';
    const { sandbox } = createPanel(settings);
    assert.deepEqual(plain(sandbox.settings.aiProviders.providerOrder), ['gemini', 'openai']);
    assert.equal(sandbox.settings.aiProviders.gemini.apiKey, 'saved-key');
    assert.equal(sandbox.selectedProviderId, 'gemini');
    assert.deepEqual(plain(sandbox.allProviderOptions).slice(0, 2).map(provider => provider.id), ['gemini', 'openai']);
    assert.equal(sandbox.allProviderOptions.find(provider => provider.id === 'openai').enabled, false);
    assert.ok(!sandbox.allProviderOptions.some(provider => provider.id === 'minimax'));
});

test('添加内置平台并追加排序，只切换设置面板，已有配置和对话选择不变', () => {
    const panel = createPanel();
    const { sandbox } = panel;
    sandbox.settings.aiProviders.openai.apiKey = 'saved-key';
    sandbox.settings.aiProviders.openai.models = [{ id: 'saved-model' }];
    sandbox.settings.aiProviders.openai.customApiUrl = 'https://example.invalid';
    sandbox.settings.currentModelId = 'current-model';
    sandbox.addBuiltInPlatform('openai');
    panel.refresh();
    assert.deepEqual(plain(sandbox.allProviderOptions).map(provider => provider.id), ['Achuan', 'openai']);
    assert.equal(sandbox.selectedProviderId, 'openai');
    assert.equal(sandbox.settings.aiProviders.openai.enabled, true);
    assert.equal(sandbox.settings.aiProviders.openai.apiKey, 'saved-key');
    assert.equal(sandbox.settings.aiProviders.openai.models[0].id, 'saved-model');
    assert.equal(sandbox.settings.aiProviders.openai.customApiUrl, 'https://example.invalid');
    assert.equal(sandbox.settings.currentProvider, 'Achuan');
    assert.equal(sandbox.settings.currentModelId, 'current-model');
    assert.equal(sandbox.platformSearchQuery, '');
    sandbox.addBuiltInPlatform('openai');
    panel.refresh();
    assert.deepEqual(plain(sandbox.settings.aiProviders.providerOrder), ['Achuan', 'openai']);
    assert.equal(panel.opened, 2);
});

test('平台开关不会移出列表，删除后可重新添加并保留模型和密钥', () => {
    const panel = createPanel();
    const { sandbox } = panel;
    sandbox.settings.aiProviders.Achuan.apiKey = 'saved-key';
    sandbox.settings.aiProviders.Achuan.models = [{ id: 'saved-model' }];
    sandbox.updateProviderEnabled('Achuan', false);
    panel.refresh();
    assert.equal(sandbox.allProviderOptions[0].enabled, false);
    sandbox.removePlatform('Achuan');
    panel.refresh();
    sandbox.normalizeProviderSettings();
    panel.refresh();
    assert.deepEqual(plain(sandbox.allProviderOptions), []);
    assert.equal(sandbox.selectedProviderId, '');
    sandbox.addBuiltInPlatform('Achuan');
    panel.refresh();
    assert.equal(sandbox.allProviderOptions[0].id, 'Achuan');
    assert.equal(sandbox.settings.aiProviders.Achuan.apiKey, 'saved-key');
    assert.equal(sandbox.settings.aiProviders.Achuan.models[0].id, 'saved-model');
    assert.equal(sandbox.settings.aiProviders.Achuan.enabled, true);
});

test('自定义平台保存名称和地址，追加到列表并拒绝空白名称', () => {
    const panel = createPanel();
    const { sandbox } = panel;
    sandbox.addCustomPlatform('   ', '');
    assert.equal(panel.saves, 0);
    sandbox.addCustomPlatform('  Local API  ', '  http://localhost:11434/v1  ');
    panel.refresh();
    const provider = sandbox.settings.aiProviders.customProviders[0];
    assert.equal(provider.name, 'Local API');
    assert.equal(provider.customApiUrl, 'http://localhost:11434/v1');
    assert.equal(sandbox.selectedProviderId, provider.id);
    assert.equal(sandbox.settings.currentProvider, 'Achuan');
    assert.deepEqual(plain(sandbox.settings.aiProviders.providerOrder), ['Achuan', provider.id]);
    assert.equal(sandbox.allProviderOptions.at(-1).id, provider.id);
    assert.equal(panel.saves, 1);
});

test('添加弹窗列出内置平台，并禁用已经添加的平台按钮', async () => {
    const filename = 'AddProviderDialog.svelte';
    const source = await preprocess(read('../src/components/AddProviderDialog.svelte'), {
        script: ({ content }) => ({ code: ts.transpileModule(content, {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
        }).outputText }),
        style: () => ({ code: '' }),
    }, { filename });
    const component = compile(source.code, { filename, generate: 'ssr' });
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const sandbox = {
        exports: {}, require: id => id === '../utils/i18n' ? { i18n: key => translations[key] } : require(id),
    };
    vm.runInNewContext(transpile(component.js.code), sandbox);
    const { html } = sandbox.exports.default.render({ providers: [
        { id: 'Achuan', name: 'A API', added: true },
        { id: 'openai', name: 'OpenAI', added: false },
    ] });
    assert.match(html, /disabled[^>]*>\s*<span>A API<\/span>/);
    assert.match(html, /已添加/);
    assert.match(html, /<span>OpenAI<\/span>/);
    assert.match(html, /自定义/);
});
