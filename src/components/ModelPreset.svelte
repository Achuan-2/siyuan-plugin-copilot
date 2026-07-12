<script lang="ts">
    import { createEventDispatcher, tick, onMount } from 'svelte';
    import { i18n, i18nKey } from '../utils/i18n';
    import { exportMdContent, pushErrMsg, pushMsg, openBlock } from '@/api';
    import { confirm, Constants, getActiveEditor } from 'siyuan';
    import MultiModelSelector from './MultiModelSelector.svelte';
    import ToolSelector, { type ToolConfig } from './ToolSelector.svelte';
    import { TOOL_CATEGORIES, QA_TOOL_CATEGORIES } from '../tools';
    import type { ThinkingEffort } from '../thinking-effort';

    export let providers: Record<string, any> = {};
    export let currentProvider = '';
    export let currentModelId = '';
    type PresetChatMode = 'ask' | 'agent' | 'draw';
    interface PromptBlock {
        id: string;
        title: string;
        addedAt: number;
    }

    export let appliedSettings = {
        contextCount: -1,
        temperature: 1,
        temperatureEnabled: true,
        systemPrompt: '',
        modelSelectionEnabled: false,
        selectedModels: [] as Array<{
            provider: string;
            modelId: string;
            thinkingEnabled?: boolean;
            thinkingEffort?: ThinkingEffort;
        }>,
        enableMultiModel: false,
        chatMode: 'ask' as PresetChatMode,
        toolSelectionEnabled: false,
        selectedTools: [] as ToolConfig[],
        toolAutoApproveSettings: {} as Record<string, boolean>,
    };
    export let globalToolAutoApproveSettings: Record<string, boolean> = {};
    export let globalToolAutoApproveSettingsAsk: Record<string, boolean> = {};
    export let plugin: any;

    const dispatch = createEventDispatcher();

    function normalizeChatMode(chatMode?: string): PresetChatMode {
        if (chatMode === 'agent' || chatMode === 'draw') {
            return chatMode;
        }
        return 'ask';
    }

    // 预设列表弹窗
    let isPresetListOpen = false;
    let presetListTop = 0;
    let presetListLeft = 0;
    let buttonElement: HTMLButtonElement;
    let presetListElement: HTMLDivElement;

    // 设置面板弹窗
    let isSettingsOpen = false;
    let settingsTop = 0;
    let settingsLeft = 0;
    let settingsElement: HTMLDivElement;

    // 模型设置（临时值，用于编辑）
    let tempContextCount = -1;
    let tempTemperature = 1;
    let tempTemperatureEnabled = false;
    let tempSystemPrompt = '';
    let tempModelSelectionEnabled = false;
    let tempSelectedModels: Array<{
        provider: string;
        modelId: string;
        thinkingEnabled?: boolean;
        thinkingEffort?: ThinkingEffort;
    }> = [];
    let tempEnableMultiModel = false;
    let tempChatMode: PresetChatMode = 'ask';
    let tempToolSelectionEnabled = false;
    let tempSelectedTools: ToolConfig[] = [];
    let tempToolAutoApproveSettings: Record<string, boolean> = {};
    let isToolSelectorOpen = false;
    let providersForModelSelector: Record<string, any> = {};
    let tempPromptBlocks: PromptBlock[] = [];
    let tempPromptBlockContentMap: Record<string, string> = {};
    let isAddingPromptBlock = false;
    let isPromptBlockDragOver = false;

    // 当前正在编辑的预设ID（空字符串表示新建/默认）
    let editingPresetId = '';

    // 预设管理
    interface Preset {
        id: string;
        name: string;
        contextCount: number;
        temperature: number;
        temperatureEnabled: boolean;
        systemPrompt: string;
        modelSelectionEnabled: boolean;
        selectedModels: Array<{
            provider: string;
            modelId: string;
            thinkingEnabled?: boolean;
            thinkingEffort?: ThinkingEffort;
        }>;
        enableMultiModel: boolean;
        chatMode: PresetChatMode;
        promptBlocks?: PromptBlock[];
        toolSelectionEnabled?: boolean;
        selectedTools?: ToolConfig[];
        toolAutoApproveSettings?: Record<string, boolean>;
        createdAt: number;
    }

    let presets: Preset[] = [];
    let selectedPresetId: string = '';
    let newPresetName = '';

    // 拖拽排序相关（预设列表）
    let dragSrcIndex: number | null = null;
    let dragOverIndex: number | null = null;
    let dragDirection: 'above' | 'below' | null = null;

    // MultiModelSelector 打开状态
    let isModelSelectorOpen = false;

    // 预设搜索筛选
    let presetSearchQuery = '';

    $: providersForModelSelector =
        tempChatMode === 'draw' ? filterProvidersByImageGeneration(providers) : providers;

    function filterProvidersByImageGeneration(sourceProviders: Record<string, any>) {
        if (!sourceProviders || Object.keys(sourceProviders).length === 0) {
            return sourceProviders || {};
        }

        const filteredProviders: Record<string, any> = { ...sourceProviders };
        for (const [providerId, providerConfig] of Object.entries(sourceProviders)) {
            if (
                providerId === 'customProviders' ||
                providerId === 'providerOrder' ||
                providerId === 'disabledBuiltInProviders'
            ) {
                continue;
            }
            if (providerConfig && !Array.isArray(providerConfig) && providerConfig.models) {
                filteredProviders[providerId] = {
                    ...providerConfig,
                    models: providerConfig.models.filter(
                        (model: any) => !!model?.capabilities?.imageGeneration
                    ),
                };
            }
        }

        if (Array.isArray(sourceProviders.customProviders)) {
            filteredProviders.customProviders = sourceProviders.customProviders
                .map((provider: any) => ({
                    ...provider,
                    models: (provider.models || []).filter(
                        (model: any) => !!model?.capabilities?.imageGeneration
                    ),
                }))
                .filter((provider: any) => provider.models.length > 0);
        }

        return filteredProviders;
    }

    function normalizePromptBlocks(promptBlocks?: Array<PromptBlock | string>): PromptBlock[] {
        if (!Array.isArray(promptBlocks)) return [];

        const seen = new Set<string>();
        return promptBlocks
            .map((block: PromptBlock | string) => {
                if (typeof block === 'string') {
                    return { id: block, title: block, addedAt: Date.now() };
                }
                return {
                    id: block?.id,
                    title: block?.title || block?.id,
                    addedAt: block?.addedAt || Date.now(),
                };
            })
            .filter(block => {
                if (!block.id || seen.has(block.id)) return false;
                seen.add(block.id);
                return true;
            });
    }

    function parseBlockIdList(blockIdText: string): string[] {
        return Array.from(
            new Set(
                (blockIdText || '')
                    .split(',')
                    .map(id => id.trim())
                    .filter(id => id && id !== '/')
            )
        );
    }

    function getDroppedPromptBlockIds(event: DragEvent): string[] {
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer) return [];

        const types = Array.from(dataTransfer.types || []);
        const gutterType = types.find(type => type.startsWith(Constants.SIYUAN_DROP_GUTTER));
        if (gutterType) {
            const meta = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, '');
            const info = meta.split(Constants.ZWSP);
            return parseBlockIdList(info[2] || '');
        }

        if (types.some(type => type.startsWith(Constants.SIYUAN_DROP_FILE))) {
            const ele: HTMLElement | undefined = (window as any).siyuan?.dragElement;
            return parseBlockIdList(ele?.innerText || '');
        }

        return [];
    }

    function getFocusedBlockId(): string | null {
        const protyle = getActiveEditor(false)?.protyle;
        return protyle?.block?.id || protyle?.options?.blockId || protyle?.block?.parentID || null;
    }

    function buildPromptBlockTitle(content: string, blockId: string): string {
        const preview = content.replace(/\s+/g, ' ').trim();
        if (!preview) return blockId;
        return preview.length > 30 ? `${preview.substring(0, 30)}...` : preview;
    }

    async function loadPromptBlockContents(
        promptBlocks: PromptBlock[],
        showError = false
    ): Promise<Record<string, string>> {
        const contentMap: Record<string, string> = {};

        for (const block of promptBlocks) {
            try {
                const data = await exportMdContent(block.id, false, false, 2, 0, false);
                if (data?.content) {
                    contentMap[block.id] = data.content;
                } else if (showError) {
                    pushErrMsg(`获取 Prompt 块内容失败: ${block.title || block.id}`);
                }
            } catch (error) {
                console.error('Load prompt block content error:', error);
                if (showError) {
                    pushErrMsg(`获取 Prompt 块内容失败: ${block.title || block.id}`);
                }
            }
        }

        return contentMap;
    }

    function buildSystemPromptWithBlocks(
        systemPrompt: string,
        promptBlocks: PromptBlock[],
        contentMap: Record<string, string>
    ): string {
        const blockPrompt = promptBlocks
            .map(block => (contentMap[block.id] || '').trim())
            .filter(Boolean)
            .join('\n\n');

        return [systemPrompt.trim() ? systemPrompt : '', blockPrompt].filter(Boolean).join('\n\n');
    }

    async function resolveSystemPromptWithBlocks(
        systemPrompt: string,
        promptBlocks: PromptBlock[],
        showError = false
    ): Promise<string> {
        const contentMap = await loadPromptBlockContents(promptBlocks, showError);
        return buildSystemPromptWithBlocks(systemPrompt, promptBlocks, contentMap);
    }

    function getTempResolvedSystemPrompt(): string {
        return buildSystemPromptWithBlocks(
            tempSystemPrompt,
            tempPromptBlocks,
            tempPromptBlockContentMap
        );
    }

    async function refreshTempPromptBlockContents(promptBlocks = tempPromptBlocks) {
        tempPromptBlockContentMap = await loadPromptBlockContents(promptBlocks);
    }

    async function addPromptBlocksByIds(blockIds: string[]) {
        const idsToAdd = parseBlockIdList(blockIds.join(',')).filter(
            id => !tempPromptBlocks.some(block => block.id === id)
        );

        if (idsToAdd.length === 0) {
            pushMsg('Prompt 块已添加');
            return;
        }

        isAddingPromptBlock = true;
        const newPromptBlocks: PromptBlock[] = [];
        const nextContentMap = { ...tempPromptBlockContentMap };

        try {
            for (const blockId of idsToAdd) {
                try {
                    const data = await exportMdContent(blockId, false, false, 2, 0, false);
                    if (!data?.content) {
                        pushErrMsg(`获取 Prompt 块内容失败: ${blockId}`);
                        continue;
                    }

                    newPromptBlocks.push({
                        id: blockId,
                        title: buildPromptBlockTitle(data.content, blockId),
                        addedAt: Date.now(),
                    });
                    nextContentMap[blockId] = data.content;
                } catch (error) {
                    console.error('Add prompt block error:', error);
                    pushErrMsg(`获取 Prompt 块内容失败: ${blockId}`);
                }
            }

            if (newPromptBlocks.length === 0) return;

            tempPromptBlocks = [...tempPromptBlocks, ...newPromptBlocks];
            tempPromptBlockContentMap = nextContentMap;
            applySettings();

            pushMsg(
                newPromptBlocks.length === 1
                    ? '已添加 Prompt 块'
                    : `已添加 ${newPromptBlocks.length} 个 Prompt 块`
            );
        } finally {
            isAddingPromptBlock = false;
            isPromptBlockDragOver = false;
        }
    }

    async function addCurrentBlockAsPrompt() {
        const blockId = getFocusedBlockId();
        if (!blockId) {
            pushErrMsg('未找到当前块');
            return;
        }

        await addPromptBlocksByIds([blockId]);
    }

    function removePromptBlock(blockId: string) {
        tempPromptBlocks = tempPromptBlocks.filter(block => block.id !== blockId);
        const { [blockId]: _removed, ...rest } = tempPromptBlockContentMap;
        tempPromptBlockContentMap = rest;
        applySettings();
    }

    async function handleOpenBlock(blockId: string) {
        try {
            await openBlock(blockId);
        } catch (error) {
            console.error('Open block error:', error);
            pushErrMsg(`打开块失败: ${blockId}`);
        }
    }

    function arePromptBlocksEqual(blocks1: PromptBlock[], blocks2: PromptBlock[]): boolean {
        if (blocks1.length !== blocks2.length) return false;
        return blocks1.every((block, index) => block.id === blocks2[index]?.id);
    }

    function handlePromptBlockDragOver(event: DragEvent) {
        if (getDroppedPromptBlockIds(event).length > 0) {
            isPromptBlockDragOver = true;
        }
    }

    function handlePromptBlockDragLeave(event: DragEvent) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        if (
            event.clientX <= rect.left ||
            event.clientX >= rect.right ||
            event.clientY <= rect.top ||
            event.clientY >= rect.bottom
        ) {
            isPromptBlockDragOver = false;
        }
    }

    async function handlePromptBlockDrop(event: DragEvent) {
        const blockIds = getDroppedPromptBlockIds(event);
        isPromptBlockDragOver = false;
        if (blockIds.length === 0) return;

        await addPromptBlocksByIds(blockIds);
        if (
            Array.from(event.dataTransfer?.types || []).some(type =>
                type.startsWith(Constants.SIYUAN_DROP_FILE)
            )
        ) {
            (window as any).siyuan.dragElement = undefined;
        }
    }

    // 保存初始状态，用于检测是否有未保存的更改
    let initialState = {
        presetName: '',
        contextCount: -1,
        temperature: 1,
        temperatureEnabled: true,
        systemPrompt: '',
        modelSelectionEnabled: false,
        selectedModels: [] as Array<{
            provider: string;
            modelId: string;
            thinkingEnabled?: boolean;
            thinkingEffort?: ThinkingEffort;
        }>,
        enableMultiModel: false,
        chatMode: 'ask' as PresetChatMode,
        promptBlocks: [] as PromptBlock[],
        toolSelectionEnabled: false,
        selectedTools: [] as ToolConfig[],
        toolAutoApproveSettings: {} as Record<string, boolean>,
    };

    function t(key: string, fallback: string): string {
        const text = i18n(key);
        return text === key ? fallback : text;
    }

    // 处理MultiModelSelector的选择事件（单模型模式）
    function handleModelSelect(event: CustomEvent<{ provider: string; modelId: string }>) {
        const { provider, modelId } = event.detail;
        tempSelectedModels = [{ provider, modelId }];
        applySettings();
        isModelSelectorOpen = false;
    }

    // 处理MultiModelSelector的变化事件（多模型模式）
    function handleModelsChange(
        event: CustomEvent<
            Array<{
                provider: string;
                modelId: string;
                thinkingEnabled?: boolean;
                thinkingEffort?: ThinkingEffort;
            }>
        >
    ) {
        tempSelectedModels = event.detail;
        applySettings();
    }

    // 处理MultiModelSelector的多模型开关事件
    function handleToggleMultiModel(event: CustomEvent<boolean>) {
        tempEnableMultiModel = event.detail;
        if (!tempEnableMultiModel && tempSelectedModels.length > 1) {
            tempSelectedModels = [];
        }
        applySettings();
    }

    // 处理工具选择更新
    function handleToolsUpdate(event: CustomEvent<ToolConfig[]>) {
        tempSelectedTools = [...event.detail];
        applySettings();
    }

    // 处理工具自动批准设置变更
    function handleToolAutoApproveChange(
        event: CustomEvent<{ toolName: string; value: boolean; settings: Record<string, boolean> }>
    ) {
        tempToolAutoApproveSettings = { ...event.detail.settings };
        applySettings();
    }

    // 根据当前聊天模式选择工具分类
    $: toolCategoriesForSelector =
        tempChatMode === 'ask' ? QA_TOOL_CATEGORIES : TOOL_CATEGORIES;

    // 获取预设中用户选中的工具数量（排除系统隐藏工具）
    function getPresetToolCount(selectedTools?: ToolConfig[]): number {
        return (selectedTools || []).filter(t => t.name !== 'get_siyuan_skills').length;
    }

    // 响应式过滤后的预设列表（支持空格分隔的 AND 搜索）
    $: filteredPresets = ((): Preset[] => {
        const q = presetSearchQuery.trim().toLowerCase();
        if (!q) return presets;
        const terms = q.split(/\s+/).filter(Boolean);
        return presets.filter(preset => {
            const hay = (
                (preset.name || '') +
                ' ' +
                (preset.systemPrompt || '') +
                ' ' +
                (preset.promptBlocks || [])
                    .map(block => `${block.title || ''} ${block.id || ''}`)
                    .join(' ') +
                ' ' +
                (preset.chatMode || '') +
                ' ' +
                (preset.selectedModels || [])
                    .map(m => getModelDisplayName(m.provider, m.modelId))
                    .join(' ') +
                ' ' +
                (preset.selectedModels || []).map(m => m.provider).join(' ') +
                ' ' +
                (preset.selectedModels || []).map(m => m.modelId).join(' ')
            ).toLowerCase();
            return terms.every(term => hay.includes(term));
        });
    })();

    // 获取当前模型配置
    function getCurrentModelConfig() {
        if (!currentProvider || !currentModelId) return null;

        let providerConfig: any = null;
        if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
            providerConfig = providers[currentProvider];
        } else if (providers.customProviders && Array.isArray(providers.customProviders)) {
            providerConfig = providers.customProviders.find((p: any) => p.id === currentProvider);
        }

        if (!providerConfig) return null;
        return providerConfig.models.find((m: any) => m.id === currentModelId);
    }

    // 获取模型显示名称
    function getModelDisplayName(provider: string, modelId: string): string {
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

    // 格式化预设的模型列表显示
    function formatPresetModels(
        selectedModels: Array<{
            provider: string;
            modelId: string;
            thinkingEnabled?: boolean;
            thinkingEffort?: ThinkingEffort;
        }>
    ): string {
        const modelCounts: Record<string, number> = {};
        selectedModels.forEach(m => {
            const provider =
                providers[m.provider] || providers.customProviders?.find(p => p.id === m.provider);
            const model = provider?.models?.find(model => model.id === m.modelId);
            const modelName = model?.name || m.modelId;
            modelCounts[modelName] = (modelCounts[modelName] || 0) + 1;
        });

        // 格式化显示：模型名 × 次数
        return Object.entries(modelCounts)
            .map(([name, count]) => (count > 1 ? `${name} × ${count}` : name))
            .join(', ');
    }

    // 加载预设
    async function loadPresets() {
        const settings = await plugin.loadSettings();
        const storedPresets = settings.modelPresets || [];
        const normalizedPresets = storedPresets.map((preset: Preset) => ({
            ...preset,
            chatMode: normalizeChatMode(preset.chatMode),
            promptBlocks: normalizePromptBlocks(preset.promptBlocks),
        }));
        presets = normalizedPresets;
        selectedPresetId = settings.selectedModelPresetId || '';

        if (JSON.stringify(storedPresets) !== JSON.stringify(normalizedPresets)) {
            settings.modelPresets = normalizedPresets;
            await plugin.saveSettings(settings);
        }
    }

    // 保存预设到设置
    async function savePresetsToStorage() {
        const settings = await plugin.loadSettings();
        settings.modelPresets = presets;
        await plugin.saveSettings(settings);
    }

    // 保存选中的预设ID
    async function saveSelectedPresetId(presetId: string) {
        const settings = await plugin.loadSettings();
        settings.selectedModelPresetId = presetId;
        await plugin.saveSettings(settings);
    }

    // 加载选中的预设ID
    async function loadSelectedPresetId(): Promise<string> {
        const settings = await plugin.loadSettings();
        return settings.selectedModelPresetId || '';
    }

    // 保存当前设置为预设
    async function saveAsPreset() {
        if (!newPresetName.trim()) {
            pushMsg(i18n('aiSidebarModelSettingsEnterPresetName'));
            return;
        }

        const preset: Preset = {
            id: Date.now().toString(),
            name: newPresetName.trim(),
            contextCount: tempContextCount,
            temperature: tempTemperature,
            temperatureEnabled: tempTemperatureEnabled,
            systemPrompt: tempSystemPrompt,
            modelSelectionEnabled: tempModelSelectionEnabled,
            selectedModels: tempSelectedModels,
            enableMultiModel: tempEnableMultiModel,
            chatMode: tempChatMode,
            promptBlocks: tempPromptBlocks,
            toolSelectionEnabled: tempToolSelectionEnabled,
            selectedTools: tempSelectedTools,
            createdAt: Date.now(),
        };

        presets = [...presets, preset];
        await savePresetsToStorage();
        newPresetName = '';

        // 自动选择新建的预设
        selectedPresetId = preset.id;
        await saveSelectedPresetId(preset.id);

        pushMsg(i18n('aiSidebarModelSettingsPresetSaved'));

        // 关闭设置面板
        isSettingsOpen = false;
        openPresetList();
    }

    // 选择预设（直接应用，不打开设置面板）
    async function selectPreset(presetId: string) {
        // 如果点击的是已选择的预设，则取消选择
        if (selectedPresetId === presetId) {
            selectedPresetId = '';
            await saveSelectedPresetId('');
            // 重置为当前应用的设置
            await resetToAppliedSettings();
            return;
        }

        const preset = presets.find(p => p.id === presetId);
        if (preset) {
            selectedPresetId = presetId;
            await saveSelectedPresetId(presetId);
            const resolvedSystemPrompt = await resolveSystemPromptWithBlocks(
                preset.systemPrompt || '',
                normalizePromptBlocks(preset.promptBlocks),
                true
            );

            // 应用预设设置
            dispatch('apply', {
                contextCount: preset.contextCount,
                temperature: preset.temperature,
                temperatureEnabled: preset.temperatureEnabled ?? true,
                systemPrompt: resolvedSystemPrompt,
                modelSelectionEnabled: preset.modelSelectionEnabled ?? false,
                selectedModels: preset.selectedModels || [],
                enableMultiModel: preset.enableMultiModel ?? false,
                chatMode: normalizeChatMode(preset.chatMode),
                toolSelectionEnabled: preset.toolSelectionEnabled ?? false,
                selectedTools: preset.selectedTools || [],
            });

            pushMsg(`已应用预设: ${preset.name}`);
        }
    }

    // 编辑预设（打开设置面板）
    async function editPreset(presetId: string) {
        const preset = presets.find(p => p.id === presetId);
        if (!preset) return;

        editingPresetId = presetId;
        newPresetName = preset.name; // 加载预设名称
        tempContextCount = preset.contextCount;
        tempTemperature = preset.temperature;
        tempTemperatureEnabled = preset.temperatureEnabled ?? false;
        tempSystemPrompt = preset.systemPrompt;
        tempModelSelectionEnabled = preset.modelSelectionEnabled ?? false;
        tempSelectedModels = [...(preset.selectedModels || [])];
        tempEnableMultiModel = preset.enableMultiModel ?? false;
        tempChatMode = normalizeChatMode(preset.chatMode);
        tempPromptBlocks = normalizePromptBlocks(preset.promptBlocks);
        tempToolSelectionEnabled = preset.toolSelectionEnabled ?? false;
        tempSelectedTools = [...(preset.selectedTools || [])];
        tempToolAutoApproveSettings = {
            ...(tempChatMode === 'ask'
                ? globalToolAutoApproveSettingsAsk
                : globalToolAutoApproveSettings)
        };
        await refreshTempPromptBlockContents(tempPromptBlocks);

        // 保存初始状态
        saveInitialState();

        // 关闭预设列表，打开设置面板
        isPresetListOpen = false;
        openSettings();
    }

    // 删除预设
    function deletePreset(presetId: string) {
        // 临时移除外部点击监听器
        document.removeEventListener('click', closeOnOutsideClick);

        confirm(
            i18n('aiSidebarModelSettingsDeletePreset'),
            i18n('aiSidebarModelSettingsConfirmDelete'),
            async () => {
                presets = presets.filter(p => p.id !== presetId);
                await savePresetsToStorage();
                if (selectedPresetId === presetId) {
                    selectedPresetId = '';
                    await saveSelectedPresetId('');
                }
                pushMsg(i18n('aiSidebarModelSettingsPresetDeleted'));

                // 重新添加外部点击监听器
                setTimeout(() => {
                    if (isPresetListOpen) {
                        document.addEventListener('click', closeOnOutsideClick);
                    }
                }, 0);
            },
            () => {
                // 用户取消删除，重新添加外部点击监听器
                setTimeout(() => {
                    if (isPresetListOpen) {
                        document.addEventListener('click', closeOnOutsideClick);
                    }
                }, 0);
            }
        );
    }

    // 拖拽开始
    function handleDragStart(e: DragEvent, index: number) {
        dragSrcIndex = index;
        dragDirection = null;
        try {
            e.dataTransfer?.setData('text/plain', String(index));
            e.dataTransfer!.effectAllowed = 'move';
        } catch (err) {
            // ignore
        }
        const el = e.currentTarget as HTMLElement | null;
        if (el) el.classList.add('dragging');
    }

    function handleDragOver(e: DragEvent, index: number) {
        e.preventDefault();
        dragOverIndex = index;
        if (dragSrcIndex !== null) {
            if (index < dragSrcIndex) {
                dragDirection = 'above';
            } else if (index > dragSrcIndex) {
                dragDirection = 'below';
            } else {
                dragDirection = null;
            }
        }
    }

    async function handleDrop(e: DragEvent, index: number) {
        e.preventDefault();
        if (dragSrcIndex === null) return;
        const src = dragSrcIndex;
        let dest = index;
        if (src === dest) {
            cleanupDrag();
            return;
        }

        // 根据拖拽方向调整目标位置
        if (dragDirection === 'below') {
            dest = index + 1;
        }

        const item = presets[src];
        presets.splice(src, 1);
        const adjustedDest = src < dest ? dest - 1 : dest;
        presets.splice(adjustedDest, 0, item);
        presets = [...presets];
        await savePresetsToStorage();
        cleanupDrag();
    }

    function handleDragEnd() {
        cleanupDrag();
    }

    function cleanupDrag() {
        dragSrcIndex = null;
        dragOverIndex = null;
        dragDirection = null;
        const els = document.querySelectorAll('.model-settings-preset-list-item.dragging');
        els.forEach(el => el.classList.remove('dragging'));
    }

    // 实时应用设置
    function applySettings() {
        dispatch('apply', {
            contextCount: tempContextCount,
            temperature: tempTemperature,
            temperatureEnabled: tempTemperatureEnabled,
            systemPrompt: getTempResolvedSystemPrompt(),
            modelSelectionEnabled: tempModelSelectionEnabled,
            selectedModels: tempSelectedModels,
            enableMultiModel: tempEnableMultiModel,
            chatMode: tempChatMode,
            toolSelectionEnabled: tempToolSelectionEnabled,
            selectedTools: tempSelectedTools,
            toolAutoApproveSettings: tempToolAutoApproveSettings,
        });

        // 注意：编辑预设时不自动保存，只有点击保存按钮才保存
    }

    // 比较两个模型数组是否相等
    function areModelsEqual(
        models1: Array<{
            provider: string;
            modelId: string;
            thinkingEnabled?: boolean;
            thinkingEffort?: ThinkingEffort;
        }>,
        models2: Array<{
            provider: string;
            modelId: string;
            thinkingEnabled?: boolean;
            thinkingEffort?: ThinkingEffort;
        }>
    ): boolean {
        if (models1.length !== models2.length) return false;
        return models1.every((m1, index) => {
            const m2 = models2[index];
            return (
                m1.provider === m2.provider &&
                m1.modelId === m2.modelId &&
                m1.thinkingEnabled === m2.thinkingEnabled &&
                m1.thinkingEffort === m2.thinkingEffort
            );
        });
    }

    // 更新预设
    async function updatePreset(presetId: string) {
        const preset = presets.find(p => p.id === presetId);
        if (preset) {
            // 如果名称有变更且不为空，则更新名称
            if (newPresetName.trim() && newPresetName.trim() !== preset.name) {
                preset.name = newPresetName.trim();
            }
            preset.contextCount = tempContextCount;
            preset.temperature = tempTemperature;
            preset.temperatureEnabled = tempTemperatureEnabled;
            preset.systemPrompt = tempSystemPrompt;
            preset.modelSelectionEnabled = tempModelSelectionEnabled;
            preset.selectedModels = tempSelectedModels;
            preset.enableMultiModel = tempEnableMultiModel;
            preset.chatMode = tempChatMode;
            preset.promptBlocks = tempPromptBlocks;
            preset.toolSelectionEnabled = tempToolSelectionEnabled;
            preset.selectedTools = tempSelectedTools;
            delete preset.toolAutoApproveSettings;
            await savePresetsToStorage();
            // 触发响应式更新
            presets = [...presets];

            // 关闭设置面板
            isSettingsOpen = false;
            openPresetList();
        }
    }

    // 重置临时值为当前应用的设置
    async function resetToAppliedSettings() {
        tempContextCount = appliedSettings.contextCount;
        tempTemperature = appliedSettings.temperature;
        tempTemperatureEnabled = appliedSettings.temperatureEnabled ?? false;
        tempSystemPrompt = appliedSettings.systemPrompt;
        tempModelSelectionEnabled = appliedSettings.modelSelectionEnabled ?? false;
        tempSelectedModels = [...(appliedSettings.selectedModels || [])];
        tempEnableMultiModel = appliedSettings.enableMultiModel ?? false;
        tempChatMode = normalizeChatMode(appliedSettings.chatMode);
        tempPromptBlocks = [];
        tempPromptBlockContentMap = {};
        tempToolSelectionEnabled = appliedSettings.toolSelectionEnabled ?? false;
        tempSelectedTools = [...(appliedSettings.selectedTools || [])];
        tempToolAutoApproveSettings = {
            ...(tempChatMode === 'ask'
                ? globalToolAutoApproveSettingsAsk
                : globalToolAutoApproveSettings)
        };

        // 检查当前应用的设置是否与某个预设匹配
        const savedPresetId = await loadSelectedPresetId();
        if (savedPresetId) {
            const preset = presets.find(p => p.id === savedPresetId);
            const promptBlocks = normalizePromptBlocks(preset?.promptBlocks);
            const promptBlockContentMap = preset
                ? await loadPromptBlockContents(promptBlocks)
                : {};
            const resolvedPresetSystemPrompt = preset
                ? buildSystemPromptWithBlocks(
                      preset.systemPrompt || '',
                      promptBlocks,
                      promptBlockContentMap
                  )
                : '';
            if (
                preset &&
                preset.contextCount === appliedSettings.contextCount &&
                preset.temperature === appliedSettings.temperature &&
                (preset.temperatureEnabled ?? true) ===
                    (appliedSettings.temperatureEnabled ?? true) &&
                resolvedPresetSystemPrompt === appliedSettings.systemPrompt &&
                (preset.modelSelectionEnabled ?? false) ===
                    (appliedSettings.modelSelectionEnabled ?? false) &&
                areModelsEqual(preset.selectedModels || [], appliedSettings.selectedModels || []) &&
                (preset.enableMultiModel ?? false) ===
                    (appliedSettings.enableMultiModel ?? false) &&
                normalizeChatMode(preset.chatMode) === normalizeChatMode(appliedSettings.chatMode) &&
                (preset.toolSelectionEnabled ?? false) ===
                    (appliedSettings.toolSelectionEnabled ?? false) &&
                JSON.stringify(preset.selectedTools || []) ===
                    JSON.stringify(appliedSettings.selectedTools || [])
            ) {
                selectedPresetId = savedPresetId;
                tempSystemPrompt = preset.systemPrompt || '';
                tempPromptBlocks = promptBlocks;
                tempPromptBlockContentMap = promptBlockContentMap;
                tempToolSelectionEnabled = preset.toolSelectionEnabled ?? false;
                tempSelectedTools = [...(preset.selectedTools || [])];
                tempToolAutoApproveSettings = {
                    ...(tempChatMode === 'ask'
                        ? globalToolAutoApproveSettingsAsk
                        : globalToolAutoApproveSettings)
                };
            } else {
                selectedPresetId = '';
            }
        } else {
            selectedPresetId = '';
        }
    }

    // 重置为默认值
    async function resetToDefaults() {
        const modelConfig = getCurrentModelConfig();
        tempContextCount = -1;
        tempTemperature = modelConfig?.temperature ?? 1;
        tempTemperatureEnabled = false;
        tempSystemPrompt = '';
        tempModelSelectionEnabled = false;
        tempSelectedModels = [];
        tempEnableMultiModel = false;
        tempChatMode = 'ask';
        tempPromptBlocks = [];
        tempPromptBlockContentMap = {};
        tempToolSelectionEnabled = false;
        tempSelectedTools = [];
        tempToolAutoApproveSettings = { ...globalToolAutoApproveSettingsAsk };
        editingPresetId = '';
        selectedPresetId = '';
        newPresetName = ''; // 重置预设名称为空
        await saveSelectedPresetId('');
        // 保存初始状态
        saveInitialState();
    }

    // 打开预设列表
    async function openPresetList() {
        await loadPresets();
        await resetToAppliedSettings();
        isPresetListOpen = true;
        updatePresetListPosition();
        setTimeout(() => {
            document.addEventListener('click', closeOnOutsideClick);
        }, 0);
    }

    // 打开设置面板
    function openSettings() {
        isSettingsOpen = true;
        updateSettingsPosition();
    }

    // 保存初始状态
    function saveInitialState() {
        initialState = {
            presetName: newPresetName,
            contextCount: tempContextCount,
            temperature: tempTemperature,
            temperatureEnabled: tempTemperatureEnabled,
            systemPrompt: tempSystemPrompt,
            modelSelectionEnabled: tempModelSelectionEnabled,
            selectedModels: [...tempSelectedModels],
            enableMultiModel: tempEnableMultiModel,
            chatMode: tempChatMode,
            promptBlocks: [...tempPromptBlocks],
            toolSelectionEnabled: tempToolSelectionEnabled,
            selectedTools: [...tempSelectedTools],
            toolAutoApproveSettings: { ...tempToolAutoApproveSettings },
        };
    }

    // 检查是否有未保存的更改
    function hasUnsavedChanges(): boolean {
        if (newPresetName !== initialState.presetName) return true;
        if (tempContextCount !== initialState.contextCount) return true;
        if (tempTemperature !== initialState.temperature) return true;
        if (tempTemperatureEnabled !== initialState.temperatureEnabled) return true;
        if (tempSystemPrompt !== initialState.systemPrompt) return true;
        if (tempModelSelectionEnabled !== initialState.modelSelectionEnabled) return true;
        if (tempEnableMultiModel !== initialState.enableMultiModel) return true;
        if (tempChatMode !== initialState.chatMode) return true;
        if (!areModelsEqual(tempSelectedModels, initialState.selectedModels)) return true;
        if (!arePromptBlocksEqual(tempPromptBlocks, initialState.promptBlocks)) return true;
        if (tempToolSelectionEnabled !== initialState.toolSelectionEnabled) return true;
        if (
            JSON.stringify(tempSelectedTools) !== JSON.stringify(initialState.selectedTools)
        )
            return true;
        return false;
    }

    // 安全关闭设置面板（带未保存更改确认）
    async function safeCloseSettings() {
        if (!hasUnsavedChanges()) {
            isSettingsOpen = false;
            openPresetList();
            return;
        }

        // 临时移除外部点击监听器
        document.removeEventListener('click', closeOnOutsideClick);

        confirm(
            i18n('aiSidebarModelSettingsUnsavedChanges') || '未保存的更改',
            i18n('aiSidebarModelSettingsConfirmClose') || '您有未保存的更改，是否保存预设？',
            async () => {
                // 用户选择保存
                if (editingPresetId) {
                    await updatePreset(editingPresetId);
                } else {
                    await saveAsPreset();
                }
                // 重新添加外部点击监听器
                setTimeout(() => {
                    if (isPresetListOpen) {
                        document.addEventListener('click', closeOnOutsideClick);
                    }
                }, 0);
            },
            () => {
                // 用户选择不保存，直接关闭
                isSettingsOpen = false;
                openPresetList();
                // 重新添加外部点击监听器
                setTimeout(() => {
                    if (isPresetListOpen) {
                        document.addEventListener('click', closeOnOutsideClick);
                    }
                }, 0);
            }
        );
    }

    // 关闭所有弹窗
    function closeAll() {
        isPresetListOpen = false;
        isSettingsOpen = false;
        document.removeEventListener('click', closeOnOutsideClick);
    }

    // 计算预设列表位置
    async function updatePresetListPosition() {
        if (!buttonElement || !isPresetListOpen) return;

        await tick();

        const rect = buttonElement.getBoundingClientRect();
        const dropdownWidth = presetListElement?.offsetWidth || 320;
        const dropdownHeight = presetListElement?.offsetHeight || 400;

        // 计算垂直位置
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        if (spaceAbove >= dropdownHeight || spaceAbove >= spaceBelow) {
            presetListTop = rect.top - dropdownHeight - 4;
        } else {
            presetListTop = rect.bottom + 4;
        }

        // 计算水平位置
        // 如果按钮右侧空间不足以放下弹窗，则右对齐；否则左对齐
        if (rect.left + dropdownWidth > window.innerWidth - 8) {
            // 右对齐：弹窗右边缘与按钮右边缘对齐
            presetListLeft = rect.right - dropdownWidth;
        } else {
            // 左对齐：弹窗左边缘与按钮左边缘对齐
            presetListLeft = rect.left;
        }

        // 确保不超出视口右边界
        if (presetListLeft + dropdownWidth > window.innerWidth - 8) {
            presetListLeft = window.innerWidth - dropdownWidth - 8;
        }

        // 确保不超出视口左边界
        if (presetListLeft < 8) {
            presetListLeft = 8;
        }
    }

    // 计算设置面板位置
    async function updateSettingsPosition() {
        if (!buttonElement || !isSettingsOpen) return;

        await tick();

        const rect = buttonElement.getBoundingClientRect();
        const dropdownWidth = settingsElement?.offsetWidth || 360;
        const dropdownHeight = settingsElement?.offsetHeight || 500;

        // 计算垂直位置
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        if (spaceAbove >= dropdownHeight || spaceAbove >= spaceBelow) {
            settingsTop = rect.top - dropdownHeight - 4;
        } else {
            settingsTop = rect.bottom + 4;
        }

        // 计算水平位置
        // 如果按钮右侧空间不足以放下弹窗，则右对齐；否则左对齐
        if (rect.left + dropdownWidth > window.innerWidth - 8) {
            // 右对齐：弹窗右边缘与按钮右边缘对齐
            settingsLeft = rect.right - dropdownWidth;
        } else {
            // 左对齐：弹窗左边缘与按钮左边缘对齐
            settingsLeft = rect.left;
        }

        // 确保不超出视口右边界
        if (settingsLeft + dropdownWidth > window.innerWidth - 8) {
            settingsLeft = window.innerWidth - dropdownWidth - 8;
        }

        // 确保不超出视口左边界
        if (settingsLeft < 8) {
            settingsLeft = 8;
        }
    }

    // 关闭下拉菜单
    async function closeOnOutsideClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest('.model-settings-button')) {
            // 如果设置面板打开，检查未保存的更改
            if (isSettingsOpen && hasUnsavedChanges()) {
                event.preventDefault();
                event.stopPropagation();
                await safeCloseSettings();
                return;
            }
            isPresetListOpen = false;
            isSettingsOpen = false;
            document.removeEventListener('click', closeOnOutsideClick);
        }
    }

    // 处理设置面板内的点击，关闭模型选择器（如果点击的不是选择器区域）
    function handleSettingsPanelClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        // 如果点击的不是 MultiModelSelector 区域，则关闭选择器
        if (isModelSelectorOpen && !target.closest('.multi-model-selector')) {
            isModelSelectorOpen = false;
        }
    }

    // 打开/关闭弹窗
    function toggleDropdown() {
        if (!isPresetListOpen && !isSettingsOpen) {
            openPresetList();
        } else {
            closeAll();
        }
    }

    $: if (isPresetListOpen) {
        updatePresetListPosition();
    }

    $: if (isSettingsOpen) {
        updateSettingsPosition();
    }

    // 组件挂载时，自动加载上次选择的预设
    onMount(() => {
        (async () => {
            await loadPresets();
            const savedPresetId = await loadSelectedPresetId();
            if (savedPresetId) {
                const preset = presets.find(p => p.id === savedPresetId);
                if (preset) {
                    // 自动应用保存的预设
                    dispatch('apply', {
                        contextCount: preset.contextCount,
                        temperature: preset.temperature,
                        temperatureEnabled: preset.temperatureEnabled ?? true,
                        systemPrompt: await resolveSystemPromptWithBlocks(
                            preset.systemPrompt || '',
                            normalizePromptBlocks(preset.promptBlocks),
                            true
                        ),
                        modelSelectionEnabled: preset.modelSelectionEnabled ?? false,
                        selectedModels: [...(preset.selectedModels || [])],
                        enableMultiModel: preset.enableMultiModel ?? false,
                        chatMode: preset.chatMode || 'ask',
                        toolSelectionEnabled: preset.toolSelectionEnabled ?? false,
                        selectedTools: [...(preset.selectedTools || [])],
                    });
                    selectedPresetId = savedPresetId;
                } else {
                    // 预设已被删除，清除保存的ID
                    await saveSelectedPresetId('');
                }
            }
        })();
    });

    // 计算当前按钮上要显示的预设名称
    $: currentPresetName = (() => {
        if (selectedPresetId) {
            const preset = presets.find(p => p.id === selectedPresetId);
            if (preset) return preset.name;
        }
        return '';
    })();
