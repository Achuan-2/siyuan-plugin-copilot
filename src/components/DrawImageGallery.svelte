<script lang="ts">
    import { createEventDispatcher, tick } from 'svelte';
    import { floatingLayer } from '../utils/floatingLayer';
    import { i18n } from '../utils/i18n';
    import type { DrawGalleryCard, DrawGalleryItem, DrawGalleryRequest, DrawPendingTask } from '../utils/drawGallery';
    import type { MessageAttachment } from '../ai-chat';

    export let items: DrawGalleryCard[] = [];
    export let pendingTasks: DrawPendingTask[] = [];
    export let disabled = false;
    export let sessionKey = '';
    export let resolveReferences: (images: MessageAttachment[]) => Promise<MessageAttachment[]> = async images => images;
    const dispatch = createEventDispatcher();
    let selected: DrawGalleryItem | null = null;
    let preview = '';
    let dialog: HTMLDivElement;
    let isFullscreen = false;
    let previewRequest = 0;
    let imageItems: DrawGalleryItem[] = [];
    $: imageItems = items.filter((item): item is DrawGalleryItem => 'image' in item);
    // 后台任务完成会改变卡片下标，用生成记录和图片本身识别当前项。
    $: selectedIndex = selected ? imageItems.findIndex(item =>
        item.generation === selected.generation && item.image.name === selected.image.name &&
        (item.image.path || item.image.data) === (selected.image.path || selected.image.data)) : -1;
    let previousFocus: HTMLElement | null = null;
    let previousSession = sessionKey;
    $: if (sessionKey !== previousSession) {
        previousSession = sessionKey;
        resetViewer();
        previousFocus = null;
    }

    async function view(item: DrawGalleryItem) {
        if (!selected) {
            previousFocus = document.activeElement as HTMLElement;
            isFullscreen = false;
        }
        const request = ++previewRequest;
        selected = item;
        preview = item.image.data || item.image.path || '';
        await tick();
        if (request !== previewRequest) return;
        dialog?.focus({ preventScroll: true });
        try {
            const references = await resolveReferences(item.referenceImages);
            if (request === previewRequest) selected = { ...item, referenceImages: references };
        } catch (error) {
            console.error('Failed to load draw reference previews:', error);
        }
    }

    function close() {
        resetViewer();
        previousFocus?.focus({ preventScroll: true });
        previousFocus = null;
    }

    function resetViewer() {
        previewRequest += 1;
        selected = null;
        preview = '';
        isFullscreen = false;
    }

    async function switchImage(direction: -1 | 1) {
        if (selectedIndex < 0) return;
        const item = imageItems[selectedIndex + direction];
        if (item) await view(item);
    }

    function toggleFullscreen() {
        isFullscreen = !isFullscreen;
    }

    function action(name: 'edit' | 'regenerate', item: DrawGalleryRequest) {
        if (selected) close();
        dispatch(name, item);
    }

    function handleKeydown(event: KeyboardEvent) {
        if (!selected || event.defaultPrevented || event.isComposing || event.repeat) return;
        if (dialog && getComputedStyle(dialog).visibility === 'hidden') return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (isFullscreen) isFullscreen = false;
            else close();
        } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
            !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            event.stopPropagation();
            void switchImage(event.key === 'ArrowLeft' ? -1 : 1);
        } else if (event.key === 'Tab' && dialog) {
            const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"]')]
                .filter(control => control.getClientRects().length > 0);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
                event.preventDefault(); first?.focus();
            }
        }
    }

    function qualityLabel(value: string) {
        const keys: Record<string, string> = {
            auto: 'aiSidebarDrawQualityAuto', low: 'aiSidebarDrawQualityLow', medium: 'aiSidebarDrawQualityMedium',
            high: 'aiSidebarDrawQualityHigh', xhigh: 'aiSidebarDrawQualityXhigh', max: 'aiSidebarDrawQualityMax',
            standard: 'aiSidebarDrawQualityStandard', hd: 'aiSidebarDrawQualityHd',
        };
        return i18n(keys[value] || 'aiSidebarDrawQualityAuto');
    }
