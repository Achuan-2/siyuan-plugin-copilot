<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from 'svelte';
    import type { ProviderConfig, CustomProviderConfig } from '../defaultSettings';
    import type { ThinkingEffort } from '../ai-chat';
    import { isGemini3Model } from '../ai-chat';
    import { t } from '../utils/i18n';

    export let providers: Record<string, any>;
    export let selectedModels: Array<{
        provider: string;
        modelId: string;
        thinkingEnabled?: boolean;
        thinkingEffort?: ThinkingEffort;
    }> = [];
    export let isOpen = false;
    export let enableMultiModel = false; // 是否启用多模型模式
    export let currentProvider = ''; // 单选模式当前选中的提供商
    export let currentModelId = ''; // 单选模式当前选中的模型
    export let chatMode: 'ask' | 'edit' | 'agent' = 'ask'; // 聊天模式

    const dispatch = createEventDispatcher();

    interface ProviderInfo {
        id: string;
        name: string;
        config: ProviderConfig;
    }

    const builtInProviderNames: Record<string, string> = {
        Achuan: t('platform.builtIn.Achuan'),
        gemini: t('platform.builtIn.gemini'),
        deepseek: t('platform.builtIn.deepseek'),
        openai: t('platform.builtIn.openai'),
        volcano: t('platform.builtIn.volcano'),
        moonshot: t('platform.builtIn.moonshot'),
    };

    let expandedProviders: Set<string> = new Set();
    // 移除 selectedModelSet，因为现在允许重复选择同一个模型

    // 模型搜索筛选
    let modelSearchQuery = '';

    // 容器宽度监听（用于单选模式自适应显示）
    let containerWidth = 0;
    let containerElement: HTMLElement;
    let resizeObserver: ResizeObserver | null = null;

    // DOM references for positioning
    let buttonEl: HTMLElement | null = null;
    let dropdownEl: HTMLElement | null = null;
    let _resizeHandler: () => void;

    // 拖拽相关状态
    let draggedIndex: number | null = null;
    let dropIndicatorIndex: number | null = null;

    // 追踪上一次的打开状态
    let wasOpen = false;

    function getProviderList(): ProviderInfo[] {
        const list: ProviderInfo[] = [];

        // 添加内置平台
        Object.keys(builtInProviderNames).forEach(id => {
            const config = providers[id];
            if (config && config.models && config.models.length > 0) {
                list.push({
                    id,
                    name: builtInProviderNames[id],
                    config,
                });
            }
        });

        // 添加自定义平台
        if (providers.customProviders && Array.isArray(providers.customProviders)) {
            providers.customProviders.forEach((customProvider: CustomProviderConfig) => {
                if (customProvider.models && customProvider.models.length > 0) {
                    list.push({
                        id: customProvider.id,
                        name: customProvider.name,
                        config: customProvider,
                    });
                }
            });
        }

        // 根据 providerOrder 排序
        const savedOrder = providers?.providerOrder || [];
        if (savedOrder.length > 0) {
            const orderMap = new Map(savedOrder.map((id, index) => [id, index]));
            list.sort((a, b) => {
                const orderA = orderMap.get(a.id);
                const orderB = orderMap.get(b.id);
                if (orderA !== undefined && orderB !== undefined) {
                    return orderA - orderB;
                }
                if (orderA !== undefined) return -1;
                if (orderB !== undefined) return 1;
                return 0;
            });
        }

        return list;
    }

    // 响应式过滤后的提供商列表（支持空格分隔的 AND 搜索）
    $: filteredProviders = (() => {
        // 显式依赖 providers，确保其更新时重新计算
        const _deps = providers;
        const query = modelSearchQuery.trim().toLowerCase();
        if (!query) {
            return getProviderList();
        } else {
            // 支持空格分隔的 AND 搜索
            const searchTerms = query.split(/\s+/).filter(term => term.length > 0);
            return getProviderList()
                .map(provider => ({
                    ...provider,
                    config: {
                        ...provider.config,
                        models: provider.config.models.filter(model => {
                            const modelText =
                                `${model.name} ${model.id} ${provider.name}`.toLowerCase();
                            // 所有搜索词都必须匹配（AND逻辑）
                            return searchTerms.every(term => modelText.includes(term));
                        }),
                    },
                }))
                .filter(provider => provider.config.models.length > 0);
        }
    })();

    // 展开逻辑：明确追踪所有依赖
    $: if (isOpen) {
        // 下拉框打开时的展开逻辑
        const query = modelSearchQuery.trim();

        if (query) {
            // 有搜索内容时，展开所有匹配的提供商
            const newExpanded = new Set<string>();
            filteredProviders.forEach(provider => {
                newExpanded.add(provider.id);
            });
            expandedProviders = newExpanded;
        } else {
            // 没有搜索内容时，始终展开所有提供商
            expandedProviders = new Set(filteredProviders.map(p => p.id));
        }
    }

    function toggleProvider(providerId: string) {
        if (expandedProviders.has(providerId)) {
            expandedProviders.delete(providerId);
        } else {
            expandedProviders.add(providerId);
        }
        expandedProviders = expandedProviders;
    }

    function addModel(provider: string, modelId: string) {
        if (enableMultiModel) {
            // 多选模式：总是添加模型，允许重复选择
            // 从 provider 配置中读取默认的 thinkingEnabled 和 thinkingEffort 值
            const defaultThinkingEnabled = getProviderModelThinkingEnabled(provider, modelId);
            const defaultThinkingEffort = getProviderModelThinkingEffort(provider, modelId);
            selectedModels = [
                ...selectedModels,
                {
                    provider,
                    modelId,
                    thinkingEnabled: defaultThinkingEnabled,
                    thinkingEffort: defaultThinkingEffort,
                },
            ];
            dispatch('change', selectedModels);
        } else {
            // 单选模式：选择模型后关闭下拉框
            dispatch('select', { provider, modelId });
            isOpen = false;
        }
    }

    function toggleEnableMultiModel() {
        dispatch('toggleEnable', enableMultiModel);
    }

    // 获取提供商显示名称
    function getProviderDisplayName(providerId: string): string {
        if (builtInProviderNames[providerId]) {
            return builtInProviderNames[providerId];
        }

        // 查找自定义提供商
        if (providers.customProviders && Array.isArray(providers.customProviders)) {
            const customProvider = providers.customProviders.find((p: any) => p.id === providerId);
            if (customProvider) {
                return customProvider.name;
            }
        }

        return providerId;
    }

    // 获取模型名称
    function getModelName(provider: string, modelId: string): string {
        let providerConfig: any = null;

        // 查找内置平台
        if (providers[provider] && !Array.isArray(providers[provider])) {
            providerConfig = providers[provider];
        } else if (providers.customProviders && Array.isArray(providers.customProviders)) {
            // 查找自定义平台
            providerConfig = providers.customProviders.find((p: any) => p.id === provider);
        }

        if (providerConfig && providerConfig.models) {
            const model = providerConfig.models.find((m: any) => m.id === modelId);
            return model ? model.name : modelId;
        }

        return modelId;
    }

    // 拖拽开始
    function handleDragStart(event: DragEvent, index: number) {
        event.stopPropagation();
        draggedIndex = index;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/multi-model-sort', 'true');
        }
    }

    // 拖拽经过（用于显示指示器）
    function handleDragOver(event: DragEvent, index: number) {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }

        if (draggedIndex !== null && draggedIndex !== index) {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            const y = event.clientY - rect.top;
            const height = rect.height;

            // 如果鼠标在元素的上半部分，显示在上方
            if (y < height / 2) {
                dropIndicatorIndex = index;
            } else {
                // 如果鼠标在元素下半部分，显示在下方
                dropIndicatorIndex = index + 1;
            }
        }
    }

    // 拖拽进入（用于显示指示器）
    function handleDragEnter(event: DragEvent, index: number) {
        event.preventDefault();
        event.stopPropagation();
        if (draggedIndex !== null && draggedIndex !== index) {
            dropIndicatorIndex = index;
        }
    }

    // 拖拽离开（清除指示器）
    function handleDragLeave(event: DragEvent) {
        event.stopPropagation();
        // 只有当鼠标真正离开容器时才清除指示器
        const relatedTarget = event.relatedTarget as HTMLElement;
        const currentTarget = event.currentTarget as HTMLElement;

        if (!currentTarget.contains(relatedTarget)) {
            dropIndicatorIndex = null;
        }
    }

    // 拖拽放置
    function handleDrop(event: DragEvent, dropIndex: number) {
        event.preventDefault();
        event.stopPropagation();
        if (draggedIndex !== null) {
            let targetIndex = dropIndicatorIndex;

            // 如果dropIndicatorIndex为null，使用传入的dropIndex
            if (targetIndex === null) {
                targetIndex = dropIndex;
            }

            // 确保目标索引有效
            if (
                targetIndex !== null &&
                targetIndex !== draggedIndex &&
                targetIndex !== draggedIndex + 1
            ) {
                // 重新排列数组
                const newModels = [...selectedModels];
                const [draggedItem] = newModels.splice(draggedIndex, 1);

                // 调整目标索引（因为我们已经移除了一个元素）
                let adjustedTargetIndex = targetIndex;
                if (targetIndex > draggedIndex) {
                    adjustedTargetIndex -= 1;
                }

                newModels.splice(adjustedTargetIndex, 0, draggedItem);
                selectedModels = newModels;
                dispatch('change', selectedModels);
            }
        }
        draggedIndex = null;
        dropIndicatorIndex = null;
    }

    // 拖拽结束
    function handleDragEnd() {
        draggedIndex = null;
        dropIndicatorIndex = null;
    }

    // 上移模型
    function moveModelUp(index: number) {
        if (index > 0) {
            const newModels = [...selectedModels];
            [newModels[index - 1], newModels[index]] = [newModels[index], newModels[index - 1]];
            selectedModels = newModels;
            dispatch('change', selectedModels);
        }
    }

    // 下移模型
    function moveModelDown(index: number) {
        if (index < selectedModels.length - 1) {
            const newModels = [...selectedModels];
            [newModels[index], newModels[index + 1]] = [newModels[index + 1], newModels[index]];
            selectedModels = newModels;
            dispatch('change', selectedModels);
        }
    }

    // 移除模型
    function removeModel(index: number) {
        const newModels = selectedModels.filter((_, i) => i !== index);
        selectedModels = newModels;
        dispatch('change', selectedModels);
    }

    // 获取模型能力
    function getModelCapabilities(provider: string, modelId: string) {
        let providerConfig: any = null;

        // 查找内置平台
        if (providers[provider] && !Array.isArray(providers[provider])) {
            providerConfig = providers[provider];
        } else if (providers.customProviders && Array.isArray(providers.customProviders)) {
            // 查找自定义平台
            providerConfig = providers.customProviders.find((p: any) => p.id === provider);
        }

        if (providerConfig && providerConfig.models) {
            const model = providerConfig.models.find((m: any) => m.id === modelId);
            return model?.capabilities;
        }

        return null;
    }

    // 获取模型的 thinkingEnabled 状态（从 provider 配置中获取，用作默认值）
    function getProviderModelThinkingEnabled(provider: string, modelId: string): boolean {
        let providerConfig: any = null;

        // 查找内置平台
        if (providers[provider] && !Array.isArray(providers[provider])) {
            providerConfig = providers[provider];
        } else if (providers.customProviders && Array.isArray(providers.customProviders)) {
            // 查找自定义平台
            providerConfig = providers.customProviders.find((p: any) => p.id === provider);
        }

        if (providerConfig && providerConfig.models) {
            const model = providerConfig.models.find((m: any) => m.id === modelId);
            return model?.thinkingEnabled || false;
        }

        return false;
    }

    // 获取模型的 thinkingEffort 状态（从 provider 配置中获取，用作默认值）
    function getProviderModelThinkingEffort(provider: string, modelId: string): ThinkingEffort {
        let providerConfig: any = null;

        // 查找内置平台
        if (providers[provider] && !Array.isArray(providers[provider])) {
            providerConfig = providers[provider];
        } else if (providers.customProviders && Array.isArray(providers.customProviders)) {
            // 查找自定义平台
            providerConfig = providers.customProviders.find((p: any) => p.id === provider);
        }

        if (providerConfig && providerConfig.models) {
            const model = providerConfig.models.find((m: any) => m.id === modelId);
            return model?.thinkingEffort || 'low';
        }

        return 'low';
    }

    // 获取模型能力的 emoji 字符串
    function getModelCapabilitiesEmoji(provider: string, modelId: string): string {
        const capabilities = getModelCapabilities(provider, modelId);
        if (!capabilities) return '';

        const emojis: string[] = [];
        if (capabilities.thinking) emojis.push('💡');
        if (capabilities.vision) emojis.push('👀');
        if (capabilities.imageGeneration) emojis.push('🖼️');
        if (capabilities.toolCalling) emojis.push('🛠️');
        if (capabilities.webSearch) emojis.push('🌐');

        return emojis.length > 0 ? ' ' + emojis.join(' ') : '';
    }

    // 切换模型实例的思考模式（直接修改实例状态）
    function toggleModelInstanceThinking(index: number) {
        const newModels = [...selectedModels];
        newModels[index].thinkingEnabled = !newModels[index].thinkingEnabled;
        selectedModels = newModels;
        dispatch('change', selectedModels);
    }

    // 修改模型实例的思考程度
    function changeModelInstanceThinkingEffort(index: number, effort: ThinkingEffort) {
        const newModels = [...selectedModels];
        newModels[index].thinkingEffort = effort;
        selectedModels = newModels;
        dispatch('change', selectedModels);
    }

    // 处理思考程度选择器的变化事件
    function handleThinkingEffortChange(index: number, event: Event) {
        const target = event.currentTarget as HTMLSelectElement;
        const effort = target.value as ThinkingEffort;
        changeModelInstanceThinkingEffort(index, effort);
    }

    // 获取已选择模型的名称列表（响应式）
    $: selectedModelNames = (() => {
        if (selectedModels.length === 0) return '';
        return selectedModels.map(m => getModelName(m.provider, m.modelId)).join('，');
    })();

    // 获取某个模型在选择列表中的数量
    function getModelSelectionCount(provider: string, modelId: string): number {
        if (!enableMultiModel) return 0;
        return selectedModels.filter(m => m.provider === provider && m.modelId === modelId).length;
    }

    // 减少模型选择次数（移除一个实例）
    function decreaseModelSelection(provider: string, modelId: string, event: Event) {
        event.stopPropagation(); // 阻止事件冒泡，避免触发模型选择
        if (!enableMultiModel) return;

        // 找到第一个匹配的模型并移除
        const index = selectedModels.findIndex(
            m => m.provider === provider && m.modelId === modelId
        );
        if (index !== -1) {
            const newModels = [...selectedModels];
            newModels.splice(index, 1);
            selectedModels = newModels;
            dispatch('change', selectedModels);
        }
    }

    // 单选模式：获取当前选中的模型名称
    function getCurrentModelName(): string {
        if (!currentProvider || !currentModelId) {
            return t('models.selectPlaceholder');
        }
        return getModelName(currentProvider, currentModelId);
    }

    // 完整模型名称（响应式）— 直接引用 currentProvider/currentModelId 确保 Svelte 追踪依赖
    $: fullModelName = currentProvider && currentModelId
        ? getModelName(currentProvider, currentModelId)
        : t('models.selectPlaceholder');

    // 根据容器宽度自适应截断的模型名称（单选模式）
    $: displayModelName = (() => {
        if (!fullModelName || fullModelName === t('models.selectPlaceholder')) return fullModelName;
        if (containerWidth > 0 && containerWidth < 200 && fullModelName.length > 10) {
            return fullModelName.substring(0, 10) + '...';
        }
        return fullModelName;
    })();

    function closeOnOutsideClick(event: MouseEvent) {
        let target = event.target as HTMLElement;
        let found = false;
        while (target) {
            if (target.classList && target.classList.contains('multi-model-selector')) {
                found = true;
                break;
            }
            target = target.parentElement;
        }
        if (!found) {
            isOpen = false;
        }
    }

    // 监听打开状态，绑定点击关闭以及窗口尺寸变化以调整下拉位置/高度
    $: if (isOpen) {
        // 只在从关闭状态切换到打开状态时清空搜索关键词
        if (!wasOpen) {
            modelSearchQuery = '';
            wasOpen = true;
        }
        setTimeout(() => {
            document.addEventListener('click', closeOnOutsideClick);
            // initial position update
            updateDropdownPosition();
            // attach resize handler
            _resizeHandler = () => updateDropdownPosition();
            window.addEventListener('resize', _resizeHandler);
        }, 0);
    } else {
        wasOpen = false;
        document.removeEventListener('click', closeOnOutsideClick);
        if (_resizeHandler) window.removeEventListener('resize', _resizeHandler);
        // clear inline styles when closed
        if (dropdownEl) {
            dropdownEl.style.maxHeight = '';
            dropdownEl.style.top = '';
            dropdownEl.style.bottom = '';
            dropdownEl.style.left = '';
            dropdownEl.style.right = '';
        }
    }

    onDestroy(() => {
        document.removeEventListener('click', closeOnOutsideClick);
        if (_resizeHandler) window.removeEventListener('resize', _resizeHandler);
        if (resizeObserver) {
            resizeObserver.disconnect();
        }
    });

    // 监听容器宽度变化（单选模式使用）
    onMount(() => {
        if (containerElement) {
            resizeObserver = new ResizeObserver(entries => {
                for (const entry of entries) {
                    containerWidth = entry.contentRect.width;
                }
            });
            resizeObserver.observe(containerElement);
        }
    });

    // 根据触发按钮位置，调整下拉在窗口中的定位和最大高度，避免溢出
    function updateDropdownPosition() {
        if (!buttonEl || !dropdownEl) return;

        const rect = buttonEl.getBoundingClientRect();
        const margin = 8; // 与窗口边缘保留的最小距离

        const availableAbove = rect.top - margin;
        const availableBelow = window.innerHeight - rect.bottom - margin;

        // 将下拉设为 fixed，方便根据视口定位
        dropdownEl.style.position = 'fixed';

        // 水平对齐：智能定位，避免超出屏幕边界
        // 先获取弹窗实际宽度
        const dropdownWidth = dropdownEl.offsetWidth || 320;

        // 尝试右对齐（弹窗右边缘与按钮右边缘对齐）
        let left = rect.right - dropdownWidth;

        // 如果右对齐后超出左边界，则调整为左边界 + margin
        if (left < margin) {
            left = margin;
        }

        // 如果仍然超出右边界，则调整为右边界 - dropdownWidth - margin
        if (left + dropdownWidth > window.innerWidth - margin) {
            left = window.innerWidth - dropdownWidth - margin;
        }

        // 确保不超出左边界
        if (left < margin) {
            left = margin;
        }

        dropdownEl.style.left = `${left}px`;
        dropdownEl.style.right = 'auto';

        // 垂直方向：优先选择空间更大的一侧（下方或上方）
        if (availableBelow >= availableAbove) {
            // 在下方展开
            dropdownEl.style.top = `${rect.bottom + margin}px`;
            dropdownEl.style.bottom = 'auto';
            dropdownEl.style.maxHeight = `${Math.max(80, availableBelow)}px`;
        } else {
            // 在上方展开（靠近触发器上方）
            dropdownEl.style.bottom = `${window.innerHeight - rect.top + margin}px`;
            dropdownEl.style.top = 'auto';
            dropdownEl.style.maxHeight = `${Math.max(80, availableAbove)}px`;
        }
    }