</script>

<div class="model-settings-button">
    <button
        bind:this={buttonElement}
        class="b3-button b3-button--text model-settings-button__trigger"
        on:click|stopPropagation={toggleDropdown}
        title={currentPresetName || i18n('aiSidebarModelSettingsTitle')}
    >
        <svg class="b3-button__icon"><use xlink:href="#iconModelSetting"></use></svg>
        {#if currentPresetName}
            <span class="model-settings-button__label">
                {currentPresetName}
            </span>
        {/if}
    </button>

    <!-- 预设列表弹窗 -->
    {#if isPresetListOpen}
        <div
            bind:this={presetListElement}
            class="model-settings-preset-list-popup"
            style="top: {presetListTop}px; left: {presetListLeft}px;"
            on:click|stopPropagation
        >
            <div class="model-settings-preset-list-header">
                <h4>{i18n('aiSidebarModelSettingsTitle')}</h4>
                <div class="model-settings-preset-list-actions">
                    <button
                        class="b3-button b3-button--text"
                        on:click={() => (isPresetListOpen = false)}
                        title={i18n('commonClose')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
            </div>

            <div class="model-settings-preset-list-content">
                <!-- 新建预设按钮 -->
                <div class="model-settings-preset-list-new">
                    <button
                        class="b3-button b3-button--primary"
                        on:click={async () => {
                            editingPresetId = '';
                            await resetToDefaults();
                            isPresetListOpen = false;
                            openSettings();
                        }}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                        {i18n('aiSidebarModelSettingsCreateNewPreset') || '新建预设'}
                    </button>
                </div>

                <!-- 预设搜索框 -->
                {#if presets.length > 0}
                    <div class="model-settings-preset-search">
                        <input
                            type="text"
                            class="b3-text-field"
                            placeholder={i18n('aiSidebarModelSettingsSearchPresets') ||
                                '搜索预设'}
                            bind:value={presetSearchQuery}
                        />
                    </div>
                {/if}

                <!-- 预设列表 -->
                {#if presets.length > 0}
                    {#if filteredPresets.length > 0}
                        <div class="model-settings-preset-list-items">
                            {#each filteredPresets as preset, index}
                                <div
                                    class="model-settings-preset-list-item"
                                    class:selected={selectedPresetId === preset.id}
                                    draggable="true"
                                    on:dragstart|stopPropagation={e => handleDragStart(e, index)}
                                    on:dragover|preventDefault|stopPropagation={e =>
                                        handleDragOver(e, index)}
                                    on:drop|stopPropagation={e => handleDrop(e, index)}
                                    on:dragend={handleDragEnd}
                                    class:drag-over={dragOverIndex === index}
                                    class:drag-over-above={dragOverIndex === index &&
                                        dragDirection === 'above'}
                                    class:drag-over-below={dragOverIndex === index &&
                                        dragDirection === 'below'}
                                >
                                    <div
                                        class="model-settings-preset-list-item-info"
                                        on:click={() => selectPreset(preset.id)}
                                        role="button"
                                        tabindex="0"
                                        on:keydown={e =>
                                            e.key === 'Enter' && selectPreset(preset.id)}
                                    >
                                        {#if selectedPresetId === preset.id}
                                            <svg class="model-settings-preset-selected-icon">
                                                <use xlink:href="#iconCheck"></use>
                                            </svg>
                                        {:else}
                                            <div class="model-settings-preset-empty-icon"></div>
                                        {/if}
                                        <div class="model-settings-preset-list-item-content">
                                            <span class="preset-name">{preset.name}</span>
                                            <div class="model-settings-preset-details">
                                                {i18n('aiSidebarModelSettingsContextCount')}: {preset.contextCount ===
                                                -1
                                                    ? i18n('aiSidebarModelSettingsUnlimited') ||
                                                      '不限制'
                                                    : preset.contextCount}
                                                {#if preset.temperatureEnabled ?? true}
                                                    | {i18n('aiSidebarModelSettingsTemperature')}: {preset.temperature.toFixed(
                                                        2
                                                    )}
                                                {/if}
                                                {#if preset.chatMode}
                                                    | {i18n('aiSidebarModelSettingsChatMode')}: {i18n(
                                                        i18nKey('aiSidebar', 'mode', preset.chatMode)
                                                    ) || preset.chatMode}
                                                {/if}
                                                {#if preset.promptBlocks && preset.promptBlocks.length > 0}
                                                    | Prompt 块: {preset.promptBlocks.length}
                                                {/if}
                                                {#if preset.toolSelectionEnabled && preset.chatMode !== 'draw' && getPresetToolCount(preset.selectedTools) > 0}
                                                    | {i18n('aiSidebarAgentTools') || '工具'}: {getPresetToolCount(
                                                        preset.selectedTools
                                                    )}
                                                {/if}
                                                {#if preset.modelSelectionEnabled && preset.selectedModels && preset.selectedModels.length > 0}
                                                    <br />
                                                    <span class="model-settings-preset-models">
                                                        {#if preset.enableMultiModel}
                                                            {i18n('aiSidebarModelSettingsMultiModel'
                                                            ) || '多模型'}:
                                                        {:else}
                                                            {i18n('aiSidebarModelSettingsModel'
                                                            ) || '模型'}:
                                                        {/if}
                                                        {formatPresetModels(preset.selectedModels)}
                                                    </span>
                                                {/if}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="model-settings-preset-list-item-actions">
                                        <button
                                            class="b3-button b3-button--text"
                                            on:click|stopPropagation={() => editPreset(preset.id)}
                                            title={i18n('aiSidebarModelSettingsEditPreset') ||
                                                '编辑预设'}
                                        >
                                            <svg class="b3-button__icon">
                                                <use xlink:href="#iconEdit"></use>
                                            </svg>
                                        </button>
                                        <button
                                            class="b3-button b3-button--text"
                                            on:click|stopPropagation={() => deletePreset(preset.id)}
                                            title={i18n('aiSidebarModelSettingsDeletePreset')}
                                        >
                                            <svg class="b3-button__icon">
                                                <use xlink:href="#iconTrashcan"></use>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {:else if presetSearchQuery.trim()}
                        <div class="model-settings-preset-list-empty">
                            {i18n('aiSidebarModelSettingsNoResults') || '无匹配结果'}
                        </div>
                    {:else}
                        <div class="model-settings-preset-list-empty">
                            {i18n('aiSidebarModelSettingsNoPresets')}
                        </div>
                    {/if}
                {:else}
                    <div class="model-settings-preset-list-empty">
                        {i18n('aiSidebarModelSettingsNoPresets')}
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    <!-- 设置面板弹窗 -->
    {#if isSettingsOpen}
        <div
            bind:this={settingsElement}
            class="model-settings-dropdown"
            style="top: {settingsTop}px; left: {settingsLeft}px;"
            on:click|stopPropagation={handleSettingsPanelClick}
        >
            <div class="model-settings-header">
                <div class="model-settings-header-left">
                    {#if editingPresetId}
                        <button
                            class="b3-button b3-button--primary"
                            on:click={() => updatePreset(editingPresetId)}
                        >
                            {i18n('aiSidebarModelSettingsSavePreset') || '保存预设'}
                        </button>
                    {:else}
                        <button class="b3-button b3-button--primary" on:click={saveAsPreset}>
                            {i18n('aiSidebarModelSettingsSavePreset') || '保存预设'}
                        </button>
                    {/if}
                </div>
                <h4>
                    {editingPresetId
                        ? i18n('aiSidebarModelSettingsEditPreset') || '编辑预设'
                        : i18n('aiSidebarModelSettingsCreateNewPreset') || '新建预设'}
                </h4>
                <div class="model-settings-header-actions">
                    <button
                        class="b3-button b3-button--text"
                        on:click={safeCloseSettings}
                        title={i18n('commonBack') || '返回'}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconBack"></use></svg>
                    </button>
                    <button
                        class="b3-button b3-button--text"
                        on:click={safeCloseSettings}
                        title={i18n('commonClose')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
            </div>

            <div class="model-settings-content">
                <!-- 预设名称 -->
                <div class="model-settings-item">
                    <label class="model-settings-label">
                        {i18n('aiSidebarModelSettingsPresetName')}
                    </label>
                    <div class="model-settings-preset-new">
                        <input
                            type="text"
                            bind:value={newPresetName}
                            on:input={applySettings}
                            class="b3-text-field"
                            placeholder={i18n('aiSidebarModelSettingsEnterPresetName')}
                        />
                    </div>
                </div>

                <!-- 上下文数设置 -->
                <div class="model-settings-item">
                    <label class="model-settings-label">
                        {i18n('aiSidebarModelSettingsContextCount')}
                        <span class="model-settings-value">
                            {tempContextCount === -1
                                ? i18n('aiSidebarModelSettingsUnlimited') || '不限制'
                                : tempContextCount}
                        </span>
                    </label>
                    <input
                        type="range"
                        min="-1"
                        max="50"
                        step="1"
                        bind:value={tempContextCount}
                        on:change={applySettings}
                        class="b3-slider"
                    />
                    <div class="model-settings-hint">
                        {i18n('aiSidebarModelSettingsContextCountHint')}
                        {tempContextCount === -1
                            ? i18n('aiSidebarModelSettingsUnlimitedHint') ||
                              '（-1 代表不限制上下文消息数）'
                            : ''}
                    </div>
                </div>

                <!-- Temperature设置 -->
                <div class="model-settings-item">
                    <label class="model-settings-label">
                        {i18n('aiSidebarModelSettingsTemperature')}
                        <span class="model-settings-value">{tempTemperature.toFixed(2)}</span>
                    </label>
                    <div class="model-settings-checkbox">
                        <input
                            type="checkbox"
                            id="temperature-enabled"
                            bind:checked={tempTemperatureEnabled}
                            on:change={applySettings}
                            class="b3-switch"
                        />
                        <label for="temperature-enabled">
                            {i18n('aiSidebarModelSettingsEnableTemperature') ||
                                '启用Temperature调整'}
                        </label>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        bind:value={tempTemperature}
                        on:change={applySettings}
                        class="b3-slider"
                        disabled={!tempTemperatureEnabled}
                    />
                    <div class="model-settings-hint">
                        {i18n('aiSidebarModelSettingsTemperatureHint')}
                    </div>
                </div>

                <!-- 系统提示词设置 -->
                <div class="model-settings-item">
                    <label class="model-settings-label">
                        {i18n('aiSidebarModelSettingsSystemPrompt')}
                    </label>
                    <div class="model-settings-prompt-actions">
                        <button
                            class="b3-button b3-button--text"
                            on:click|preventDefault={addCurrentBlockAsPrompt}
                            disabled={isAddingPromptBlock}
                            title="添加当前块为 Prompt"
                        >
                            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            {isAddingPromptBlock ? '添加中...' : '添加当前块'}
                        </button>
                    </div>
                    <textarea
                        bind:value={tempSystemPrompt}
                        on:change={applySettings}
                        class="b3-text-field model-settings-textarea"
                        placeholder={i18n('aiSidebarModelSettingsSystemPromptPlaceholder')}
                        rows="4"
                    ></textarea>
                    <div
                        class="model-settings-prompt-block-drop"
                        class:drag-over={isPromptBlockDragOver}
                        on:dragover|preventDefault|stopPropagation={handlePromptBlockDragOver}
                        on:dragleave|preventDefault|stopPropagation={handlePromptBlockDragLeave}
                        on:drop|preventDefault|stopPropagation={handlePromptBlockDrop}
                    >
                        <svg class="model-settings-prompt-block-drop-icon">
                            <use xlink:href="#iconAdd"></use>
                        </svg>
                        <span>{t('aiSidebar.modelSettings.promptBlockDrop', '拖拽块到这里作为 Prompt')}</span>
                    </div>
                    {#if tempPromptBlocks.length > 0}
                        <div class="model-settings-prompt-blocks">
                            {#each tempPromptBlocks as block, index (block.id)}
                                <div class="model-settings-prompt-block">
                                    <div
                                        class="model-settings-prompt-block-info"
                                        on:click={() => handleOpenBlock(block.id)}
                                        title="点击打开块"
                                    >
                                        <span class="model-settings-prompt-block-title">
                                            {index + 1}. {block.title || block.id}
                                        </span>
                                        <span class="model-settings-prompt-block-id">
                                            {block.id}
                                        </span>
                                    </div>
                                    <button
                                        class="b3-button b3-button--text"
                                        on:click={() => removePromptBlock(block.id)}
                                        title="移除 Prompt 块"
                                    >
                                        <svg class="b3-button__icon">
                                            <use xlink:href="#iconTrashcan"></use>
                                        </svg>
                                    </button>
                                </div>
                            {/each}
                        </div>
                    {/if}
                    <div class="model-settings-hint">
                        {i18n('aiSidebarModelSettingsSystemPromptHint')}
                    </div>
                </div>

                <!-- 聊天模式设置 -->
                <div class="model-settings-item">
                    <label class="model-settings-label">
                        {i18n('aiSidebarModelSettingsChatMode') || '聊天模式'}
                    </label>
                    <select
                        bind:value={tempChatMode}
                        class="b3-select"
                        on:change={() => {
                            if (tempChatMode !== 'ask' && tempEnableMultiModel) {
                                tempEnableMultiModel = false;
                            }
                            tempToolAutoApproveSettings = {
                                ...(tempChatMode === 'ask'
                                    ? globalToolAutoApproveSettingsAsk
                                    : globalToolAutoApproveSettings)
                            };
                            applySettings();
                        }}
                    >
                        <option value="ask">{i18n('aiSidebarModeAsk') || '问答模式'}</option>
                        <option value="agent">{i18n('aiSidebarModeAgent') || 'Agent模式'}</option>
                        <option value="draw">{i18n('aiSidebarModeDraw') || '画图模式'}</option>
                    </select>
                    <div class="model-settings-hint">
                        {i18n('aiSidebarModelSettingsChatModeHint') ||
                            '选择聊天模式，只有问答模式支持多模型'}
                    </div>
                </div>

                <!-- 模型选择设置 -->
                <div class="model-settings-item">
                    <div class="model-settings-checkbox">
                        <input
                            type="checkbox"
                            id="model-selection-enabled"
                            bind:checked={tempModelSelectionEnabled}
                            on:change={applySettings}
                            class="b3-switch"
                        />
                        <label for="model-selection-enabled">
                            {i18n('aiSidebarModelSettingsEnableModelSelection') || '启用模型选择'}
                        </label>
                    </div>

                    {#if tempModelSelectionEnabled}
                        <div class="model-settings-model-selector">
                            <!-- 使用 MultiModelSelector 组件 -->
                            <MultiModelSelector
                                providers={providersForModelSelector}
                                selectedModels={tempSelectedModels}
                                bind:isOpen={isModelSelectorOpen}
                                enableMultiModel={tempEnableMultiModel}
                                currentProvider={tempSelectedModels.length > 0
                                    ? tempSelectedModels[0].provider
                                    : currentProvider}
                                currentModelId={tempSelectedModels.length > 0
                                    ? tempSelectedModels[0].modelId
                                    : currentModelId}
                                chatMode={tempChatMode}
                                on:select={handleModelSelect}
                                on:change={handleModelsChange}
                                on:toggleEnable={handleToggleMultiModel}
                            />
                        </div>
                    {/if}

                    <div class="model-settings-hint">
                        {i18n('aiSidebarModelSettingsModelSelectionHint') ||
                            '启用后，应用预设时会自动切换到选择的模型'}
                    </div>
                </div>

                <!-- 工具选择设置 -->
                {#if tempChatMode !== 'draw'}
                <div class="model-settings-item">
                    <div class="model-settings-checkbox">
                        <input
                            type="checkbox"
                            id="tool-selection-enabled"
                            bind:checked={tempToolSelectionEnabled}
                            on:change={applySettings}
                            class="b3-switch"
                        />
                        <label for="tool-selection-enabled">
                            {i18n('aiSidebarModelSettingsEnableToolSelection') || '启用工具选择'}
                        </label>
                    </div>

                    {#if tempToolSelectionEnabled}
                        <div class="model-settings-tool-selector">
                            <button
                                class="b3-button b3-button--text model-settings-tool-selector__trigger"
                                on:click={() => (isToolSelectorOpen = true)}
                            >
                                <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                                <span>
                                    {i18n('aiSidebarAgentSelectTools') || '选择工具'}
                                    ({getPresetToolCount(tempSelectedTools)})
                                </span>
                            </button>
                        </div>
                    {/if}

                    <div class="model-settings-hint">
                        {i18n('aiSidebarModelSettingsToolSelectionHint') ||
                            '启用后，应用预设时会自动切换到选择的工具'}
                    </div>
                </div>

                {#if isToolSelectorOpen}
                    <ToolSelector
                        selectedTools={tempSelectedTools}
                        toolAutoApproveSettings={tempToolAutoApproveSettings}
                        categories={toolCategoriesForSelector}
                        on:update={handleToolsUpdate}
                        on:autoApproveChange={handleToolAutoApproveChange}
                        on:close={() => (isToolSelectorOpen = false)}
                    />
                {/if}
                {/if}
            </div>

            <div class="model-settings-footer">
                <button class="b3-button b3-button--text" on:click={resetToDefaults}>
                    {i18n('aiSidebarModelSettingsReset')}
                </button>
            </div>
        </div>
    {/if}
</div>

<style lang="scss">
    .model-settings-button {
        position: relative;
    }

    .model-settings-button__trigger {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 200px;
        padding-inline: 6px 8px;
    }

    .model-settings-button__label {
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
    }

    // 预设列表弹窗
    .model-settings-preset-list-popup {
        position: fixed;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        box-shadow: var(--b3-dialog-shadow);
        width: 360px;
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        z-index: 1000;
    }

    .model-settings-preset-list-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--b3-border-color);

        h4 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        }
    }

    .model-settings-preset-list-actions {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .model-settings-preset-list-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .model-settings-preset-list-new {
        display: flex;
        justify-content: center;

        button {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
        }
    }

    .model-settings-preset-list-items {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .model-settings-preset-list-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        cursor: grab;
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-background);
            border-color: var(--b3-theme-primary-light);
        }

        &:active {
            cursor: grabbing;
        }

        &.selected {
            background: var(--b3-theme-primary-lightest);
            border-color: var(--b3-theme-primary);

            .preset-name {
                color: var(--b3-theme-primary);
                font-weight: 600;
            }
        }

        &.dragging {
            opacity: 0.5;
        }

        &.drag-over {
            border: 1px dashed var(--b3-theme-primary);
            background: var(--b3-theme-surface);
        }

        &.drag-over-above {
            border-top: 2px solid var(--b3-theme-primary);
        }

        &.drag-over-below {
            border-bottom: 2px solid var(--b3-theme-primary);
        }
    }

    .model-settings-preset-list-item-info {
        flex: 1;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        cursor: pointer;
        min-width: 0;
    }

    .model-settings-preset-empty-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        margin-top: 2px;
    }

    .model-settings-preset-list-item-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
    }

    .preset-name {
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .model-settings-preset-details {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.5;
    }

    .model-settings-preset-models {
        color: var(--b3-theme-on-surface);
        font-weight: 500;
    }

    .model-settings-preset-list-item-actions {
        display: flex;
        gap: 2px;
        flex-shrink: 0;
    }

    .model-settings-preset-list-empty {
        padding: 24px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-size: 13px;
    }

    // 设置面板
    .model-settings-dropdown {
        position: fixed;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        box-shadow: var(--b3-dialog-shadow);
        width: 360px;
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        z-index: 10;
    }

    .model-settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--b3-border-color);

        h4 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        }
    }

    .model-settings-header-left {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .model-settings-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .model-settings-content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .model-settings-item {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .model-settings-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
    }

    .model-settings-value {
        font-size: 12px;
        color: var(--b3-theme-primary);
        font-weight: 600;
    }

    .model-settings-hint {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        margin-top: -4px;
    }

    .model-settings-checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;

        label {
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            cursor: pointer;

            &.disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        }
    }

    .model-settings-textarea {
        resize: vertical;
        min-height: 60px;
        font-family: var(--b3-font-family);
        font-size: 12px;
    }

    .model-settings-prompt-actions {
        display: flex;
        justify-content: flex-start;
    }

    .model-settings-prompt-block-drop {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 34px;
        padding: 6px 8px;
        border: 1px dashed var(--b3-border-color);
        border-radius: 6px;
        color: var(--b3-theme-on-surface-light);
        font-size: 12px;
        transition:
            border-color 0.2s,
            background 0.2s;

        &.drag-over {
            border-color: var(--b3-theme-primary);
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
        }
    }

    .model-settings-prompt-block-drop-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
    }

    .model-settings-prompt-blocks {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .model-settings-prompt-block {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        background: var(--b3-theme-surface);
    }

    .model-settings-prompt-block-info {
        min-width: 0;
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        cursor: pointer;

        &:hover {
            .model-settings-prompt-block-title {
                text-decoration: underline;
                color: var(--b3-theme-primary);
            }
        }
    }

    .model-settings-prompt-block-title,
    .model-settings-prompt-block-id {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .model-settings-prompt-block-title {
        font-size: 12px;
        color: var(--b3-theme-on-surface);
    }

    .model-settings-prompt-block-id {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
    }

    .model-settings-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 12px 16px;
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
    }

    .b3-slider {
        width: 100%;
    }

    .model-settings-model-selector {
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .model-settings-tool-selector {
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .model-settings-tool-selector__trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: 100%;
    }

    .model-settings-preset-search {
        display: flex;
        padding: 6px 0;
    }

    .model-settings-preset-search .b3-text-field {
        width: 100%;
        padding: 6px 8px;
        font-size: 12px;
    }

    .model-settings-disabled-hint {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        font-weight: normal;
    }

    .model-settings-preset-selected-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--b3-theme-primary);
        margin-top: 2px;
    }
</style>
