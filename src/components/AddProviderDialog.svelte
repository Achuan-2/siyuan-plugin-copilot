<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { i18n } from '../utils/i18n';
    import type { ChatInterfaceType } from '../ai-chat';

    export let providers: Array<{ id: string; name: string; added: boolean }> = [];

    const dispatch = createEventDispatcher<{
        add: { providerId: string } | {
            name: string;
            apiUrl: string;
            chatInterface: ChatInterfaceType;
            apiKey: string;
        };
        cancel: void;
    }>();
    let tab: 'builtin' | 'custom' = 'builtin';
    let name = '';
    let apiUrl = '';
    let chatInterface: ChatInterfaceType = 'openai-completion';
    let apiKey = '';

    function focusInput(node: HTMLInputElement) {
        node.focus();
    }

    function addCustomProvider() {
        if (name.trim()) {
            dispatch('add', {
                name: name.trim(),
                apiUrl: apiUrl.trim(),
                chatInterface,
                apiKey: apiKey.trim(),
            });
        }
    }
</script>

<div class="add-provider-dialog">
    <div class="provider-tabs" role="tablist" aria-label={i18n('platformAddTitle')}>
        <button
            class="b3-button b3-button--text"
            class:active={tab === 'builtin'}
            role="tab"
            aria-selected={tab === 'builtin'}
            on:click={() => (tab = 'builtin')}
        >{i18n('platformTypeBuiltin')}</button>
        <button
            class="b3-button b3-button--text"
            class:active={tab === 'custom'}
            role="tab"
            aria-selected={tab === 'custom'}
            on:click={() => (tab = 'custom')}
        >{i18n('platformCustom')}</button>
    </div>

    {#if tab === 'builtin'}
        <div class="provider-grid">
            {#each providers as provider (provider.id)}
                <button
                    class="provider-option"
                    disabled={provider.added}
                    on:click={() => dispatch('add', { providerId: provider.id })}
                >
                    <span>{provider.name}</span>
                    {#if provider.added}
                        <span class="provider-added">{i18n('platformAlreadyAdded')}</span>
                    {:else}
                        <svg aria-hidden="true"><use xlink:href="#iconAdd"></use></svg>
                    {/if}
                </button>
            {/each}
        </div>
        <div class="provider-actions">
            <button class="b3-button b3-button--cancel" on:click={() => dispatch('cancel')}>
                {i18n('platformCancel')}
            </button>
        </div>
    {:else}
        <form on:submit|preventDefault={addCustomProvider}>
            <label>
                <span>{i18n('platformName')}</span>
                <input
                    class="b3-text-field"
                    bind:value={name}
                    placeholder={i18n('platformNamePlaceholder')}
                    required
                    use:focusInput
                />
            </label>
            <label>
                <span>{i18n('platformApiUrl')}</span>
                <input
                    class="b3-text-field"
                    bind:value={apiUrl}
                    placeholder={i18n('platformApiUrlPlaceholder')}
                />
            </label>
            <label>
                <span>{i18n('platformChatInterface')}</span>
                <select class="b3-select" bind:value={chatInterface}>
                    <option value="openai-completion">OpenAI Completion</option>
                    <option value="gemini">Gemini</option>
                    <option value="anthropic">Anthropic</option>
                </select>
            </label>
            <label>
                <span>{i18n('settingsAiApiKeyTitle')}</span>
                <input
                    class="b3-text-field"
                    type="password"
                    bind:value={apiKey}
                    placeholder={i18n('settingsAiApiKeyDescription')}
                    autocomplete="off"
                />
            </label>
            <div class="provider-actions">
                <button type="button" class="b3-button b3-button--cancel" on:click={() => dispatch('cancel')}>
                    {i18n('platformCancel')}
                </button>
                <button type="submit" class="b3-button" disabled={!name.trim()}>
                    {i18n('platformConfirmAdd')}
                </button>
            </div>
        </form>
    {/if}
</div>

<style lang="scss">
    .add-provider-dialog {
        padding: 16px 24px;
        max-height: 70vh;
        overflow-y: auto;
    }

    .provider-tabs {
        display: flex;
        gap: 8px;
        margin-bottom: 20px;

        .active {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
        }
    }

    .provider-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
    }

    .provider-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 48px;
        padding: 12px;
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        font: inherit;
        text-align: left;
        cursor: pointer;

        &:hover:not(:disabled) {
            border-color: var(--b3-theme-primary);
            background: var(--b3-theme-primary-lightest);
        }

        &:disabled {
            color: var(--b3-theme-on-surface-light);
            cursor: default;
        }

        svg {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
            fill: currentColor;
        }
    }

    .provider-added {
        font-size: 12px;
        white-space: nowrap;
    }

    form {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    label {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .provider-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 20px;
    }

    @media (max-width: 480px) {
        .add-provider-dialog {
            padding: 16px;
        }

        .provider-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
