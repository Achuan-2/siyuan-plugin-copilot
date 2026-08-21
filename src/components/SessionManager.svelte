<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
    import { pushMsg } from '../api';
    import { i18n } from '../utils/i18n';

    export let sessions: ChatSession[] = [];
    export let currentSessionId: string = '';
    export let isOpen = false;
    // 父组件提供的「按需加载会话完整对话文本」函数：会话内容通常存放在独立文件，搜索正文时需要由父组件读取。
    export let loadSessionText: ((sessionId: string) => Promise<string>) | null = null;

    const dispatch = createEventDispatcher();

    // 下拉菜单位置
    let dropdownTop = 0;
    let dropdownLeft = 0;
    let buttonElement: HTMLButtonElement;
    let dropdownElement: HTMLDivElement;

    interface ChatSession {
        id: string;
        title: string;
        messages?: any[];
        messageCount?: number;
        createdAt: number;
        updatedAt: number;
        pinned?: boolean; // 是否钉住
        isLoading?: boolean; // 会话是否有后台任务正在运行
    }

    function handleSessionStatus(event: Event) {
        const detail = (event as CustomEvent<{ sessionId?: string; isLoading?: boolean }>).detail;
        if (!detail?.sessionId || typeof detail.isLoading !== 'boolean') return;

        const index = sessions.findIndex(session => session.id === detail.sessionId);
        if (index === -1 || sessions[index].isLoading === detail.isLoading) return;

        sessions[index] = { ...sessions[index], isLoading: detail.isLoading };
        sessions = [...sessions];
    }

    onMount(() => {
        window.addEventListener('copilot-session-status', handleSessionStatus);
    });

    onDestroy(() => {
        window.removeEventListener('copilot-session-status', handleSessionStatus);
    });

    // 右键菜单状态
    let contextMenuVisible = false;
    let contextMenuX = 0;
    let contextMenuY = 0;
    let contextMenuSession: ChatSession | null = null;

    // 批量删除相关状态
    let isMultiSelectMode = false; // 是否处于多选模式
    let selectedSessionIds: Set<string> = new Set(); // 选中的会话ID集合

    // 重命名相关状态
    let isRenameDialogOpen = false; // 重命名对话框是否打开
    let renameSessionTitle = ''; // 重命名输入框的值
    let renameSession: ChatSession | null = null; // 要重命名的会话

    // 搜索相关状态
    let searchQuery = ''; // 搜索关键词
    // 缓存每个会话的可搜索正文文本，避免重复读取文件
    let messagesTextCache: Map<string, string> = new Map();
    let isSearchLoading = false; // 是否正在按需加载会话内容
    let searchToken = 0; // 用于丢弃过期的异步加载结果
    let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    // 提取会话内嵌（已存在内存）的可搜索文本（用户消息 + AI生成的内容）
    function extractInlineMessagesText(session: ChatSession): string {
        const messages = session.messages || [];
        const parts: string[] = [];
        for (const msg of messages) {
            if (!msg || msg.role === 'system') continue;
            if (typeof msg.content === 'string') {
                parts.push(msg.content);
            } else if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part && part.type === 'text' && typeof part.text === 'string') {
                        parts.push(part.text);
                    }
                }
            }
            if (typeof (msg as any).thinking === 'string' && (msg as any).thinking) {
                parts.push((msg as any).thinking);
            }
        }
        return parts.join('\n');
    }

    // 取得会话用于搜索匹配的文本（优先 cache，回退到内存中的 messages）
    function getSearchableText(session: ChatSession): string {
        if (messagesTextCache.has(session.id)) {
            return messagesTextCache.get(session.id) || '';
        }
        // 部分会话可能在内存中已经持有 messages（如刚保存的当前会话）
        if (session.messages && session.messages.length > 0) {
            const text = extractInlineMessagesText(session);
            messagesTextCache.set(session.id, text);
            return text;
        }
        return '';
    }

    // 判断会话是否匹配当前搜索关键词
    function sessionMatchesSearch(session: ChatSession, query: string): boolean {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        if (session.title && session.title.toLowerCase().includes(q)) return true;
        return getSearchableText(session).toLowerCase().includes(q);
    }

    // 按需把所有会话的正文文本加载进缓存，便于搜索匹配
    async function ensureMessagesLoaded() {
        if (!loadSessionText) return;
        const myToken = ++searchToken;
        const pending = sessions.filter(s => !messagesTextCache.has(s.id));
        if (pending.length === 0) return;

        isSearchLoading = true;
        try {
            for (const s of pending) {
                if (myToken !== searchToken) return; // 已被新一次搜索取代
                if (s.messages && s.messages.length > 0) {
                    messagesTextCache.set(s.id, extractInlineMessagesText(s));
                    continue;
                }
                try {
                    const text = await loadSessionText(s.id);
                    messagesTextCache.set(s.id, text || '');
                } catch (err) {
                    console.error('Load session text error:', s.id, err);
                    messagesTextCache.set(s.id, '');
                }
                // 每加载一批会话就触发一次响应式更新，让结果增量出现
                messagesTextCache = messagesTextCache;
            }
        } finally {
            if (myToken === searchToken) {
                isSearchLoading = false;
            }
        }
    }

    function formatDate(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return (
                i18n('aiSidebarSessionToday') +
                ' ' +
                date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            );
        } else if (days === 1) {
            return (
                i18n('aiSidebarSessionYesterday') +
                ' ' +
                date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            );
        } else if (days < 7) {
            return `${days}${i18n('aiSidebarSessionDaysAgo')}`;
        } else {
            return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        }
    }

    function loadSession(sessionId: string) {
        // 多选模式下不加载会话，只切换选中状态
        if (isMultiSelectMode) {
            toggleSessionSelection(sessionId);
            return;
        }

        dispatch('load', { sessionId });
        isOpen = false;
    }

    function deleteSession(sessionId: string, event: Event) {
        event.stopPropagation();
        dispatch('delete', { sessionId });
    }

    function newSession() {
        dispatch('new');
        isOpen = false;
    }

    // 切换多选模式
    function toggleMultiSelectMode() {
        isMultiSelectMode = !isMultiSelectMode;
        if (!isMultiSelectMode) {
            // 退出多选模式时清空选中项
            selectedSessionIds.clear();
            selectedSessionIds = selectedSessionIds;
        }
    }

    // 切换会话选中状态
    function toggleSessionSelection(sessionId: string) {
        if (selectedSessionIds.has(sessionId)) {
            selectedSessionIds.delete(sessionId);
        } else {
            selectedSessionIds.add(sessionId);
        }
        selectedSessionIds = selectedSessionIds; // 触发响应式更新
    }

    // 全选/取消全选
    function toggleSelectAll() {
        if (selectedSessionIds.size === sortedSessions.length) {
            // 当前全选，则取消全选
            selectedSessionIds.clear();
        } else {
            // 未全选，则全选
            selectedSessionIds = new Set(sortedSessions.map(s => s.id));
        }
        selectedSessionIds = selectedSessionIds; // 触发响应式更新
    }

    // 批量删除选中的会话
    function batchDeleteSessions() {
        if (selectedSessionIds.size === 0) {
            pushMsg('请先选择要删除的会话');
            return;
        }

        dispatch('batchDelete', { sessionIds: Array.from(selectedSessionIds) });

        // 删除后退出多选模式
        isMultiSelectMode = false;
        selectedSessionIds.clear();
        selectedSessionIds = selectedSessionIds;
    }

    // 是否全选
    $: isAllSelected =
        sortedSessions.length > 0 && selectedSessionIds.size === sortedSessions.length;

    function closeOnOutsideClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest('.session-manager')) {
            isOpen = false;
        }
    }

    // 计算下拉菜单位置
    async function updateDropdownPosition() {
        if (!buttonElement || !isOpen) return;

        await tick();

        const rect = buttonElement.getBoundingClientRect();
        const dropdownWidth = dropdownElement?.offsetWidth || 320;
        const dropdownHeight = dropdownElement?.offsetHeight || 400;

        // 计算垂直位置
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;

        if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
            // 显示在按钮下方
            dropdownTop = rect.bottom + 4;
        } else {
            // 显示在按钮上方
            dropdownTop = rect.top - dropdownHeight - 4;
        }

        // 计算水平位置（右对齐）
        dropdownLeft = rect.right - dropdownWidth;

        // 确保下拉菜单不会超出视口左边界
        if (dropdownLeft < 8) {
            dropdownLeft = 8;
        }

        // 确保下拉菜单不会超出视口右边界
        if (dropdownLeft + dropdownWidth > window.innerWidth - 8) {
            dropdownLeft = window.innerWidth - dropdownWidth - 8;
        }
    }

    $: if (isOpen) {
        // 打开时触发刷新事件，重新加载最新的会话列表
        dispatch('refresh');
        updateDropdownPosition();
        setTimeout(() => {
            document.addEventListener('click', closeOnOutsideClick);
        }, 0);
    } else {
        document.removeEventListener('click', closeOnOutsideClick);
    }

    // 按钉住状态和更新时间排序（钉住的在前，然后按时间降序），并按搜索关键词过滤
    // messagesTextCache 显式作为参数，让 Svelte 在异步加载完成时重排列表
    function buildSortedSessions(
        list: ChatSession[],
        query: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _cache: Map<string, string>
    ): ChatSession[] {
        return list
            .filter(s => sessionMatchesSearch(s, query))
            .sort((a, b) => {
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;
                return b.updatedAt - a.updatedAt;
            });
    }

    $: sortedSessions = buildSortedSessions(sessions, searchQuery, messagesTextCache);

    // 关闭抽屉时清空搜索关键词，避免下次打开仍残留
    $: if (!isOpen && searchQuery) {
        searchQuery = '';
    }

    // 监听搜索词变化：非空时（去抖后）按需加载所有会话的正文进行匹配
    $: handleSearchQueryChange(searchQuery, isOpen);

    function handleSearchQueryChange(query: string, open: boolean) {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = null;
        }
        const q = (query || '').trim();
        if (!open || !q) {
            // 取消进行中的加载，仅按已有 cache + 标题进行匹配
            searchToken++;
            isSearchLoading = false;
            return;
        }
        searchDebounceTimer = setTimeout(() => {
            ensureMessagesLoaded();
        }, 200);
    }

    // 显示右键菜单
    function showContextMenu(event: MouseEvent, session: ChatSession) {
        event.preventDefault();
        event.stopPropagation();

        contextMenuSession = session;
        contextMenuX = event.clientX;
        contextMenuY = event.clientY;
        contextMenuVisible = true;
    }

    // 关闭右键菜单
    function closeContextMenu() {
        contextMenuVisible = false;
        contextMenuSession = null;
    }

    // 全局点击事件处理（关闭右键菜单）
    function handleGlobalClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest('.session-context-menu')) {
            closeContextMenu();
        }
    }

    // 钉住/取消钉住会话
    function togglePinSession() {
        if (!contextMenuSession) return;

        const session = sessions.find(s => s.id === contextMenuSession.id);
        if (session) {
            session.pinned = !session.pinned;
            sessions = [...sessions];
            dispatch('update', { sessions });
            pushMsg(
                session.pinned
                    ? i18n('aiSidebarSessionPinned')
                    : i18n('aiSidebarSessionUnpinned')
            );
        }
        // 不关闭右键菜单，让用户可以继续操作
    }

    // 导出会话到笔记
    function exportSessionToNote() {
        if (!contextMenuSession) return;

        dispatch('saveToNote', { sessionId: contextMenuSession.id });
        closeContextMenu();
    }

    // 导出会话到文件
    function exportSessionToFile() {
        if (!contextMenuSession) return;

        const session = contextMenuSession;
        const markdown = generateSessionMarkdown(session);

        // 创建下载链接
        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${session.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        pushMsg(i18n('aiSidebarSessionExportSuccess'));
        closeContextMenu();
    }

    // 生成会话的Markdown内容
    function generateSessionMarkdown(session: ChatSession): string {
        const header = `# ${session.title}\n\n`;
        const date = `> 创建时间：${new Date(session.createdAt).toLocaleString('zh-CN')}\n`;
        const updateDate = `> 更新时间：${new Date(session.updatedAt).toLocaleString('zh-CN')}\n\n`;

        const messages = (session.messages || [])
            .filter(msg => msg.role !== 'system')
            .map(msg => {
                const role = msg.role === 'user' ? '👤 **用户**' : '🤖 **助手**';
                let content = '';

                if (typeof msg.content === 'string') {
                    content = msg.content;
                } else if (Array.isArray(msg.content)) {
                    content = msg.content
                        .filter(part => part.type === 'text')
                        .map(part => part.text)
                        .join('\n');
                }

                return `${role}\n\n${content}\n`;
            })
            .join('\n---\n\n');

        return header + date + updateDate + messages;
    }

    // 监听全局点击事件
    $: if (contextMenuVisible) {
        setTimeout(() => {
            document.addEventListener('click', handleGlobalClick);
        }, 0);
    } else {
        document.removeEventListener('click', handleGlobalClick);
    }

    // 打开重命名对话框
    function openRenameDialog() {
        if (!contextMenuSession) return;

        renameSession = contextMenuSession;
        renameSessionTitle = contextMenuSession.title;
        isRenameDialogOpen = true;
        closeContextMenu();
    }

    // 确认重命名
    function confirmRename() {
        if (!renameSession || !renameSessionTitle.trim()) {
            pushMsg('会话标题不能为空');
            return;
        }

        const session = sessions.find(s => s.id === renameSession.id);
        if (session) {
            session.title = renameSessionTitle.trim();
            sessions = [...sessions];
            dispatch('update', { sessions });
            pushMsg(i18n('aiSidebarSessionRenameSuccess') || '重命名成功');
        }

        isRenameDialogOpen = false;
        renameSession = null;
        renameSessionTitle = '';
    }

    // 取消重命名
    function cancelRename() {
        isRenameDialogOpen = false;
        renameSession = null;
        renameSessionTitle = '';
    }
</script>

<div class="session-manager">
    <button
        bind:this={buttonElement}
        class="session-manager__button b3-button b3-button--text"
        on:click|stopPropagation={() => (isOpen = !isOpen)}
        title={i18n('aiSidebarSessionTitle')}
    >
        <svg class="b3-button__icon"><use xlink:href="#iconHistory"></use></svg>
    </button>

    {#if isOpen}
        <div
            bind:this={dropdownElement}
            class="session-manager__dropdown"
            style="top: {dropdownTop}px; left: {dropdownLeft}px;"
        >
            <div class="session-manager__header">
                <h4>{i18n('aiSidebarSessionHistory')}</h4>
                <div class="session-manager__header-actions">
                    {#if isMultiSelectMode}
                        <!-- 多选模式下的操作按钮 -->
                        <button
                            class="b3-button b3-button--text"
                            on:click={toggleSelectAll}
                            title={isAllSelected ? '取消全选' : '全选'}
                        >
                            <svg class="b3-button__icon">
                                <use
                                    xlink:href={isAllSelected ? '#iconCloseRound' : '#iconSelect'}
                                ></use>
                            </svg>
                        </button>
                        <button
                            class="b3-button b3-button--error"
                            on:click={batchDeleteSessions}
                            disabled={selectedSessionIds.size === 0}
                            title="删除选中 ({selectedSessionIds.size})"
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconTrashcan"></use>
                            </svg>
                            <span>删除 ({selectedSessionIds.size})</span>
                        </button>
                        <button
                            class="b3-button b3-button--text"
                            on:click={toggleMultiSelectMode}
                            title="退出多选"
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconClose"></use>
                            </svg>
                        </button>
                    {:else}
                        <!-- 普通模式下的操作按钮 -->
                        <button
                            class="b3-button b3-button--text"
                            on:click|stopPropagation={toggleMultiSelectMode}
                            title="多选删除"
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconList"></use>
                            </svg>
                        </button>
                        <button class="b3-button b3-button--primary" on:click={newSession}>
                            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            {i18n('aiSidebarSessionNew')}
                        </button>
                    {/if}
                </div>
            </div>

            <div class="session-manager__search">
                <svg class="session-manager__search-icon">
                    <use xlink:href="#iconSearch"></use>
                </svg>
                <input
                    type="text"
                    class="session-manager__search-input"
                    bind:value={searchQuery}
                    placeholder={i18n('aiSidebarSessionSearchPlaceholder') ||
                        '搜索会话标题或对话内容'}
                />
                {#if isSearchLoading}
                    <span class="session-manager__search-loading" title="正在加载会话内容…">…</span>
                {/if}
                {#if searchQuery}
                    <button
                        type="button"
                        class="session-manager__search-clear"
                        on:click={() => (searchQuery = '')}
                        title={i18n('aiSidebarSessionSearchClear') || '清除搜索'}
                    >
                        <svg class="b3-button__icon">
                            <use xlink:href="#iconClose"></use>
                        </svg>
                    </button>
                {/if}
            </div>

            <div class="session-manager__list">
                {#if sortedSessions.length === 0}
                    <div class="session-manager__empty">
                        {searchQuery.trim()
                            ? isSearchLoading
                                ? i18n('aiSidebarSessionSearching') || '正在搜索…'
                                : i18n('aiSidebarSessionSearchNoResults') || '没有匹配的会话'
                            : i18n('aiSidebarSessionEmpty')}
                    </div>
                {:else}
                    {#each sortedSessions as session}
                        <div
                            class="session-item"
                            class:session-item--active={session.id === currentSessionId}
                            class:session-item--pinned={session.pinned}
                            class:session-item--selected={selectedSessionIds.has(session.id)}
                            role="button"
                            tabindex="0"
                            on:click={() => loadSession(session.id)}
                            on:contextmenu={e => showContextMenu(e, session)}
                            on:keydown={() => {}}
                        >
                            {#if isMultiSelectMode}
                                <!-- 多选模式下显示复选框 -->
                                <div class="session-item__checkbox">
                                    <input
                                        type="checkbox"
                                        checked={selectedSessionIds.has(session.id)}
                                        on:change={() => toggleSessionSelection(session.id)}
                                        on:click|stopPropagation
                                    />
                                </div>
                            {/if}
                            <div class="session-item__content">
                                <div class="session-item__title">
                                    {#if session.pinned}
                                        <svg class="session-item__pin-icon">
                                            <use xlink:href="#iconPin"></use>
                                        </svg>
                                    {/if}
                                    {session.title}
                                    {#if session.isLoading}
                                        <svg
                                            class="session-item__loading-icon"
                                            title="后台任务进行中"
                                            aria-label="后台任务进行中"
                                        >
                                            <use xlink:href="#iconRefresh"></use>
                                        </svg>
                                    {/if}
                                </div>
                                <div class="session-item__info">
                                    <span class="session-item__date">
                                        {formatDate(session.updatedAt)}
                                    </span>
                                    <span class="session-item__count">
                                        {session.messageCount ||
                                            (session.messages
                                                ? session.messages.filter(m => m.role !== 'system')
                                                      .length
                                                : 0)}
                                        {i18n('aiSidebarMessagesMessageCount')}
                                    </span>
                                </div>
                            </div>
                            {#if !isMultiSelectMode}
                                <!-- 普通模式下显示删除按钮 -->
                                <button
                                    class="b3-button b3-button--text session-item__delete"
                                    on:click={e => deleteSession(session.id, e)}
                                    title={i18n('aiSidebarSessionDelete')}
                                >
                                    <svg class="b3-button__icon">
                                        <use xlink:href="#iconTrashcan"></use>
                                    </svg>
                                </button>
                            {/if}
                        </div>
                    {/each}
                {/if}
            </div>
        </div>
    {/if}

    <!-- 右键菜单 -->
    {#if contextMenuVisible && contextMenuSession}
        <div class="session-context-menu" style="left: {contextMenuX}px; top: {contextMenuY}px;">
            <div
                class="session-context-menu__item"
                role="button"
                tabindex="0"
                on:click={togglePinSession}
                on:keydown={e => e.key === 'Enter' && togglePinSession()}
            >
                <svg class="b3-menu__icon">
                    <use xlink:href={contextMenuSession.pinned ? '#iconUnpin' : '#iconPin'}></use>
                </svg>
                <span>
                    {contextMenuSession.pinned
                        ? i18n('aiSidebarSessionUnpin')
                        : i18n('aiSidebarSessionPin')}
                </span>
            </div>
            <div
                class="session-context-menu__item"
                role="button"
                tabindex="0"
                on:click={openRenameDialog}
                on:keydown={e => e.key === 'Enter' && openRenameDialog()}
            >
                <svg class="b3-menu__icon">
                    <use xlink:href="#iconEdit"></use>
                </svg>
                <span>{i18n('aiSidebarSessionRename') || '重命名'}</span>
            </div>
            <div
                class="session-context-menu__item"
                role="button"
                tabindex="0"
                on:click={exportSessionToNote}
                on:keydown={e => e.key === 'Enter' && exportSessionToNote()}
            >
                <svg class="b3-menu__icon">
                    <use xlink:href="#iconDownload"></use>
                </svg>
                <span>{i18n('aiSidebarActionsSaveToNote') || '保存为笔记'}</span>
            </div>
            <div
                class="session-context-menu__item"
                role="button"
                tabindex="0"
                on:click={exportSessionToFile}
                on:keydown={e => e.key === 'Enter' && exportSessionToFile()}
            >
                <svg class="b3-menu__icon">
                    <use xlink:href="#iconDownload"></use>
                </svg>
                <span>{i18n('aiSidebarSessionExport')}</span>
            </div>
        </div>
    {/if}

    <!-- 重命名对话框 -->
    {#if isRenameDialogOpen && renameSession}
        <div class="session-rename-dialog-overlay" on:click={cancelRename}>
            <div class="session-rename-dialog" on:click|stopPropagation>
                <div class="session-rename-dialog__header">
                    <h3>{i18n('aiSidebarSessionRename') || '重命名会话'}</h3>
                    <button
                        class="b3-button b3-button--text"
                        on:click={cancelRename}
                        title={i18n('commonCancel') || '取消'}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                <div class="session-rename-dialog__body">
                    <input
                        type="text"
                        class="b3-text-field"
                        bind:value={renameSessionTitle}
                        placeholder={i18n('aiSidebarSessionTitlePlaceholder') || '请输入会话标题'}
                        on:keydown={e => e.key === 'Enter' && confirmRename()}
                        autofocus
                    />
                </div>
                <div class="session-rename-dialog__footer">
                    <button class="b3-button b3-button--text" on:click={cancelRename}>
                        {i18n('commonCancel') || '取消'}
                    </button>
                    <button class="b3-button b3-button--primary" on:click={confirmRename}>
                        {i18n('commonConfirm') || '确定'}
                    </button>
                </div>
            </div>
        </div>
    {/if}
</div>

<style lang="scss">
    .session-manager {
        position: relative;
    }

    .session-manager__button {
        min-width: 32px;
    }

    .session-manager__dropdown {
        position: fixed;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        box-shadow: var(--b3-dialog-shadow);
        width: 320px;
        max-height: 60vh;
        display: flex;
        flex-direction: column;
        z-index: 10;
    }

    .session-manager__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--b3-border-color);

        h4 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        }

        .session-manager__header-actions {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        button {
            font-size: 12px;
            padding: 4px 12px;

            &:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        }
    }

    .session-manager__list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
    }

    .session-manager__search {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .session-manager__search-icon {
        flex-shrink: 0;
        width: 14px;
        height: 14px;
        color: var(--b3-theme-on-surface-light);
    }

    .session-manager__search-input {
        flex: 1;
        min-width: 0;
        padding: 4px 6px;
        font-size: 12px;
        background: transparent;
        color: var(--b3-theme-on-background);
        border: none;
        outline: none;

        &::placeholder {
            color: var(--b3-theme-on-surface-light);
        }
    }

    .session-manager__search-loading {
        flex-shrink: 0;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1;
        padding: 0 4px;
    }

    .session-manager__search-clear {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 4px;

        &:hover {
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-background);
        }

        svg {
            width: 12px;
            height: 12px;
        }
    }

    .session-manager__empty {
        padding: 40px 20px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-size: 13px;
    }

    .session-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        margin-bottom: 4px;
        border-radius: 6px;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-surface);
            border-color: var(--b3-border-color);

            .session-item__delete {
                opacity: 1;
            }
        }
    }

    .session-item--active {
        background: var(--b3-theme-primary-lightest);
        border-color: var(--b3-theme-primary);

        .session-item__title {
            color: var(--b3-theme-primary);
            font-weight: 600;
        }
    }

    .session-item--selected {
        background: var(--b3-theme-primary-lightest);
        border-color: var(--b3-theme-primary);
    }

    .session-item__checkbox {
        display: flex;
        align-items: center;
        margin: 0;
        cursor: pointer;

        input[type='checkbox'] {
            width: 16px;
            height: 16px;
            cursor: pointer;
            margin: 0;
        }
    }

    .session-item__content {
        flex: 1;
        min-width: 0;
    }

    .session-item__title {
        font-size: 13px;
        color: var(--b3-theme-on-background);
        margin-bottom: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .session-item__info {
        display: flex;
        gap: 12px;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
    }

    .session-item__delete {
        opacity: 0;
        transition: opacity 0.2s;
        flex-shrink: 0;

        &:hover {
            color: var(--b3-theme-error);
        }
    }

    .session-item--active .session-item__delete {
        opacity: 1;
    }

    .session-item--pinned {
        border-left: 2px solid var(--b3-theme-primary);
    }

    .session-item__pin-icon {
        width: 12px;
        height: 12px;
        margin-right: 4px;
        color: var(--b3-theme-primary);
        vertical-align: text-top;
    }

    .session-item__loading-icon {
        width: 13px;
        height: 13px;
        margin-left: 5px;
        color: var(--b3-theme-primary);
        vertical-align: -2px;
        animation: session-item-spin 1s linear infinite;
    }

    @keyframes session-item-spin {
        from {
            transform: rotate(0deg);
        }

        to {
            transform: rotate(360deg);
        }
    }

    .session-context-menu {
        position: fixed;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        box-shadow: var(--b3-dialog-shadow);
        z-index: 10000;
        min-width: 150px;
        padding: 4px 0;
    }

    .session-context-menu__item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        font-size: 13px;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        transition: background 0.2s;

        &:hover {
            background: var(--b3-theme-surface);
        }

        svg {
            width: 14px;
            height: 14px;
            color: var(--b3-theme-on-surface);
        }

        span {
            flex: 1;
        }
    }

    .session-rename-dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
    }

    .session-rename-dialog {
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        box-shadow: var(--b3-dialog-shadow);
        width: 90%;
        max-width: 400px;
        display: flex;
        flex-direction: column;
    }

    .session-rename-dialog__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid var(--b3-border-color);

        h3 {
            margin: 0;
            font-size: 15px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        }

        button {
            padding: 4px;
        }
    }

    .session-rename-dialog__body {
        padding: 20px 16px;

        .b3-text-field {
            width: 100%;
            padding: 8px 12px;
            font-size: 14px;
            border: 1px solid var(--b3-border-color);
            border-radius: 4px;
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-background);
            transition: border-color 0.2s;

            &:focus {
                outline: none;
                border-color: var(--b3-theme-primary);
            }

            &::placeholder {
                color: var(--b3-theme-on-surface-light);
            }
        }
    }

    .session-rename-dialog__footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid var(--b3-border-color);

        button {
            padding: 6px 16px;
            font-size: 13px;
        }
    }
</style>
