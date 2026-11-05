import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function module(path) {
    const context = { exports: {} };
    vm.runInNewContext(compile(read(path)), context);
    return context.exports;
}
const state = module('../src/utils/sessionState.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const imageMessages = [{ role: 'user', content: 'cover' },
    { role: 'assistant', content: 'done', generatedImages: [{ path: '/data/image.png' }] }];
const metadata = id => ({ id, title: id, createdAt: 1, updatedAt: 1, messageCount: 1, isLoading: false });

const source = read('../src/ai-sidebar.svelte').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile('sidebar.ts', source, ts.ScriptTarget.Latest, true);
function functions(names) {
    return names.map(name => {
        const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
        assert.ok(node, name);
        return node.getText(ast);
    }).join('\n');
}

test('生成图片后会话固定为画图模式，历史记录和旧图片会话也恢复画图模式', () => {
    assert.equal(state.resolveChatSessionMode(imageMessages, 'ask'), 'draw');
    assert.equal(state.resolveChatSessionMode([], 'ask', true), 'draw');
    assert.equal(state.resolveChatSessionMode([], 'agent'), 'agent');
    assert.equal(state.resolveChatSessionMode([], undefined), 'ask');
    const context = { ...state, messages: imageMessages, drawModeLocked: false, chatMode: 'draw', isLoading: false,
        drawDraftRestoreVersion: 0, drawAnnotationOpenVersion: 0,
        getBaseSystemPrompt: () => '', currentAttachments: [], multiModelResponses: [] };
    const guard = ast.statements.filter(node => ts.isLabeledStatement(node) &&
        /hasGeneratedSessionImages\(messages\)|drawModeLocked && chatMode|drawModeSwitchDisabled =/.test(node.getText(ast)))
        .map(node => node.getText(ast)).join('\n');
    const flush = () => vm.runInNewContext(compile(guard), context);
    flush();
    assert.equal(context.drawModeLocked, true);
    context.chatMode = 'ask';
    flush();
    assert.equal(context.chatMode, 'draw');
    assert.equal(context.drawModeSwitchDisabled, true);
    vm.runInNewContext(compile(functions(['doNewSession'])), context);
    context.doNewSession();
    flush();
    assert.equal(context.chatMode, 'draw');
    assert.equal(context.drawModeLocked, false);
    assert.equal(context.drawModeSwitchDisabled, false);
    assert.equal(context.messages.length, 0);
    assert.equal(context.currentAttachments.length, 0);
});

test('已有生图记录的会话不能通过应用对话预设绕过模式限制', () => {
    const notices = [];
    const context = { drawModeSwitchDisabled: true, chatMode: 'draw', i18n: key => key,
        pushErrMsg: value => notices.push(value) };
    vm.runInNewContext(compile(functions(['handleApplyModelSettings'])), context);
    context.handleApplyModelSettings({ detail: { chatMode: 'ask', persist: true } });
    assert.equal(context.chatMode, 'draw');
    assert.deepEqual(notices, ['aiSidebarDrawSessionModeLocked']);
});

test('新建后台视图立即返回，不中断原会话或清空它的消息', async () => {
    const events = [];
    const context = { sessionHost: true, sessionViewId: 'original', isLoading: true,
        chatMode: 'draw',
        abortMessage: () => assert.fail('Must keep original request running'),
        dispatch: (...args) => events.push(args), messages: imageMessages };
    vm.runInNewContext(compile(functions(['newSession'])), context);
    await context.newSession();
    assert.equal(context.messages, imageMessages);
    assert.equal(context.isLoading, true);
    assert.deepEqual(plain(events), [['session-new', { viewId: 'original', chatMode: 'draw' }]]);
});

test('会话运行状态按任务来源计数，其他视图完成或销毁不清除仍在运行的任务', () => {
    const tasks = module('../src/sessionTaskStatus.ts');
    assert.equal(tasks.getSessionTaskStatus('s'), undefined);
    tasks.setSessionTaskStatus('s', true, 'view-a');
    tasks.setSessionTaskStatus('s', true, 'view-b');
    assert.equal(tasks.setSessionTaskStatus('s', false, 'view-a'), true);
    assert.equal(tasks.getSessionTaskStatus('s'), true);
    assert.equal(tasks.setSessionTaskStatus('s', false, 'idle-view'), true);
    tasks.setSessionTaskStatus('s', false, 'view-b');
    assert.equal(tasks.getSessionTaskStatus('s'), false);
});

