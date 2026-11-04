<script lang="ts">
    import { createEventDispatcher, tick } from 'svelte';
    import { floatingLayer, containsFloatingTarget } from '../utils/floatingLayer';
    import { i18n } from '../utils/i18n';
    import {
        getDrawImageCapabilities,
        type DrawImageQuality,
        type DrawImageResolution,
    } from '../utils/drawImageConfig';

    export let modelId = '';
    export let isGemini = false;
    export let aspectRatio = 'auto';
    export let resolution: DrawImageResolution = '1K';
    export let quality: DrawImageQuality = 'auto';
    export let count = 1;

    const dispatch = createEventDispatcher();
    const qualityLabels: Record<DrawImageQuality, string> = {
        auto: i18n('aiSidebarDrawQualityAuto'), low: i18n('aiSidebarDrawQualityLow'),
        medium: i18n('aiSidebarDrawQualityMedium'), high: i18n('aiSidebarDrawQualityHigh'),
        xhigh: i18n('aiSidebarDrawQualityXhigh'), max: i18n('aiSidebarDrawQualityMax'),
        standard: i18n('aiSidebarDrawQualityStandard'), hd: i18n('aiSidebarDrawQualityHd'),
    };
    let root: HTMLDivElement;
    let button: HTMLButtonElement;
    let panel: HTMLDivElement;
    let open = false;
    let left = 0;
    let top = 0;
    let previousModel = modelId;
    $: capabilities = getDrawImageCapabilities(modelId, isGemini);
    $: if (modelId !== previousModel) {
        previousModel = modelId;
        open = false;
    }

    async function toggle() {
        if (open) { close(); return; }
        open = true;
        await tick();
        if (!panel || !button) return;
        const rect = button.getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        left = Math.max(8, Math.min(rect.right - bounds.width, window.innerWidth - bounds.width - 8));
        const above = rect.top - bounds.height - 8;
        top = above >= 8 ? above : Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - bounds.height - 8));
        panel.focus({ preventScroll: true });
    }

    function close(restoreFocus = true) {
        open = false;
        if (restoreFocus) button?.focus();
    }

    function handleOutside(event: PointerEvent) {
        if (open && root && !containsFloatingTarget(root, event.target as Node)) close(false);
    }

    function handleKeydown(event: KeyboardEvent) {
        if (open && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
    }

    function reset() {
        aspectRatio = 'auto';
        resolution = capabilities.defaultResolution;
        quality = capabilities.qualities[0] || 'auto';
        count = 1;
        dispatch('reset');
    }
</script>

<svelte:window on:pointerdown={handleOutside} on:keydown|capture={handleKeydown} on:resize={() => close(false)} />

<div class="draw-settings" bind:this={root}>
    <label class="draw-settings__ratio" title={i18n('aiSidebarDrawAspectRatio')}>
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="4" y="2" width="12" height="16" rx="2" stroke="currentColor" stroke-width="1.5" />
        </svg>
        <select class="b3-select" aria-label={i18n('aiSidebarDrawAspectRatio')} bind:value={aspectRatio}>
            {#each capabilities.aspectRatios as ratio}
                <option value={ratio}>{ratio === 'auto' ? i18n('aiSidebarDrawQualityAuto') : ratio}</option>
            {/each}
        </select>
    </label>
    <button
        bind:this={button}
        type="button"
        class="draw-settings__toggle"
        class:draw-settings__toggle--active={open}
        aria-label={i18n('aiSidebarDrawParameters')}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={i18n('aiSidebarDrawParameters')}
        on:click|stopPropagation={toggle}
    >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="M3 7h4m6 0h8M3 17h10m6 0h2" stroke-linecap="round" />
            <circle cx="10" cy="7" r="3" /><circle cx="16" cy="17" r="3" />
        </svg>
    </button>
    {#if open}
        <div
            use:floatingLayer
            bind:this={panel}
            class="draw-settings__panel"
            style:left="{left}px"
            style:top="{top}px"
            role="dialog"
            aria-label={i18n('aiSidebarDrawParameters')}
            tabindex="-1"
        >
            <div class="draw-settings__header">
                <strong>{i18n('aiSidebarDrawParameters')}</strong>
                <button type="button" class="draw-settings__reset" on:click={reset}>
                    {i18n('aiSidebarDrawReset')}
                </button>
            </div>
            {#if isGemini}
                <fieldset>
                    <legend>{i18n('aiSidebarDrawResolution')}</legend>
                    <div class="draw-settings__choices">
                        {#each capabilities.resolutions as value}
                            <button type="button" class:selected={resolution === value} aria-pressed={resolution === value}
                                on:click={() => { resolution = value; dispatch('resolutionchange'); }}>
                                {value === '512' ? '0.5K' : value}
                            </button>
                        {/each}
                    </div>
                </fieldset>
            {:else}
                <fieldset>
                    <legend>{i18n('aiSidebarDrawQuality')}</legend>
                    <div class="draw-settings__choices">
                        {#each capabilities.qualities as value}
                            <button type="button" class:selected={quality === value} aria-pressed={quality === value}
                                on:click={() => quality = value}>
                                {qualityLabels[value]}
                            </button>
                        {/each}
                    </div>
                </fieldset>
            {/if}
            <label class="draw-settings__count">
                <span>{i18n('aiSidebarDrawCount')}<output>{count}</output></span>
                <input type="range" min="1" max="10" step="1" bind:value={count} />
            </label>
        </div>
    {/if}
</div>

<style>
    .draw-settings { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .draw-settings__ratio { display: flex; align-items: center; gap: 2px; color: var(--b3-theme-on-surface); }
    .draw-settings__ratio select { background: transparent; border: 0; box-shadow: none; font-size: 13px; max-width: 100px; }
    button { cursor: pointer; font: inherit; color: inherit; }
    button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    .draw-settings__toggle { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; border-radius: 7px; background: transparent; color: var(--b3-theme-on-surface); }
    .draw-settings__toggle:hover, .draw-settings__toggle--active { background: var(--b3-theme-surface); color: var(--b3-theme-on-background); }
    .draw-settings__panel { position: fixed; z-index: 10; box-sizing: border-box; width: min(360px, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow-y: auto; padding: 20px; border: 1px solid var(--b3-border-color); border-radius: 12px; background: var(--b3-theme-background); color: var(--b3-theme-on-background); box-shadow: 0 8px 32px rgba(0, 0, 0, .12); font-size: 13px; }
    .draw-settings__panel:focus { outline: none; }
    .draw-settings__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 24px; }
    .draw-settings__header strong { font-size: 15px; }
    .draw-settings__reset { padding: 5px 9px; border: 1px solid var(--b3-border-color); border-radius: 7px; background: transparent; font-size: 12px; }
    .draw-settings__reset:hover { background: var(--b3-theme-surface); }
    fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
    legend { padding: 0; margin-bottom: 10px; font-weight: 500; }
    .draw-settings__choices { display: flex; flex-wrap: wrap; gap: 6px; }
    .draw-settings__choices button { flex: 1 0 44px; padding: 9px 6px; border: 1px solid var(--b3-border-color); border-radius: 8px; background: transparent; white-space: nowrap; }
    .draw-settings__choices button:hover { background: var(--b3-theme-surface); }
    .draw-settings__choices button.selected { background: var(--b3-theme-primary-lightest); border-color: var(--b3-theme-primary); color: var(--b3-theme-primary); }
    .draw-settings__count { display: grid; gap: 12px; margin-top: 24px; }
    .draw-settings__count span { display: flex; align-items: center; gap: 10px; font-weight: 500; }
    output { color: var(--b3-theme-on-surface); font-weight: normal; }
    input[type="range"] { width: 100%; margin: 0; accent-color: var(--b3-theme-primary); cursor: pointer; }
</style>
