<script lang="ts">
    import { onMount } from 'svelte';
    import TranslateDialog from './TranslateDialog.svelte';
    import { settingsStore } from '../stores/settings';
    import { cloneSettings } from '../utils/settingsStorage';

    export let plugin: any;
    export let defaultProvider = '';
    export let defaultModelId = '';
    export let close: () => void;

    let settings: any = null;

    onMount(() => {
        let destroyed = false;
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
        };
    });
</script>

{#if settings}
    <TranslateDialog
        isOpen={true}
        standalone={true}
        {plugin}
        {settings}
        providers={settings.aiProviders || {}}
        defaultProvider={defaultProvider || settings.currentProvider || ''}
        defaultModelId={defaultModelId || settings.currentModelId || ''}
        on:close={close}
    />
{/if}