test('旧列表的差量保存保留新会话、并发重命名和后台任务完成状态', () => {
    const original = [metadata('a')];
    const backgroundChanges = state.diffSessionMetadata(original, [{ ...original[0], messageCount: 8 }]);
    const latest = [metadata('b'), { ...original[0], title: 'renamed elsewhere' }];
    const merged = plain(state.mergeSessionMetadata(latest, backgroundChanges));
    assert.deepEqual(merged.map(item => item.id), ['b', 'a']);
    assert.equal(merged[1].title, 'renamed elsewhere');
    assert.equal(merged[1].messageCount, 8);
    const deleted = state.diffSessionMetadata(original, []);
    assert.deepEqual(plain(state.mergeSessionMetadata(latest, deleted)).map(item => item.id), ['b']);
    assert.deepEqual(plain(state.mergeSessionMetadata([], backgroundChanges)), []);
});

function fixture() {
    const tasks = module('../src/sessionTaskStatus.ts');
    const files = { 'chat-sessions.json': { sessions: [] } };
    const events = [];
    const plugin = {
        async loadData(path) { await Promise.resolve(); return structuredClone(files[path]); },
        async saveData(path, data) { await Promise.resolve(); files[path] = plain(data); },
    };
    function view(id) {
        const context = { ...state, ...tasks, plugin, console,
            sessions: [], sessionMetadataBaseline: [], sessionListLoadVersion: 0, currentSessionId: id,
            isLoading: false, isDestroyed: false, chatMode: 'ask', drawModeLocked: false,
            isSavingSession: false, pendingSaveSilent: null, hasUnsavedChanges: false,
            pendingSessionSnapshot: null, streamingMessage: '', streamingThinking: '', multiModelResponses: [],
            pendingSessionSaveWaiters: [],
            getMessageText: value => value, i18n: key => key,
            pushErrMsg: text => assert.fail(text),
            window: { dispatchEvent: event => events.push(event.type) },
            CustomEvent: class { constructor(type) { this.type = type; } },
        };
        vm.runInNewContext(compile(functions(['loadSessions', 'saveSessions', 'captureSessionSnapshot', 'saveCurrentSession', 'generateSessionTitle', 'handleSessionUpdate'])), context);
        return context;
    }
    return { tasks, files, events, plugin, view };
}

test('真实列表保存函数并发创建两个会话，后台完成后两条历史和状态均保留', async () => {
    const f = fixture();
    const a = f.view('a');
    const b = f.view('b');
    await Promise.all([a.loadSessions(), b.loadSessions()]);
    a.sessions = [metadata('a')];
    b.sessions = [metadata('b')];
    f.tasks.setSessionTaskStatus('a', true, 'a');
    f.tasks.setSessionTaskStatus('b', true, 'b');
    await Promise.all([a.saveSessions(), b.saveSessions()]);
    assert.deepEqual(f.files['chat-sessions.json'].sessions.map(item => item.id).sort(), ['a', 'b']);
    assert.ok(f.files['chat-sessions.json'].sessions.every(item => item.isLoading));
    // a 未刷新 b 的新列表就结束，不能把 b 从历史中删掉。
    f.tasks.setSessionTaskStatus('a', false, 'a');
    a.sessions[0].messageCount = 5;
    await a.saveSessions();
    const saved = f.files['chat-sessions.json'].sessions;
    assert.equal(saved.find(item => item.id === 'a').isLoading, false);
    assert.equal(saved.find(item => item.id === 'b').isLoading, true);
    assert.ok(f.events.includes('copilot-sessions-changed'));
    const idle = f.view('b');
    await idle.loadSessions();
    assert.equal(idle.sessions.find(item => item.id === 'b').isLoading, true);
});

