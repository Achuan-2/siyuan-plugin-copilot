<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type { Tool } from '../tools';
    import { getSubToolConfig, getSubToolNames, type ToolConfig } from '../tools/toolSelection';
    import { i18n } from '../utils/i18n';

    export let tool: Tool;
    export let config: ToolConfig | undefined;

    const dispatch = createEventDispatcher<{
        change: { action: string; field: 'enabled' | 'autoApprove' };
    }>();
    let expanded = false;
    $: actions = getSubToolNames(tool);
    $: enabledCount = actions.filter(action => config && getSubToolConfig(config, action).enabled).length;
</script>

{#if actions.length > 0}
    <div class="sub-tool-list">
        <button
            type="button"
            class="sub-tool-list__heading"
            aria-expanded={expanded}
            title={expanded ? i18n('commonCollapse') : i18n('commonExpand')}
            on:click={() => expanded = !expanded}
        >
            <svg class="svg sub-tool-list__arrow" class:sub-tool-list__arrow--expanded={expanded}>
                <use xlink:href="#iconRight"></use>
            </svg>
            <span>{i18n('toolsSubToolHeading')}</span>
            <span class="sub-tool-list__count">{enabledCount}/{actions.length}</span>
        </button>
        {#if expanded}
            {#each actions as action (action)}
                <div class="sub-tool-list__row">
                    <label class="sub-tool-list__name">
                        <input
                            type="checkbox"
                            checked={!!config && getSubToolConfig(config, action).enabled}
                            disabled={!config}
                            on:change={() => dispatch('change', { action, field: 'enabled' })}
                        />
                        <code>{action}</code>
                    </label>
                    <label class="sub-tool-list__auto" title={i18n('toolsAutoApproveTooltip')}>
                        <input
                            type="checkbox"
                            class="b3-switch"
                            checked={!!config && getSubToolConfig(config, action).autoApprove}
                            disabled={!config}
                            on:change={() => dispatch('change', { action, field: 'autoApprove' })}
                        />
                        {i18n('toolsAutoApproveLabel')}
                    </label>
                </div>
            {/each}
        {/if}
    </div>
{/if}

<style lang="scss">
    .sub-tool-list {
        margin: 10px 0 0 28px;
        padding: 8px 10px;
        border: 1px solid var(--b3-theme-surface-lighter);
        border-radius: 4px;
        font-size: 12px;

        &__heading {
            display: flex;
            align-items: center;
            gap: 6px;
            width: 100%;
            padding: 0;
            border: 0;
            background: none;
            color: var(--b3-theme-on-surface-light);
            text-align: left;
            cursor: pointer;
        }
        &__arrow {
            width: 10px;
            height: 10px;
            flex-shrink: 0;
            transition: transform 0.2s;
            &--expanded { transform: rotate(90deg); }
        }
        &__count { margin-left: auto; }
        &__heading + &__row { margin-top: 6px; }
        &__row, &__name, &__auto { display: flex; align-items: center; }
        &__row { justify-content: space-between; gap: 12px; padding: 3px 0; }
        &__name, &__auto { gap: 6px; cursor: pointer; }
        &__name code { overflow-wrap: anywhere; }
        &__auto { white-space: nowrap; }
    }
</style>
