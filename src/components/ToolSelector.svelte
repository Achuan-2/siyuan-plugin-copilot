<script context="module" lang="ts">
    export interface ToolConfig {
        name: string;
        autoApprove: boolean;
    }
</script>

<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { AVAILABLE_TOOLS, TOOL_CATEGORIES, type Tool } from '../tools';
    import { i18n } from '../utils/i18n';

    export let selectedTools: ToolConfig[] = [];
    export let toolAutoApproveSettings: Record<string, boolean> = {}; // 所有工具的 autoApprove 配置
    export let categories: Record<string, { tools: string[] }> = TOOL_CATEGORIES; // 工具分类配置

    const dispatch = createEventDispatcher();

    // 使用本地状态管理选中工具，避免双向绑定的问题
    let localSelectedTools: ToolConfig[] = [...selectedTools];

    // 本地缓存的 autoApprove 配置（从外部 settings 初始化）
    let toolAutoApproveMap: Map<string, boolean> = new Map();

    // 当外部 selectedTools 改变时，同步到本地状态
    $: if (selectedTools) {
        localSelectedTools = [...selectedTools];
    }

    // 当外部 toolAutoApproveSettings 改变时，同步到本地 Map
    $: if (toolAutoApproveSettings) {
        toolAutoApproveMap = new Map(Object.entries(toolAutoApproveSettings));
    }

    function close() {
        dispatch('close');
    }
    // 按类别组织工具
    // 按类别组织工具并对思源 MCP 工具进行细分与排序
    $: categorizedTools = (() => {
        const result: Record<string, Tool[]> = {};
        for (const [category, config] of Object.entries(categories)) {
            const mappedTools = config.tools
                .map(toolName => AVAILABLE_TOOLS.find(tool => tool.function.name === toolName))
                .filter(tool => tool !== undefined) as Tool[];

            if (category === 'siyuan') {
                // 定义三个子分类的工具名称列表以及排序
                const noteToolOrder = [
                    'block', 'document', 'outline', 'search', 'sql', 'ref', 'history', 'notebook', 'bookmark', 'tag', 'dailynote', 'inbox', 'attr', 'database', 'template'
                ];
                const repoSyncFileToolOrder = [
                    'repo', 'sync', 'import', 'export', 'asset', 'unzip', 'file'
                ];
                const agentExternalToolOrder = [
                    'frontend', 'question', 'todo_write', 'skill', 'http_request', 'web_fetch', 'web_search', 'system', 'workspace'
                ];

                const noteTools: Tool[] = [];
                const repoSyncFileTools: Tool[] = [];
                const agentExternalTools: Tool[] = [];
                const remainingTools: Tool[] = [];

                for (const tool of mappedTools) {
                    const toolName = tool.function.name;
                    if (noteToolOrder.includes(toolName)) {
                        noteTools.push(tool);
                    } else if (repoSyncFileToolOrder.includes(toolName)) {
                        repoSyncFileTools.push(tool);
                    } else if (agentExternalToolOrder.includes(toolName)) {
                        agentExternalTools.push(tool);
                    } else {
                        remainingTools.push(tool);
                    }
                }

                // 排序辅助函数
                const sortByOrder = (toolsList: Tool[], order: string[]) => {
                    return toolsList.sort((a, b) => {
                        const idxA = order.indexOf(a.function.name);
                        const idxB = order.indexOf(b.function.name);
                        return idxA - idxB;
                    });
                };

                sortByOrder(noteTools, noteToolOrder);
                sortByOrder(repoSyncFileTools, repoSyncFileToolOrder);
                sortByOrder(agentExternalTools, agentExternalToolOrder);

                if (noteTools.length > 0) result['siyuan_note'] = noteTools;
                if (repoSyncFileTools.length > 0) result['siyuan_repo'] = repoSyncFileTools;
                if (agentExternalTools.length > 0) result['siyuan_agent'] = agentExternalTools;
                if (remainingTools.length > 0) result['siyuan'] = remainingTools;
            } else {
                result[category] = mappedTools;
            }
        }
        return result;
    })();

    // 切换工具选择
    function toggleTool(toolName: string) {
        const index = localSelectedTools.findIndex(t => t.name === toolName);
        if (index >= 0) {
            // 移除工具（保留 autoApprove 配置在 toolAutoApproveMap 中）
            localSelectedTools = localSelectedTools.filter(t => t.name !== toolName);
        } else {
            // 添加工具，使用持久化的 autoApprove 配置（默认 false）
            const savedAutoApprove = toolAutoApproveMap.get(toolName) ?? false;
            localSelectedTools = [
                ...localSelectedTools,
                { name: toolName, autoApprove: savedAutoApprove },
            ];
        }
        // 通知父组件更新
        selectedTools = [...localSelectedTools];
        dispatch('update', localSelectedTools);
    }

    // 切换工具的自动批准状态
    function toggleToolAutoApprove(toolName: string) {
        const index = localSelectedTools.findIndex(t => t.name === toolName);
        const currentValue = toolAutoApproveMap.get(toolName) ?? false;
        const newValue = !currentValue;

        // 更新本地 Map
        toolAutoApproveMap.set(toolName, newValue);

        // 将 Map 转换为对象，通知父组件更新
        const newSettings: Record<string, boolean> = {};
        toolAutoApproveMap.forEach((value, key) => {
            newSettings[key] = value;
        });
        toolAutoApproveSettings = newSettings;
        dispatch('autoApproveChange', { toolName, value: newValue, settings: newSettings });

        if (index >= 0) {
            // 工具已选中,更新其自动批准状态
            localSelectedTools = localSelectedTools.map((tool, i) =>
                i === index ? { ...tool, autoApprove: newValue } : tool
            );
            // 同步到导出 prop
            selectedTools = [...localSelectedTools];
            // 通知父组件更新
            dispatch('update', localSelectedTools);
        }
    }

    // 用户可选择的工具列表（基于当前分类配置，排除系统工具 get_siyuan_skills）
    $: userSelectableTools = Object.values(categorizedTools)
        .flat()
        .filter(tool => tool.function.name !== 'get_siyuan_skills');

    // 用户选中的工具数量（排除系统工具）
    $: userSelectedCount = localSelectedTools.filter(t => t.name !== 'get_siyuan_skills').length;

    // 全选/取消全选
    function toggleAll() {
        if (userSelectedCount === userSelectableTools.length) {
            // 取消全选（保留系统工具，如果存在）
            // 注意：不清除 toolAutoApproveMap，保留自动批准配置
            localSelectedTools = localSelectedTools.filter(t => t.name === 'get_siyuan_skills');
        } else {
            // 全选用户可选工具（保留系统工具，如果存在）
            const systemTool = localSelectedTools.find(t => t.name === 'get_siyuan_skills');
            // 使用持久化的 autoApprove 配置
            const newSelection = userSelectableTools.map(tool => ({
                name: tool.function.name,
                autoApprove: toolAutoApproveMap.get(tool.function.name) ?? false,
            }));
            localSelectedTools = systemTool ? [systemTool, ...newSelection] : newSelection;
        }
        // 同步到导出 prop 以支持 bind:selectedTools
        selectedTools = [...localSelectedTools];
        // 通知父组件更新
        dispatch('update', localSelectedTools);
    }

    // 检查工具是否被选中
    function isToolSelected(toolName: string): boolean {
        return localSelectedTools.some(t => t.name === toolName);
    }

    // 获取工具的自动批准状态
    function getToolAutoApprove(toolName: string): boolean {
        const tool = localSelectedTools.find(t => t.name === toolName);
        return tool?.autoApprove || false;
    }

    // 为了让模板能可靠地响应选中状态变化，维护两个响应式集合
    $: selectedSet = new Set(localSelectedTools.map(t => t.name));
    $: autoApproveMap = new Map(localSelectedTools.map(t => [t.name, t.autoApprove]));

    // 获取工具的友好名称
    function getToolDisplayName(toolName: string): string {
        const key = `tools.${toolName}.name`;
        const name = i18n(key);
        return name === key ? toolName : name;
    }

    // 获取工具的完整描述
    function getToolFullDescription(tool: Tool): string {
        const key = `tools.${tool.function.name}.description`;
        const localDesc = i18n(key);
        return localDesc !== key ? localDesc : tool.function.description;
    }

    // 获取工具的简短描述
    function getToolShortDescription(tool: Tool): string {
        const description = getToolFullDescription(tool);
        const firstLine = description.split('\n')[0];
        return firstLine || description.substring(0, 50) + '...';
    }

    // 展开/折叠详情
    let expandedTools: Set<string> = new Set();
    function toggleExpand(toolName: string) {
        if (expandedTools.has(toolName)) {
            expandedTools.delete(toolName);
        } else {
            expandedTools.add(toolName);
        }
        expandedTools = expandedTools;
    }

    // 检查某个类别的工具是否全部选中
    function isCategoryFullySelected(tools: Tool[]): boolean {
        if (tools.length === 0) return false;
        return tools.every(tool => selectedSet.has(tool.function.name));
    }

    // 检查某个类别的工具是否部分选中
    function isCategoryPartiallySelected(tools: Tool[]): boolean {
        if (tools.length === 0) return false;
        const selectedCount = tools.filter(tool => selectedSet.has(tool.function.name)).length;
        return selectedCount > 0 && selectedCount < tools.length;
    }

    // 切换类别的全选/取消全选
    function toggleCategory(tools: Tool[]) {
        const allSelected = isCategoryFullySelected(tools);

        if (allSelected) {
            // 取消全选该类别：从 localSelectedTools 中移除该类别的所有工具
            const toolNamesToRemove = new Set(tools.map(t => t.function.name));
            localSelectedTools = localSelectedTools.filter(t => !toolNamesToRemove.has(t.name));
        } else {
            // 全选该类别：添加该类别的所有未选中工具
            const toolNamesInCategory = new Set(tools.map(t => t.function.name));
            // 保留不在该类别的工具
            const toolsOutsideCategory = localSelectedTools.filter(
                t => !toolNamesInCategory.has(t.name)
            );
            // 添加该类别的所有工具
            const newCategorySelections = tools.map(tool => ({
                name: tool.function.name,
                autoApprove: toolAutoApproveMap.get(tool.function.name) ?? false,
            }));
            localSelectedTools = [...toolsOutsideCategory, ...newCategorySelections];
        }

        // 同步到导出 prop
        selectedTools = [...localSelectedTools];
        // 通知父组件更新
        dispatch('update', localSelectedTools);
    }

    // 展开/折叠类别
    let collapsedCategories: Set<string> = new Set();
    function toggleCategoryCollapse(category: string) {
        if (collapsedCategories.has(category)) {
            collapsedCategories.delete(category);
        } else {
            collapsedCategories.add(category);
        }
        collapsedCategories = collapsedCategories;
    }

    // 思源 MCP 工具父分类逻辑
    function isSiyuanCategory(category: string): boolean {
        return ['siyuan', 'siyuan_note', 'siyuan_repo', 'siyuan_agent'].includes(category);
    }

    $: hasSiyuanTools = Object.entries(categorizedTools).some(([cat, tList]) => tList.length > 0 && isSiyuanCategory(cat));

    $: allSiyuanMcpTools = Object.entries(categorizedTools)
        .filter(([cat, _]) => isSiyuanCategory(cat))
        .map(([_, tList]) => tList)
        .flat();

    function isMcpParentFullySelected(): boolean {
        if (allSiyuanMcpTools.length === 0) return false;
        return allSiyuanMcpTools.every(tool => selectedSet.has(tool.function.name));
    }

    function isMcpParentPartiallySelected(): boolean {
        if (allSiyuanMcpTools.length === 0) return false;
        const selectedCount = allSiyuanMcpTools.filter(tool => selectedSet.has(tool.function.name)).length;
        return selectedCount > 0 && selectedCount < allSiyuanMcpTools.length;
    }

    function toggleMcpParent() {
        const allSelected = isMcpParentFullySelected();
        const mcpToolNames = new Set(allSiyuanMcpTools.map(t => t.function.name));

        if (allSelected) {
            localSelectedTools = localSelectedTools.filter(t => !mcpToolNames.has(t.name));
        } else {
            const nonMcpTools = localSelectedTools.filter(t => !mcpToolNames.has(t.name));
            const newMcpSelections = allSiyuanMcpTools.map(tool => ({
                name: tool.function.name,
                autoApprove: toolAutoApproveMap.get(tool.function.name) ?? false,
            }));
            localSelectedTools = [...nonMcpTools, ...newMcpSelections];
        }

        selectedTools = [...localSelectedTools];
        dispatch('update', localSelectedTools);
    }

    let mcpParentCollapsed = false;
    function toggleMcpParentCollapse() {
        mcpParentCollapsed = !mcpParentCollapsed;
    }