test('模式和模式锁随会话正文及列表保存，重开时不受全局最后使用模式影响', async () => {
    const f = fixture();
    f.files['chat-sessions.json'].sessions = [metadata('draw')];
    const draw = f.view('draw');
    draw.chatMode = 'draw';
    draw.drawModeLocked = true;
    draw.messages = imageMessages;
    await draw.saveCurrentSession(true);
    const body = f.files['sessions/draw.json'];
    assert.equal(body.chatMode, 'draw');
    assert.equal(body.drawModeLocked, true);
    assert.equal(f.files['chat-sessions.json'].sessions[0].chatMode, 'draw');
    assert.equal(state.resolveChatSessionMode(body.messages, body.chatMode, body.drawModeLocked), 'draw');
});

test('宿主为新会话创建独立视图，切回已有会话时复用原视图', () => {
    const source = read('../src/components/AIChatSessionHost.svelte').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    const ast = ts.createSourceFile('host.ts', source, ts.ScriptTarget.Latest, true);
    const code = ast.statements.filter(node => ts.isFunctionDeclaration(node)).map(node => node.getText(ast)).join('\n');
    const host = { viewSequence: 0, views: [], activeViewId: '' };
    vm.runInNewContext(compile(code), host);
    host.activateSession('running');
    const original = host.views[0];
    host.createNewSessionView();
    assert.equal(host.views.length, 2);
    assert.equal(host.views[1].initialChatMode, 'ask');
    assert.notEqual(host.activeViewId, original.viewId);
    host.activateSession('running');
    assert.equal(host.activeViewId, original.viewId);
    assert.equal(host.views[0], original);
    assert.equal(host.views.length, 2);
    host.handleSessionNew({ detail: { viewId: original.viewId, chatMode: 'draw' } });
    const drawingView = host.views[2];
    assert.equal(drawingView.initialChatMode, 'draw');
    assert.equal(drawingView.initialSessionId, '');
    assert.equal(drawingView.initialMessage, '');
    assert.equal(host.activeViewId, drawingView.viewId);
    host.activateSession('running');
    assert.equal(host.views[0], original);
    assert.equal(host.activeViewId, original.viewId);
});

test('迟到的列表读取不能覆盖更新的会话列表', async () => {
    const f = fixture();
    const pending = [];
    f.plugin.loadData = () => new Promise(resolve => pending.push(resolve));
    const view = f.view('a');
    const first = view.loadSessions();
    const second = view.loadSessions();
    pending[1]({ sessions: [metadata('new')] });
    await second;
    pending[0]({ sessions: [metadata('old')] });
    await first;
    assert.deepEqual(plain(view.sessions).map(item => item.id), ['new']);
});

test('钉住会话仅修改钉住状态，保留后台更新的标题、消息计数和运行状态', async () => {
    const f = fixture();
    const view = f.view('a');
    f.files['chat-sessions.json'].sessions = [metadata('a')];
    await view.loadSessions();
    f.files['chat-sessions.json'].sessions[0] = { ...metadata('a'), title: 'latest title', messageCount: 20, updatedAt: 30 };
    f.tasks.setSessionTaskStatus('a', true, 'background-owner');
    await view.handleSessionUpdate([{ id: 'a', pinned: true }]);
    const saved = f.files['chat-sessions.json'].sessions[0];
    assert.equal(saved.title, 'latest title');
    assert.equal(saved.messageCount, 20);
    assert.equal(saved.updatedAt, 30);
    assert.equal(saved.isLoading, true);
    assert.equal(saved.pinned, true);
});

test('同一毫秒创建会话仍使用不同的持久化 ID', () => {
    const context = { exports: {}, Date: { now: () => 1 } };
    vm.runInNewContext(compile(read('../src/utils/sessionState.ts')), context);
    const ids = Array.from({ length: 100 }, () => context.exports.createChatSessionId());
    assert.equal(new Set(ids).size, 100);
    assert.ok(ids.every(id => id.startsWith('session_1_')));
});

