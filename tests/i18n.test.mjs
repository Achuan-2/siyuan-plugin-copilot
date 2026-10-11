import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const dictionaries = Object.fromEntries(['zh_CN', 'en_US'].map(locale =>
    [locale, JSON.parse(readFileSync(new URL(`../i18n/${locale}.json`, import.meta.url), 'utf8'))]));
const compiled = ts.transpileModule(readFileSync(new URL('../src/utils/i18n.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function loadI18n(language) {
    const sandbox = {
        exports: {},
        window: { siyuan: { config: { lang: language } } },
        require(id) {
            if (id.endsWith('zh_CN.json')) return dictionaries.zh_CN;
            if (id.endsWith('en_US.json')) return dictionaries.en_US;
            throw new Error(`Unexpected import: ${id}`);
        },
    };
    vm.runInNewContext(compiled, sandbox);
    return { api: sandbox.exports, config: sandbox.window.siyuan.config };
}

test('旧版和新版思源语言标签都能选择对应字典并用于日期格式化', () => {
    for (const [language, expected, label] of [
        ['en', 'en', 'Save'], ['en_US', 'en-US', 'Save'],
        ['zh_CN', 'zh-CN', '保存'], ['zh-CN', 'zh-CN', '保存'],
        ['zh_CHT', 'zh-TW', '保存'], ['de_DE', 'de-DE', 'Save'],
    ]) {
        const { api } = loadI18n(language);
        assert.equal(api.getCurrentLanguage(), expected);
        assert.equal(api.i18n('commonSave'), label);
        assert.doesNotThrow(() => new Intl.DateTimeFormat(api.getCurrentLanguage()));
    }
});

test('宿主字典缺键时使用当前语言的打包字典，未知键仍回退到键名', () => {
    const { api } = loadI18n('en');
    api.setPluginInstance({ i18n: { commonSave: 'Custom Save', commonCancel: null } });
    assert.equal(api.i18n('commonSave'), 'Custom Save');
    assert.equal(api.i18n('commonCancel'), 'Cancel');
    assert.equal(api.hasTranslation('commonCancel'), true);
    assert.equal(api.i18n('unknownKey'), 'unknownKey');
    assert.equal(api.hasTranslation('unknownKey'), false);
    assert.equal(api.hasTranslation('toString'), false);
    api.setPluginInstance(null);
    assert.equal(api.i18n('commonSave'), 'Save');
});

test('获取翻译时重新读取语言，缺少宿主窗口时仍可使用默认中文', () => {
    const { api, config } = loadI18n('en');
    config.lang = 'zh_CN';
    assert.equal(api.i18n('commonSave'), '保存');
    const sandbox = { exports: {}, require: id => id.endsWith('zh_CN.json') ? dictionaries.zh_CN : dictionaries.en_US };
    vm.runInNewContext(compiled, sandbox);
    assert.equal(sandbox.exports.i18n('commonSave'), '保存');
});

test('命名参数保留美元替换符、正则字符和参数内占位符，只进行一次替换', () => {
    const { api } = loadI18n('en');
    api.setPluginInstance({ i18n: { template: '${name} / ${name} / ${a.b} / ${aXb} / ${next} / ${missing}' } });
    const name = "$& $` $' ${next}";
    assert.equal(api.i18n('template', { name, 'a.b': 0, next: 'done' }),
        `${name} / ${name} / 0 / ${'${aXb}'} / done / ${'${missing}'}`);
});

test('位置参数支持重排和重复引用，动态文案保留错误内容和计数', () => {
    const { api } = loadI18n('en');
    api.setPluginInstance({ i18n: { reordered: '{1} / {0} / {1} / {2}' } });
    assert.equal(api.tf('reordered', '$&', 'second'), 'second / $& / second / {2}');
    assert.equal(api.tf('aiSidebarDrawImageSelected', 3), 'Image 3 selected for further editing');
    assert.equal(api.tf('translateFailed', 'HTTP 429'), 'Translation failed: HTTP 429');
    assert.equal(api.tf('sessionDeleteCount', 2), 'Delete (2)');
});

test('复数缺键时回退，已有数量形式正常插值', () => {
    const { api } = loadI18n('en');
    api.setPluginInstance({ i18n: { count: '${count} items', count_one: '${count} item' } });
    assert.equal(api.tp('count', 0), '0 items');
    assert.equal(api.tp('count', 1), '1 item');
    assert.equal(api.tp('count', 2), '2 items');
});
