import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../devtools-hook.cjs', import.meta.url), 'utf8');
const ctrlShiftI = { type: 'keyDown', key: 'I', code: 'KeyI', control: true, shift: true };
const cmdOptionI = { type: 'keyDown', key: 'i', code: 'KeyI', meta: true, alt: true };

class Contents extends EventEmitter {
    constructor(id, hostWebContents) {
        super();
        Object.assign(this, { id, hostWebContents, destroyed: false, opened: false, toggles: 0 });
    }
    isDestroyed() { return this.destroyed; }
    isDevToolsOpened() { return this.opened; }
    toggleDevTools() { this.toggles++; this.opened ? this.closeDevTools() : this.openDevTools(); }
    openDevTools() {
        this.opened = true;
        this.devToolsWebContents = new Contents(this.id + 1000);
        this.emit('devtools-opened');
    }
    closeDevTools() { this.opened = false; this.emit('devtools-closed'); }
    destroy() { this.destroyed = true; this.emit('destroyed'); }
    input(input) {
        const event = { prevented: false, preventDefault() { this.prevented = true; } };
        this.emit('before-input-event', event, input);
        return event.prevented;
    }
}

function fixture() {
    let now = 1000;
    const host = new Contents(1);
    const guest = new Contents(2, host);
    const otherHost = new Contents(3);
    const otherGuest = new Contents(4, otherHost);
    const contents = new Map([host, guest, otherHost, otherGuest].map(wc => [wc.id, wc]));
    const sandbox = {
        module: { exports: {} }, Date: { now: () => now },
        require: id => {
            assert.equal(id, 'electron');
            return { webContents: { fromId: id => contents.get(id) } };
        },
    };
    vm.runInNewContext(source, sandbox);
    const create = sandbox.module.exports.createDevToolsHooks;
    return { host, guest, otherHost, otherGuest, contents, create, hooks: create(), advance: () => now += 100 };
}

test('网页、思源窗口和开发者工具内均切换思源开发者工具', () => {
    for (const hotkey of [ctrlShiftI, cmdOptionI]) {
        const f = fixture();
        assert.equal(f.hooks.hook(2), true);
        assert.equal(f.guest.input(hotkey), true);
        assert.equal(f.host.opened, true);
        assert.equal(f.guest.opened, false);
        f.advance();
        assert.equal(f.host.devToolsWebContents.input(hotkey), true);
        assert.equal(f.host.opened, false);
        f.advance();
        assert.equal(f.host.input(hotkey), true);
        assert.equal(f.host.opened, true);
        f.hooks.unhookAll();
    }
});

test('F12、其他快捷键、额外修饰键和 keyUp 不被接管', () => {
    const f = fixture();
    f.hooks.hook(2);
    for (const input of [
        { type: 'keyDown', key: 'F12' },
        { ...ctrlShiftI, key: 'f', code: 'KeyF' },
        { ...ctrlShiftI, alt: true }, { ...cmdOptionI, shift: true },
        { ...ctrlShiftI, type: 'keyUp' },
    ]) assert.equal(f.guest.input(input), false);
    assert.equal(f.host.toggles, 0);
});

test('长按被阻止；同一次输入的宿主与 guest 回调只切换一次', () => {
    const f = fixture();
    f.hooks.hook(2);
    f.guest.input(ctrlShiftI);
    f.host.input(ctrlShiftI);
    f.advance();
    assert.equal(f.guest.input({ ...ctrlShiftI, isAutoRepeat: true }), true);
    assert.equal(f.host.toggles, 1);
    f.guest.input(ctrlShiftI);
    assert.equal(f.host.toggles, 2);
});

test('刷新重复绑定不会叠加监听，最后一个网页关闭时拆除宿主监听', () => {
    const f = fixture();
    f.contents.set(5, new Contents(5, f.host));
    f.hooks.hook(2);
    f.hooks.hook(2);
    f.hooks.hook(5);
    assert.equal(f.guest.listenerCount('before-input-event'), 1);
    assert.equal(f.host.listenerCount('before-input-event'), 1);
    f.guest.destroy();
    assert.equal(f.guest.listenerCount('before-input-event'), 0);
    assert.equal(f.host.listenerCount('before-input-event'), 1);
    f.hooks.unhook(5);
    assert.equal(f.host.listenerCount('before-input-event'), 0);
    assert.equal(f.host.listenerCount('devtools-opened'), 0);
});

test('不同窗口切换互不抑制，卸载一个实例不影响其他实例', () => {
    const f = fixture();
    const otherHooks = f.create();
    f.hooks.hook(2);
    otherHooks.hook(4);
    f.guest.input(ctrlShiftI);
    f.otherGuest.input(ctrlShiftI);
    assert.equal(f.host.toggles, 1);
    assert.equal(f.otherHost.toggles, 1);
    const dt = f.host.devToolsWebContents;
    f.hooks.unhookAll();
    assert.equal(dt.listenerCount('before-input-event'), 0);
    assert.equal(f.host.listenerCount('before-input-event'), 0);
    assert.equal(f.otherHost.listenerCount('before-input-event'), 1);
    f.advance();
    assert.equal(f.otherGuest.input(ctrlShiftI), true);
    otherHooks.unhookAll();
});

test('guest 意外打开开发者工具时关闭 guest 并打开思源的', () => {
    const f = fixture();
    f.hooks.hook(2);
    f.guest.openDevTools();
    assert.equal(f.guest.opened, false);
    assert.equal(f.host.opened, true);
});

test('宿主销毁时清理所有 guest 监听', () => {
    const f = fixture();
    f.hooks.hook(2);
    f.host.destroy();
    assert.equal(f.guest.listenerCount('before-input-event'), 0);
    assert.equal(f.host.listenerCount('before-input-event'), 0);
    assert.equal(f.hooks.hook(2), false);
});

test('renderer 保存 guest id，重复 ready 不重绑，DOM 移除后仍能清理', () => {
    const hooks = { calls: [], hook(id) { this.calls.push(['hook', id]); return true; },
        unhook(id) { this.calls.push(['unhook', id]); }, unhookAll() { this.calls.push(['all']); } };
    const rendererSource = readFileSync(new URL('../src/utils/webviewDevTools.ts', import.meta.url), 'utf8');
    const sandbox = { exports: {}, console, window: {
        siyuan: { config: { system: { dataDir: 'data' } } },
        require: id => id === 'path' ? { join: (...parts) => parts.join('/') } : {
            require: path => { assert.equal(path, 'data/plugins/copilot/devtools-hook.cjs');
                return { createDevToolsHooks: () => hooks }; },
        },
    } };
    vm.runInNewContext(ts.transpileModule(rendererSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, sandbox);
    const view = new EventTarget();
    view.getWebContentsId = () => 2;
    const cleanup = sandbox.exports.bindWebviewDevTools(view, 'copilot');
    view.dispatchEvent(new Event('did-attach'));
    view.dispatchEvent(new Event('dom-ready'));
    assert.deepEqual(hooks.calls, [['hook', 2]]);
    view.getWebContentsId = () => { throw new Error('detached'); };
    cleanup();
    view.dispatchEvent(new Event('dom-ready'));
    assert.deepEqual(hooks.calls, [['hook', 2], ['unhook', 2]]);
    sandbox.exports.disposeWebviewDevTools();
    assert.deepEqual(hooks.calls.at(-1), ['all']);
});