test('会话列表暂时读取不到时保留已加载历史，阻止覆盖，恢复后可重试保存', async () => {
    const f = fixture();
    const view = f.view('a');
    view.console = { error() {} };
    const notices = [];
    view.pushErrMsg = value => notices.push(value);
    f.files['chat-sessions.json'].sessions = [metadata('a')];
    await view.loadSessions();
    const read = f.plugin.loadData;
    f.plugin.loadData = async () => undefined;
    await view.loadSessions();
    assert.equal(view.sessions[0].id, 'a');
    view.sessions[0].title = 'retry title';
    await view.saveSessions();
    assert.equal(f.files['chat-sessions.json'].sessions[0].title, 'a');
    assert.equal(notices.length, 1);
    f.plugin.loadData = read;
    await view.saveSessions();
    assert.equal(f.files['chat-sessions.json'].sessions[0].title, 'retry title');
});

test('发送快照仅保存已发送的消息和资源路径，重新打开不保留运行状态', () => {
    const messages = [{ role: 'user', content: 'question', attachments: [{ type: 'image', name: 'ref.png', path: '/data/ref.png', data: 'blob:ref' }] }];
    const snapshot = state.createChatSessionSnapshot(messages, 'ask', false, true);
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.messages[0].content, 'question');
    assert.equal(snapshot.messages[0].attachments[0].data, '');
    assert.equal(messages[0].attachments[0].data, 'blob:ref');
    messages[0].content = 'changed';
    assert.equal(snapshot.messages[0].content, 'question');
    assert.equal(snapshot.generationInterrupted, true);
    const reopened = state.recoverChatSession(snapshot, { chatMode: 'ask' });
    assert.equal(reopened.snapshot.messages.length, 1);
    assert.equal(reopened.snapshot.messages[0].content, 'question');
});

test('只有索引的旧会话仍可打开，优先恢复内嵌消息，不伪造已丢失的提示词', () => {
    const recovered = state.recoverChatSession(undefined, { id: 'old', title: 'truncated prompt', isLoading: true });
    assert.equal(recovered.missingContent, true);
    assert.equal(recovered.snapshot.messages.length, 0);
    const inline = state.recoverChatSession(null, { messages: [{ role: 'user', content: 'full prompt' }], chatMode: 'agent' });
    assert.equal(inline.snapshot.messages[0].content, 'full prompt');
    assert.equal(inline.snapshot.chatMode, 'agent');
    assert.throws(() => state.recoverChatSession(null), /unavailable/);
});

test('正文先于索引落盘，中途退出也不会发布一个没有正文的新会话', async () => {
    const f = fixture();
    const view = f.view('new');
    view.messages = [{ role: 'user', content: 'saved before network request' }];
    let finishBody;
    const write = f.plugin.saveData;
    f.plugin.saveData = async (path, data) => {
        if (path === 'sessions/new.json') await new Promise(resolve => { finishBody = resolve; });
        return write(path, data);
    };
    const saving = view.saveCurrentSession(true);
    await Promise.resolve();
    assert.equal(f.files['chat-sessions.json'].sessions.length, 0);
    finishBody();
    await saving;
    assert.equal(f.files['sessions/new.json'].messages[0].content, 'saved before network request');
    assert.equal(f.files['chat-sessions.json'].sessions[0].id, 'new');
});

test('发送后不定时保存流式分片，回复完成后才保存完整结果', async () => {
    const f = fixture();
    const view = f.view('stream');
    view.messages = [{ role: 'user', content: 'question' }];
    view.isLoading = true;
    await view.saveCurrentSession(true);
    view.streamingMessage = 'partial reply';
    view.streamingThinking = 'partial thinking';
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.files['sessions/stream.json'].messages.length, 1);
    assert.equal(f.files['sessions/stream.json'].messages[0].content, 'question');
    view.messages.push({ role: 'assistant', content: 'complete reply' });
    view.isLoading = false;
    view.streamingMessage = '';
    await view.saveCurrentSession(true);
    assert.equal(f.files['sessions/stream.json'].generationInterrupted, false);
    assert.equal(f.files['sessions/stream.json'].messages.length, 2);
    assert.equal(f.files['sessions/stream.json'].messages[1].content, 'complete reply');
});

