<script lang="ts">
    import { createEventDispatcher, tick } from 'svelte';
    import { floatingLayer, containsFloatingTarget } from '../utils/floatingLayer';
    import { i18n } from '../utils/i18n';

    export let value = 'auto';
    export let options: string[] = [];
    export let label = '';
    export let labels: Record<string, string> = {};
    export let showRatioPreview = false;

    const listId = `draw-options-${Math.random().toString(36).slice(2)}`;
    const dispatch = createEventDispatcher();
    let root: HTMLDivElement;
    let trigger: HTMLButtonElement;
    let list: HTMLDivElement;
    let open = false;
    let activeIndex = 0;
    let left = 0;
    let top = 0;
    let maxHeight = 400;
    let previousOptions = options;
    $: if (options !== previousOptions) {
        previousOptions = options;
        open = false;
    }

    function optionLabel(option: string) {
        return labels[option] || (option === 'auto' ? i18n('aiSidebarDrawQualityAuto') : option);
    }

    function previewStyle(ratio: string) {
        const [width, height] = ratio === 'auto' ? [1, 1] : ratio.split(':').map(Number);
        const scale = 24 / Math.max(width, height);
        return `width: ${width * scale}px; height: ${height * scale}px;`;
    }

    function close(restoreFocus = false) {
        open = false;
        if (restoreFocus) trigger?.focus({ preventScroll: true });
    }

    async function revealActive() {
        await tick();
        list?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    }

    async function show(index = options.indexOf(value)) {
        if (!options.length || !trigger) return;
        const anchor = trigger.getBoundingClientRect();
        maxHeight = Math.max(36, Math.min(400, Math.max(anchor.top - 14, window.innerHeight - anchor.bottom - 14)));
        activeIndex = Math.max(0, index);
        open = true;
        dispatch('open');
        await tick();
        if (!trigger || !list) return;
        const bounds = list.getBoundingClientRect();
        left = Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8));
        const above = anchor.top - bounds.height - 6;
        top = above >= 8 ? above : Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - 8));
        list.focus({ preventScroll: true });
        await revealActive();
    }

    function select(index: number) {
        if (!options[index]) return;
        value = options[index];
        dispatch('change', value);
        close(true);
    }

    function handleTriggerKeydown(event: KeyboardEvent) {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            void show(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : options.indexOf(value));
        }
    }

    function handleListKeydown(event: KeyboardEvent) {
        if (event.key === 'Tab') { close(true); return; }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select(activeIndex);
            return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Home') activeIndex = 0;
        else if (event.key === 'End') activeIndex = options.length - 1;
        else activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        void revealActive();
    }

    function handleEscape(event: KeyboardEvent) {
        if (open && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        }
    }

    function handleOutside(event: PointerEvent) {
        if (open && root && !containsFloatingTarget(root, event.target as Node)) close();
    }
</script>

<svelte:window on:pointerdown={handleOutside} on:keydown|capture={handleEscape} on:resize={() => close()} />

<div class="draw-option" bind:this={root}>
    <button bind:this={trigger} type="button" class="draw-option__trigger" class:draw-option__trigger--open={open}
        role="combobox" aria-label={label} aria-haspopup="listbox"
        aria-controls={listId} aria-expanded={open} title={label}
        on:click|stopPropagation={() => open ? close() : show()} on:keydown={handleTriggerKeydown}>
        {#if showRatioPreview}
            <span class="draw-option__preview" aria-hidden="true"><span class:auto={value === 'auto'} style={previewStyle(value)}></span></span>
        {:else}
            <span class="draw-option__label">{label}</span>
        {/if}
        <span>{optionLabel(value)}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    {#if open}
        <div use:floatingLayer bind:this={list} id={listId} class="draw-option__list"
            style:left="{left}px" style:top="{top}px" style:max-height="{maxHeight}px" role="listbox" tabindex="-1"
            aria-label={label} aria-activedescendant={`${listId}-${activeIndex}`}
            on:keydown={handleListKeydown}>
            {#each options as option, index}
                <button type="button" role="option" tabindex="-1" id={`${listId}-${index}`} data-index={index}
                    class="draw-option__option" class:selected={value === option} class:active={activeIndex === index}
                    aria-selected={value === option} on:click={() => select(index)}>
                    {#if showRatioPreview}
                        <span class="draw-option__preview" aria-hidden="true"><span class:auto={option === 'auto'} style={previewStyle(option)}></span></span>
                    {/if}
                    <span>{optionLabel(option)}</span>
                    {#if value === option}<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .draw-option { display: flex; flex-shrink: 0; }
    button { font: inherit; cursor: pointer; color: inherit; }
    .draw-option__trigger { display: flex; align-items: center; gap: 7px; min-height: 30px; padding: 3px 6px; border: 0; border-radius: 7px; background: transparent; color: var(--b3-theme-on-surface); font-size: 13px; }
    .draw-option__trigger:hover, .draw-option__trigger--open { background: var(--b3-theme-surface); color: var(--b3-theme-on-background); }
    .draw-option__trigger:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    .draw-option__label { font-size: 12px; }
    .draw-option__preview { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex-shrink: 0; }
    .draw-option__preview > span { box-sizing: border-box; border: 1.5px solid currentColor; border-radius: 2px; }
    .draw-option__preview > span.auto { width: 19px !important; height: 19px !important; border-style: dashed; }
    .draw-option__list { position: fixed; z-index: 12; box-sizing: border-box; width: 146px; max-width: calc(100vw - 16px); max-height: min(400px, calc(100vh - 16px)); overflow-y: auto; overscroll-behavior: contain; padding: 6px; border: 1px solid var(--b3-border-color); border-radius: 10px; background: var(--b3-theme-background); color: var(--b3-theme-on-background); box-shadow: 0 8px 28px rgba(0,0,0,.16); outline: none; font-size: 13px; }
    .draw-option__option { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 36px; padding: 3px 8px; border: 0; border-radius: 6px; background: transparent; text-align: left; }
    .draw-option__option > svg { margin-left: auto; flex-shrink: 0; }
    .draw-option__option:hover, .draw-option__option.active { background: var(--b3-theme-surface); }
    .draw-option__option.selected { color: var(--b3-theme-primary); }
</style>
