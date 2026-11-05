<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import DrawOptionSelector from './DrawOptionSelector.svelte';
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
    const countOptions = Array.from({ length: 10 }, (_, index) => String(index + 1));
    const qualityLabels: Record<DrawImageQuality, string> = {
        auto: i18n('aiSidebarDrawQualityAuto'), low: i18n('aiSidebarDrawQualityLow'),
        medium: i18n('aiSidebarDrawQualityMedium'), high: i18n('aiSidebarDrawQualityHigh'),
        xhigh: i18n('aiSidebarDrawQualityXhigh'), max: i18n('aiSidebarDrawQualityMax'),
        standard: i18n('aiSidebarDrawQualityStandard'), hd: i18n('aiSidebarDrawQualityHd'),
    };
    $: capabilities = getDrawImageCapabilities(modelId, isGemini);
</script>

<div class="draw-settings">
    <DrawOptionSelector bind:value={aspectRatio} options={capabilities.aspectRatios}
        label={i18n('aiSidebarDrawAspectRatio')} showRatioPreview />
    {#if isGemini}
        <DrawOptionSelector bind:value={resolution} options={capabilities.resolutions}
            label={i18n('aiSidebarDrawResolution')} labels={{ '512': '0.5K' }}
            on:change={() => dispatch('resolutionchange')} />
    {:else}
        <DrawOptionSelector bind:value={quality} options={capabilities.qualities}
            label={i18n('aiSidebarDrawQuality')} labels={qualityLabels} />
    {/if}
    <DrawOptionSelector value={String(count)} options={countOptions}
        label={i18n('aiSidebarDrawCount')} on:change={event => count = Number(event.detail)} />
</div>

<style>
    .draw-settings { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
</style>