</script>

<div class="tool-selector__overlay" on:click={close}></div>
<div class="tool-selector">
    <div class="tool-selector__header">
        <h3>{i18n('tools.selector.title')}</h3>
        <div class="tool-selector__actions">
            <button class="b3-button b3-button--text" on:click={toggleAll}>
                {userSelectedCount === userSelectableTools.length
                    ? i18n('tools.selector.deselectAll')
                    : i18n('tools.selector.selectAll')}
            </button>
            <button class="b3-button b3-button--cancel" on:click={close}>
                {i18n('common.close')}
            </button>
        </div>
    </div>

    <div class="tool-selector__content">
        <div class="tool-selector__info">
            <svg class="svg"><use xlink:href="#iconInfo"></use></svg>
            <span>{i18n('tools.selector.info')}</span>
        </div>

        {#if hasSiyuanTools}
            <div class="mcp-parent-category">
                <div class="mcp-parent-category__header">
                    <div
                        class="mcp-parent-category__title-container"
                        on:click={toggleMcpParentCollapse}
                        style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;"
                    >
                        <svg
                            class="svg mcp-parent-category__arrow"
                            class:mcp-parent-category__arrow--rotated={!mcpParentCollapsed}
                            style="width: 12px; height: 12px; transition: transform 0.2s; fill: var(--b3-theme-primary); flex-shrink: 0;"
                        >
                            <use xlink:href="#iconRight"></use>
                        </svg>
                        <h3 class="mcp-parent-category__title" style="margin: 0; font-size: 15px; font-weight: 600; color: var(--b3-theme-primary);">{i18n('tools.category.siyuan_mcp_parent')}</h3>
                    </div>
                    <button
                        class="b3-button b3-button--text mcp-parent-category__select-btn"
                        class:mcp-parent-category__select-btn--partial={isMcpParentPartiallySelected()}
                        on:click={toggleMcpParent}
                        style="font-size: 12px; padding: 2px 8px; min-width: unset; height: auto; line-height: 1.5;"
                    >
                        {isMcpParentFullySelected()
                            ? i18n('tools.selector.deselectAll')
                            : i18n('tools.selector.selectAll')}
                    </button>
                </div>

                {#if !mcpParentCollapsed}
                    <div class="mcp-parent-category__content">
                        {#each Object.entries(categorizedTools).filter(([cat, tList]) => tList.length > 0 && isSiyuanCategory(cat)) as [category, tools] (category)}
                            <div class="tool-category">
                                <div class="tool-category__header">
                                    <div
                                        class="tool-category__title-container"
                                        on:click={() => toggleCategoryCollapse(category)}
                                        style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;"
                                    >
                                        <svg
                                            class="svg tool-category__arrow"
                                            class:tool-category__arrow--rotated={!collapsedCategories.has(category)}
                                            style="width: 10px; height: 10px; transition: transform 0.2s; fill: var(--b3-theme-primary); flex-shrink: 0;"
                                        >
                                            <use xlink:href="#iconRight"></use>
                                        </svg>
                                        <h4 class="tool-category__title" style="margin: 0;">{i18n(`tools.category.${category}`)}</h4>
                                    </div>
                                    <button
                                        class="b3-button b3-button--text tool-category__select-btn"
                                        class:tool-category__select-btn--partial={isCategoryPartiallySelected(
                                            tools
                                        )}
                                        on:click={() => toggleCategory(tools)}
                                    >
                                        {isCategoryFullySelected(tools)
                                            ? i18n('tools.selector.deselectAll')
                                            : i18n('tools.selector.selectAll')}
                                    </button>
                                </div>
                                {#if !collapsedCategories.has(category)}
                                    <div class="tool-list">
                                        {#each tools as tool (tool.function.name)}
                                            {@const toolName = tool.function.name}
                                            {@const isExpanded = expandedTools.has(toolName)}

                                            <div
                                                class="tool-item"
                                                class:tool-item--selected={selectedSet.has(toolName)}
                                            >
                                                <div class="tool-item__header">
                                                    <label class="tool-item__checkbox">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedSet.has(toolName)}
                                                            on:change={() => toggleTool(toolName)}
                                                        />
                                                        <span class="tool-item__name">
                                                            {getToolDisplayName(toolName)}
                                                        </span>
                                                    </label>
                                                    <div class="tool-item__header-right">
                                                        <label
                                                            class="tool-item__auto-approve"
                                                            title={i18n('tools.autoApprove.tooltip')}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                class="b3-switch"
                                                                checked={toolAutoApproveMap.get(toolName) || false}
                                                                on:change={() => toggleToolAutoApprove(toolName)}
                                                            />
                                                            <span class="tool-item__auto-approve-text">
                                                                {i18n('tools.autoApprove.label')}
                                                            </span>
                                                        </label>
                                                        <button
                                                            class="tool-item__expand b3-button b3-button--text"
                                                            on:click={() => toggleExpand(toolName)}
                                                            title={isExpanded
                                                                ? i18n('common.collapse')
                                                                : i18n('common.expand')}
                                                        >
                                                            <svg
                                                                class="svg"
                                                                class:tool-item__expand--rotated={isExpanded}
                                                            >
                                                                <use xlink:href="#iconRight"></use>
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>

                                                <div class="tool-item__description">
                                                    {getToolShortDescription(tool)}
                                                </div>

                                                {#if isExpanded}
                                                    <div class="tool-item__details">
                                                        <pre class="tool-item__full-description">{getToolFullDescription(tool)}</pre>

                                                        <div class="tool-item__parameters">
                                                            <strong>{i18n('tools.selector.parameters')}:</strong>
                                                            <ul>
                                                                {#each Object.entries(tool.function.parameters.properties) as [paramName, param]}
                                                                    <li>
                                                                        <code>{paramName}</code>
                                                                        {#if tool.function.parameters.required.includes(paramName)}
                                                                            <span class="tool-item__required">
                                                                                ({i18n('common.required')})
                                                                            </span>
                                                                        {/if}
                                                                        : {param.description}
                                                                    </li>
                                                                {/each}
                                                            </ul>
                                                        </div>
                                                    </div>
                                                {/if}
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}

        {#each Object.entries(categorizedTools).filter(([cat, tList]) => tList.length > 0 && !isSiyuanCategory(cat)) as [category, tools] (category)}
            <div class="tool-category">
                <div class="tool-category__header">
                    <div
                        class="tool-category__title-container"
                        on:click={() => toggleCategoryCollapse(category)}
                        style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;"
                    >
                        <svg
                            class="svg tool-category__arrow"
                            class:tool-category__arrow--rotated={!collapsedCategories.has(category)}
                            style="width: 10px; height: 10px; transition: transform 0.2s; fill: var(--b3-theme-primary); flex-shrink: 0;"
                        >
                            <use xlink:href="#iconRight"></use>
                        </svg>
                        <h4 class="tool-category__title" style="margin: 0;">{i18n(`tools.category.${category}`)}</h4>
                    </div>
                    <button
                        class="b3-button b3-button--text tool-category__select-btn"
                        class:tool-category__select-btn--partial={isCategoryPartiallySelected(
                            tools
                        )}
                        on:click={() => toggleCategory(tools)}
                    >
                        {isCategoryFullySelected(tools)
                            ? i18n('tools.selector.deselectAll')
                            : i18n('tools.selector.selectAll')}
                    </button>
                </div>
                {#if !collapsedCategories.has(category)}
                    <div class="tool-list">
                        {#each tools as tool (tool.function.name)}
                            {@const toolName = tool.function.name}
                            {@const isExpanded = expandedTools.has(toolName)}

                            <div
                                class="tool-item"
                                class:tool-item--selected={selectedSet.has(toolName)}
                            >
                                <div class="tool-item__header">
                                    <label class="tool-item__checkbox">
                                        <input
                                            type="checkbox"
                                            checked={selectedSet.has(toolName)}
                                            on:change={() => toggleTool(toolName)}
                                        />
                                        <span class="tool-item__name">
                                            {getToolDisplayName(toolName)}
                                        </span>
                                    </label>
                                    <div class="tool-item__header-right">
                                        <label
                                            class="tool-item__auto-approve"
                                            title={i18n('tools.autoApprove.tooltip')}
                                        >
                                            <input
                                                type="checkbox"
                                                class="b3-switch"
                                                checked={toolAutoApproveMap.get(toolName) || false}
                                                on:change={() => toggleToolAutoApprove(toolName)}
                                            />
                                            <span class="tool-item__auto-approve-text">
                                                {i18n('tools.autoApprove.label')}
                                            </span>
                                        </label>
                                        <button
                                            class="tool-item__expand b3-button b3-button--text"
                                            on:click={() => toggleExpand(toolName)}
                                            title={isExpanded
                                                ? i18n('common.collapse')
                                                : i18n('common.expand')}
                                        >
                                            <svg
                                                class="svg"
                                                class:tool-item__expand--rotated={isExpanded}
                                            >
                                                <use xlink:href="#iconRight"></use>
                                            </svg>
                                        </button>
                                    </div>
                                </div>

                                <div class="tool-item__description">
                                    {getToolShortDescription(tool)}
                                </div>

                                {#if isExpanded}
                                    <div class="tool-item__details">
                                        <pre class="tool-item__full-description">{getToolFullDescription(tool)}</pre>

                                        <div class="tool-item__parameters">
                                            <strong>{i18n('tools.selector.parameters')}:</strong>
                                            <ul>
                                                {#each Object.entries(tool.function.parameters.properties) as [paramName, param]}
                                                    <li>
                                                        <code>{paramName}</code>
                                                        {#if tool.function.parameters.required.includes(paramName)}
                                                            <span class="tool-item__required">
                                                                ({i18n('common.required')})
                                                            </span>
                                                        {/if}
                                                        : {param.description}
                                                    </li>
                                                {/each}
                                            </ul>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}
    </div>

    <div class="tool-selector__footer">
        <div class="tool-selector__footer-left">
            <div class="tool-selector__footer-info">
                <svg class="svg"><use xlink:href="#iconInfo"></use></svg>
                <span>{i18n('tools.autoApprove.footerInfo')}</span>
            </div>
        </div>
        <span class="tool-selector__count">
            {i18n('tools.selector.selected')}: {userSelectedCount}/{userSelectableTools.length}
        </span>
    </div>
</div>

<style lang="scss">
    .tool-selector__overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999;
    }

    .tool-selector {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        width: 90%;
        max-width: 700px;
        max-height: 80vh;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1000;

        &__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px;
            border-bottom: 1px solid var(--b3-theme-surface-lighter);

            h3 {
                margin: 0;
                font-size: 16px;
                font-weight: 500;
            }
        }

        &__actions {
            display: flex;
            gap: 8px;
        }

        &__content {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }

        &__info {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px;
            margin-bottom: 16px;
            background: var(--b3-theme-primary-lightest);
            border-radius: 4px;
            font-size: 13px;
            color: var(--b3-theme-on-surface);

            .svg {
                width: 16px;
                height: 16px;
                flex-shrink: 0;
            }
        }

        &__footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-top: 1px solid var(--b3-theme-surface-lighter);
            font-size: 13px;
            color: var(--b3-theme-on-surface-light);
        }

        &__footer-left {
            display: flex;
            align-items: center;
        }

        &__footer-info {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--b3-theme-on-surface-light);

            .svg {
                width: 14px;
                height: 14px;
                flex-shrink: 0;
            }
        }

        &__count {
            font-weight: 500;
        }
    }

    .mcp-parent-category {
        margin-bottom: 24px;

        &__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--b3-theme-surface-lighter);
            padding-bottom: 10px;
        }

        &__arrow {
            transition: transform 0.2s;
            &--rotated {
                transform: rotate(90deg);
            }
        }

        &__content {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding-left: 8px;

            .tool-category {
                margin-bottom: 0;
            }
        }
    }

    .tool-category {
        margin-bottom: 24px;

        &:last-child {
            margin-bottom: 0;
        }

        &__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }

        &__arrow {
            transition: transform 0.2s;
            &--rotated {
                transform: rotate(90deg);
            }
        }

        &__title {
            margin: 0;
            font-size: 14px;
            font-weight: 500;
            color: var(--b3-theme-primary);
        }

        &__select-btn {
            font-size: 12px;
            padding: 2px 8px;
            min-width: unset;
            height: auto;
            line-height: 1.5;

            &--partial {
                color: var(--b3-theme-primary);
                font-weight: 500;
            }
        }
    }

    .tool-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .tool-item {
        padding: 12px;
        border: 1px solid var(--b3-theme-surface-lighter);
        border-radius: 4px;
        transition: all 0.2s;

        &:hover {
            border-color: var(--b3-theme-primary-light);
            background: var(--b3-theme-primary-lightest);
        }

        &--selected {
            border-color: var(--b3-theme-primary);
            background: var(--b3-theme-primary-lightest);
        }

        &__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }

        &__header-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        &__checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            user-select: none;

            input[type='checkbox'] {
                cursor: pointer;
            }
        }

        &__name {
            font-weight: 500;
            font-size: 14px;
        }

        &__auto-approve {
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            user-select: none;
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            padding: 2px 8px;
            border-radius: 3px;
            white-space: nowrap;

            &:hover {
                background: var(--b3-theme-primary-lighter);
            }
        }

        &__auto-approve-text {
            font-size: 11px;
        }

        &__expand {
            padding: 4px;
            min-width: unset;

            .svg {
                width: 14px;
                height: 14px;
                transition: transform 0.2s;
            }

            &--rotated {
                transform: rotate(90deg);
            }
        }

        &__description {
            font-size: 13px;
            color: var(--b3-theme-on-surface-light);
            margin-left: 28px;
        }

        &__details {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--b3-theme-surface-lighter);
        }

        &__full-description {
            font-size: 12px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
            background: var(--b3-theme-surface);
            padding: 8px;
            border-radius: 4px;
            margin: 0 0 12px 0;
        }

        &__parameters {
            font-size: 12px;

            strong {
                display: block;
                margin-bottom: 8px;
            }

            ul {
                margin: 0;
                padding-left: 20px;
                list-style: disc;
            }

            li {
                margin: 4px 0;
                line-height: 1.5;
            }

            code {
                background: var(--b3-theme-surface);
                padding: 2px 6px;
                border-radius: 3px;
                font-family: var(--b3-font-family-code);
            }
        }

        &__required {
            color: var(--b3-theme-error);
            font-size: 11px;
        }
    }
</style>
