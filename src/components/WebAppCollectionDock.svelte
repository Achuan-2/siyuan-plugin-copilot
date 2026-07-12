<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { i18n } from '../utils/i18n';

    export let plugin: any;
    export let webApps: any[] = [];
    export let openedAppIds: string[] = [];

    let activeAppId: string = '';
    let contentArea: HTMLElement;
    let isFullscreen = false;
    let showAppMenu = false;
    let appMenuButton: HTMLButtonElement;
    // 拖拽排序状态
    let draggedAppId: string | null = null;
    let dragOverAppId: string | null = null;
    let dropPosition: 'before' | 'after' | null = null;
    // appId -> wrapper element (contains the slot passed to initWebAppView)
    const wrapperMap = new Map<string, HTMLElement>();
    // appId -> slot element (passed to initWebAppView)
    const slotMap = new Map<string, HTMLElement>();

    // 从 prop 派生当前可见的页签，按 openedAppIds 的顺序排列
    $: visibleApps = (openedAppIds || []).reduce<any[]>((arr, id) => {
        const app = (webApps || []).find(a => a.id === id);
        if (app) arr.push(app);
        return arr;
    }, []);

    function getIconId(app: any): string {
        if (app.icon && app.icon.startsWith('data:image')) {
            return plugin.getWebAppIconId(app.id);
        }
        return 'iconCopilotWebApp';
    }

    function getWebAppIconUrl(icon: string): string {
        if (!icon) return '';
        if (icon.startsWith('data:')) return icon;
        return `/data/storage/petal/siyuan-plugin-copilot/webappIcon/${icon}`;
    }

    function ensureApp(app: any) {
        if (slotMap.has(app.id) || !contentArea) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'webapp-collection__app-wrapper';
        wrapper.style.display = 'none';
        wrapper.style.flexDirection = 'column';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';
        wrapper.style.minHeight = '0';
        wrapper.style.overflow = 'hidden';

        const slot = document.createElement('div');
        slot.style.width = '100%';
        slot.style.height = '100%';
        slot.style.minHeight = '0';
        slot.style.flex = '1';
        wrapper.appendChild(slot);

        plugin.initWebAppView(slot, app);

        contentArea.appendChild(wrapper);
        slotMap.set(app.id, slot);
        wrapperMap.set(app.id, wrapper);
    }

    export function openApp(appId: string) {
        // 该方法由父组件调用，仅负责选中已存在的页签
        // 添加/移除 openedAppIds 的逻辑在父组件中完成
        const app = (webApps || []).find(a => a.id === appId);
        if (app) {
            selectApp(app);
        }
    }

    function selectApp(app: any) {
        if (!app || activeAppId === app.id) return;
        activeAppId = app.id;
        ensureApp(app);
        updateVisibleWrapper();
    }

    function updateVisibleWrapper() {
        for (const [id, wrapper] of wrapperMap) {
            wrapper.style.display = id === activeAppId ? 'flex' : 'none';
        }
    }

    function closeAppTab(event: MouseEvent, app: any) {
        event.stopPropagation();
        plugin.closeWebAppInCollectionDock?.(app.id);

        if (activeAppId === app.id) {
            activeAppId = '';
        }
    }

    // 拖拽排序：计算放置位置
    function updateDropPosition(event: DragEvent, target: HTMLElement) {
        const rect = target.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        dropPosition = event.clientY < midpoint ? 'before' : 'after';
    }

    function handleDragStart(event: DragEvent, appId: string) {
        draggedAppId = appId;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', appId);
        }
    }

    function handleDragEnter(event: DragEvent, appId: string) {
        event.preventDefault();
        if (draggedAppId === appId) return;
        dragOverAppId = appId;
        const target = event.currentTarget as HTMLElement;
        updateDropPosition(event, target);
    }

    function handleDragOver(event: DragEvent, appId: string) {
        event.preventDefault();
        if (draggedAppId === appId) return;
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
        const target = event.currentTarget as HTMLElement;
        updateDropPosition(event, target);
    }

    function handleDragLeave(event: DragEvent, appId: string) {
        const target = event.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        if (
            event.clientX <= rect.left ||
            event.clientX >= rect.right ||
            event.clientY <= rect.top ||
            event.clientY >= rect.bottom
        ) {
            if (dragOverAppId === appId) {
                dragOverAppId = null;
                dropPosition = null;
            }
        }
    }

    function handleDrop(event: DragEvent, appId: string) {
        event.preventDefault();
        if (!draggedAppId || draggedAppId === appId || !dropPosition) {
            draggedAppId = null;
            dragOverAppId = null;
            dropPosition = null;
            return;
        }

        const currentIds = [...(openedAppIds || [])];
        const draggedIndex = currentIds.indexOf(draggedAppId);
        const targetIndex = currentIds.indexOf(appId);
        if (draggedIndex === -1 || targetIndex === -1) {
            draggedAppId = null;
            dragOverAppId = null;
            dropPosition = null;
            return;
        }

        const [removed] = currentIds.splice(draggedIndex, 1);
        let insertIndex = targetIndex;
        if (draggedIndex < targetIndex) {
            insertIndex = dropPosition === 'before' ? targetIndex - 1 : targetIndex;
        } else {
            insertIndex = dropPosition === 'before' ? targetIndex : targetIndex + 1;
        }
        currentIds.splice(insertIndex, 0, removed);

        plugin.setOpenedWebAppIds?.(currentIds);

        draggedAppId = null;
        dragOverAppId = null;
        dropPosition = null;
    }

    function handleDragEnd() {
        draggedAppId = null;
        dragOverAppId = null;
        dropPosition = null;
    }

    function toggleFullscreen() {
        isFullscreen = !isFullscreen;
        const root = document.querySelector('.webapp-collection') as HTMLElement | null;
        if (!root) return;

        if (isFullscreen) {
            root.style.position = 'fixed';
            root.style.top = '0';
            root.style.left = '0';
            root.style.right = '0';
            root.style.bottom = '0';
            root.style.width = '100vw';
            root.style.height = '100vh';
            root.style.zIndex = '9999';
            root.style.background = 'var(--b3-theme-background)';
        } else {
            root.style.position = '';
            root.style.top = '';
            root.style.left = '';
            root.style.right = '';
            root.style.bottom = '';
            root.style.width = '';
            root.style.height = '';
            root.style.zIndex = '';
            root.style.background = '';
        }
    }

    function toggleAppMenu() {
        showAppMenu = !showAppMenu;
    }

    function closeAppMenu() {
        showAppMenu = false;
    }

    function handleOpenAppFromMenu(app: any) {
        closeAppMenu();
        plugin.openWebAppInCollectionDock?.(app.id);
    }

    // 点击外部关闭小程序菜单
    function handleDocumentClick(event: MouseEvent) {
        if (!showAppMenu) return;
        const target = event.target as Node;
        if (appMenuButton && appMenuButton.contains(target)) return;
        const menu = document.querySelector('.webapp-collection__app-menu');
        if (menu && menu.contains(target)) return;
        closeAppMenu();
    }

    // Reactive cleanup: remove wrappers for apps that are no longer visible
    $: {
        const visibleIds = new Set(visibleApps.map(app => app.id));
        for (const [id, wrapper] of wrapperMap) {
            if (!visibleIds.has(id)) {
                wrapper.remove();
                wrapperMap.delete(id);
                slotMap.delete(id);
            }
        }

        if (activeAppId && !visibleIds.has(activeAppId)) {
            activeAppId = '';
            if (visibleApps.length > 0) {
                setTimeout(() => selectApp(visibleApps[0]), 0);
            }
        }
    }

    onMount(() => {
        if (visibleApps.length > 0) {
            selectApp(visibleApps[0]);
        }
        document.addEventListener('click', handleDocumentClick);
    });

    onDestroy(() => {
        for (const wrapper of wrapperMap.values()) {
            wrapper.remove();
        }
        wrapperMap.clear();
        slotMap.clear();
        document.removeEventListener('click', handleDocumentClick);
    });
