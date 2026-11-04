<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import AIChatSessionHost from './AIChatSessionHost.svelte';

    export let plugin: any;
    export let initialMessage: string = '';

    let dialogElement: HTMLElement;
    let aiSidebarApp: AIChatSessionHost | null = null;

    onMount(() => {
        // 创建AI聊天组件实例
        aiSidebarApp = new AIChatSessionHost({
            target: dialogElement,
            props: {
                plugin: plugin,
                initialMessage: initialMessage,
                mode: 'dialog',
            },
        });
    });

    onDestroy(() => {
        // 清理组件
        if (aiSidebarApp) {
            aiSidebarApp.$destroy();
            aiSidebarApp = null;
        }
    });
</script>

<div class="chat-dialog" bind:this={dialogElement}>
    <!-- AI聊天组件会被挂载到这里 -->
</div>

<style lang="scss">
    .chat-dialog {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--b3-theme-background);
        overflow: hidden;
    }
</style>