</script>

<div class="multi-model-selector" bind:this={containerElement}>
    <button
        bind:this={buttonEl}
        class="multi-model-selector__button b3-button b3-button--text"
        class:multi-model-selector__button--active={enableMultiModel}
        on:click|stopPropagation={() => (isOpen = !isOpen)}
        title={enableMultiModel ? t('multiModel.title') : fullModelName}
    >
        <svg class="b3-button__icon">
            <use xlink:href="#iconLayout"></use>
        </svg>
        <span class="multi-model-selector__label">
            {#if enableMultiModel}
                {#if selectedModels.length > 0}
                    {t('multiModel.enabled')} ({selectedModels.length})
                {:else}
                    {t('multiModel.title')}
                {/if}
            {:else}
                {displayModelName}
            {/if}
        </span>
    </button>

    {#if isOpen}
        <div class="multi-model-selector__dropdown" bind:this={dropdownEl}>
            <div class="multi-model-selector__header">
                <div class="multi-model-selector__title">
                    {enableMultiModel
                        ? t('multiModel.selectModels')
                        : t('models.selectPlaceholder')}
                </div>
                <div
                    class="multi-model-selector__toggle"
                    on:click|stopPropagation
                    role="button"
                    tabindex="0"
                    on:keydown={e => e.key === 'Enter' && toggleEnableMultiModel()}
                >
                    <label>
                        <input
                            type="checkbox"
                            class="b3-switch"
                            bind:checked={enableMultiModel}
                            on:change={toggleEnableMultiModel}
                            disabled={chatMode === 'agent'}
                        />
                        <span class="multi-model-selector__toggle-label">
                            {t('multiModel.enable')}
                        </span>
                    </label>
                </div>
            </div>

            {#if enableMultiModel}
                <div class="multi-model-selector__count-header">
                    <div class="multi-model-selector__count">
                        {#if selectedModels.length > 0}
                            {t('multiModel.selected')}: {selectedModels.length} ({selectedModelNames})
                        {:else}
                            {t('multiModel.selected')}: {selectedModels.length}
                        {/if}
                    </div>
                </div>

                {#if selectedModels.length > 0}
                    <div class="multi-model-selector__selected-header">
                        <div class="multi-model-selector__selected-title">
                            {t('multiModel.selectedModels')}
                        </div>
                    </div>

                    <div class="multi-model-selector__selected-models">
                        {#each selectedModels as model, index}
                            <!-- Drop indicator before this item -->
                            {#if dropIndicatorIndex === index}
                                <div
                                    class="multi-model-selector__drop-indicator multi-model-selector__drop-indicator--active"
                                ></div>
                            {/if}

                            <div
                                class="multi-model-selector__selected-model"
                                draggable="true"
                                role="button"
                                tabindex="0"
                                on:dragstart={e => handleDragStart(e, index)}
                                on:dragover={e => handleDragOver(e, index)}
                                on:dragenter={e => handleDragEnter(e, index)}
                                on:dragleave={handleDragLeave}
                                on:drop={e => handleDrop(e, index)}
                                on:dragend={handleDragEnd}
                            >
                                <div class="multi-model-selector__selected-model-content">
                                    <div class="multi-model-selector__drag-handle">
                                        <svg class="multi-model-selector__drag-icon">
                                            <use xlink:href="#iconDrag"></use>
                                        </svg>
                                    </div>
                                    <div class="multi-model-selector__selected-model-info">
                                        <span class="multi-model-selector__selected-model-name">
                                            {getModelName(
                                                model.provider,
                                                model.modelId
                                            )}{getModelCapabilitiesEmoji(
                                                model.provider,
                                                model.modelId
                                            )}
                                        </span>
                                        <span class="multi-model-selector__selected-model-provider">
                                            {getProviderDisplayName(model.provider)}
                                        </span>
                                    </div>
                                    <div
                                        class="multi-model-selector__selected-model-thinking"
                                        role="group"
                                        on:mousedown|stopPropagation
                                        on:click|stopPropagation
                                        on:keydown={() => {}}
                                    >
                                        {#if getModelCapabilities(model.provider, model.modelId)?.thinking}
                                            <label
                                                class="multi-model-selector__thinking-toggle"
                                                title="思考模式"
                                            >
                                                <input
                                                    type="checkbox"
                                                    class="b3-switch"
                                                    checked={model.thinkingEnabled || false}
                                                    on:change={() =>
                                                        toggleModelInstanceThinking(index)}
                                                />
                                                <span class="multi-model-selector__thinking-label">
                                                    思考
                                                </span>
                                            </label>
                                            {#if model.thinkingEnabled}
                                                <select
                                                    class="b3-select multi-model-selector__thinking-effort"
                                                    value={model.thinkingEffort || 'low'}
                                                    on:change={e =>
                                                        handleThinkingEffortChange(index, e)}
                                                    on:click|stopPropagation
                                                    title="思考程度"
                                                >
                                                    <option value="low">低</option>
                                                    {#if !isGemini3Model(model.modelId)}
                                                        <option value="medium">中</option>
                                                    {/if}
                                                    <option value="high">高</option>
                                                    {#if !isGemini3Model(model.modelId)}
                                                        <option value="auto">自动</option>
                                                    {/if}
                                                </select>
                                            {/if}
                                        {/if}
                                    </div>
                                    <div class="multi-model-selector__selected-model-actions">
                                        <button
                                            class="multi-model-selector__move-btn"
                                            disabled={index === 0}
                                            on:click|stopPropagation={() => moveModelUp(index)}
                                            title={t('multiModel.moveUp')}
                                        >
                                            <svg class="multi-model-selector__move-icon">
                                                <use xlink:href="#iconUp"></use>
                                            </svg>
                                        </button>
                                        <button
                                            class="multi-model-selector__move-btn"
                                            disabled={index === selectedModels.length - 1}
                                            on:click|stopPropagation={() => moveModelDown(index)}
                                            title={t('multiModel.moveDown')}
                                        >
                                            <svg class="multi-model-selector__move-icon">
                                                <use xlink:href="#iconDown"></use>
                                            </svg>
                                        </button>
                                        <button
                                            class="multi-model-selector__remove-btn"
                                            on:click|stopPropagation={() => removeModel(index)}
                                            title={t('multiModel.remove')}
                                        >
                                            <svg class="multi-model-selector__remove-icon">
                                                <use xlink:href="#iconClose"></use>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        {/each}

                        <!-- Drop indicator after the last item -->
                        {#if dropIndicatorIndex === selectedModels.length}
                            <div
                                class="multi-model-selector__drop-indicator multi-model-selector__drop-indicator--active"
                            ></div>
                        {/if}
                    </div>
                {/if}
            {/if}

            <div class="multi-model-selector__tree">
                <!-- 模型搜索框 -->
                <div class="multi-model-selector__search">
                    <input
                        type="text"
                        class="b3-text-field"
                        placeholder={t('multiModel.searchModels') || '搜索模型'}
                        bind:value={modelSearchQuery}
                        spellcheck="false"
                    />
                </div>

                {#if modelSearchQuery.trim() && filteredProviders.length === 0}
                    <div class="multi-model-selector__no-results">
                        {t('multiModel.noResults') || '无匹配结果'}
                    </div>
                {/if}

                {#each filteredProviders as provider}
                    <div class="multi-model-selector__provider">
                        <div
                            class="multi-model-selector__provider-header"
                            role="button"
                            tabindex="0"
                            on:click={() => toggleProvider(provider.id)}
                            on:keydown={() => {}}
                        >
                            <svg
                                class="multi-model-selector__expand-icon"
                                class:multi-model-selector__expand-icon--expanded={expandedProviders.has(
                                    provider.id
                                )}
                            >
                                <use xlink:href="#iconRight"></use>
                            </svg>
                            <span>{provider.name}</span>
                            <span class="multi-model-selector__provider-count">
                                ({provider.config.models.length})
                            </span>
                        </div>
                        {#if expandedProviders.has(provider.id)}
                            <div class="multi-model-selector__models">
                                {#each provider.config.models as model}
                                    <div
                                        class="multi-model-selector__model"
                                        role="button"
                                        tabindex="0"
                                        class:multi-model-selector__model--active={!enableMultiModel &&
                                            currentProvider === provider.id &&
                                            currentModelId === model.id}
                                        on:click={() => addModel(provider.id, model.id)}
                                        on:keydown={() => {}}
                                    >
                                        {#if enableMultiModel}
                                            <div class="multi-model-selector__add-button">
                                                <svg class="multi-model-selector__add-icon">
                                                    <use xlink:href="#iconAdd"></use>
                                                </svg>
                                            </div>
                                        {/if}
                                        <div class="multi-model-selector__model-info">
                                            <div class="multi-model-selector__model-name-container">
                                                {#if enableMultiModel && getModelSelectionCount(provider.id, model.id) > 0}
                                                    <span
                                                        class="multi-model-selector__model-count-badge"
                                                        role="button"
                                                        tabindex="0"
                                                        title="点击减少选择次数"
                                                        on:click={e =>
                                                            decreaseModelSelection(
                                                                provider.id,
                                                                model.id,
                                                                e
                                                            )}
                                                        on:keydown={() => {}}
                                                    >
                                                        {getModelSelectionCount(
                                                            provider.id,
                                                            model.id
                                                        )}
                                                    </span>
                                                {/if}
                                                <span class="multi-model-selector__model-name">
                                                    {model.name}{getModelCapabilitiesEmoji(
                                                        provider.id,
                                                        model.id
                                                    )}
                                                </span>
                                            </div>
                                            <span class="multi-model-selector__model-params">
                                                T: {model.temperature} | Max: {model.maxTokens}
                                            </span>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/each}
                <!-- 移除空状态显示，当没有模型时不显示任何内容 -->
            </div>
        </div>
    {/if}
</div>

<style lang="scss">
    .multi-model-selector {
        position: relative;
    }

    .multi-model-selector__button {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        font-size: 12px;
        border-radius: 4px;
        transition: all 0.2s;

        &--active {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
        }
    }

    .multi-model-selector__label {
        white-space: nowrap;
    }

    .multi-model-selector__dropdown {
        /* 使用 fixed，并通过脚本在打开时设置具体 top/bottom/left/right 与 max-height，
           保证在视口内展开且可滚动 */
        position: fixed;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        box-shadow: var(--b3-dialog-shadow);
        min-width: 320px;
        max-width: calc(min(450px, 90vw));
        /* 无固定 max-height，交由脚本或内联样式控制，基础上限制为视口 */
        overflow: hidden;
        z-index: 1000;
        display: flex;
        flex-direction: column;
    }

    .multi-model-selector__header {
        padding: 12px 16px;
        border-bottom: 1px solid var(--b3-border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--b3-theme-surface);
    }

    .multi-model-selector__title {
        font-weight: 600;
        font-size: 14px;
        color: var(--b3-theme-on-background);
    }

    .multi-model-selector__toggle {
        font-size: 12px;

        label {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            user-select: none;
        }
    }

    .multi-model-selector__toggle-label {
        font-size: 12px;
        color: var(--b3-theme-on-surface);
    }

    .multi-model-selector__count-header {
        padding: 8px 16px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .multi-model-selector__count {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        font-weight: 500;
    }

    .multi-model-selector__selected-header {
        padding: 8px 16px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .multi-model-selector__selected-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
        margin-bottom: 2px;
    }

    .multi-model-selector__selected-models {
        max-height: 200px;
        overflow-y: auto;
    }

    .multi-model-selector__drop-indicator {
        height: 2px;
        background: var(--b3-theme-primary);
        border-radius: 1px;
        margin: 2px 8px;
        opacity: 0;
        transition: opacity 0.2s ease;

        &--active {
            opacity: 1;
        }
    }

    .multi-model-selector__selected-model {
        margin: 4px 8px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        cursor: move;
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-surface-light);
            border-color: var(--b3-theme-primary-light);
        }

        &:active {
            transform: scale(0.98);
        }
    }

    .multi-model-selector__selected-model-content {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        min-width: 0; /* 允许内容收缩 */
    }

    .multi-model-selector__drag-handle {
        flex-shrink: 0;
        cursor: grab;
        color: var(--b3-theme-on-surface-light);

        &:active {
            cursor: grabbing;
        }
    }

    .multi-model-selector__drag-icon {
        width: 14px;
        height: 14px;
    }

    .multi-model-selector__selected-model-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .multi-model-selector__selected-model-name {
        font-size: 13px;
        font-weight: 500;
        color: var(--b3-theme-on-background);
    }

    .multi-model-selector__selected-model-provider {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
    }

    .multi-model-selector__selected-model-actions {
        display: flex;
        gap: 2px;
        flex-shrink: 0;
    }

    .multi-model-selector__move-btn,
    .multi-model-selector__remove-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: none;
        background: transparent;
        border-radius: 4px;
        cursor: pointer;
        color: var(--b3-theme-on-surface-light);
        transition: all 0.2s;

        &:hover:not(:disabled) {
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-background);
        }

        &:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
    }

    .multi-model-selector__move-icon,
    .multi-model-selector__remove-icon {
        width: 12px;
        height: 12px;
    }

    .multi-model-selector__tree {
        padding: 8px;
        overflow-y: auto;
        max-height: 500px;
        flex: 1;
    }

    .multi-model-selector__search {
        padding: 8px 0 12px 0;
    }

    .multi-model-selector__search input {
        width: 100%;
        padding: 6px 8px;
        font-size: 12px;
    }

    .multi-model-selector__no-results {
        padding: 16px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-size: 12px;
    }

    .multi-model-selector__provider {
        margin-bottom: 4px;
    }

    .multi-model-selector__provider-header {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        cursor: pointer;
        border-radius: 4px;
        font-weight: 600;
        font-size: 13px;
        color: var(--b3-theme-on-background);

        &:hover {
            background: var(--b3-theme-surface);
        }
    }

    .multi-model-selector__expand-icon {
        width: 12px;
        height: 12px;
        transition: transform 0.2s;
        flex-shrink: 0;
    }

    .multi-model-selector__expand-icon--expanded {
        transform: rotate(90deg);
    }

    .multi-model-selector__provider-count {
        margin-left: auto;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        font-weight: normal;
    }

    .multi-model-selector__models {
        padding-left: 20px;
        margin-top: 2px;
    }

    .multi-model-selector__model {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
        border-radius: 4px;
        margin-bottom: 2px;
        border-left: 2px solid transparent;
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-surface);
        }

        &--active {
            background: var(--b3-theme-primary-lightest);
            border-left-color: var(--b3-theme-primary);

            .multi-model-selector__model-name {
                color: var(--b3-theme-primary);
                font-weight: 600;
            }
        }
    }

    .multi-model-selector__add-button {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--b3-theme-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-primary-light);
            transform: scale(1.1);
        }
    }

    .multi-model-selector__add-icon {
        width: 12px;
        height: 12px;
        fill: white;
    }

    .multi-model-selector__model-info {
        flex: 1;
        display: flex;
        flex-direction: column;
    }

    .multi-model-selector__model-name-container {
        display: flex;
        align-items: center;
        position: relative;
        padding-left: 12px; /* 为角标留出空间 */
    }

    .multi-model-selector__model-count-badge {
        position: absolute;
        left: -8px;
        top: -8px;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        background: var(--b3-theme-primary);
        color: white;
        font-size: 12px;
        font-weight: 600;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        z-index: 10;
        border: 2px solid var(--b3-theme-background);
        cursor: pointer;
        transition: all 0.2s;
        user-select: none;

        &:hover {
            background: var(--b3-theme-primary-light);
            transform: scale(1.1);
        }

        &:active {
            transform: scale(0.95);
        }
    }

    .multi-model-selector__model-name {
        font-size: 13px;
        color: var(--b3-theme-on-background);
        margin-bottom: 2px;
        font-weight: 500;
    }

    .multi-model-selector__model-params {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
    }

    .multi-model-selector__selected-model-thinking {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .multi-model-selector__thinking-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        user-select: none;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
    }

    .multi-model-selector__thinking-label {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
    }

    .multi-model-selector__thinking-effort {
        font-size: 11px;
        padding: 2px 4px;
        border-radius: 3px;
        cursor: pointer;
        min-width: 50px;
    }
</style>
