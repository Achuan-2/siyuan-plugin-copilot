import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/utils/floatingLayer.ts', import.meta.url), 'utf8');

function fixture() {
    const observers = [];
    const document = {
        defaultView: {
            getComputedStyle(node) {
                return { display: 'block', visibility: 'visible', zIndex: 'auto', ...node.style };
            },
            MutationObserver: class {
                constructor(callback) { this.callback = callback; observers.push(this); }
                observe() {}
                disconnect() { this.disconnected = true; }
            },
        },
        createComment: () => new Element(),
    };
    class Element {
        ownerDocument = document;
        style = {};
        children = [];
        listeners = new Map();
        parentElement = null;
        get parentNode() { return this.parentElement; }
        appendChild(node) { node.remove(); this.children.push(node); node.parentElement = this; }
        insertBefore(node, next) {
            node.remove();
            this.children.splice(this.children.indexOf(next), 0, node);
            node.parentElement = this;
        }
        remove() {
            if (this.parentElement) {
                this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
                this.parentElement = null;
            }
        }
        addEventListener(type, listener) { this.listeners.set(type, listener); }
        removeEventListener(type) { this.listeners.delete(type); }
    }
    document.body = new Element();
    const host = new Element();
    document.body.appendChild(host);
    const owner = new Element();
    host.appendChild(owner);
    const popup = new Element();
    popup.style.zIndex = '10';
    owner.appendChild(popup);

    const sandbox = { exports: {}, queueMicrotask };
    vm.runInNewContext(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, sandbox);
    return {
        ...sandbox.exports, Element, document, host, owner, popup, observers,
        sync: () => observers.filter(observer => !observer.disconnected).forEach(observer => observer.callback()),
    };
}

test('浮层移出裁剪容器，层级高于宿主，组件销毁后清理节点与观察器', async () => {
    const f = fixture();
    f.host.style = { transform: 'translateX(20px)', overflow: 'hidden', zIndex: '5000' };
    const action = f.floatingLayer(f.popup);
    await Promise.resolve();
    assert.equal(f.popup.parentElement, f.document.body);
    assert.equal(Number(f.popup.style.zIndex), 5011);
    assert.equal(f.owner.children.length, 1);
    action.destroy();
    assert.equal(f.popup.parentElement, null);
    assert.equal(f.owner.children.length, 0);
    assert.ok(f.observers.every(observer => observer.disconnected));
    assert.equal(f.popup.listeners.size, 0);
});

test('切换会话或隐藏 Dock 后隐藏浮层，恢复时重新显示', async () => {
    const f = fixture();
    f.floatingLayer(f.popup);
    await Promise.resolve();
    for (const property of ['visibility', 'display']) {
        f.host.style[property] = property === 'visibility' ? 'hidden' : 'none';
        f.sync();
        assert.equal(f.popup.style.visibility, 'hidden');
        delete f.host.style[property];
        f.sync();
        assert.equal(f.popup.style.visibility, undefined);
    }
});

test('嵌套浮层仍归属原面板，点击它不会被当作点击面板外部', async () => {
    const f = fixture();
    const nested = new f.Element();
    f.popup.appendChild(nested);
    f.floatingLayer(f.popup);
    f.floatingLayer(nested);
    await Promise.resolve();
    assert.equal(nested.parentElement, f.document.body);
    assert.equal(f.containsFloatingTarget(f.owner, nested), true);
    assert.equal(f.containsFloatingTarget(f.popup, nested), true);
    assert.equal(f.containsFloatingTarget(f.owner, f.document.body), false);
    assert.ok(Number(nested.style.zIndex) > Number(f.popup.style.zIndex));
    f.host.style.display = 'none';
    f.sync();
    assert.equal(nested.style.visibility, 'hidden');
});

test('更新定位 style 后补回浮层层级，内部点击不触发宿主收起 Dock', async () => {
    const f = fixture();
    f.floatingLayer(f.popup);
    await Promise.resolve();
    const zIndex = f.popup.style.zIndex;
    f.popup.style = { top: '100px', left: '20px' };
    f.sync();
    assert.equal(f.popup.style.zIndex, zIndex);
    assert.equal(f.popup.style.top, '100px');
    let stopped = false;
    f.popup.listeners.get('click')({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
});

test('同一轮挂载后立即销毁，不会留下异步挂载的浮层', async () => {
    const f = fixture();
    f.floatingLayer(f.popup).destroy();
    await Promise.resolve();
    assert.equal(f.popup.parentElement, null);
    assert.equal(f.observers.length, 0);
    assert.equal(f.owner.children.length, 0);
});
