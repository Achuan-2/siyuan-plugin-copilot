<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { fetchModels, getDefaultChatInterface } from '../ai-chat';
    import { pushMsg, pushErrMsg } from '../api';
    import type { ProviderConfig, ModelConfig } from '../defaultSettings';
    import { i18n } from '../utils/i18n';
    import { getModelCapabilities } from '../utils/modelCapabilities';

    export let providerId: string;
    export let providerName: string;
    export let defaultApiUrl: string = ''; // 默认 API 地址
    export let websiteUrl: string = ''; // 平台官网链接
    export let config: ProviderConfig;
    export let isCustomProvider: boolean = false; // 是否为自定义平台

    // 内置平台列表（不需要自定义参数）
    const builtInProviders = ['Achuan', 'gemini', 'deepseek', 'openai', 'moonshot', 'volcano', 'minimax'];
    $: isBuiltInProvider = builtInProviders.includes(providerId);

    const dispatch = createEventDispatcher();

    let isLoadingModels = false;
    let searchQuery = '';
    let availableModels: { id: string; name: string }[] = [];
    let showModelSearchModal = false;
    let showAddModelModal = false;
    let addedModelsSearchQuery = '';
    let manualModelId = '';
    let manualModelName = '';
    let isEditingName = false;
    let editingName = providerName;
    let showApiKey = false; // 控制 API Key 是否显示明文
    let showAdvancedConfig = false; // 控制高级设置是否显示
    let customBodyErrors: { [modelId: string]: string | null } = {}; // 跟踪每个模型的 JSON 验证错误
    let showCustomBodyForModel: { [modelId: string]: boolean } = {}; // 控制每个模型的自定义参数折叠/展开
    let currentChatInterface = getDefaultChatInterface(providerId);

    const chatInterfaceOptions = [
        { value: 'openai-completion', label: 'OpenAI Completion' },
        { value: 'gemini', label: 'Gemini' },
        { value: 'anthropic', label: 'Anthropic' },
    ];

    // 验证 JSON 字符串（支持嵌套 JSON）
    function validateJsonString(str: string): {
        valid: boolean;
        error?: string;
        formatted?: string;
    } {
        if (!str || !str.trim()) {
            return { valid: true };
        }
        try {
            const parsed = JSON.parse(str);
            // 确保是对象类型
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                return { valid: false, error: '必须是 JSON 对象格式' };
            }
            // 返回格式化的 JSON（保持嵌套结构）
            return { valid: true, formatted: JSON.stringify(parsed, null, 2) };
        } catch (e: any) {
            // 提取更友好的错误信息
            const message = e.message || '无效的 JSON 格式';
            // 尝试提取位置信息
            const posMatch = message.match(/position\s+(\d+)/i);
            if (posMatch) {
                const pos = parseInt(posMatch[1]);
                return { valid: false, error: `JSON 格式错误：第 ${pos} 个字符处` };
            }
            return { valid: false, error: `JSON 格式错误：${message}` };
        }
    }

    // 处理 customBody 更新，带验证
    function handleCustomBodyChange(modelId: string, value: string) {
        const result = validateJsonString(value);
        customBodyErrors[modelId] = result.valid ? null : result.error || null;
        customBodyErrors = { ...customBodyErrors };
        updateModel(modelId, 'customBody', value);
    }

    // 格式化 JSON
    function formatCustomBodyJson(modelId: string, currentValue: string) {
        const result = validateJsonString(currentValue);
        if (result.valid && result.formatted) {
            updateModel(modelId, 'customBody', result.formatted);
            customBodyErrors[modelId] = null;
            customBodyErrors = { ...customBodyErrors };
            pushMsg('JSON 已格式化');
        }
    }

    // 确保 advancedConfig 存在
    $: {
        if (!config.advancedConfig) {
            config.advancedConfig = {
                customModelsUrl: '',
                customChatUrl: '',
                chatInterface: getDefaultChatInterface(providerId),
            };
        } else if (!config.advancedConfig.chatInterface) {
            config.advancedConfig.chatInterface = getDefaultChatInterface(providerId);
        }
    }

    // 兼容旧配置：默认启用平台
    $: {
        if (typeof config.enabled !== 'boolean') {
            config.enabled = true;
        }
    }

    // 生成 API 地址预览（根据聊天接口类型展示）
    function buildApiPreview(raw: string, chatInterface: string) {
        if (!raw) return '';
        let s = raw.trim();

        // 记录原始结尾标记
        const endsWithHash = s.endsWith('#');
        const endsWithSlash = s.endsWith('/');

        // 移除结尾标记
        if (endsWithHash) {
            s = s.slice(0, -1);
        } else if (endsWithSlash) {
            s = s.slice(0, -1);
        }

        // 补全协议
        if (!/^https?:\/\//.test(s)) {
            s = 'https://' + s;
        }

        try {
            new URL(s);
        } catch (e) {
            return s; // 无效URL
        }

        if (chatInterface === 'gemini') {
            // 规则1：已是 Gemini generateContent 端点，直接使用
            if (/:(?:streamGenerateContent|generateContent)$/i.test(s)) {
                return s;
            }

            // 规则3：以 '#' 结尾，强制使用输入地址，不拼接任何路径
            if (endsWithHash) {
                return s;
            }

            // 规则2：以 '/' 结尾，去掉 /v1beta 前缀
            if (endsWithSlash) {
                return s + '/models/{model}:streamGenerateContent';
            }

            // 规则4：默认情况，拼接完整路径
            return s + '/v1beta/models/{model}:streamGenerateContent';
        }

        if (chatInterface === 'anthropic') {
            // 规则1：已是 messages 端点，直接使用
            if (/\/messages$/i.test(s)) {
                return s;
            }

            // 规则3：以 '#' 结尾，强制使用输入地址，不拼接任何路径
            if (endsWithHash) {
                return s;
            }

            // 规则2：以 '/' 结尾，去掉 /v1 前缀
            if (endsWithSlash) {
                return s + '/messages';
            }

            // 规则4：默认情况，拼接完整路径
            return s + '/v1/messages';
        }

        // 规则1：已是 completions 端点，直接使用
        if (/\/completions$/i.test(s)) {
            return s;
        }

        // 规则3：以 '#' 结尾，强制使用输入地址，不拼接任何路径
        if (endsWithHash) {
            return s;
        }

        // 规则2：以 '/' 结尾，去掉 /v1 前缀
        if (endsWithSlash) {
            return s + '/chat/completions';
        }

        // 规则4：默认情况，拼接完整路径
        return s + '/v1/chat/completions';
    }

    function getChatUrlPlaceholder(chatInterface: string) {
        if (chatInterface === 'gemini') {
            return i18n('platform.advancedConfig.chatUrlPlaceholderGemini');
        }

        if (chatInterface === 'anthropic') {
            return i18n('platform.advancedConfig.chatUrlPlaceholderAnthropic');
        }

        return i18n('platform.advancedConfig.chatUrlPlaceholder');
    }

    // 响应式预览值：优先使用用户输入的 customApiUrl，否则使用默认 API 地址做示例
    $: currentChatInterface = config.advancedConfig?.chatInterface || getDefaultChatInterface(providerId);
    $: apiPreview = buildApiPreview(config.customApiUrl || defaultApiUrl || '', currentChatInterface);

    // 获取模型列表
    async function loadModels() {
        if (!config.apiKey) {
            pushErrMsg(i18n('aiSidebar.errors.noApiKey'));
            return;
        }

        isLoadingModels = true;
        try {
            const models = await fetchModels(
                providerId,
                config.apiKey,
                config.customApiUrl,
                config.advancedConfig,
                config.useForwardProxy,
                config.advancedConfig?.chatInterface
            );
            // 去重：使用 Map 以模型 ID 为键进行去重
            const uniqueModelsMap = new Map();
            models.forEach(m => {
                if (!uniqueModelsMap.has(m.id)) {
                    uniqueModelsMap.set(m.id, { id: m.id, name: m.name });
                }
            });
            // 按模型ID升序排序
            availableModels = Array.from(uniqueModelsMap.values()).sort((a, b) =>
                a.id.localeCompare(b.id)
            );
            showModelSearchModal = true;
            searchQuery = '';
            pushMsg(
                i18n('models.fetchSuccess').replace('{count}', availableModels.length.toString())
            );
        } catch (error) {
            pushErrMsg(`${i18n('models.fetchFailed')}: ${error.message}`);
            console.error('Load models error:', error);
        } finally {
            isLoadingModels = false;
        }
    }

    // 打开模型搜索弹窗
    function openModelSearchModal() {
        if (!config.apiKey) {
            pushErrMsg('请先设置 API Key');
            return;
        }
        loadModels();
    }

    // 关闭模型搜索弹窗
    function closeModelSearchModal() {
        showModelSearchModal = false;
        searchQuery = '';
        availableModels = [];
    }

    // 添加模型
    function addModel(modelId: string, modelName: string) {
        // 检查是否已存在
        if (config.models.some(m => m.id === modelId)) {
            pushErrMsg('该模型已添加');
            return;
        }

        // 自动检测模型能力
        const capabilities = getModelCapabilities(modelId);

        const newModel: ModelConfig = {
            id: modelId,
            name: modelName,
            temperature: 1,
            maxTokens: -1,
            capabilities: capabilities,
            thinkingEnabled: false, // 默认不开启思考模式
            thinkingEffort: 'medium', // 默认思考强度
        };

        config.models = [...config.models, newModel];
        dispatch('change');
        pushMsg(`已添加模型: ${modelName}`);
        // 不再清空搜索关键词，方便连续添加多个模型
    }

    // 手动添加模型
    function addManualModel() {
        if (!manualModelId.trim()) {
            pushErrMsg(i18n('models.idRequired'));
            return;
        }

        const modelName = manualModelName.trim() || manualModelId.trim();
        addModel(manualModelId.trim(), modelName);

        manualModelId = '';
        manualModelName = '';
        showAddModelModal = false;
    }

    // 打开添加模型弹窗
    function openAddModelModal() {
        showAddModelModal = true;
    }

    // 关闭添加模型弹窗
    function closeAddModelModal() {
        showAddModelModal = false;
        manualModelId = '';
        manualModelName = '';
    }

    // 删除模型
    function removeModel(modelId: string) {
        config.models = config.models.filter(m => m.id !== modelId);
        dispatch('change');
        pushMsg('已删除模型');
    }

    // 切换模型添加/删除状态
    function toggleModel(modelId: string, modelName: string) {
        const isAdded = config.models.some(m => m.id === modelId);
        if (isAdded) {
            removeModel(modelId);
        } else {
            addModel(modelId, modelName);
        }
    }

    // 更新模型配置
    function updateModel(modelId: string, field: keyof ModelConfig, value: any) {
        const model = config.models.find(m => m.id === modelId);
        if (model) {
            (model as any)[field] = value;
            config.models = [...config.models];
            dispatch('change');
        }
    }

    // 过滤并排序模型 - 支持空格分隔的多关键词搜索
    $: filteredModels = availableModels
        .filter(m => {
            if (!searchQuery.trim()) return true;

            // 将搜索词按空格分割成多个关键词
            const keywords = searchQuery.toLowerCase().trim().split(/\s+/);
            const modelId = m.id.toLowerCase();
            const modelName = m.name.toLowerCase();

            // 所有关键词都必须在 id 或 name 中出现（并集搜索）
            return keywords.every(
                keyword => modelId.includes(keyword) || modelName.includes(keyword)
            );
        })
        .sort((a, b) => a.id.localeCompare(b.id));

    // 已添加模型过滤
    $: filteredAddedModels = config.models.filter(model => {
        const query = addedModelsSearchQuery.trim().toLowerCase();
        if (!query) return true;
        const text = `${model.name} ${model.id}`.toLowerCase();
        return text.includes(query);
    });

    // 开始编辑名称
    function startEditName() {
        editingName = providerName;
        isEditingName = true;
    }

    // 保存名称
    function saveName() {
        if (editingName.trim() && editingName !== providerName) {
            dispatch('rename', { newName: editingName.trim() });
            providerName = editingName.trim();
        }
        isEditingName = false;
    }

    // 取消编辑
    function cancelEditName() {
        editingName = providerName;
        isEditingName = false;
    }

    // 同步 providerName 的变化
    $: if (!isEditingName) {
        editingName = providerName;
    }

    // 获取模型能力的 emoji 字符串
    function getModelCapabilitiesEmoji(modelId: string): string {
        const capabilities = getModelCapabilities(modelId);
        if (!capabilities || Object.keys(capabilities).length === 0) return '';

        const emojis: string[] = [];
        if (capabilities.thinking) emojis.push('💡');
        if (capabilities.vision) emojis.push('👀');
        if (capabilities.imageGeneration) emojis.push('🖼️');
        if (capabilities.toolCalling) emojis.push('🛠️');
        if (capabilities.webSearch) emojis.push('🌐');

        return emojis.length > 0 ? ' ' + emojis.join(' ') : '';
    }
