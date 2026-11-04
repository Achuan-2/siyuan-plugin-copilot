<script lang="ts">
    import AISidebar from '../ai-sidebar.svelte';
    import type { ChatSessionMode } from '../utils/sessionState';

    export let plugin: any;
    export let initialMessage = '';
    export let initialSessionId = '';
    export let mode: 'sidebar' | 'dialog' = 'sidebar';
    export let respondToGlobalActions = false;

    interface ChatView {
        viewId: string;
        sessionId: string;
        initialSessionId: string;
        initialMessage: string;
        initialChatMode?: ChatSessionMode;
    }

    let viewSequence = 0;

    function createView(sessionId = '', message = '', initialChatMode?: ChatSessionMode): ChatView {
        viewSequence += 1;
        return {
            viewId: `copilot-session-view-${Date.now()}-${viewSequence}-${Math.random().toString(36).slice(2, 8)}`,
            sessionId,
            initialSessionId: sessionId,
            initialMessage: message,
            initialChatMode,
        };
    }

    let views: ChatView[] = [createView(initialSessionId, initialMessage)];
    let activeViewId = views[0].viewId;

    function activateSession(sessionId: string) {
        if (!sessionId) return;

        const existingView = views.find(view => view.sessionId === sessionId);
        if (existingView) {
            activeViewId = existingView.viewId;
            return;
        }

        const view = createView(sessionId);
        views = [...views, view];
        activeViewId = view.viewId;
    }

    function createNewSessionView() {
        const view = createView('', '', 'ask');
        views = [...views, view];
        activeViewId = view.viewId;
    }

    function handleSessionSwitch(event: CustomEvent<{ sessionId: string }>) {
        activateSession(event.detail?.sessionId || '');
    }

    function handleSessionNew() {
        createNewSessionView();
    }

    function handleSessionCreated(
        event: CustomEvent<{ viewId?: string; sessionId?: string }>
    ) {
        const { viewId, sessionId } = event.detail || {};
        if (!viewId || !sessionId) return;

        const view = views.find(item => item.viewId === viewId);
        if (!view || view.sessionId === sessionId) return;

        views = views.map(item =>
            item.viewId === viewId ? { ...item, sessionId } : item
        );
    }
</script>

<div class="ai-chat-session-host">
    {#each views as view (view.viewId)}
        <div
            class="ai-chat-session-host__view"
            class:ai-chat-session-host__view--active={view.viewId === activeViewId}
            aria-hidden={view.viewId !== activeViewId}
        >
            <AISidebar
                {plugin}
                {mode}
                sessionHost={true}
                sessionViewId={view.viewId}
                isSessionViewActive={view.viewId === activeViewId}
                respondToGlobalActions={respondToGlobalActions && view.viewId === activeViewId}
                initialSessionId={view.initialSessionId}
                initialMessage={view.initialMessage}
                initialChatMode={view.initialChatMode}
                on:session-switch={handleSessionSwitch}
                on:session-new={handleSessionNew}
                on:session-created={handleSessionCreated}
            />
        </div>
    {/each}
</div>

<style>
    .ai-chat-session-host {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    .ai-chat-session-host__view {
        position: absolute;
        inset: 0;
        visibility: hidden;
        pointer-events: none;
    }

    .ai-chat-session-host__view--active {
        visibility: visible;
        pointer-events: auto;
    }
</style>
