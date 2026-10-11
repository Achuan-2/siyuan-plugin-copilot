<script lang="ts">
    import { i18n, tf } from '../utils/i18n';
    import { createEventDispatcher } from 'svelte';
    import { pushMsg, pushErrMsg } from '../api';
    import type { CustomProviderConfig } from '../defaultSettings';

    export let customProviders: CustomProviderConfig[];

    const dispatch = createEventDispatcher();

    let newProviderName = '';
    let showAddForm = false;

    function generateId(): string {
        return `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    function addCustomProvider() {
        if (!newProviderName.trim()) {
            pushErrMsg('platform.nameRequired');
            return;
        }

        const newProvider: CustomProviderConfig = {
            id: generateId(),
            name: newProviderName.trim(),
            apiKey: '',
            customApiUrl: '',
            models: [],
            enabled: true,
        };

        customProviders = [...customProviders, newProvider];
        dispatch('change');
        pushMsg(tf('platformAdded', newProviderName));

        newProviderName = '';
        showAddForm = false;
    }

    function removeCustomProvider(id: string) {
        const provider = customProviders.find(p => p.id === id);
        if (provider) {
            customProviders = customProviders.filter(p => p.id !== id);
            dispatch('change');
            pushMsg(tf('platformDeleted', provider.name));
        }
    }

    function renameProvider(id: string, newName: string) {
        const provider = customProviders.find(p => p.id === id);
        if (provider) {
            provider.name = newName;
            customProviders = [...customProviders];
            dispatch('change');
        }
    }
</script>

<div class="custom-provider-manager">
    <div class="manager-header">
        <h5>{i18n('platformCustomTitle')}</h5>
        <button class="b3-button b3-button--outline" on:click={() => (showAddForm = !showAddForm)}>
            {showAddForm ? i18n('platformCancel') : i18n('platformAdd')}
        </button>
    </div>

    {#if showAddForm}
        <div class="add-form">
            <div class="b3-label">
                <div class="b3-label__text">{i18n('platformName')}</div>
                <input
                    class="b3-text-field fn__flex-1"
                    type="text"
                    bind:value={newProviderName}
                    placeholder={i18n('platformNamePlaceholder')}
                    on:keydown={e => e.key === 'Enter' && addCustomProvider()}
                />
            </div>
            <button
                class="b3-button b3-button--outline"
                on:click={addCustomProvider}
                disabled={!newProviderName.trim()}
            >
                {i18n('platformConfirmAdd')}
            </button>
        </div>
    {/if}

    <div class="provider-list">
        {#each customProviders as provider}
            <div class="provider-item">
                <input
                    class="b3-text-field provider-name-input"
                    type="text"
                    bind:value={provider.name}
                    on:change={() => renameProvider(provider.id, provider.name)}
                />
                <button
                    class="b3-button b3-button--text b3-button--error"
                    on:click={() => removeCustomProvider(provider.id)}
                    title={i18n('aiSidebarConfirmDeletePlatformTitle')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                </button>
            </div>
        {/each}
        {#if customProviders.length === 0}
            <div class="empty-hint">{i18n('platformNoCustom')}</div>
        {/if}
    </div>
</div>

<style lang="scss">
    .custom-provider-manager {
        background: var(--b3-theme-surface);
        border-radius: 6px;
        padding: 16px;
        margin-bottom: 16px;
    }

    .manager-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;

        h5 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-surface);
        }
    }

    .add-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        background: var(--b3-theme-background);
        border-radius: 4px;
        margin-bottom: 12px;
    }

    .provider-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .provider-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        background: var(--b3-theme-background);
        border-radius: 4px;
        border: 1px solid var(--b3-border-color);
    }

    .provider-name-input {
        flex: 1;
        font-weight: 500;
    }

    .empty-hint {
        padding: 20px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-size: 13px;
    }
</style>