</script>

<div class="webapp-collection" class:webapp-collection--fullscreen={isFullscreen}>
    <div class="webapp-collection__toolbar">
        <div class="webapp-collection__toolbar-left">
            <button
                class="b3-button b3-button--text webapp-collection__toolbar-btn"
                bind:this={appMenuButton}
                on:click={toggleAppMenu}
                title={i18n('aiSidebarWebappTitle') || '小程序'}
            >
                <svg class="b3-button__icon">
                    <use xlink:href="#iconCopilotWebApp"></use>
                </svg>
            </button>

            {#if showAppMenu}
                <div class="webapp-collection__app-menu">
                    {#each webApps || [] as app (app.id)}
                        <button
                            class="b3-menu__item webapp-collection__app-menu-item"
                            class:b3-menu__item--selected={activeAppId === app.id}
                            on:click={() => handleOpenAppFromMenu(app)}
                        >
                            <div
                                class="b3-menu__icon"
                                style="display: flex; align-items: center; justify-content: center;"
                            >
                                {#if app.icon}
                                    <img
                                        src={getWebAppIconUrl(app.icon)}
                                        alt=""
                                        style="width: 16px; height: 16px; object-fit: cover;"
                                    />
                                {:else}
                                    <svg><use xlink:href="#iconGlobe"></use></svg>
                                {/if}
                            </div>
                            <span class="b3-menu__label">{app.name}</span>
                        </button>
                    {/each}
                    {#if (webApps || []).length === 0}
                        <div class="webapp-collection__app-menu-empty">
                            {i18n('settingsWebAppCollectionDockNoApps') || '暂无小程序'}
                        </div>
                    {/if}
                </div>
            {/if}
        </div>

        <div class="webapp-collection__toolbar-right">
            <button
                class="b3-button b3-button--text webapp-collection__toolbar-btn"
                title={isFullscreen ? '退出全屏' : '全屏'}
                on:click={toggleFullscreen}
            >
                <svg class="b3-button__icon">
                    <use xlink:href={isFullscreen ? '#iconContract' : '#iconFullscreen'}></use>
                </svg>
            </button>
        </div>
    </div>

    <div class="webapp-collection__body">
        <div class="webapp-collection__tabs">
            {#each visibleApps as app (app.id)}
                <div
                    class="webapp-collection__tab"
                    class:webapp-collection__tab--active={activeAppId === app.id}
                    class:webapp-collection__tab--dragging={draggedAppId === app.id}
                    class:webapp-collection__tab--drop-before={dragOverAppId === app.id &&
                        dropPosition === 'before'}
                    class:webapp-collection__tab--drop-after={dragOverAppId === app.id &&
                        dropPosition === 'after'}
                    title={app.name}
                    role="button"
                    tabindex="0"
                    draggable="true"
                    on:click={() => selectApp(app)}
                    on:keydown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            selectApp(app);
                        }
                    }}
                    on:dragstart={e => handleDragStart(e, app.id)}
                    on:dragenter={e => handleDragEnter(e, app.id)}
                    on:dragover={e => handleDragOver(e, app.id)}
                    on:dragleave={e => handleDragLeave(e, app.id)}
                    on:drop={e => handleDrop(e, app.id)}
                    on:dragend={handleDragEnd}
                >
                    <svg class="webapp-collection__tab-icon">
                        <use xlink:href={`#${getIconId(app)}`}></use>
                    </svg>
                    <span class="webapp-collection__tab-name">{app.name}</span>
                    <button
                        class="webapp-collection__tab-close"
                        title="关闭"
                        on:click={e => closeAppTab(e, app)}
                    >
                        <svg>
                            <use xlink:href="#iconClose"></use>
                        </svg>
                    </button>
                </div>
            {/each}
        </div>
        <div class="webapp-collection__content" bind:this={contentArea}></div>
    </div>
</div>

<style lang="scss">
    .webapp-collection {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--b3-theme-background);
    }

    .webapp-collection__toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        flex-shrink: 0;
    }

    .webapp-collection__toolbar-left,
    .webapp-collection__toolbar-right {
        display: flex;
        align-items: center;
        gap: 4px;
        position: relative;
    }

    .webapp-collection__toolbar-btn {
        padding: 4px;
    }

    .webapp-collection__app-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        min-width: 180px;
        max-height: 320px;
        overflow-y: auto;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1000;
        padding: 4px;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .webapp-collection__app-menu-item {
        border-radius: 4px;

        &.b3-menu__item--selected {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
        }
    }

    .webapp-collection__app-menu-empty {
        padding: 12px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        text-align: center;
    }

    .webapp-collection__body {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .webapp-collection__tabs {
        width: 56px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 4px;
        border-right: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        overflow-y: auto;
        overflow-x: hidden;
    }

    .webapp-collection__tab {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 8px 4px;
        border-radius: 4px;
        border: none;
        background: transparent;
        color: var(--b3-theme-on-surface);
        cursor: pointer;
        transition: background-color 0.2s ease;
        user-select: none;

        &:hover {
            background: var(--b3-theme-background-light);

            .webapp-collection__tab-close {
                opacity: 1;
            }
        }

        &--active {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
        }

        &--dragging {
            opacity: 0.4;
            cursor: grabbing;
        }

        // 上方放置指示器
        &--drop-before::before {
            content: '';
            position: absolute;
            top: -2px;
            left: 4px;
            right: 4px;
            height: 3px;
            background: var(--b3-theme-primary);
            border-radius: 2px;
            z-index: 1;
        }

        // 下方放置指示器
        &--drop-after::after {
            content: '';
            position: absolute;
            bottom: -2px;
            left: 4px;
            right: 4px;
            height: 3px;
            background: var(--b3-theme-primary);
            border-radius: 2px;
            z-index: 1;
        }
    }

    .webapp-collection__tab-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
    }

    .webapp-collection__tab-name {
        font-size: 10px;
        line-height: 1.2;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: center;
    }

    .webapp-collection__tab-close {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 14px;
        height: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 3px;
        opacity: 0;
        transition: opacity 0.2s ease, background-color 0.2s ease;
        color: var(--b3-theme-on-surface-light);
        background: var(--b3-theme-background);
        cursor: pointer;
        padding: 0;

        svg {
            width: 10px;
            height: 10px;
        }

        &:hover {
            background: var(--b3-theme-error);
            color: var(--b3-theme-on-error);
        }
    }

    .webapp-collection__content {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        position: relative;
    }

    :global(.webapp-collection__app-wrapper) {
        display: none;
        width: 100%;
        height: 100%;
        flex-direction: column;
        overflow: hidden;
    }
</style>