test('写入等待期间用户消息快照固定，排队的完成结果最终正常保存', async () => {
    const f = fixture();
    const view = f.view('pending');
    view.messages = [{ role: 'user', content: 'question' }];
    view.isLoading = true;
    let release;
    let calls = 0;
    const write = f.plugin.saveData;
    f.plugin.saveData = async (path, data) => {
        if (path === 'sessions/pending.json' && calls++ === 0) await new Promise(resolve => { release = resolve; });
        return write(path, data);
    };
    const first = view.saveCurrentSession(true);
    view.messages.push({ role: 'assistant', content: 'completed' });
    view.isLoading = false;
    const completedSave = view.saveCurrentSession(true);
    release();
    await Promise.all([first, completedSave]);
    assert.equal(f.files['sessions/pending.json'].messages[1].content, 'completed');
    assert.equal(f.files['sessions/pending.json'].generationInterrupted, false);
});

test('加载缺失正文会话的真实函数仍设置会话 ID 并显示恢复说明', async () => {
    const f = fixture();
    f.files['chat-sessions.json'].sessions = [metadata('missing')];
    const view = f.view('');
    view.settings = {};
    view.messages = [];
    view.getProviderAndModelConfig = () => null;
    view.getBaseSystemPrompt = () => '';
    view.scrollToTop = async () => {};
    vm.runInNewContext(compile(functions(['doLoadSession'])), view);
    await view.loadSessions();
    await view.doLoadSession('missing');
    assert.equal(view.currentSessionId, 'missing');
    assert.equal(view.sessionRecoveryNotice, 'aiSidebarSessionMissingContent');
    assert.equal(view.messages.length, 0);
    view.messages = [{ role: 'user', content: 'continue this session' }];
    await view.saveCurrentSession(true);
    assert.equal(f.files['sessions/missing.json'].messages[0].content, 'continue this session');
});

test('回复过程中退出并重新加载，仍能打开会话看到已发送消息且不显示后台转圈', async () => {
    const beforeExit = fixture();
    const running = beforeExit.view('interrupted');
    running.messages = [{ role: 'user', content: '完整的用户提问' }];
    running.isLoading = true;
    beforeExit.tasks.setSessionTaskStatus('interrupted', true, 'old-view');
    await running.saveCurrentSession(true);
    running.streamingMessage = '未完成且无需保存的回复';

    // 新运行时有独立任务表，只复用已经保存到磁盘的会话文件。
    const afterRestart = fixture();
    Object.assign(afterRestart.files, plain(beforeExit.files));
    const reopened = afterRestart.view('');
    reopened.settings = {};
    reopened.messages = [];
    reopened.getProviderAndModelConfig = () => null;
    reopened.getBaseSystemPrompt = () => '';
    reopened.scrollToTop = async () => {};
    vm.runInNewContext(compile(functions(['doLoadSession'])), reopened);
    await reopened.loadSessions();
    assert.equal(reopened.sessions[0].isLoading, false);
    await reopened.doLoadSession('interrupted');
    assert.equal(reopened.currentSessionId, 'interrupted');
    assert.equal(reopened.messages.length, 1);
    assert.equal(reopened.messages[0].content, '完整的用户提问');
    assert.equal(reopened.sessionRecoveryNotice, 'aiSidebarSessionInterruptedRecovery');
});

test('首次正文保存失败时不创建空的会话索引，重试后能正常保存', async () => {
    const f = fixture();
    const view = f.view('failed');
    view.messages = [{ role: 'user', content: 'preserve my message' }];
    const write = f.plugin.saveData;
    f.plugin.saveData = async path => { if (path === 'sessions/failed.json') throw new Error('write failed'); };
    await assert.rejects(view.saveCurrentSession(true), /write failed/);
    assert.equal(f.files['chat-sessions.json'].sessions.length, 0);
    f.plugin.saveData = write;
    await view.saveCurrentSession(true);
    assert.equal(f.files['chat-sessions.json'].sessions[0].id, 'failed');
    assert.equal(f.files['sessions/failed.json'].messages[0].content, 'preserve my message');
});