</script>

<div class="provider-config">
    <div class="provider-config__header">
        {#if isCustomProvider && isEditingName}
            <div class="provider-name-editor">
                <input
                    class="b3-text-field provider-name-input"
                    type="text"
                    bind:value={editingName}
                    on:keydown={e => {
                        if (e.key === 'Enter') saveName();
                        if (e.key === 'Escape') cancelEditName();
                    }}
                    placeholder="输入平台名称"
                />
                <button class="b3-button b3-button--text" on:click={saveName} title="保存">
                    <svg class="b3-button__icon">
                        <use xlink:href="#iconCheck"></use>
                    </svg>
                </button>
                <button class="b3-button b3-button--text" on:click={cancelEditName} title="取消">
                    <svg class="b3-button__icon">
                        <use xlink:href="#iconClose"></use>
                    </svg>
                </button>
            </div>
        {:else}
            <div class="provider-header-content">
                <div class="provider-title-row">
                    <h4>{providerName}</h4>
                    {#if config.customWebsiteUrl || websiteUrl}
                        <a
                            href={config.customWebsiteUrl || websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="platform-link"
                            title="访问平台官网"
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconLink"></use>
                            </svg>
                            <span>访问平台</span>
                        </a>
                    {/if}
                </div>
                {#if providerId === 'Achuan'}
                    <div class="provider-description">
                        {i18n('platform.builtIn.AchuanDescription')}
                    </div>
                    <div style="margin-top:6px;">
                        <a
                            href="https://achuan-2.apifox.cn/doc-8155570"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="platform-link"
                            title="Achuan API 使用帮助"
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconHelp"></use>
                            </svg>
                            <span>帮助指南</span>
                        </a>
                    </div>
                {/if}
            </div>
            {#if isCustomProvider}
                <button
                    class="b3-button b3-button--text edit-name-button"
                    on:click={startEditName}
                    title="编辑名称"
                >
                    <svg class="b3-button__icon">
                        <use xlink:href="#iconEdit"></use>
                    </svg>
                </button>
            {/if}
        {/if}
    </div>

    <div class="provider-config__section">
        <div>
            <div class="b3-label__text">
                {i18n('platform.apiUrl')}
            </div>
            <input
                class="b3-text-field fn__flex-1"
                type="text"
                style="width: 100%"
                value={config.customApiUrl || defaultApiUrl || ''}
                on:input={e => {
                    config.customApiUrl = e.currentTarget.value;
                    dispatch('change');
                }}
                placeholder={i18n('platform.apiUrlPlaceholder')}
            />
            {#if apiPreview}
                <div class="api-preview">
                    <div class="api-preview__url">{apiPreview}</div>
                </div>
            {/if}
            <div class="b3-label__text label-description">
                {i18n('platform.apiUrlHint')}
            </div>
        </div>

        <div>
            <div class="b3-label__text">{i18n('platform.chatInterface')}</div>
            <select
                class="b3-select provider-config__select"
                bind:value={config.advancedConfig.chatInterface}
                on:change={() => dispatch('change')}
            >
                {#each chatInterfaceOptions as option}
                    <option value={option.value}>{option.label}</option>
                {/each}
            </select>
        </div>

        <div>
            <div class="b3-label__text">API Key</div>
            <div class="api-key-input-wrapper">
                {#if showApiKey}
                    <input
                        class="b3-text-field fn__flex-1"
                        type="text"
                        bind:value={config.apiKey}
                        on:change={() => dispatch('change')}
                        placeholder={i18n('settings.ai.apiKey.description')}
                    />
                {:else}
                    <input
                        class="b3-text-field fn__flex-1"
                        type="password"
                        bind:value={config.apiKey}
                        on:change={() => dispatch('change')}
                        placeholder={i18n('settings.ai.apiKey.description')}
                    />
                {/if}
                <button
                    class="b3-button b3-button--text api-key-toggle"
                    on:click={() => (showApiKey = !showApiKey)}
                >
                    <svg class="b3-button__icon">
                        <use xlink:href={showApiKey ? '#iconEye' : '#iconEyeoff'}></use>
                    </svg>
                </button>
            </div>
        </div>

        <div>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input
                    type="checkbox"
                    class="b3-switch"
                    checked={config.useForwardProxy || false}
                    on:change={e => {
                        config.useForwardProxy = e.currentTarget.checked;
                        dispatch('change');
                    }}
                />
                <span>{i18n('platform.useForwardProxy')}</span>
            </label>
            <div class="b3-label__text label-description">
                {i18n('platform.useForwardProxyHint')}
            </div>
        </div>

        {#if isCustomProvider}
            <div>
                <div class="b3-label__text">{i18n('platform.websiteUrl')}</div>
                <div class="website-url-input-wrapper">
                    <input
                        class="b3-text-field fn__flex-1"
                        type="text"
                        bind:value={config.customWebsiteUrl}
                        on:change={() => dispatch('change')}
                        placeholder={i18n('platform.websiteUrlPlaceholder')}
                    />
                    <button
                        class="b3-button b3-button--text website-url-open"
                        on:click={() => {
                            const url = config.customWebsiteUrl?.trim();
                            if (url) {
                                window.open(url, '_blank', 'noopener,noreferrer');
                            }
                        }}
                        disabled={!config.customWebsiteUrl?.trim()}
                        title="打开官网"
                    >
                        <svg class="b3-button__icon">
                            <use xlink:href="#iconOpenWindow"></use>
                        </svg>
                    </button>
                </div>
                <div class="b3-label__text label-description">
                    {i18n('platform.websiteUrlHint')}
                </div>
            </div>
        {/if}

        <div>
            <div class="b3-label__text">{i18n('models.management')}</div>
            <div class="provider-config__model-buttons">
                <button
                    class="b3-button b3-button--outline"
                    on:click={openModelSearchModal}
                    disabled={isLoadingModels || !config.apiKey}
                >
                    {isLoadingModels ? i18n('common.loading') : i18n('common.searchAndAdd')}
                </button>
                <button class="b3-button b3-button--outline" on:click={openAddModelModal}>
                    {i18n('models.manualAdd')}
                </button>
            </div>
        </div>

        <!-- 高级自定义设置 -->
        <div class="advanced-config-section">
            <button
                class="b3-button b3-button--text advanced-toggle"
                on:click={() => (showAdvancedConfig = !showAdvancedConfig)}
            >
                <svg class="b3-button__icon" style="transition: transform 0.2s">
                    <use xlink:href={showAdvancedConfig ? '#iconDown' : '#iconRight'}></use>
                </svg>
                <span>{i18n('platform.advanced')}</span>
            </button>

            {#if showAdvancedConfig}
                <div class="advanced-config-content">
                    <div class="b3-label__text advanced-hint">
                        {i18n('platform.advancedConfig.hint')}
                    </div>

                    <div>
                        <div class="b3-label__text">
                            {i18n('platform.advancedConfig.modelsUrl')}
                        </div>
                        <input
                            class="b3-text-field fn__flex-1"
                            type="text"
                            style="width: 100%"
                            bind:value={config.advancedConfig.customModelsUrl}
                            on:change={() => dispatch('change')}
                            placeholder={i18n('platform.advancedConfig.modelsUrlPlaceholder')}
                        />
                    </div>

                    <div>
                        <div class="b3-label__text">{i18n('platform.advancedConfig.chatUrl')}</div>
                        <input
                            class="b3-text-field fn__flex-1"
                            type="text"
                            style="width: 100%"
                            bind:value={config.advancedConfig.customChatUrl}
                            on:change={() => dispatch('change')}
                            placeholder={getChatUrlPlaceholder(currentChatInterface)}
                        />
                    </div>
                </div>
            {/if}
        </div>
    </div>

    <!-- 模型搜索弹窗 -->
    {#if showModelSearchModal}
        <div class="modal-overlay" on:click={closeModelSearchModal}>
            <div class="modal-content modal-content--large" on:click|stopPropagation>
                <div class="modal-header">
                    <h4>{i18n('common.searchAndAdd')}</h4>
                    <button class="modal-close" on:click={closeModelSearchModal}>
                        <svg class="b3-button__icon" style="width: 13px;height: 13px">
                            <use xlink:href="#iconClose"></use>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    {#if availableModels.length > 0}
                        <div>
                            <input
                                class="b3-text-field fn__flex-1"
                                style="width: 100%"
                                type="text"
                                bind:value={searchQuery}
                                placeholder={i18n('models.searchPlaceholder')}
                            />
                        </div>

                        <div class="model-search-results">
                            {#each filteredModels.slice(0, 200) as model}
                                <div class="model-search-item">
                                    <div class="model-search-item__info">
                                        <span class="model-search-item__name">
                                            {model.name}{getModelCapabilitiesEmoji(model.id)}
                                        </span>
                                        <span class="model-search-item__id">{model.id}</span>
                                    </div>
                                    <button
                                        class="b3-button"
                                        class:b3-button--text={!config.models.some(
                                            m => m.id === model.id
                                        )}
                                        class:b3-button--cancel={config.models.some(
                                            m => m.id === model.id
                                        )}
                                        on:click={() => toggleModel(model.id, model.name)}
                                    >
                                        {config.models.some(m => m.id === model.id)
                                            ? i18n('models.remove') || '移除'
                                            : i18n('models.add')}
                                    </button>
                                </div>
                            {/each}
                            {#if filteredModels.length === 0}
                                <div class="model-search-empty">{i18n('models.noMatch')}</div>
                            {/if}
                        </div>
                    {:else}
                        <div class="loading-models">
                            <div class="loading-spinner"></div>
                            <span>{i18n('models.fetching')}</span>
                        </div>
                    {/if}
                </div>
                <div class="modal-footer">
                    <button class="b3-button b3-button--text" on:click={closeModelSearchModal}>
                        {i18n('common.close')}
                    </button>
                </div>
            </div>
        </div>
    {/if}

    {#if config.models.length > 0}
        <div class="provider-config__models">
            <h5>{i18n('models.added')}</h5>
            <div class="added-models-search">
                <input
                    class="b3-text-field fn__flex-1"
                    type="text"
                    bind:value={addedModelsSearchQuery}
                    placeholder={i18n('models.searchPlaceholder') || '搜索模型...'}
                />
            </div>
            {#if filteredAddedModels.length === 0}
                <div class="model-search-empty">{i18n('models.noMatch')}</div>
            {/if}
            {#each filteredAddedModels as model}
                <div class="model-item">
                    <div class="model-item__header">
                        <span class="model-item__name">{model.name}</span>
                        <button
                            class="b3-button b3-button--text b3-button--error"
                            on:click={() => removeModel(model.id)}
                            title="删除"
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconTrashcan"></use>
                            </svg>
                        </button>
                    </div>
                    <div class="model-item__config">
                        <div class="model-config-item">
                            <span>{i18n('models.temperature')}: {model.temperature}</span>
                            <input
                                type="range"
                                min="0"
                                max="2"
                                step="0.1"
                                bind:value={model.temperature}
                                on:change={() =>
                                    updateModel(model.id, 'temperature', model.temperature)}
                            />
                        </div>
                        <div class="model-config-item">
                            <span>{i18n('models.maxTokens')}</span>
                            <input
                                class="b3-text-field"
                                type="number"
                                min="-1"
                                max="128000"
                                bind:value={model.maxTokens}
                                on:change={() =>
                                    updateModel(model.id, 'maxTokens', model.maxTokens)}
                            />
                        </div>
                        <div class="model-config-item">
                            <span>{i18n('models.capabilities')}</span>
                            <div class="model-capabilities">
                                <label class="">
                                    <input
                                        type="checkbox"
                                        class="b3-switch"
                                        checked={model.capabilities?.thinking || false}
                                        on:change={e => {
                                            if (!model.capabilities) model.capabilities = {};
                                            model.capabilities.thinking = e.currentTarget.checked;
                                            updateModel(
                                                model.id,
                                                'capabilities',
                                                model.capabilities
                                            );
                                        }}
                                    />
                                    <span class="capability-label">
                                        💡 {i18n('models.thinking')}
                                    </span>
                                </label>
                                <label class="">
                                    <input
                                        type="checkbox"
                                        class="b3-switch"
                                        checked={model.capabilities?.vision || false}
                                        on:change={e => {
                                            if (!model.capabilities) model.capabilities = {};
                                            model.capabilities.vision = e.currentTarget.checked;
                                            updateModel(
                                                model.id,
                                                'capabilities',
                                                model.capabilities
                                            );
                                        }}
                                    />
                                    <span class="capability-label">👀 {i18n('models.vision')}</span>
                                </label>
                                <label class="">
                                    <input
                                        type="checkbox"
                                        class="b3-switch"
                                        checked={model.capabilities?.imageGeneration || false}
                                        on:change={e => {
                                            if (!model.capabilities) model.capabilities = {};
                                            model.capabilities.imageGeneration =
                                                e.currentTarget.checked;
                                            updateModel(
                                                model.id,
                                                'capabilities',
                                                model.capabilities
                                            );
                                        }}
                                    />
                                    <span class="capability-label">
                                        🖼️ {i18n('models.imageGeneration')}
                                    </span>
                                </label>
                                <label class="">
                                    <input
                                        type="checkbox"
                                        class="b3-switch"
                                        checked={model.capabilities?.toolCalling || false}
                                        on:change={e => {
                                            if (!model.capabilities) model.capabilities = {};
                                            model.capabilities.toolCalling =
                                                e.currentTarget.checked;
                                            updateModel(
                                                model.id,
                                                'capabilities',
                                                model.capabilities
                                            );
                                        }}
                                    />
                                    <span class="capability-label">
                                        🛠️ {i18n('models.toolCalling')}
                                    </span>
                                </label>
                                <label class="">
                                    <input
                                        type="checkbox"
                                        class="b3-switch"
                                        checked={model.capabilities?.webSearch || false}
                                        on:change={e => {
                                            if (!model.capabilities) model.capabilities = {};
                                            model.capabilities.webSearch = e.currentTarget.checked;
                                            updateModel(
                                                model.id,
                                                'capabilities',
                                                model.capabilities
                                            );
                                        }}
                                    />
                                    <span class="capability-label">
                                        🌐 {i18n('models.webSearch')}
                                    </span>
                                </label>
                            </div>
                        </div>
                        <!-- 自定义参数设置（所有平台都显示，默认折叠） -->
                        <div class="model-config-item">
                            <button
                                class="custom-body-toggle"
                                on:click={() =>
                                    (showCustomBodyForModel[model.id] =
                                        !showCustomBodyForModel[model.id])}
                            >
                                <svg class="b3-button__icon">
                                    <use
                                        xlink:href={showCustomBodyForModel[model.id]
                                            ? '#iconDown'
                                            : '#iconRight'}
                                    ></use>
                                </svg>
                                <span>{i18n('models.customBody')}</span>
                            </button>

                            {#if showCustomBodyForModel[model.id]}
                                <div class="custom-body-content">
                                    <div class="custom-body-header">
                                        {#if model.customBody && validateJsonString(model.customBody).valid}
                                            <button
                                                class="format-json-btn"
                                                title="格式化 JSON"
                                                on:click={() =>
                                                    formatCustomBodyJson(
                                                        model.id,
                                                        model.customBody || ''
                                                    )}
                                            >
                                                <svg
                                                    class="b3-button__icon"
                                                    style="width: 12px; height: 12px; color: var(--b3-theme-on-surface);"
                                                >
                                                    <use xlink:href="#iconFormat"></use>
                                                </svg>
                                            </button>
                                        {/if}
                                    </div>
                                    <textarea
                                        class="b3-text-field custom-body-textarea"
                                        class:json-error={customBodyErrors[model.id]}
                                        class:json-valid={model.customBody &&
                                            !customBodyErrors[model.id] &&
                                            validateJsonString(model.customBody).valid}
                                        style="width: 100%; height: 80px; resize: vertical; font-family: monospace; font-size: 12px;"
                                        value={model.customBody || ''}
                                        placeholder={'支持嵌套 JSON，例如：\n{\n  "key": "value",\n  "nested": { "a": 1 }\n}'}
                                        spellcheck={false}
                                        on:input={e =>
                                            handleCustomBodyChange(model.id, e.currentTarget.value)}
                                    />
                                    {#if customBodyErrors[model.id]}
                                        <div class="json-error-hint">
                                            {customBodyErrors[model.id]}
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    {/if}

    <!-- 手动添加模型弹窗 -->
    {#if showAddModelModal}
        <div class="modal-overlay" on:click={closeAddModelModal}>
            <div class="modal-content" on:click|stopPropagation>
                <div class="modal-header">
                    <h4>{i18n('models.manual')}</h4>
                    <button class="modal-close" on:click={closeAddModelModal}>
                        <svg class="b3-button__icon" style="width: 13px;height: 13px">
                            <use xlink:href="#iconClose"></use>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    <div>
                        <div class="b3-label__text">{i18n('models.id')}</div>
                        <input
                            class="b3-text-field fn__flex-1"
                            type="text"
                            bind:value={manualModelId}
                            placeholder={i18n('models.idPlaceholder')}
                            on:keydown={e => e.key === 'Enter' && addManualModel()}
                        />
                    </div>
                    <div>
                        <div class="b3-label__text">{i18n('models.name')}</div>
                        <input
                            class="b3-text-field fn__flex-1"
                            type="text"
                            bind:value={manualModelName}
                            placeholder={i18n('models.namePlaceholder')}
                            on:keydown={e => e.key === 'Enter' && addManualModel()}
                        />
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="b3-button b3-button--text" on:click={closeAddModelModal}>
                        {i18n('common.cancel')}
                    </button>
                    <button
                        class="b3-button b3-button--outline"
                        on:click={addManualModel}
                        disabled={!manualModelId.trim()}
                    >
                        {i18n('models.addModel')}
                    </button>
                </div>
            </div>
        </div>
    {/if}
</div>

<style lang="scss">
    .provider-config {
        padding: 16px;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        height: 100%;
        overflow-y: auto;
    }

    .provider-config__header {
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        gap: 8px;

        h4 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        }
    }

    .provider-header-content {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        flex: 1;
    }

    .provider-title-row {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .provider-description {
        font-size: 12px;
        color: var(--b3-theme-on-surface);
        line-height: 1.5;
        background: var(--b3-theme-primary-lightest);
        padding: 6px 12px;
        border-radius: 4px;
        border-left: 3px solid var(--b3-theme-primary);
        opacity: 0.9;
        margin-top: 2px;
    }

    .platform-link {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        font-size: 12px;
        color: var(--b3-theme-primary);
        text-decoration: none;
        border-radius: 4px;
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
        }

        svg {
            width: 14px;
            height: 14px;
        }
    }

    .provider-name-editor {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 1;
    }

    .provider-name-input {
        flex: 1;
        font-size: 16px;
        font-weight: 600;
    }

    .edit-name-button {
        opacity: 0.6;
        transition: opacity 0.2s;

        &:hover {
            opacity: 1;
        }
    }

    .provider-config__section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .provider-config__select {
        width: 100%;
    }

    .api-key-input-wrapper {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
    }

    .website-url-input-wrapper {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
    }

    .website-url-open {
        flex-shrink: 0;
        opacity: 0.6;
        transition: opacity 0.2s;

        &:hover:not(:disabled) {
            opacity: 1;
        }

        &:disabled {
            opacity: 0.3;
            cursor: not-allowed;
        }
    }

    .api-key-toggle {
        flex-shrink: 0;
        opacity: 0.6;
        transition: opacity 0.2s;

        &:hover {
            opacity: 1;
        }
    }

    .api-preview {
        margin-top: 8px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        word-break: break-all;
        background: var(--b3-theme-surface);
        padding: 6px;
        border-radius: 4px;
        border: 1px solid var(--b3-border-color);
    }

    .api-preview__url {
        margin-top: 4px;
        color: var(--b3-theme-on-surface);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Segoe UI Mono',
            monospace;
        font-size: 13px;
    }

    .provider-config__model-buttons {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;

        button {
            min-width: 0;
        }
    }

    .label-description {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        margin-top: 4px;
        line-height: 1.4;
    }

    .model-search-results {
        max-height: 300px;
        overflow-y: auto;
        margin-top: 8px;
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
    }

    .model-search-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid var(--b3-border-color);

        &:last-child {
            border-bottom: none;
        }

        &:hover {
            background: var(--b3-theme-background);
        }
    }

    .model-search-item__name {
        font-size: 13px;
        color: var(--b3-theme-on-surface);
    }

    .provider-config__models {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--b3-border-color);

        h5 {
            margin: 0 0 12px 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-surface);
        }
    }

    .added-models-search {
        margin-bottom: 10px;
    }

    .model-item {
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 12px;
    }

    .model-item__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
    }

    .model-item__name {
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .model-item__config {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .model-config-item {
        display: flex;
        flex-direction: column;
        gap: 4px;

        span {
            font-size: 12px;
            color: var(--b3-theme-on-surface);
        }

        input[type='range'] {
            width: 100%;
        }

        input[type='number'] {
            width: 100%;
        }
    }

    .model-capabilities {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 4px;

        label {
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
        }

        .capability-label {
            font-size: 12px;
            color: var(--b3-theme-on-surface);
        }
    }

    // 弹窗样式
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
        overflow-y: auto;
        z-index: 1000;
    }

    .modal-content {
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: var(--b3-dialog-shadow);
        width: min(600px, calc(100vw - 24px));
        min-width: 0;
        max-width: 600px;
        max-height: calc(100vh - 24px);
        max-height: calc(100dvh - 24px);
        display: flex;
        flex-direction: column;
        animation: modalShow 0.2s ease-out;
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--b3-border-color);

        h4 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        }
    }

    .modal-close {
        background: none;
        border: none;
        padding: 4px;
        cursor: pointer;
        color: var(--b3-theme-on-surface-light);
        border-radius: 4px;

        &:hover {
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-background);
        }
    }

    .modal-body {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        overflow-y: auto;
        min-height: 0;
    }

    .modal-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px 20px;
        border-top: 1px solid var(--b3-border-color);
    }

    @keyframes modalShow {
        from {
            opacity: 0;
            transform: scale(0.95);
        }
        to {
            opacity: 1;
            transform: scale(1);
        }
    }

    // 模型搜索弹窗专用样式
    .modal-content--large {
        width: min(800px, calc(100vw - 24px));
        min-width: 0;
        max-width: 800px;
        max-height: calc(100vh - 24px);
        max-height: calc(100dvh - 24px);
    }

    .model-search-results {
        max-height: min(420px, 48vh);
        overflow-y: auto;
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        background: var(--b3-theme-background);
    }

    .model-search-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px;
        border-bottom: 1px solid var(--b3-border-color);

        &:last-child {
            border-bottom: none;
        }

        &:hover {
            background: var(--b3-theme-surface);
        }
    }

    .model-search-item__info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
    }

    .model-search-item__name {
        font-size: 14px;
        font-weight: 500;
        color: var(--b3-theme-on-background);
    }

    .model-search-item__id {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        word-break: break-all;
        overflow-wrap: anywhere;
    }

    .model-search-empty {
        padding: 40px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-size: 14px;
    }

    .loading-models {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 40px;
        color: var(--b3-theme-on-surface);
    }

    .loading-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid var(--b3-theme-border);
        border-top-color: var(--b3-theme-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    @media (max-width: 768px) {
        .modal-overlay {
            align-items: flex-start;
            padding-top: max(12px, env(safe-area-inset-top));
            padding-bottom: max(12px, env(safe-area-inset-bottom));
        }

        .modal-content,
        .modal-content--large {
            width: calc(100vw - 24px);
            max-width: none;
            max-height: calc(100vh - 24px);
            max-height: calc(100dvh - 24px);
            border-radius: 10px;
        }

        .modal-header {
            padding: 12px 14px;
        }

        .modal-body {
            padding: 12px 14px;
            gap: 12px;
        }

        .modal-footer {
            padding: 12px 14px;
        }

        .model-search-results {
            max-height: 52vh;
        }

        .model-search-item {
            padding: 10px;
            gap: 8px;
            flex-direction: column;
            align-items: stretch;
        }

        .model-search-item__name,
        .model-search-item__id {
            overflow-wrap: anywhere;
        }

        .model-search-item .b3-button {
            width: 100%;
        }
    }

    // 高级设置样式
    .advanced-config-section {
        margin-top: 8px;
        border-top: 1px solid var(--b3-border-color);
        padding-top: 8px;
    }

    .advanced-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 0;
        width: 100%;
        justify-content: flex-start;
        color: var(--b3-theme-on-surface);
        font-size: 13px;

        &:hover {
            color: var(--b3-theme-on-background);
        }

        .b3-button__icon {
            width: 14px;
            height: 14px;
        }
    }

    .advanced-config-content {
        margin-top: 12px;
        padding: 12px;
        background: var(--b3-theme-background);
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .advanced-hint {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.4;
        margin-bottom: 4px;
        padding: 8px;
        background: var(--b3-theme-surface);
        border-radius: 4px;
        border-left: 3px solid var(--b3-theme-primary);
    }

    // 自定义参数折叠按钮样式
    .custom-body-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 0;
        width: 100%;
        justify-content: flex-start;
        color: var(--b3-theme-on-surface);
        font-size: 12px;
        background: none;
        border: none;
        cursor: pointer;
        transition: color 0.2s;

        &:hover {
            color: var(--b3-theme-on-background);
        }

        .b3-button__icon {
            width: 14px;
            height: 14px;
        }
    }

    .custom-body-content {
        margin-top: 8px;
    }

    // 自定义参数 JSON 样式
    .custom-body-header {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .format-json-btn {
        padding: 2px 4px;
        border-radius: 4px;
        background: transparent;
        border: none;
        cursor: pointer;
        opacity: 0.6;
        transition: opacity 0.2s;

        &:hover {
            opacity: 1;
            background: var(--b3-theme-surface);
        }
    }

    .custom-body-textarea {
        white-space: pre;
        tab-size: 2;

        &.json-error {
            border-color: var(--b3-theme-error) !important;
            background-color: color-mix(in srgb, var(--b3-theme-error) 5%, transparent);
        }

        &.json-valid {
            border-color: var(--b3-theme-success, #52c41a) !important;
        }
    }

    .json-error-hint {
        font-size: 11px;
        color: var(--b3-theme-error);
        margin-top: 4px;
        padding: 4px 8px;
        background: color-mix(in srgb, var(--b3-theme-error) 10%, transparent);
        border-radius: 4px;
    }
</style>