</script>

<svelte:window on:keydown|capture={handleKeydown} />

<div class="draw-gallery" aria-label={i18n('aiSidebarDrawGallery')}>
    {#each pendingTasks as task (task.key)}
        {#each Array(Math.max(1, Math.min(10, task.count))) as _}
            <div class="draw-gallery__pending" role="status" title={task.prompt}>
                <span class="draw-gallery__spinner"></span>{task.status || i18n('aiSidebarDrawGenerating')}
                <button type="button" class="draw-gallery__cancel" on:click={() => dispatch('cancel', task.key)}
                    aria-label={i18n('aiSidebarStopGeneration')} title={i18n('aiSidebarStopGeneration')}>×</button>
            </div>
        {/each}
    {/each}
    {#each items as item (item.key)}
        <article class="draw-gallery__card" class:draw-gallery__card--failed={!('image' in item)}>
            {#if 'image' in item}
                <button type="button" class="draw-gallery__preview" on:click={() => view(item)}
                    aria-label={i18n('aiSidebarDrawDetails')} title={item.prompt}>
                    <img src={item.image.data} alt={item.prompt || item.image.name} loading="lazy" />
                    <span class="draw-gallery__caption">{item.prompt}</span>
                </button>
            {:else}
                <div class="draw-gallery__failure" role="status">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></svg>
                    <strong>{i18n('aiSidebarDrawGenerateFailed')}</strong>
                    {#if item.error}<span title={item.error}>{item.error}</span>{/if}
                </div>
                <span class="draw-gallery__caption">{item.prompt}</span>
            {/if}
            <div class="draw-gallery__actions">
                {#if 'image' in item}
                    <button type="button" {disabled} on:click={() => action('edit', item)}
                        aria-label={i18n('aiSidebarDrawEditImage')} title={i18n('aiSidebarDrawEditImage')}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg>
                    </button>
                {/if}
                <button type="button" {disabled} on:click={() => action('regenerate', item)}
                    aria-label={i18n('aiSidebarDrawRegenerateImage')} title={i18n('aiSidebarDrawRegenerateImage')}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.5 7a7.5 7.5 0 0 1 12-2L20 8M4 16l2.5 3a7.5 7.5 0 0 0 12-2" /></svg>
                </button>
                {#if 'image' in item}
                    <button type="button" on:click={() => dispatch('download', item.image)}
                        aria-label={i18n('aiSidebarDrawDownloadImage')} title={i18n('aiSidebarDrawDownloadImage')}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>
                    </button>
                {/if}
            </div>
        </article>
    {/each}
</div>
{#if !items.length && !pendingTasks.length}
    <div class="draw-gallery__empty">{i18n('aiSidebarDrawEmpty')}</div>
{/if}

{#if selected}
    <div use:floatingLayer class="draw-detail__overlay" class:draw-detail__overlay--fullscreen={isFullscreen} role="presentation"
        on:click={event => { if (event.target === event.currentTarget) close(); }}>
        <div class="draw-detail" class:draw-detail--fullscreen={isFullscreen} bind:this={dialog} role="dialog" aria-modal="true"
            aria-label={i18n('aiSidebarDrawDetails')} tabindex="-1">
            <div class="draw-detail__toolbar">
                <button type="button" on:click={toggleFullscreen}
                    aria-label={isFullscreen ? i18n('fullscreenExit') : i18n('fullscreenTitle')}
                    title={isFullscreen ? i18n('fullscreenExit') : i18n('fullscreenTitle')} aria-pressed={isFullscreen}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        {#if isFullscreen}<path d="M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5" />
                        {:else}<path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5" />{/if}
                    </svg>
                </button>
                <button type="button" class="draw-detail__close" aria-label={i18n('aiSidebarDrawCloseDetails')}
                    title={i18n('aiSidebarDrawCloseDetails')} on:click={close}>×</button>
            </div>
            <div class="draw-detail__image">
                <img src={preview} alt={selected.prompt || selected.image.name} />
                {#if imageItems.length > 1}
                    <button type="button" class="draw-detail__nav draw-detail__nav--previous" disabled={selectedIndex <= 0}
                        on:click={() => switchImage(-1)} aria-label={i18n('aiSidebarDrawPreviousImage')} title={i18n('aiSidebarDrawPreviousImage')}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7" /></svg>
                    </button>
                    <button type="button" class="draw-detail__nav draw-detail__nav--next" disabled={selectedIndex < 0 || selectedIndex >= imageItems.length - 1}
                        on:click={() => switchImage(1)} aria-label={i18n('aiSidebarDrawNextImage')} title={i18n('aiSidebarDrawNextImage')}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5 7 7-7 7" /></svg>
                    </button>
                {/if}
                {#if preview !== (selected.image.data || selected.image.path || '')}
                    <button type="button" class="draw-detail__back" on:click={() => preview = selected.image.data || selected.image.path || ''}>{i18n('aiSidebarDrawBackToResult')}</button>
                {/if}
            </div>
            <div class="draw-detail__info">
                {#if selected.generation}
                    <header><strong>{selected.generation.modelId}</strong>
                        <time>{new Date(selected.generation.createdAt).toLocaleString()}</time>
                    </header>
                {/if}
                <section><h3>{i18n('aiSidebarDrawPrompt')}</h3><p>{selected.prompt}</p></section>
                {#if selected.generation}
                    <section><h3>{i18n('aiSidebarDrawParameters')}</h3>
                        <div class="draw-detail__parameters">
                            <span>{selected.generation.settings.aspectRatio === 'auto' ? i18n('aiSidebarDrawQualityAuto') : selected.generation.settings.aspectRatio}</span>
                            {#if selected.generation.modelId.toLowerCase().includes('gemini')}
                                <span>{selected.generation.settings.resolution === '512' ? '0.5K' : selected.generation.settings.resolution}</span>
                            {:else}
                                <span>{qualityLabel(selected.generation.settings.quality)}</span>
                            {/if}
                            <span>{i18n('aiSidebarDrawCount')} {selected.generation.settings.count}</span>
                        </div>
                    </section>
                {/if}
                {#if selected.referenceImages.length}
                    <section><h3>{i18n('aiSidebarDrawReferences')}</h3>
                        <div class="draw-detail__references">
                            {#each selected.referenceImages as image}
                                <button type="button" title={image.name}
                                    on:click={() => preview = image.data || image.path || ''}>
                                    <img src={image.data || image.path || ''} alt={image.name} /><span>{image.name}</span>
                                </button>
                            {/each}
                        </div>
                    </section>
                {/if}
                {#if selected.generation && selected.generation.history.length > 1}
                    <details><summary>{i18n('aiSidebarDrawConversation')}</summary>
                        <ol>{#each selected.generation.history as prompt}<li>{prompt}</li>{/each}</ol>
                    </details>
                {/if}
                <div class="draw-detail__buttons">
                    <button type="button" class="draw-detail__edit" {disabled} on:click={() => action('edit', selected)}>{i18n('aiSidebarDrawEditImage')}</button>
                    <button type="button" {disabled} on:click={() => action('regenerate', selected)}>{i18n('aiSidebarDrawRegenerateImage')}</button>
                    <button type="button" on:click={() => dispatch('download', selected.image)}>{i18n('aiSidebarDrawDownloadImage')}</button>
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    .draw-gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr)); gap: 12px; align-items: start; }
    button { font: inherit; cursor: pointer; color: inherit; }
    button:disabled { opacity: .45; cursor: default; }
    button:focus-visible, summary:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    .draw-gallery__card { position: relative; border-radius: 12px; overflow: hidden; background: var(--b3-theme-surface); border: 1px solid var(--b3-border-color); }
    .draw-gallery__preview { display: block; padding: 0; border: 0; width: 100%; background: none; position: relative; }
    .draw-gallery__preview img { display: block; width: 100%; height: auto; min-height: 120px; max-height: 520px; object-fit: contain; }
    .draw-gallery__failure { box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 220px; padding: 52px 20px; text-align: center; color: var(--b3-theme-error); font-size: 13px; }
    .draw-gallery__failure > svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; }
    .draw-gallery__failure > span { color: var(--b3-theme-on-surface); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 64px; overflow: hidden; font-size: 12px; }
    .draw-gallery__caption { box-sizing: border-box; position: absolute; bottom: 0; left: 0; right: 0; padding: 28px 12px 12px; background: linear-gradient(transparent, rgba(0,0,0,.8)); color: #fff; font-size: 12px; line-height: 1.5; text-align: left; white-space: pre-wrap; max-height: 45%; overflow: hidden; opacity: 0; transition: opacity .15s; pointer-events: none; }
    .draw-gallery__actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 5px; opacity: 0; transition: opacity .15s; }
    .draw-gallery__card:hover .draw-gallery__caption, .draw-gallery__card:focus-within .draw-gallery__caption,
    .draw-gallery__card:hover .draw-gallery__actions, .draw-gallery__card:focus-within .draw-gallery__actions { opacity: 1; }
    .draw-gallery__actions button { width: 30px; height: 30px; border-radius: 50%; border: 0; display: grid; place-items: center; background: rgba(0,0,0,.65); color: #fff; }
    .draw-gallery__actions button:hover { background: rgba(0,0,0,.9); }
    .draw-gallery__actions svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .draw-gallery__pending { position: relative; display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 220px; border: 1px solid var(--b3-border-color); border-radius: 12px; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface); font-size: 13px; }
    .draw-gallery__cancel { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border: 0; border-radius: 50%; background: var(--b3-theme-background); font-size: 20px; line-height: 1; }
    .draw-gallery__spinner { width: 16px; height: 16px; border: 2px solid var(--b3-border-color); border-top-color: var(--b3-theme-primary); border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .draw-gallery__empty { margin: auto; padding: 48px 12px; text-align: center; color: var(--b3-theme-on-surface); font-size: 13px; }
    .draw-detail__overlay { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px; box-sizing: border-box; background: rgba(0,0,0,.55); }
    .draw-detail { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 32%); width: min(1280px, 100%); height: min(900px, calc(100vh - 40px)); border-radius: 14px; overflow: hidden; background: var(--b3-theme-background); color: var(--b3-theme-on-background); box-shadow: 0 16px 64px rgba(0,0,0,.3); outline: none; font-size: 13px; }
    .draw-detail__toolbar { position: absolute; top: 10px; right: 10px; z-index: 2; display: flex; align-items: center; gap: 8px; }
    .draw-detail__toolbar button { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--b3-border-color); border-radius: 50%; background: var(--b3-theme-background); }
    .draw-detail__close { font-size: 22px; line-height: 1; }
    .draw-detail__toolbar svg, .draw-detail__nav svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .draw-detail__image { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: var(--b3-theme-surface); }
    .draw-detail__image img { position: absolute; inset: 20px; width: calc(100% - 40px); height: calc(100% - 40px); object-fit: contain; }
    .draw-detail__nav { position: absolute; top: 50%; transform: translateY(-50%); z-index: 1; display: grid; place-items: center; width: 40px; height: 48px; padding: 0; border: 0; border-radius: 8px; background: rgba(0,0,0,.5); color: #fff; }
    .draw-detail__nav:hover:not(:disabled) { background: rgba(0,0,0,.75); }
    .draw-detail__nav:disabled { opacity: .2; }
    .draw-detail__nav--previous { left: 12px; }
    .draw-detail__nav--next { right: 12px; }
    .draw-detail__back { position: absolute; top: 12px; left: 12px; padding: 6px 10px; border: 1px solid var(--b3-border-color); border-radius: 7px; background: var(--b3-theme-background); font-size: 12px; }
    .draw-detail__info { min-width: 0; padding: 44px 22px 22px; overflow-y: auto; overflow-wrap: anywhere; }
    header { display: grid; gap: 8px; padding-bottom: 20px; border-bottom: 1px solid var(--b3-border-color); }
    header strong { font-size: 16px; } time { color: var(--b3-theme-on-surface); font-size: 12px; }
    section { margin-top: 24px; } h3 { font-size: 13px; margin: 0 0 12px; } p { white-space: pre-wrap; line-height: 1.7; margin: 0; }
    .draw-detail__parameters { display: flex; flex-wrap: wrap; gap: 6px; }
    .draw-detail__parameters span { padding: 5px 9px; border-radius: 7px; background: var(--b3-theme-surface); }
    .draw-detail__references { display: flex; flex-wrap: wrap; gap: 8px; }
    .draw-detail__references button { padding: 6px; border: 1px solid var(--b3-border-color); border-radius: 9px; background: none; width: 82px; }
    .draw-detail__references img { width: 68px; height: 68px; object-fit: cover; border-radius: 5px; }
    .draw-detail__references span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--b3-theme-on-surface); }
    details { margin-top: 24px; line-height: 1.6; } summary { cursor: pointer; } li { white-space: pre-wrap; margin: 8px 0; }
    .draw-detail__buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 28px; }
    .draw-detail__buttons button { padding: 8px 10px; border: 1px solid var(--b3-border-color); border-radius: 8px; background: none; }
    .draw-detail__buttons .draw-detail__edit { background: var(--b3-theme-primary); border-color: var(--b3-theme-primary); color: var(--b3-theme-on-primary, #fff); }
    .draw-detail__overlay--fullscreen { padding: 0; background: #111; }
    .draw-detail--fullscreen { grid-template-columns: 1fr; grid-template-rows: 1fr; width: 100%; height: 100%; border-radius: 0; }
    .draw-detail--fullscreen .draw-detail__image { background: #111; }
    .draw-detail--fullscreen .draw-detail__image img { inset: 0; width: 100%; height: 100%; }
    .draw-detail--fullscreen .draw-detail__info { display: none; }
    .draw-detail--fullscreen .draw-detail__toolbar button { background: rgba(0,0,0,.6); border-color: rgba(255,255,255,.3); color: #fff; }
    :global(html[data-frontend^="desktop"]) :global(body.body--windows) .draw-detail--fullscreen .draw-detail__toolbar,
    :global(html[data-frontend^="desktop"]) :global(body.body--linux) .draw-detail--fullscreen .draw-detail__toolbar {
        right: calc(12px + var(--b3-window-controls-width, var(--b3-fullscreen-controls-width, 138px)));
    }
    @media (hover: none) { .draw-gallery__actions, .draw-gallery__caption { opacity: 1; } }
    @media (max-width: 640px) {
        .draw-detail__overlay { padding: 8px; }
        .draw-detail { grid-template-columns: 1fr; grid-template-rows: minmax(180px, 50%) minmax(0, 1fr); height: calc(100vh - 16px); }
        .draw-detail__info { padding: 18px; }
        .draw-detail__image img { inset: 12px; width: calc(100% - 24px); height: calc(100% - 24px); }
        .draw-detail__overlay--fullscreen { padding: 0; }
        .draw-detail--fullscreen { grid-template-rows: 1fr; height: 100%; }
        .draw-detail--fullscreen .draw-detail__image img { inset: 0; width: 100%; height: 100%; }
    }
</style>
