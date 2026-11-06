<script lang="ts">
    import { onMount } from 'svelte';
    import TranslateDialog from './TranslateDialog.svelte';
    import { settingsStore } from '../stores/settings';
    import { cloneSettings } from '../utils/settingsStorage';
    import { getFrontend } from 'siyuan';
    import { TranslateDraftTransfer, isTranslateWindowURL, type TranslateWindowDraft } from '../utils/translateWindow';

    export let plugin: any;
    export let defaultProvider = '';
    export let defaultModelId = '';
    export let initialDraftId = '';
    export let close: () => void;

    let settings: any = null;
    let initialDraft: TranslateWindowDraft | null = null;

    onMount(() => {
        let destroyed = false;
        // openTab 的临时页签也会挂载本组件；仅让真正的独立窗口接收草稿。
        const isTranslationWindow = getFrontend() === 'desktop-window' &&
            isTranslateWindowURL(window.location.href, plugin.name, window.location.origin);
        const transfer = isTranslationWindow ? new TranslateDraftTransfer(plugin.name) : null;
        const stopReceiving = transfer?.receive(initialDraftId, draft => { initialDraft = draft; });
        // 使用各自的编辑副本，沿用设置存储的合并规则和跨窗口同步。
        const unsubscribe = settingsStore.subscribe(value => {
            if (value?.aiProviders) settings = cloneSettings(value);
        });
        plugin.loadSettings().then(value => {
            if (!destroyed) settings = cloneSettings(value);
        }).catch(error => console.error('Failed to load translation settings:', error));
        return () => {
            destroyed = true;
            unsubscribe();
            stopReceiving?.();
            transfer?.dispose();
        };
    });
</script>

{#if settings}
    <TranslateDialog
        isOpen={true}
        standalone={true}
        {plugin}
        {settings}
        {initialDraft}
        providers={settings.aiProviders || {}}
        defaultProvider={defaultProvider || settings.currentProvider || ''}
        defaultModelId={defaultModelId || settings.currentModelId || ''}
        on:close={close}
    />
{/if}
