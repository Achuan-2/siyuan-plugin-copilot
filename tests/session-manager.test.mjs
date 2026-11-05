import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = code => ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const source = read('../src/components/SessionManager.svelte').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile('sessions.ts', source, ts.ScriptTarget.Latest, true);
const sessionState = { exports: {} };
vm.runInNewContext(compile(read('../src/utils/sessionState.ts')), sessionState);
const plain = value => JSON.parse(JSON.stringify(value));
const session = (id, extra = {}) => ({ id, title: id, createdAt: 1, updatedAt: 1, ...extra });

function fixture() {
    const events = [];
    const context = { ...sessionState.exports, sessions: [], activeCategory: 'chat', selectedSessionIds: new Set(),
        messagesTextCache: new Map(), contextMenuVisible: true, contextMenuSession: {}, isOpen: true,
        updateDropdownPosition: async () => {}, dispatch: (...args) => events.push(args),
    };
    const names = ['getSessionCategory', 'selectCategory', 'closeContextMenu', 'buildSortedSessions',
        'sessionMatchesSearch', 'getSearchableText', 'extractInlineMessagesText', 'newSession', 'toggleSelectAll'];
    vm.runInNewContext(compile(ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name.text))
        .map(node => node.getText(ast)).join('\n')), context);
    return { context, events };
}

test('聊天包含问答、Agent 和旧文字会话，画图兼容模式锁、旧图片和中断请求', () => {
    const { context: f } = fixture();
    for (const chat of [session('ask', { chatMode: 'ask' }), session('agent', { chatMode: 'agent' }), session('old')]) {
        assert.equal(f.getSessionCategory(chat), 'chat');
    }
    for (const draw of [session('draw', { chatMode: 'draw' }), session('locked', { drawModeLocked: true }),
        session('legacy', { messages: [{ role: 'assistant', attachments: [{ type: 'image' }] }] }),
        session('interrupted', { messages: [{ role: 'user', drawGeneration: { prompt: 'drawing' } }] })]) {
        assert.equal(f.getSessionCategory(draw), 'draw');
    }
});

test('分类筛选叠加标题与正文搜索，并在各分类中保留钉住和更新时间排序', () => {
    const { context: f } = fixture();
    const sessions = [session('chat', { updatedAt: 10 }), session('draw', { chatMode: 'draw', updatedAt: 20 }),
        session('agent', { chatMode: 'agent', pinned: true }), session('draw-pinned', { chatMode: 'draw', pinned: true })];
    const cache = f.messagesTextCache;
    assert.deepEqual(plain(f.buildSortedSessions(sessions, '', cache, 'chat')).map(s => s.id), ['agent', 'chat']);
    assert.deepEqual(plain(f.buildSortedSessions(sessions, '', cache, 'draw')).map(s => s.id), ['draw-pinned', 'draw']);
    cache.set('chat', 'needle');
    cache.set('draw', 'needle');
    assert.deepEqual(plain(f.buildSortedSessions(sessions, 'needle', cache, 'chat')).map(s => s.id), ['chat']);
    assert.deepEqual(plain(f.buildSortedSessions(sessions, 'needle', cache, 'draw')).map(s => s.id), ['draw']);
    assert.deepEqual(sessions.map(s => s.id), ['chat', 'draw', 'agent', 'draw-pinned']);
});

test('切换分类清除旧勾选和右键菜单，全选和新建会话均使用当前分类', () => {
    const { context: f, events } = fixture();
    f.selectedSessionIds.add('chat');
    f.selectCategory('draw');
    assert.equal(f.selectedSessionIds.size, 0);
    assert.equal(f.contextMenuVisible, false);
    f.sortedSessions = [session('draw', { chatMode: 'draw' })];
    f.toggleSelectAll();
    assert.deepEqual([...f.selectedSessionIds], ['draw']);
    f.newSession();
    assert.deepEqual(plain(events), [['new', { chatMode: 'draw' }]]);
    assert.equal(f.isOpen, false);
});
