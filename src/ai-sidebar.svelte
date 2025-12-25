<script lang="ts">
    import { onMount, tick, onDestroy } from 'svelte';
    import {
        chat,
        type Message,
        type MessageAttachment,
        type EditOperation,
        type ToolCall,
        type ContextDocument,
        type ThinkingEffort,
        isSupportedThinkingGeminiModel,
        isSupportedThinkingClaudeModel,
    } from './ai-chat';
    import type { MessageContent } from './ai-chat';
    import { getActiveEditor } from 'siyuan';
    import {
        refreshSql,
        pushMsg,
        pushErrMsg,
        sql,
        exportMdContent,
        openBlock,
        updateBlock,
        insertBlock,
        getBlockDOM,
        getBlockKramdown,
        getBlockByID,
        getFileBlob,
        renderSprig,
        createDocWithMd,
        lsNotebooks,
        searchDocs,
        getHPathByID,
    } from './api';
    import ModelSelector from './components/ModelSelector.svelte';
    import MultiModelSelector from './components/MultiModelSelector.svelte';
    import SessionManager from './components/SessionManager.svelte';
    import ToolSelector, { type ToolConfig } from './components/ToolSelector.svelte';
    import ModelPresetButton from './components/ModelPreset.svelte';
    import type { ProviderConfig } from './defaultSettings';
    import { settingsStore } from './stores/settings';
    import { confirm, Constants } from 'siyuan';
    import { t } from './utils/i18n';
    import { AVAILABLE_TOOLS, executeToolCall } from './tools';

    export let plugin: any;
    export let initialMessage: string = ''; // 初始消息
    export let mode: 'sidebar' | 'dialog' = 'sidebar'; // 使用模式：sidebar或dialog

    interface ChatSession {
        id: string;
        title: string;
        messages: Message[];
        createdAt: number;
        updatedAt: number;
        pinned?: boolean; // 是否钉住
    }

    let messages: Message[] = [];
    let currentInput = '';
    let isLoading = false;
    let streamingMessage = '';
    let streamingThinking = ''; // 流式思考内容
    let isThinkingPhase = false; // 是否在思考阶段
    let settings: any = {};
    let messagesContainer: HTMLElement;
    let textareaElement: HTMLTextAreaElement;
    let inputContainer: HTMLElement;
    let fileInputElement: HTMLInputElement;

    // 思考过程折叠状态管理
    let thinkingCollapsed: Record<number, boolean> = {};

    // 消息编辑状态
    let editingMessageIndex: number | null = null;
    let editingMessageContent = '';
    let isEditDialogOpen = false;

    // 右键菜单状态
    let contextMenuVisible = false;
    let contextMenuX = 0;
    let contextMenuY = 0;
    let contextMenuMessageIndex: number | null = null;
    let contextMenuMessageType: 'user' | 'assistant' | null = null;
    let contextMenuIsMultiModel = false;
    // 选区相关（用于右键时判断是否对选中的文本进行复制）
    let selectionInMessage = false;
    let selectionHtml = '';
    let selectionText = '';

    // 附件管理
    let currentAttachments: MessageAttachment[] = [];
    let isUploadingFile = false;

    // 中断控制
    let abortController: AbortController | null = null;
    let isAborted = false; // 标记是否已中断，防止中断后 onComplete 重复添加消息

    // 自动滚动控制
    let autoScroll = true;

    // 上下文文档
    let contextDocuments: ContextDocument[] = [];
    let isSearchDialogOpen = false;
    let searchKeyword = '';
    let searchResults: any[] = [];
    let isSearching = false;
    let isDragOver = false;
    let searchTimeout: number | null = null;

    // 提示词管理
    interface Prompt {
        id: string;
        title: string;
        content: string;
        createdAt: number;
    }
    let prompts: Prompt[] = [];
    let isPromptManagerOpen = false;
    let isPromptSelectorOpen = false;
    let editingPrompt: Prompt | null = null;
    let newPromptTitle = '';
    let newPromptContent = '';

    // 会话管理
    let sessions: ChatSession[] = [];
    let currentSessionId: string = '';
    let isSessionManagerOpen = false;
    let hasUnsavedChanges = false;

    // 在新窗口打开菜单
    let showOpenWindowMenu = false;
    let openWindowMenuButton: HTMLButtonElement;

    // 全屏模式
    let isFullscreen = false;
    let sidebarContainer: HTMLElement;

    // 当前选中的提供商和模型
    let currentProvider = '';
    let currentModelId = '';
    let providers: Record<string, ProviderConfig> = {};

    // 显示设置
    let messageFontSize = 12;

    // 模型临时设置
    let tempModelSettings = {
        contextCount: 10,
        temperature: 0.7,
        temperatureEnabled: true,
        systemPrompt: '',
        modelSelectionEnabled: false,
        selectedModels: [] as Array<{ provider: string; modelId: string }>,
        enableMultiModel: false,
        chatMode: 'ask' as 'ask' | 'edit' | 'agent',
    };

    // 编辑模式
    type ChatMode = 'ask' | 'edit' | 'agent';
    let chatMode: ChatMode = 'ask';
    let autoApproveEdit = false; // 自动批准编辑操作
    let isDiffDialogOpen = false;
    let currentDiffOperation: EditOperation | null = null;
    type DiffViewMode = 'diff' | 'split';
    let diffViewMode: DiffViewMode = 'diff'; // diff查看模式：diff或split

    // 当模式切换时，更新已添加的上下文文档内容
    $: if (chatMode) {
        updateContextDocumentsForMode();
    }

    // 更新上下文文档内容以匹配当前模式
    async function updateContextDocumentsForMode() {
        if (contextDocuments.length === 0) return;

        const updatedDocs: ContextDocument[] = [];
        for (const doc of contextDocuments) {
            try {
                let content: string;

                if (chatMode === 'agent') {
                    // agent模式：文档只保留ID，块获取kramdown
                    if (doc.type === 'doc') {
                        content = ''; // 文档不保存内容，只保留ID
                    } else {
                        // 块获取kramdown格式
                        const blockData = await getBlockKramdown(doc.id);
                        if (blockData && blockData.kramdown) {
                            content = blockData.kramdown;
                        } else {
                            content = doc.content; // 保留原内容
                        }
                    }
                } else if (chatMode === 'edit') {
                    // edit模式：获取kramdown格式
                    const blockData = await getBlockKramdown(doc.id);
                    if (blockData && blockData.kramdown) {
                        content = blockData.kramdown;
                    } else {
                        content = doc.content; // 保留原内容
                    }
                } else {
                    // ask模式：获取Markdown格式
                    const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                    if (data && data.content) {
                        content = data.content;
                    } else {
                        content = doc.content; // 保留原内容
                    }
                }

                updatedDocs.push({
                    id: doc.id,
                    title: doc.title,
                    content: content,
                    type: doc.type,
                });
            } catch (error) {
                console.error(`Failed to update content for block ${doc.id}:`, error);
                // 出错时保留原内容
                updatedDocs.push(doc);
            }
        }

        contextDocuments = updatedDocs;
    }

    // 重新生成单个多模型响应（在多模型选择阶段使用）
    async function regenerateModelResponse(index: number) {
        const response = multiModelResponses[index];
        if (!response) {
            pushErrMsg(t('aiSidebar.errors.noMessage'));
            return;
        }

        // 如果目标模型正在加载中，则拒绝重复触发
        if (response.isLoading) {
            pushErrMsg(t('aiSidebar.errors.generating'));
            return;
        }

        const config = getProviderAndModelConfig(response.provider, response.modelId);
        if (!config) {
            pushErrMsg(t('aiSidebar.info.noValidModel') || '无效的模型');
            return;
        }

        const { providerConfig, modelConfig } = config;
        if (!providerConfig || !providerConfig.apiKey) {
            pushErrMsg(t('aiSidebar.errors.noApiKey'));
            return;
        }

        // 标记为加载中并清空内容/错误
        multiModelResponses[index] = {
            ...multiModelResponses[index],
            isLoading: true,
            error: undefined,
            content: '',
            thinking: '',
            thinkingCollapsed: false,
        };
        multiModelResponses = [...multiModelResponses];

        // 获取最后一条用户消息并准备上下文
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        if (!lastUserMessage) {
            pushErrMsg(t('aiSidebar.errors.noUserMessage'));
            multiModelResponses[index].isLoading = false;
            multiModelResponses = [...multiModelResponses];
            return;
        }

        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        const userContextDocs = lastUserMessage.contextDocuments || [];
        for (const doc of userContextDocs) {
            try {
                let content: string;
                if (chatMode === 'edit') {
                    const blockData = await getBlockKramdown(doc.id);
                    content = (blockData && blockData.kramdown) || doc.content;
                } else {
                    const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                    content = (data && data.content) || doc.content;
                }
                contextDocumentsWithLatestContent.push({
                    id: doc.id,
                    title: doc.title,
                    content,
                    type: doc.type,
                });
            } catch (error) {
                console.error(`Failed to fetch latest content for block ${doc.id}:`, error);
                contextDocumentsWithLatestContent.push(doc);
            }
        }

        const userContent =
            typeof lastUserMessage.content === 'string'
                ? lastUserMessage.content
                : getMessageText(lastUserMessage.content);
        const userMessage: Message = {
            role: 'user',
            content: userContent,
            attachments: lastUserMessage.attachments,
            contextDocuments:
                contextDocumentsWithLatestContent.length > 0
                    ? contextDocumentsWithLatestContent
                    : undefined,
        };

        const messagesToSend = prepareMessagesForAI(
            messages,
            contextDocumentsWithLatestContent,
            userContent,
            userMessage
        );

        // 本次请求的 AbortController（用于单个模型的中断）
        const localAbort = new AbortController();

        // 解析自定义参数
        let customBody = {};
        if (modelConfig.customBody) {
            try {
                customBody = JSON.parse(modelConfig.customBody);
            } catch (e) {
                console.error('Failed to parse custom body:', e);
                multiModelResponses[index].error = '自定义参数 JSON 格式错误';
                multiModelResponses[index].isLoading = false;
                multiModelResponses = [...multiModelResponses];
                return;
            }
        }

        try {
            let fullText = '';
            let thinking = '';

            await chat(
                response.provider,
                {
                    apiKey: providerConfig.apiKey,
                    model: modelConfig.id,
                    messages: messagesToSend,
                    temperature: tempModelSettings.temperatureEnabled
                        ? tempModelSettings.temperature
                        : undefined,
                    maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                    stream: true,
                    signal: localAbort.signal,
                    customBody,
                    enableThinking: modelConfig.capabilities?.thinking || false,
                    reasoningEffort: modelConfig.thinkingEffort || 'medium',
                    onThinkingChunk: async (chunk: string) => {
                        thinking += chunk;
                        if (multiModelResponses[index]) {
                            multiModelResponses[index].thinking = thinking;
                            multiModelResponses = [...multiModelResponses];
                        }
                    },
                    onThinkingComplete: () => {
                        if (multiModelResponses[index] && multiModelResponses[index].thinking) {
                            multiModelResponses[index].thinkingCollapsed = true;
                            multiModelResponses = [...multiModelResponses];
                        }
                    },
                    onChunk: async (chunk: string) => {
                        fullText += chunk;
                        if (multiModelResponses[index]) {
                            multiModelResponses[index].content = fullText;
                            multiModelResponses = [...multiModelResponses];
                        }
                    },
                    onComplete: async (text: string) => {
                        if (multiModelResponses[index]) {
                            multiModelResponses[index].content = convertLatexToMarkdown(text);
                            multiModelResponses[index].thinking = thinking;
                            multiModelResponses[index].isLoading = false;
                            if (thinking && !multiModelResponses[index].thinkingCollapsed) {
                                multiModelResponses[index].thinkingCollapsed = true;
                            }
                            multiModelResponses = [...multiModelResponses];
                        }
                    },
                    onError: (error: Error) => {
                        if (error.message !== 'Request aborted' && multiModelResponses[index]) {
                            multiModelResponses[index].error = error.message;
                            multiModelResponses[index].isLoading = false;
                            multiModelResponses = [...multiModelResponses];
                        }
                    },
                },
                providerConfig.customApiUrl,
                providerConfig.advancedConfig
            );
        } catch (error) {
            if ((error as Error).message !== 'Request aborted' && multiModelResponses[index]) {
                multiModelResponses[index].error = (error as Error).message;
                multiModelResponses[index].isLoading = false;
                multiModelResponses = [...multiModelResponses];
            }
        }
    }

    // 重新生成历史消息中的单个多模型响应（history message.multiModelResponses）
    async function regenerateHistoryModelResponse(absMessageIndex: number, responseIndex: number) {
        const msg = messages[absMessageIndex];
        if (!msg || !msg.multiModelResponses) {
            pushErrMsg(t('aiSidebar.errors.noMessage'));
            return;
        }

        const response = msg.multiModelResponses[responseIndex];
        if (!response) {
            pushErrMsg(t('aiSidebar.errors.noMessage'));
            return;
        }

        if (response.isLoading) {
            pushErrMsg(t('aiSidebar.errors.generating'));
            return;
        }

        const config = getProviderAndModelConfig(response.provider, response.modelId);
        if (!config) {
            pushErrMsg(t('aiSidebar.info.noValidModel') || '无效的模型');
            return;
        }

        const { providerConfig, modelConfig } = config;
        if (!providerConfig || !providerConfig.apiKey) {
            pushErrMsg(t('aiSidebar.errors.noApiKey'));
            return;
        }

        // 标记为加载中并清空内容/错误
        msg.multiModelResponses[responseIndex] = {
            ...msg.multiModelResponses[responseIndex],
            isLoading: true,
            error: undefined,
            content: '',
            thinking: '',
            thinkingCollapsed: false,
        };
        messages = [...messages];

        // 找到该 assistant 消息之前最近的 user 消息作为上下文
        let lastUserMessage: Message | undefined;
        for (let i = absMessageIndex - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                lastUserMessage = messages[i];
                break;
            }
        }

        if (!lastUserMessage) {
            pushErrMsg(t('aiSidebar.errors.noUserMessage'));
            msg.multiModelResponses[responseIndex].isLoading = false;
            messages = [...messages];
            return;
        }

        // 获取用户消息的上下文文档最新内容（如果有）
        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        const userContextDocs = lastUserMessage.contextDocuments || [];
        for (const doc of userContextDocs) {
            try {
                let content: string;
                if (chatMode === 'edit') {
                    const blockData = await getBlockKramdown(doc.id);
                    content = (blockData && blockData.kramdown) || doc.content;
                } else {
                    const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                    content = (data && data.content) || doc.content;
                }
                contextDocumentsWithLatestContent.push({
                    id: doc.id,
                    title: doc.title,
                    content,
                    type: doc.type,
                });
            } catch (error) {
                console.error(`Failed to fetch latest content for block ${doc.id}:`, error);
                contextDocumentsWithLatestContent.push(doc);
            }
        }

        const userContent =
            typeof lastUserMessage.content === 'string'
                ? lastUserMessage.content
                : getMessageText(lastUserMessage.content);
        const userMessage: Message = {
            role: 'user',
            content: userContent,
            attachments: lastUserMessage.attachments,
            contextDocuments:
                contextDocumentsWithLatestContent.length > 0
                    ? contextDocumentsWithLatestContent
                    : undefined,
        };

        const messagesToSend = prepareMessagesForAI(
            messages,
            contextDocumentsWithLatestContent,
            userContent,
            userMessage
        );

        const localAbort = new AbortController();

        // 解析自定义参数
        let customBody = {};
        if (modelConfig.customBody) {
            try {
                customBody = JSON.parse(modelConfig.customBody);
            } catch (e) {
                console.error('Failed to parse custom body:', e);
                msg.multiModelResponses[responseIndex].error = '自定义参数 JSON 格式错误';
                msg.multiModelResponses[responseIndex].isLoading = false;
                messages = [...messages];
                return;
            }
        }

        try {
            let fullText = '';
            let thinking = '';

            await chat(
                response.provider,
                {
                    apiKey: providerConfig.apiKey,
                    model: modelConfig.id,
                    messages: messagesToSend,
                    temperature: tempModelSettings.temperatureEnabled
                        ? tempModelSettings.temperature
                        : undefined,
                    maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                    stream: true,
                    signal: localAbort.signal,
                    customBody,
                    enableThinking:
                        modelConfig.capabilities?.thinking &&
                        (modelConfig.thinkingEnabled || false),
                    reasoningEffort: modelConfig.thinkingEffort || 'medium',
                    onThinkingChunk: async (chunk: string) => {
                        thinking += chunk;
                        msg.multiModelResponses[responseIndex].thinking = thinking;
                        messages = [...messages];
                    },
                    onThinkingComplete: () => {
                        if (msg.multiModelResponses[responseIndex].thinking) {
                            msg.multiModelResponses[responseIndex].thinkingCollapsed = true;
                            messages = [...messages];
                        }
                    },
                    onChunk: async (chunk: string) => {
                        fullText += chunk;
                        msg.multiModelResponses[responseIndex].content = fullText;
                        messages = [...messages];
                    },
                    onComplete: async (text: string) => {
                        msg.multiModelResponses[responseIndex].content =
                            convertLatexToMarkdown(text);
                        msg.multiModelResponses[responseIndex].thinking = thinking;
                        msg.multiModelResponses[responseIndex].isLoading = false;
                        if (thinking && !msg.multiModelResponses[responseIndex].thinkingCollapsed) {
                            msg.multiModelResponses[responseIndex].thinkingCollapsed = true;
                        }
                        messages = [...messages];
                    },
                    onError: (error: Error) => {
                        if (error.message !== 'Request aborted') {
                            msg.multiModelResponses[responseIndex].error = error.message;
                            msg.multiModelResponses[responseIndex].isLoading = false;
                            messages = [...messages];
                        }
                    },
                },
                providerConfig.customApiUrl,
                providerConfig.advancedConfig
            );
        } catch (error) {
            if ((error as Error).message !== 'Request aborted') {
                msg.multiModelResponses[responseIndex].error = (error as Error).message;
                msg.multiModelResponses[responseIndex].isLoading = false;
                messages = [...messages];
            }
        }
    }

    // Agent 模式
    let isToolSelectorOpen = false;
    let selectedTools: ToolConfig[] = []; // 选中的工具配置列表
    let toolCallsInProgress: Set<string> = new Set(); // 正在执行的工具调用ID
    let toolCallsExpanded: Record<string, boolean> = {}; // 工具调用是否展开，默认折叠
    let toolCallResultsExpanded: Record<string, boolean> = {}; // 工具结果是否展开，默认折叠
    let pendingToolCall: ToolCall | null = null; // 待批准的工具调用
    let isToolApprovalDialogOpen = false; // 工具批准对话框是否打开
    let isToolConfigLoaded = false; // 标记工具配置是否已加载

    // 多模型对话
    let enableMultiModel = false; // 是否启用多模型模式
    let selectedMultiModels: Array<{ provider: string; modelId: string }> = []; // 选中的多个模型
    let multiModelResponses: Array<{
        provider: string;
        modelId: string;
        modelName: string;
        content: string;
        thinking?: string;
        isLoading: boolean;
        error?: string;
        thinkingCollapsed?: boolean;
        thinkingEnabled?: boolean; // 用户是否开启思考模式（从 provider 配置获取）
    }> = []; // 多模型响应
    let isWaitingForAnswerSelection = false; // 是否在等待用户选择答案
    let selectedAnswerIndex: number | null = null; // 用户选择的答案索引
    let multiModelLayout: 'card' | 'tab' = 'tab'; // 多模型布局模式：card 或 tab
    let selectedTabIndex: number = 0; // 当前选中的页签索引

    // 保存到笔记相关
    let isSaveToNoteDialogOpen = false; // 保存到笔记对话框是否打开
    let saveDocumentName = ''; // 保存的文档名称
    let saveNotebookId = ''; // 保存的笔记本ID
    let savePath = ''; // 保存的路径
    let savePathSearchKeyword = ''; // 路径搜索关键词
    let savePathSearchResults: any[] = []; // 路径搜索结果
    let isSavePathSearching = false; // 是否正在搜索路径
    let savePathSearchTimeout: number | null = null; // 路径搜索防抖
    let showSavePathDropdown = false; // 是否显示路径下拉框
    let currentDocPath = ''; // 当前文档路径
    let currentDocNotebookId = ''; // 当前文档所在笔记本ID
    let hasDefaultPath = false; // 是否有全局默认路径
    let saveDialogNotebooks: any[] = []; // 保存对话框中的笔记本列表
    let saveMessageIndex: number | null = null; // 要保存的单个消息索引（null表示保存整个会话）
    let openAfterSave = true; // 保存后是否打开笔记

    // 订阅设置变化
    let unsubscribe: () => void;

    onMount(async () => {
        settings = await plugin.loadSettings();

        // 迁移旧设置到新结构
        migrateOldSettings();

        // 初始化提供商和模型信息
        providers = settings.aiProviders || {};
        currentProvider = settings.currentProvider || '';
        currentModelId = settings.currentModelId || '';

        // 初始化多模型选择，过滤掉无效的模型
        selectedMultiModels = (settings.selectedMultiModels || []).filter(model => {
            const config = getProviderAndModelConfig(model.provider, model.modelId);
            return config !== null; // 只保留有效的模型
        });

        // 如果过滤后的模型列表与原列表不同，保存更新后的列表
        if (selectedMultiModels.length !== (settings.selectedMultiModels || []).length) {
            settings.selectedMultiModels = selectedMultiModels;
            await plugin.saveSettings(settings);
        }

        // 初始化字体大小设置
        messageFontSize = settings.messageFontSize || 12;

        // 加载历史会话
        await loadSessions();

        // 加载提示词
        await loadPrompts();

        // 加载 Agent 模式的工具配置
        await loadToolsConfig();

        // 如果有系统提示词，添加到消息列表
        if (settings.aiSystemPrompt) {
            messages = [{ role: 'system', content: settings.aiSystemPrompt }];
        }

        // 如果有初始消息，自动填充到输入框
        if (initialMessage) {
            currentInput = initialMessage;
            // 在dialog模式下，自动聚焦输入框
            if (mode === 'dialog') {
                await tick();
                textareaElement?.focus();
            }
        }

        // 订阅设置变化
        unsubscribe = settingsStore.subscribe(newSettings => {
            if (newSettings && Object.keys(newSettings).length > 0) {
                // 更新本地设置
                settings = newSettings;

                // 更新提供商信息
                if (newSettings.aiProviders) {
                    providers = newSettings.aiProviders;
                }

                // 更新当前选择（如果设置中有保存）
                if (newSettings.currentProvider) {
                    currentProvider = newSettings.currentProvider;
                }
                if (newSettings.currentModelId) {
                    currentModelId = newSettings.currentModelId;
                }

                // 更新多模型选择，过滤掉无效的模型
                if (newSettings.selectedMultiModels !== undefined) {
                    const validModels = newSettings.selectedMultiModels.filter(model => {
                        const config = getProviderAndModelConfig(model.provider, model.modelId);
                        return config !== null;
                    });
                    selectedMultiModels = validModels;

                    // 如果过滤后的模型列表与原列表不同，更新设置
                    if (validModels.length !== newSettings.selectedMultiModels.length) {
                        settings.selectedMultiModels = validModels;
                        // 异步保存设置
                        plugin.saveSettings(settings).catch(err => {
                            console.error('Failed to save filtered multi-models:', err);
                        });
                    }
                }

                // 实时更新字体大小设置
                if (newSettings.messageFontSize !== undefined) {
                    messageFontSize = newSettings.messageFontSize;
                } // 更新系统提示词
                if (settings.aiSystemPrompt && messages.length === 0) {
                    messages = [{ role: 'system', content: settings.aiSystemPrompt }];
                } else if (settings.aiSystemPrompt && messages[0]?.role === 'system') {
                    messages[0].content = settings.aiSystemPrompt;
                }

                // console.debug('AI Sidebar: ' + t('common.configComplete'));
            }
        });

        // 添加全局点击事件监听器
        document.addEventListener('click', handleClickOutside);
        // 添加全局滚动事件监听器以关闭右键菜单
        document.addEventListener('scroll', closeContextMenu, true);
        // 添加全局复制事件监听器
        document.addEventListener('copy', handleCopyEvent);
    });

    onDestroy(async () => {
        // 取消订阅
        if (unsubscribe) {
            unsubscribe();
        }

        // 移除全局点击事件监听器
        document.removeEventListener('click', handleClickOutside);
        // 移除全局滚动事件监听器
        document.removeEventListener('scroll', closeContextMenu, true);
        // 移除全局复制事件监听器
        document.removeEventListener('copy', handleCopyEvent);

        // 保存工具配置
        if (isToolConfigLoaded) {
            await saveToolsConfig();
        }

        // 如果有未保存的更改，自动保存当前会话
        if (hasUnsavedChanges && messages.filter(m => m.role !== 'system').length > 0) {
            await saveCurrentSession(true); // 静默保存，不显示提示
        }
    });

    // 迁移旧设置到新结构
    function migrateOldSettings() {
        if (!settings.aiProviders && settings.aiProvider && settings.aiApiKey) {
            // 创建新的提供商结构
            if (!settings.aiProviders) {
                settings.aiProviders = {
                    gemini: { apiKey: '', customApiUrl: '', models: [] },
                    deepseek: { apiKey: '', customApiUrl: '', models: [] },
                    openai: { apiKey: '', customApiUrl: '', models: [] },
                    volcano: { apiKey: '', customApiUrl: '', models: [] },
                    customProviders: [],
                };
            }

            // 迁移旧的设置
            const oldProvider = settings.aiProvider;
            if (settings.aiProviders[oldProvider]) {
                settings.aiProviders[oldProvider].apiKey = settings.aiApiKey || '';
                settings.aiProviders[oldProvider].customApiUrl = settings.aiCustomApiUrl || '';

                // 如果有模型，添加到列表
                if (settings.aiModel) {
                    settings.aiProviders[oldProvider].models = [
                        {
                            id: settings.aiModel,
                            name: settings.aiModel,
                            temperature: settings.aiTemperature || 0.7,
                            maxTokens: settings.aiMaxTokens || -1,
                        },
                    ];
                    settings.currentProvider = oldProvider;
                    settings.currentModelId = settings.aiModel;
                }
            }

            // 保存迁移后的设置
            plugin.saveSettings(settings);
        }

        // 确保 customProviders 数组存在
        if (settings.aiProviders && !settings.aiProviders.customProviders) {
            settings.aiProviders.customProviders = [];
        }
    }

    // 自动调整textarea高度
    function autoResizeTextarea() {
        if (textareaElement) {
            textareaElement.style.height = 'auto';
            textareaElement.style.height = Math.min(textareaElement.scrollHeight, 200) + 'px';
        }
    }

    // 监听输入变化
    $: {
        currentInput;
        tick().then(autoResizeTextarea);
    }

    // 当消息、多模型响应或选择页签/答案变化时，高亮代码块
    $: {
        // 保持对变量的引用以便 Svelte 触发依赖
        messages;
        multiModelResponses;
        selectedTabIndex;
        selectedAnswerIndex;
        thinkingCollapsed;

        tick().then(async () => {
            if (messagesContainer) {
                // 等待DOM完全更新后再处理代码块
                await tick();
                await tick();
                highlightCodeBlocks(messagesContainer);
                await tick();
                cleanupCodeBlocks(messagesContainer);
                renderMathFormulas(messagesContainer);
                setupBlockRefLinks(messagesContainer);
            }
        });
    }

    // 处理粘贴事件
    async function handlePaste(event: ClipboardEvent) {
        const items = event.clipboardData?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // 处理图片
            if (item.type.startsWith('image/')) {
                event.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    await addImageAttachment(file);
                }
                return;
            }

            // 处理文件
            if (item.kind === 'file') {
                event.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    await addFileAttachment(file);
                }
                return;
            }
        }
    }

    // 添加图片附件
    async function addImageAttachment(file: File) {
        if (!file.type.startsWith('image/')) {
            pushErrMsg(t('aiSidebar.errors.imageOnly'));
            return;
        }

        // 检查文件大小 (最大 10MB)
        if (file.size > 10 * 1024 * 1024) {
            pushErrMsg(t('aiSidebar.errors.imageTooLarge'));
            return;
        }

        try {
            isUploadingFile = true;

            // 将图片转换为 base64
            const base64 = await fileToBase64(file);

            currentAttachments = [
                ...currentAttachments,
                {
                    type: 'image',
                    name: file.name,
                    data: base64,
                    mimeType: file.type,
                },
            ];
        } catch (error) {
            console.error('Add image error:', error);
            pushErrMsg(t('aiSidebar.errors.addImageFailed'));
        } finally {
            isUploadingFile = false;
        }
    }

    // 添加文件附件
    async function addFileAttachment(file: File) {
        // 只支持文本文件和图片
        const isText =
            file.type.startsWith('text/') ||
            file.name.endsWith('.md') ||
            file.name.endsWith('.txt') ||
            file.name.endsWith('.json') ||
            file.name.endsWith('.xml') ||
            file.name.endsWith('.csv');

        const isImage = file.type.startsWith('image/');

        if (!isText && !isImage) {
            pushErrMsg(t('aiSidebar.errors.textAndImageOnly'));
            return;
        }

        // 检查文件大小 (文本文件最大 5MB，图片最大 10MB)
        const maxSize = isImage ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
        if (file.size > maxSize) {
            pushErrMsg(t('aiSidebar.errors.fileTooLarge'));
            return;
        }

        try {
            isUploadingFile = true;

            if (isImage) {
                await addImageAttachment(file);
            } else {
                // 读取文本文件内容
                const content = await file.text();

                currentAttachments = [
                    ...currentAttachments,
                    {
                        type: 'file',
                        name: file.name,
                        data: content,
                        mimeType: file.type,
                    },
                ];
            }
        } catch (error) {
            console.error('Add file error:', error);
            pushErrMsg(t('aiSidebar.errors.addFileFailed'));
        } finally {
            isUploadingFile = false;
        }
    }

    // 文件转 base64
    function fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // 触发文件选择
    function triggerFileUpload() {
        fileInputElement?.click();
    }

    // 处理文件选择
    async function handleFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        const files = input.files;

        if (!files || files.length === 0) return;

        for (let i = 0; i < files.length; i++) {
            await addFileAttachment(files[i]);
        }

        // 清空 input，允许重复选择同一文件
        input.value = '';
    }

    // 移除附件
    function removeAttachment(index: number) {
        currentAttachments = currentAttachments.filter((_, i) => i !== index);
    }

    // 检查是否在底部
    function isAtBottom() {
        if (!messagesContainer) return true;
        const threshold = 100; // 100px的阈值
        const scrollBottom =
            messagesContainer.scrollHeight -
            messagesContainer.scrollTop -
            messagesContainer.clientHeight;
        return scrollBottom < threshold;
    }

    // 处理滚动事件
    function handleScroll() {
        if (!messagesContainer) return;

        const atBottom = isAtBottom();

        // 如果用户滚动到底部附近，恢复自动滚动
        if (atBottom) {
            autoScroll = true;
        } else if (isLoading) {
            // 如果正在加载且用户滚动离开底部，停止自动滚动
            autoScroll = false;
        }
    }

    // 全屏切换
    function toggleFullscreen() {
        if (!sidebarContainer) return;
        isFullscreen = !isFullscreen;
    }

    // 滚动到底部
    async function scrollToBottom(force = false) {
        await tick();
        if (messagesContainer && (force || autoScroll)) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    // 滚动到顶部
    async function scrollToTop() {
        await tick();
        if (messagesContainer) {
            messagesContainer.scrollTop = 0;
        }
    }

    // 切换模型
    function handleModelSelect(event: CustomEvent<{ provider: string; modelId: string }>) {
        const { provider, modelId } = event.detail;
        currentProvider = provider;
        currentModelId = modelId;

        // 保存选择
        settings.currentProvider = provider;
        settings.currentModelId = modelId;
        plugin.saveSettings(settings);
    }

    // 处理多模型选择变化
    function handleMultiModelChange(
        event: CustomEvent<Array<{ provider: string; modelId: string }>>
    ) {
        selectedMultiModels = event.detail;

        // 保存到设置中
        settings.selectedMultiModels = event.detail;
        plugin.saveSettings(settings);
    }

    // 处理多模型开关切换
    function handleToggleMultiModel(event: CustomEvent<boolean>) {
        enableMultiModel = event.detail;

        // 如果禁用多模型,清除相关状态
        if (!enableMultiModel) {
            multiModelResponses = [];
            isWaitingForAnswerSelection = false;
            selectedAnswerIndex = null;
        }
    }

    // 处理多模型中模型的思考模式切换
    function handleToggleModelThinking(
        event: CustomEvent<{ provider: string; modelId: string; enabled: boolean }>
    ) {
        const { provider, modelId, enabled } = event.detail;

        // 查找并更新 provider 中对应模型的 thinkingEnabled 设置
        let providerConfig: any = null;

        // 检查是否是内置平台
        if (providers[provider] && !Array.isArray(providers[provider])) {
            providerConfig = providers[provider];
        } else if (providers.customProviders && Array.isArray(providers.customProviders)) {
            // 检查是否是自定义平台
            providerConfig = providers.customProviders.find((p: any) => p.id === provider);
        }

        if (providerConfig && providerConfig.models) {
            const model = providerConfig.models.find((m: any) => m.id === modelId);
            if (model) {
                model.thinkingEnabled = enabled;
                // 触发响应式更新
                providers = { ...providers };
                // 保存设置
                settings.aiProviders = providers;
                plugin.saveSettings(settings);
            }
        }
    }

    // 处理模型设置应用
    async function handleApplyModelSettings(
        event: CustomEvent<{
            contextCount: number;
            temperature: number;
            temperatureEnabled: boolean;
            systemPrompt: string;
            modelSelectionEnabled?: boolean;
            selectedModels?: Array<{ provider: string; modelId: string }>;
            enableMultiModel?: boolean;
            chatMode?: 'ask' | 'edit' | 'agent';
            modelThinkingSettings?: Record<string, boolean>;
        }>
    ) {
        const newSettings = event.detail;

        // 更新tempModelSettings，保持所有字段的状态
        tempModelSettings = {
            contextCount: newSettings.contextCount,
            temperature: newSettings.temperature,
            temperatureEnabled: newSettings.temperatureEnabled,
            systemPrompt: newSettings.systemPrompt,
            modelSelectionEnabled: newSettings.modelSelectionEnabled ?? false,
            selectedModels: newSettings.selectedModels || [],
            enableMultiModel: newSettings.enableMultiModel ?? false,
            chatMode: newSettings.chatMode ?? 'ask',
            modelThinkingSettings: newSettings.modelThinkingSettings || {},
        };

        // 应用聊天模式
        if (newSettings.chatMode) {
            chatMode = newSettings.chatMode;
        }

        // 应用thinking设置
        if (newSettings.modelThinkingSettings) {
            // 更新每个模型的thinking设置
            for (const [key, enabled] of Object.entries(newSettings.modelThinkingSettings)) {
                const [provider, modelId] = key.split(':');
                if (provider && modelId) {
                    const providerConfig =
                        providers[provider] ||
                        providers.customProviders?.find(p => p.id === provider);
                    if (providerConfig) {
                        const model = providerConfig.models?.find(m => m.id === modelId);
                        if (model) {
                            model.thinkingEnabled = enabled;
                        }
                    }
                }
            }
        }

        // 如果启用了模型选择
        if (
            newSettings.modelSelectionEnabled &&
            newSettings.selectedModels &&
            newSettings.selectedModels.length > 0
        ) {
            // 只有ask模式才能启用多模型
            if (newSettings.enableMultiModel && newSettings.chatMode === 'ask') {
                // 多模型模式
                enableMultiModel = true;

                // 先更新设置对象
                settings.selectedMultiModels = [...newSettings.selectedModels];

                // 然后更新本地变量
                selectedMultiModels = [...newSettings.selectedModels];

                // 最后保存设置
                await plugin.saveSettings(settings);
            } else {
                // 单模型模式
                enableMultiModel = false;
                const selectedModel = newSettings.selectedModels[0];
                if (selectedModel) {
                    // 先更新设置对象（包括selectedProviderId）
                    settings.selectedProviderId = selectedModel.provider;
                    settings.currentProvider = selectedModel.provider;
                    settings.currentModelId = selectedModel.modelId;

                    // 然后更新本地变量
                    currentProvider = selectedModel.provider;
                    currentModelId = selectedModel.modelId;

                    // 最后保存设置
                    await plugin.saveSettings(settings);
                }
            }
        } else {
            // 如果未启用模型选择，确保禁用多模型模式
            enableMultiModel = false;
        }
    }

    // 获取当前提供商配置
    function getCurrentProviderConfig() {
        if (!currentProvider) return null;

        // 检查是否是内置平台
        if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
            return providers[currentProvider];
        }

        // 检查是否是自定义平台
        if (providers.customProviders && Array.isArray(providers.customProviders)) {
            return providers.customProviders.find((p: any) => p.id === currentProvider);
        }

        return null;
    }

    // 获取当前模型配置
    function getCurrentModelConfig() {
        const providerConfig = getCurrentProviderConfig();
        if (!providerConfig || !currentModelId) {
            return null;
        }
        return providerConfig.models.find((m: any) => m.id === currentModelId);
    }

    // 思考模式状态（响应式）
    // 确保追踪 currentProvider、currentModelId 和 providers 的变化
    $: isThinkingModeEnabled = (() => {
        // 确保读取最新的 providers 数据
        if (!currentProvider || !currentModelId) {
            return false;
        }

        // 从 settings 中读取最新的配置，确保数据是最新的
        const providerConfig = (() => {
            // 检查是否是自定义平台
            const customProvider = settings.aiProviders?.customProviders?.find(
                (p: any) => p.id === currentProvider
            );
            if (customProvider) {
                return customProvider;
            }

            // 检查是否是内置平台
            if (settings.aiProviders?.[currentProvider]) {
                return settings.aiProviders[currentProvider];
            }

            // 回退到 providers 对象
            if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
                return providers[currentProvider];
            }

            if (providers.customProviders && Array.isArray(providers.customProviders)) {
                return providers.customProviders.find((p: any) => p.id === currentProvider);
            }

            return null;
        })();

        if (!providerConfig) {
            return false;
        }

        const modelConfig = providerConfig.models?.find((m: any) => m.id === currentModelId);
        // 只有当模型支持思考能力时，才返回 thinkingEnabled 的值
        return modelConfig?.capabilities?.thinking ? modelConfig.thinkingEnabled || false : false;
    })();

    // 是否显示思考模式按钮（只有支持思考的模型才显示）
    $: showThinkingToggle = (() => {
        if (!currentProvider || !currentModelId) {
            return false;
        }

        const providerConfig = (() => {
            const customProvider = settings.aiProviders?.customProviders?.find(
                (p: any) => p.id === currentProvider
            );
            if (customProvider) {
                return customProvider;
            }

            if (settings.aiProviders?.[currentProvider]) {
                return settings.aiProviders[currentProvider];
            }

            if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
                return providers[currentProvider];
            }

            if (providers.customProviders && Array.isArray(providers.customProviders)) {
                return providers.customProviders.find((p: any) => p.id === currentProvider);
            }

            return null;
        })();

        if (!providerConfig) {
            return false;
        }

        const modelConfig = providerConfig.models?.find((m: any) => m.id === currentModelId);
        return modelConfig?.capabilities?.thinking || false;
    })();

    // 是否显示思考程度选择器（只有 Gemini 和 Claude 模型在启用思考模式时才显示）
    $: showThinkingEffortSelector = (() => {
        if (!isThinkingModeEnabled || !currentModelId) {
            return false;
        }
        // 检查是否是支持思考程度设置的模型（Gemini 或 Claude）
        return (
            isSupportedThinkingGeminiModel(currentModelId) ||
            isSupportedThinkingClaudeModel(currentModelId)
        );
    })();

    // 当前模型是否是 Gemini 模型（用于决定是否显示"默认"选项）
    $: isCurrentModelGemini = currentModelId
        ? isSupportedThinkingGeminiModel(currentModelId)
        : false;

    // 当前思考程度设置
    $: currentThinkingEffort = (() => {
        if (!currentProvider || !currentModelId) {
            return 'medium' as ThinkingEffort;
        }

        const providerConfig = (() => {
            const customProvider = settings.aiProviders?.customProviders?.find(
                (p: any) => p.id === currentProvider
            );
            if (customProvider) {
                return customProvider;
            }

            if (settings.aiProviders?.[currentProvider]) {
                return settings.aiProviders[currentProvider];
            }

            if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
                return providers[currentProvider];
            }

            if (providers.customProviders && Array.isArray(providers.customProviders)) {
                return providers.customProviders.find((p: any) => p.id === currentProvider);
            }

            return null;
        })();

        if (!providerConfig) {
            return 'medium' as ThinkingEffort;
        }

        const modelConfig = providerConfig.models?.find((m: any) => m.id === currentModelId);
        return (modelConfig?.thinkingEffort || 'medium') as ThinkingEffort;
    })();

    // 更新思考程度
    async function updateThinkingEffort(effort: ThinkingEffort) {
        if (!currentProvider || !currentModelId) {
            return;
        }

        const modelConfig = getCurrentModelConfig();
        if (!modelConfig) {
            return;
        }

        modelConfig.thinkingEffort = effort;

        // 获取提供商配置
        const providerConfig = getCurrentProviderConfig();
        if (!providerConfig) {
            return;
        }

        // 找到模型在数组中的索引并更新
        const modelIndex = providerConfig.models.findIndex((m: any) => m.id === currentModelId);
        if (modelIndex !== -1) {
            providerConfig.models[modelIndex] = { ...modelConfig };
            providerConfig.models = [...providerConfig.models];
        }

        // 更新 settings 并保存
        const isCustomProvider =
            settings.aiProviders.customProviders?.some((p: any) => p.id === currentProvider) ||
            false;

        if (isCustomProvider) {
            const customProviders = settings.aiProviders.customProviders || [];
            const customProviderIndex = customProviders.findIndex(
                (p: any) => p.id === currentProvider
            );
            if (customProviderIndex !== -1) {
                customProviders[customProviderIndex] = { ...providerConfig };
                settings = {
                    ...settings,
                    aiProviders: {
                        ...settings.aiProviders,
                        customProviders: [...customProviders],
                    },
                };
            }
        } else {
            settings = {
                ...settings,
                aiProviders: {
                    ...settings.aiProviders,
                    [currentProvider]: providerConfig,
                },
            };
        }

        providers = {
            ...providers,
            [currentProvider]: providerConfig,
        };

        await plugin.saveSettings(settings);
    }

    // 处理思考程度选择器变化
    function handleThinkingEffortChange(event: Event) {
        const target = event.currentTarget as HTMLSelectElement;
        updateThinkingEffort(target.value as ThinkingEffort);
    }

    // 切换思考模式
    async function toggleThinkingMode() {
        if (!currentProvider || !currentModelId) {
            return;
        }

        const modelConfig = getCurrentModelConfig();
        if (!modelConfig) {
            return;
        }

        // 确保 capabilities 对象存在
        if (!modelConfig.capabilities) {
            modelConfig.capabilities = {};
        }

        // 只有当模型支持思考能力时，才能切换
        if (!modelConfig.capabilities.thinking) {
            return;
        }

        // 切换思考模式启用状态
        modelConfig.thinkingEnabled = !modelConfig.thinkingEnabled;

        // 获取提供商配置
        const providerConfig = getCurrentProviderConfig();
        if (!providerConfig) {
            return;
        }

        // 找到模型在数组中的索引并更新
        const modelIndex = providerConfig.models.findIndex((m: any) => m.id === currentModelId);
        if (modelIndex !== -1) {
            providerConfig.models[modelIndex] = { ...modelConfig };
            providerConfig.models = [...providerConfig.models];
        }

        // 更新 settings 并保存
        // 检查是否是自定义平台（通过检查 customProviders 数组）
        const isCustomProvider =
            settings.aiProviders.customProviders?.some((p: any) => p.id === currentProvider) ||
            false;

        if (isCustomProvider) {
            // 自定义平台：更新 customProviders 数组
            const customProviders = settings.aiProviders.customProviders || [];
            const customProviderIndex = customProviders.findIndex(
                (p: any) => p.id === currentProvider
            );
            if (customProviderIndex !== -1) {
                customProviders[customProviderIndex] = { ...providerConfig };
                settings = {
                    ...settings,
                    aiProviders: {
                        ...settings.aiProviders,
                        customProviders: [...customProviders],
                    },
                };
            }
        } else {
            // 内置平台：直接更新
            settings = {
                ...settings,
                aiProviders: {
                    ...settings.aiProviders,
                    [currentProvider]: providerConfig,
                },
            };
        }

        // 更新 providers 对象以触发响应式更新
        providers = {
            ...providers,
            [currentProvider]: providerConfig,
        };

        // 保存设置（settings 已经在上面更新过了）
        await plugin.saveSettings(settings);
    }

    // 获取指定提供商和模型的配置
    function getProviderAndModelConfig(provider: string, modelId: string) {
        let providerConfig: any = null;

        // 检查是否是内置平台
        if (providers[provider] && !Array.isArray(providers[provider])) {
            providerConfig = providers[provider];
        } else if (providers.customProviders && Array.isArray(providers.customProviders)) {
            // 检查是否是自定义平台
            providerConfig = providers.customProviders.find((p: any) => p.id === provider);
        }

        if (!providerConfig) return null;

        const modelConfig = providerConfig.models.find((m: any) => m.id === modelId);
        return { providerConfig, modelConfig };
    }

    // 多模型发送消息
    async function sendMultiModelMessage() {
        // 保存用户输入和附件
        const userContent = currentInput.trim();
        const userAttachments = [...currentAttachments];
        const userContextDocuments = [...contextDocuments];

        // 获取所有上下文文档的最新内容
        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        if (userContextDocuments.length > 0) {
            for (const doc of userContextDocuments) {
                try {
                    const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                    if (data && data.content) {
                        contextDocumentsWithLatestContent.push({
                            id: doc.id,
                            title: doc.title,
                            content: data.content,
                            type: doc.type,
                        });
                    } else {
                        contextDocumentsWithLatestContent.push(doc);
                    }
                } catch (error) {
                    console.error(`Failed to get latest content for block ${doc.id}:`, error);
                    contextDocumentsWithLatestContent.push(doc);
                }
            }
        }

        // 创建用户消息
        const userMessage: Message = {
            role: 'user',
            content: userContent,
            attachments: userAttachments.length > 0 ? userAttachments : undefined,
            contextDocuments:
                contextDocumentsWithLatestContent.length > 0
                    ? contextDocumentsWithLatestContent
                    : undefined,
        };

        messages = [...messages, userMessage];
        currentInput = '';
        currentAttachments = [];
        contextDocuments = [];
        isLoading = true;
        isWaitingForAnswerSelection = true;
        hasUnsavedChanges = true;
        autoScroll = true;
        isAborted = false; // 重置中断标志

        // 如果是第一条用户消息且没有会话ID，立即创建会话
        const userMessages = messages.filter(m => m.role === 'user');
        if (userMessages.length === 1 && !currentSessionId) {
            const now = Date.now();
            const newSession: ChatSession = {
                id: `session_${now}`,
                title: generateSessionTitle(),
                messages: [...messages],
                createdAt: now,
                updatedAt: now,
            };
            sessions = [newSession, ...sessions];
            currentSessionId = newSession.id;
            await saveSessions();

            // 立即执行自动重命名
            autoRenameSession(userContent);
        }

        await scrollToBottom(true);

        // 准备消息数组（包含上下文）
        const messagesToSend = prepareMessagesForAI(
            messages,
            contextDocumentsWithLatestContent,
            userContent,
            userMessage
        );

        // 初始化多模型响应数组
        multiModelResponses = selectedMultiModels.map(model => {
            const config = getProviderAndModelConfig(model.provider, model.modelId);
            return {
                provider: model.provider,
                modelId: model.modelId,
                modelName: config?.modelConfig?.name || model.modelId,
                content: '',
                thinking: '',
                isLoading: true,
                thinkingCollapsed: false,
                thinkingEnabled: config?.modelConfig?.thinkingEnabled || false,
            };
        });

        // 创建新的 AbortController
        abortController = new AbortController();

        // 并发请求所有模型
        const promises = selectedMultiModels.map(async (model, index) => {
            const config = getProviderAndModelConfig(model.provider, model.modelId);
            if (!config) return;

            const { providerConfig, modelConfig } = config;
            if (!providerConfig.apiKey) return;

            // 解析自定义参数
            let customBody = {};
            if (modelConfig.customBody) {
                try {
                    customBody = JSON.parse(modelConfig.customBody);
                } catch (e) {
                    console.error('Failed to parse custom body:', e);
                    multiModelResponses[index].error = '自定义参数 JSON 格式错误';
                    multiModelResponses[index].isLoading = false;
                    multiModelResponses = [...multiModelResponses];
                    return;
                }
            }

            try {
                let fullText = '';
                let thinking = '';

                await chat(
                    model.provider,
                    {
                        apiKey: providerConfig.apiKey,
                        model: modelConfig.id,
                        messages: messagesToSend,
                        temperature: tempModelSettings.temperature,
                        maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                        stream: true,
                        signal: abortController.signal,
                        enableThinking:
                            modelConfig.capabilities?.thinking &&
                            (modelConfig.thinkingEnabled || false),
                        reasoningEffort: modelConfig.thinkingEffort || 'medium',
                        customBody, // 传递自定义参数
                        onThinkingChunk: async (chunk: string) => {
                            thinking += chunk;
                            if (multiModelResponses[index]) {
                                multiModelResponses[index].thinking = thinking;
                                multiModelResponses = [...multiModelResponses];
                            }
                        },
                        onThinkingComplete: () => {
                            if (multiModelResponses[index] && multiModelResponses[index].thinking) {
                                multiModelResponses[index].thinkingCollapsed = true;
                                multiModelResponses = [...multiModelResponses];
                            }
                        },
                        onChunk: async (chunk: string) => {
                            fullText += chunk;
                            if (multiModelResponses[index]) {
                                multiModelResponses[index].content = fullText;
                                multiModelResponses = [...multiModelResponses];
                            }
                        },
                        onComplete: async (text: string) => {
                            // 如果已经中断，不再处理完成回调
                            if (isAborted) {
                                return;
                            }
                            if (multiModelResponses[index]) {
                                multiModelResponses[index].content = convertLatexToMarkdown(text);
                                multiModelResponses[index].thinking = thinking;
                                multiModelResponses[index].isLoading = false;
                                if (thinking && !multiModelResponses[index].thinkingCollapsed) {
                                    multiModelResponses[index].thinkingCollapsed = true;
                                }
                                multiModelResponses = [...multiModelResponses];
                            }
                        },
                        onError: (error: Error) => {
                            // 如果是主动中断，不显示错误
                            if (error.message !== 'Request aborted' && multiModelResponses[index]) {
                                multiModelResponses[index].error = error.message;
                                multiModelResponses[index].isLoading = false;
                                multiModelResponses = [...multiModelResponses];
                            }
                        },
                    },
                    providerConfig.customApiUrl,
                    providerConfig.advancedConfig
                );
            } catch (error) {
                // 如果是主动中断，不显示错误
                if ((error as Error).message !== 'Request aborted' && multiModelResponses[index]) {
                    multiModelResponses[index].error = (error as Error).message;
                    multiModelResponses[index].isLoading = false;
                    multiModelResponses = [...multiModelResponses];
                }
            }
        });

        // 等待所有请求完成
        await Promise.all(promises);

        isLoading = false;
        abortController = null;
    }

    // 准备发送给AI的消息（提取为独立函数以便复用）
    function prepareMessagesForAI(
        messages: Message[],
        contextDocumentsWithLatestContent: ContextDocument[],
        userContent: string,
        lastUserMessage: Message
    ) {
        // 过滤掉空的 assistant 消息，防止某些 Provider（例如 Kimi）报错
        let messagesToSend = messages
            .filter(msg => {
                if (msg.role === 'system') return false;
                if (msg.role === 'assistant') {
                    const text =
                        typeof msg.content === 'string'
                            ? msg.content
                            : getMessageText(msg.content || []);
                    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
                    const hasReasoning = !!msg.reasoning_content;
                    // 保留有 tool_calls 或 reasoning_content 的 assistant 消息，即便正文为空
                    return (text && text.toString().trim() !== '') || hasToolCalls || hasReasoning;
                }
                return true;
            })
            .map((msg, index, array) => {
                const baseMsg: any = {
                    role: msg.role,
                    content: msg.content,
                };

                const isLastMessage = index === array.length - 1;
                if (
                    !isLastMessage &&
                    msg.role === 'user' &&
                    msg.contextDocuments &&
                    msg.contextDocuments.length > 0
                ) {
                    const hasImages = msg.attachments?.some(att => att.type === 'image');
                    const originalContent =
                        typeof msg.content === 'string' ? msg.content : getMessageText(msg.content);

                    const contextText = msg.contextDocuments
                        .map(doc => {
                            const label = doc.type === 'doc' ? '文档' : '块';

                            // agent模式：文档块只传递ID，不传递内容
                            if (chatMode === 'agent' && doc.type === 'doc') {
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                            }

                            // 其他情况：传递完整内容
                            if (doc.content) {
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                            } else {
                                // 如果没有内容（agent模式下的文档），只传递ID
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                            }
                        })
                        .join('\n\n---\n\n');

                    if (hasImages) {
                        const contentParts: any[] = [];
                        let textContent = originalContent;
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                        contentParts.push({ type: 'text', text: textContent });

                        msg.attachments?.forEach(att => {
                            if (att.type === 'image') {
                                contentParts.push({
                                    type: 'image_url',
                                    image_url: { url: att.data },
                                });
                            }
                        });

                        const fileTexts = msg.attachments
                            ?.filter(att => att.type === 'file')
                            .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                            .join('\n\n---\n\n');

                        if (fileTexts) {
                            contentParts.push({
                                type: 'text',
                                text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                            });
                        }

                        baseMsg.content = contentParts;
                    } else {
                        let enhancedContent = originalContent;

                        if (msg.attachments && msg.attachments.length > 0) {
                            const attachmentTexts = msg.attachments
                                .map(att => {
                                    if (att.type === 'file') {
                                        return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                    }
                                    return '';
                                })
                                .filter(Boolean)
                                .join('\n\n---\n\n');

                            if (attachmentTexts) {
                                enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                            }
                        }

                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                        baseMsg.content = enhancedContent;
                    }
                }

                return baseMsg;
            });

        // 处理最后一条用户消息
        if (messagesToSend.length > 0) {
            const lastMessage = messagesToSend[messagesToSend.length - 1];
            if (lastMessage.role === 'user') {
                const hasImages = lastUserMessage.attachments?.some(att => att.type === 'image');

                if (hasImages) {
                    const contentParts: any[] = [];
                    let textContent = userContent;

                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';

                                // agent模式：文档块只传递ID，不传递内容
                                if (chatMode === 'agent' && doc.type === 'doc') {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }

                                // 其他情况：传递完整内容
                                if (doc.content) {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                                } else {
                                    // 如果没有内容（agent模式下的文档），只传递ID
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }
                            })
                            .join('\n\n---\n\n');
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    contentParts.push({ type: 'text', text: textContent });

                    lastUserMessage.attachments?.forEach(att => {
                        if (att.type === 'image') {
                            contentParts.push({
                                type: 'image_url',
                                image_url: { url: att.data },
                            });
                        }
                    });

                    const fileTexts = lastUserMessage.attachments
                        ?.filter(att => att.type === 'file')
                        .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                        .join('\n\n---\n\n');

                    if (fileTexts) {
                        contentParts.push({
                            type: 'text',
                            text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                        });
                    }

                    lastMessage.content = contentParts;
                } else {
                    let enhancedContent = userContent;

                    if (lastUserMessage.attachments && lastUserMessage.attachments.length > 0) {
                        const attachmentTexts = lastUserMessage.attachments
                            .map(att => {
                                if (att.type === 'file') {
                                    return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                }
                                return '';
                            })
                            .filter(Boolean)
                            .join('\n\n---\n\n');

                        if (attachmentTexts) {
                            enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                        }
                    }

                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';

                                // agent模式：文档块只传递ID，不传递内容
                                if (chatMode === 'agent' && doc.type === 'doc') {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }

                                // 其他情况：传递完整内容
                                if (doc.content) {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                                } else {
                                    // 如果没有内容（agent模式下的文档），只传递ID
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }
                            })
                            .join('\n\n---\n\n');
                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    lastMessage.content = enhancedContent;
                }
            }
        }

        // 添加系统提示词
        if (settings.aiSystemPrompt) {
            messagesToSend.unshift({ role: 'system', content: settings.aiSystemPrompt });
        }

        // 使用临时系统提示词（如果设置了）
        if (tempModelSettings.systemPrompt.trim()) {
            // 如果已有系统提示词，替换它；否则添加新的
            const systemMsgIndex = messagesToSend.findIndex(msg => msg.role === 'system');
            if (systemMsgIndex !== -1) {
                messagesToSend[systemMsgIndex].content = tempModelSettings.systemPrompt;
            } else {
                messagesToSend.unshift({ role: 'system', content: tempModelSettings.systemPrompt });
            }
        }

        // 限制上下文消息数量
        const systemMessages = messagesToSend.filter(msg => msg.role === 'system');
        const otherMessages = messagesToSend.filter(msg => msg.role !== 'system');
        const limitedMessages = otherMessages.slice(-tempModelSettings.contextCount);

        // 建立 tool_call_id => tool 消息的索引，便于补全被截断的链条
        const toolResultById = new Map<string, Message>();
        for (const msg of otherMessages) {
            if (msg.role === 'tool' && msg.tool_call_id) {
                toolResultById.set(msg.tool_call_id, msg);
            }
        }

        const limitedMessagesWithToolFix: Message[] = [];
        const includedToolCallIds = new Set<string>();

        for (const msg of limitedMessages) {
            if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                // 先推入 assistant
                limitedMessagesWithToolFix.push(msg);

                // 紧跟补全每一个 tool_call 的结果，保持顺序
                for (const tc of msg.tool_calls) {
                    const toolMsg = toolResultById.get(tc.id);
                    if (toolMsg && !includedToolCallIds.has(tc.id)) {
                        limitedMessagesWithToolFix.push(toolMsg);
                        includedToolCallIds.add(tc.id);
                    }
                }
                continue;
            }

            if (msg.role === 'tool') {
                // 仅在前一条是对应的 assistant 且未加入过时保留，避免孤立 tool
                const prev = limitedMessagesWithToolFix[limitedMessagesWithToolFix.length - 1];
                if (
                    prev &&
                    prev.role === 'assistant' &&
                    prev.tool_calls?.some(tc => tc.id === msg.tool_call_id) &&
                    msg.tool_call_id &&
                    !includedToolCallIds.has(msg.tool_call_id)
                ) {
                    limitedMessagesWithToolFix.push(msg);
                    includedToolCallIds.add(msg.tool_call_id);
                }
                continue;
            }

            // 其他消息正常保留
            limitedMessagesWithToolFix.push(msg);
        }

        messagesToSend = [...systemMessages, ...limitedMessagesWithToolFix];

        return messagesToSend;
    }

    // 选择多模型答案
    function selectMultiModelAnswer(index: number) {
        const selectedResponse = multiModelResponses[index];
        if (!selectedResponse || selectedResponse.isLoading) return;

        // 设置布局为页签样式
        multiModelLayout = 'tab';

        // 创建assistant消息，包含多模型完整结果
        const assistantMessage: Message = {
            role: 'assistant',
            content: selectedResponse.content, // 设置为选择的答案内容，以便连续对话时包含上下文
            thinking: selectedResponse.thinking || '', // 保存思考内容
            multiModelResponses: multiModelResponses.map((response, i) => ({
                ...response,
                isSelected: i === index, // 标记哪个被选择,
                modelName: i === index ? ' ✅' + response.modelName : response.modelName, // 选择的模型名添加✅
            })),
        };

        messages = [...messages, assistantMessage];

        // 清除多模型状态
        multiModelResponses = [];
        isWaitingForAnswerSelection = false;
        selectedAnswerIndex = null;
        hasUnsavedChanges = true;

        // 自动保存会话
        saveCurrentSession(true);

        // 根据选择的AI回答自动重命名会话标题
        autoRenameSession(selectedResponse.content);
    }

    // 自动重命名会话
    async function autoRenameSession(content: string) {
        // 检查是否启用自动重命名
        if (!settings.autoRenameSession) {
            console.log('Auto-rename disabled');
            return;
        }

        // 检查是否配置了重命名模型
        if (!settings.autoRenameProvider || !settings.autoRenameModelId) {
            console.log('Auto-rename model not configured');
            return;
        }

        // 获取重命名模型配置
        const config = getProviderAndModelConfig(
            settings.autoRenameProvider,
            settings.autoRenameModelId
        );
        if (!config) {
            console.log('Auto-rename model config not found');
            return;
        }

        const { providerConfig, modelConfig } = config;
        if (!providerConfig.apiKey) {
            console.log('Auto-rename model API key not configured');
            return;
        }

        console.log('Starting auto-rename for session:', currentSessionId);

        try {
            // 使用自定义提示词模板，替换 {message} 占位符
            const promptTemplate =
                settings.autoRenamePrompt ||
                '请根据以下内容生成一个简洁的会话标题（不超过20个字，不要使用引号）：\n\n{message}';
            const prompt = promptTemplate.replace('{message}', content);

            let generatedTitle = '';

            // 调用AI生成标题
            await chat(
                settings.autoRenameProvider,
                {
                    apiKey: providerConfig.apiKey,
                    model: modelConfig.id,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    maxTokens: 50,
                    stream: true,
                    onChunk: async (chunk: string) => {
                        generatedTitle += chunk;
                    },
                    onComplete: async (text: string) => {
                        // 清理生成的标题（移除引号和多余空格）
                        const cleanTitle = text
                            .trim()
                            .replace(/^["']|["']$/g, '')
                            .substring(0, 50);
                        if (cleanTitle && currentSessionId) {
                            // 直接更新当前会话的标题（不重新加载，避免覆盖刚创建的会话）
                            const session = sessions.find(s => s.id === currentSessionId);
                            if (session) {
                                session.title = cleanTitle;
                                sessions = [...sessions];
                                await saveSessions();
                                console.log('Auto-renamed session to:', cleanTitle);
                            } else {
                                console.error(
                                    'Session not found for auto-rename:',
                                    currentSessionId
                                );
                            }
                        } else {
                            console.log(
                                'Auto-rename failed: cleanTitle=',
                                cleanTitle,
                                'currentSessionId=',
                                currentSessionId
                            );
                        }
                    },
                    onError: (error: Error) => {
                        console.error('Auto-rename session failed:', error);
                        // 静默失败，不影响用户体验
                    },
                },
                providerConfig.customApiUrl,
                providerConfig.advancedConfig
            );
        } catch (error) {
            console.error('Auto-rename session error:', error);
            // 静默失败
        }
    }

    // 发送消息
    async function sendMessage() {
        if ((!currentInput.trim() && currentAttachments.length === 0) || isLoading) return;

        // 如果处于等待选择答案状态，阻止发送
        if (isWaitingForAnswerSelection) {
            pushErrMsg(t('multiModel.waitingSelection'));
            return;
        }

        // 检查设置
        const providerConfig = getCurrentProviderConfig();
        if (!providerConfig) {
            pushErrMsg(t('aiSidebar.errors.noProvider'));
            return;
        }

        if (!providerConfig.apiKey) {
            pushErrMsg(t('aiSidebar.errors.noApiKey'));
            return;
        }

        const modelConfig = getCurrentModelConfig();
        if (!modelConfig) {
            pushErrMsg(t('aiSidebar.errors.noModel'));
            return;
        }

        // 解析自定义参数
        let customBody = {};
        if (modelConfig.customBody) {
            try {
                customBody = JSON.parse(modelConfig.customBody);
            } catch (e) {
                console.error('Failed to parse custom body:', e);
                pushErrMsg('自定义参数 JSON 格式错误');
                return;
            }
        }

        // 如果启用了多模型模式且在问答模式
        if (enableMultiModel && chatMode === 'ask' && selectedMultiModels.length > 0) {
            await sendMultiModelMessage();
            return;
        }

        // 获取所有上下文文档的最新内容
        // ask模式：使用 exportMdContent 获取 Markdown 格式
        // edit模式：使用 getBlockKramdown 获取 kramdown 格式（包含块ID信息）
        // agent模式：文档块只传递ID，普通块获取kramdown
        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        if (contextDocuments.length > 0) {
            for (const doc of contextDocuments) {
                try {
                    let content: string;

                    if (chatMode === 'agent') {
                        // agent模式：文档只传递ID，块获取kramdown
                        if (doc.type === 'doc') {
                            // 文档块只传递ID，不需要获取内容
                            content = '';
                        } else {
                            // 普通块获取kramdown格式
                            const blockData = await getBlockKramdown(doc.id);
                            if (blockData && blockData.kramdown) {
                                content = blockData.kramdown;
                            } else {
                                // 降级使用缓存内容
                                content = doc.content;
                            }
                        }
                    } else if (chatMode === 'edit') {
                        // 编辑模式：获取kramdown格式，保留块ID结构
                        const blockData = await getBlockKramdown(doc.id);
                        if (blockData && blockData.kramdown) {
                            content = blockData.kramdown;
                        } else {
                            // 降级使用缓存内容
                            content = doc.content;
                        }
                    } else {
                        // ask模式：获取Markdown格式
                        const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                        if (data && data.content) {
                            content = data.content;
                        } else {
                            // 降级使用缓存内容
                            content = doc.content;
                        }
                    }

                    contextDocumentsWithLatestContent.push({
                        id: doc.id,
                        title: doc.title,
                        content: content,
                        type: doc.type, // 保留类型信息
                    });
                } catch (error) {
                    console.error(`Failed to get latest content for block ${doc.id}:`, error);
                    // 出错时使用缓存的内容
                    contextDocumentsWithLatestContent.push(doc);
                }
            }
        }

        // 用户消息只保存原始输入（不包含文档内容）
        const userContent = currentInput.trim();

        const userMessage: Message = {
            role: 'user',
            content: userContent,
            attachments: currentAttachments.length > 0 ? [...currentAttachments] : undefined,
            contextDocuments:
                contextDocumentsWithLatestContent.length > 0
                    ? [...contextDocumentsWithLatestContent]
                    : undefined,
        };

        messages = [...messages, userMessage];
        currentInput = '';
        currentAttachments = [];
        contextDocuments = []; // 发送后清空全局上下文
        isLoading = true;
        isAborted = false; // 重置中断标志
        streamingMessage = '';
        streamingThinking = '';
        isThinkingPhase = false;
        hasUnsavedChanges = true;
        autoScroll = true; // 发送新消息时启用自动滚动

        // 如果是第一条用户消息且没有会话ID，立即创建会话
        const userMessages = messages.filter(m => m.role === 'user');
        if (userMessages.length === 1 && !currentSessionId) {
            const now = Date.now();
            const newSession: ChatSession = {
                id: `session_${now}`,
                title: generateSessionTitle(),
                messages: [...messages],
                createdAt: now,
                updatedAt: now,
            };
            sessions = [newSession, ...sessions];
            currentSessionId = newSession.id;
            await saveSessions();

            // 立即执行自动重命名
            autoRenameSession(userContent);
        }

        await scrollToBottom(true);

        // DeepSeek 思考模式：开启新一轮对话前清理历史消息中的 reasoning_content，保留工具调用链
        if (chatMode === 'agent' && currentProvider === 'deepseek') {
            messages = messages.map(msg => {
                if (msg.role === 'assistant' && msg.reasoning_content) {
                    const { reasoning_content, ...rest } = msg as any;
                    return rest as Message;
                }
                return msg;
            });
        }

        const isDeepseekThinkingAgent =
            chatMode === 'agent' &&
            currentProvider === 'deepseek' &&
            modelConfig.capabilities?.thinking &&
            (modelConfig.thinkingEnabled || false);

        // 准备发送给AI的消息（包含系统提示词和上下文文档）
        // 深拷贝消息数组，避免修改原始消息
        // 保留工具调用相关字段（如果存在），以便在 Agent 模式下正确处理历史工具调用
        // 过滤掉空的 assistant 消息，防止部分 Provider（例如 Kimi）返回错误
        let messagesToSend = messages
            .filter(msg => {
                if (msg.role === 'system') return false;
                if (msg.role === 'assistant') {
                    const text =
                        typeof msg.content === 'string'
                            ? msg.content
                            : getMessageText(msg.content || []);
                    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
                    const hasReasoning = !!msg.reasoning_content;
                    // 保留有 tool_calls 或 reasoning_content 的 assistant 消息，即便正文为空
                    return (text && text.toString().trim() !== '') || hasToolCalls || hasReasoning;
                }
                return true;
            })
            .map((msg, index, array) => {
                const baseMsg: any = {
                    role: msg.role,
                    content: msg.content,
                };

                // 只在字段存在时才包含，避免传递 undefined 字段给 API
                if (msg.tool_calls) {
                    baseMsg.tool_calls = msg.tool_calls;
                }
                if (msg.tool_call_id) {
                    baseMsg.tool_call_id = msg.tool_call_id;
                    baseMsg.name = msg.name;
                }

                if (isDeepseekThinkingAgent && msg.reasoning_content) {
                    baseMsg.reasoning_content = msg.reasoning_content;
                }

                // 只处理历史用户消息的上下文（不是最后一条消息）
                // 最后一条消息将在后面用最新内容处理
                const isLastMessage = index === array.length - 1;
                if (
                    !isLastMessage &&
                    msg.role === 'user' &&
                    msg.contextDocuments &&
                    msg.contextDocuments.length > 0
                ) {
                    const hasImages = msg.attachments?.some(att => att.type === 'image');

                    // 获取原始消息内容
                    const originalContent =
                        typeof msg.content === 'string' ? msg.content : getMessageText(msg.content);

                    // 构建上下文文本（agent模式下，文档块只传递ID）
                    const contextText = msg.contextDocuments
                        .map(doc => {
                            const label = doc.type === 'doc' ? '文档' : '块';

                            // agent模式：文档块只传递ID，不传递内容
                            if (chatMode === 'agent' && doc.type === 'doc') {
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                            }

                            // 其他情况：传递完整内容
                            if (doc.content) {
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                            } else {
                                // 如果没有内容（agent模式下的文档），只传递ID
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                            }
                        })
                        .join('\n\n---\n\n');

                    // 如果有图片附件，使用多模态格式
                    if (hasImages) {
                        const contentParts: any[] = [];

                        // 添加文本内容和上下文
                        let textContent = originalContent;
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                        contentParts.push({ type: 'text', text: textContent });

                        // 添加图片
                        msg.attachments?.forEach(att => {
                            if (att.type === 'image') {
                                contentParts.push({
                                    type: 'image_url',
                                    image_url: { url: att.data },
                                });
                            }
                        });

                        // 添加文本文件内容
                        const fileTexts = msg.attachments
                            ?.filter(att => att.type === 'file')
                            .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                            .join('\n\n---\n\n');

                        if (fileTexts) {
                            contentParts.push({
                                type: 'text',
                                text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                            });
                        }

                        baseMsg.content = contentParts;
                    } else {
                        // 纯文本格式
                        let enhancedContent = originalContent;

                        // 添加文本文件附件
                        if (msg.attachments && msg.attachments.length > 0) {
                            const attachmentTexts = msg.attachments
                                .map(att => {
                                    if (att.type === 'file') {
                                        return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                    }
                                    return '';
                                })
                                .filter(Boolean)
                                .join('\n\n---\n\n');

                            if (attachmentTexts) {
                                enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                            }
                        }

                        // 添加上下文文档
                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;

                        baseMsg.content = enhancedContent;
                    }
                }

                return baseMsg;
            });

        // 处理最后一条用户消息，添加附件和上下文文档
        if (messagesToSend.length > 0) {
            const lastMessage = messagesToSend[messagesToSend.length - 1];
            if (lastMessage.role === 'user') {
                const lastUserMessage = messages[messages.length - 1];
                const hasImages = lastUserMessage.attachments?.some(att => att.type === 'image');

                // 如果有图片附件，使用多模态格式
                if (hasImages) {
                    const contentParts: any[] = [];

                    // 先添加用户输入
                    let textContent = userContent;

                    // 然后添加上下文文档（如果有）
                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';

                                // agent模式：文档块只传递ID，不传递内容
                                if (chatMode === 'agent' && doc.type === 'doc') {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }

                                // 其他情况：传递完整内容
                                if (doc.content) {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                                } else {
                                    // 如果没有内容（agent模式下的文档），只传递ID
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }
                            })
                            .join('\n\n---\n\n');
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    contentParts.push({ type: 'text', text: textContent });

                    // 添加图片
                    lastUserMessage.attachments?.forEach(att => {
                        if (att.type === 'image') {
                            contentParts.push({
                                type: 'image_url',
                                image_url: { url: att.data },
                            });
                        }
                    });

                    // 添加文本文件内容
                    const fileTexts = lastUserMessage.attachments
                        ?.filter(att => att.type === 'file')
                        .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                        .join('\n\n---\n\n');

                    if (fileTexts) {
                        contentParts.push({
                            type: 'text',
                            text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                        });
                    }

                    lastMessage.content = contentParts;
                } else {
                    // 纯文本格式
                    let enhancedContent = userContent;

                    // 添加文本文件附件
                    if (lastUserMessage.attachments && lastUserMessage.attachments.length > 0) {
                        const attachmentTexts = lastUserMessage.attachments
                            .map(att => {
                                if (att.type === 'file') {
                                    return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                }
                                return '';
                            })
                            .filter(Boolean)
                            .join('\n\n---\n\n');

                        if (attachmentTexts) {
                            enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                        }
                    }

                    // 添加上下文文档
                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';

                                // agent模式：文档块只传递ID，不传递内容
                                if (chatMode === 'agent' && doc.type === 'doc') {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }

                                // 其他情况：传递完整内容
                                if (doc.content) {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                                } else {
                                    // 如果没有内容（agent模式下的文档），只传递ID
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }
                            })
                            .join('\n\n---\n\n');
                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    lastMessage.content = enhancedContent;
                }
            }
        }

        // 根据模式添加系统提示词
        if (chatMode === 'edit') {
            // 编辑模式的特殊系统提示词
            const editModePrompt = `你是一个专业的笔记编辑助手。当用户要求修改内容时，你必须返回JSON格式的编辑指令。

**关于上下文格式**：
用户提供的上下文将以以下格式呈现：

## 文档: 文档标题
或
## 块: 块内容预览

**BlockID**: \`20240101120000-abc123\`

\`\`\`markdown
这里是kramdown格式的内容，包含块ID信息：
段落内容
{: id="20240101120100-def456"}

* 列表项
  {: id="20240101120200-ghi789"}
\`\`\`

**关于BlockID和kramdown格式**：
- **顶层BlockID**：位于 \`\`\`markdown 代码块之前，格式为 **BlockID**: \`xxxxxxxxxx-xxxxxxx\`
- **子块ID标记**：在markdown代码块内，格式为 {: id="20240101120100-def456"}
- 段落块会有 {: id="..."} 标记
- 列表项会有 {: id="..."} 标记  
- 标题、代码块等各种块都有ID标记

你可以编辑任何包含ID标记的块，包括：
- 顶层文档/块（使用代码块外的BlockID）
- 文档内的任何子块（使用代码块内的 {: id="xxx"}）

**提取BlockID的方法**：
- 从 **BlockID**: \`xxxxx\` 获取顶层块ID
- 从 {: id="xxxxx"} 获取子块ID
- BlockID格式通常为：时间戳-字符串，如 20240101120000-abc123

编辑指令格式（必须严格遵循）：
\`\`\`json
{
  "editOperations": [
    {
      "operationType": "update",  // 操作类型："update"=更新块（默认），"insert"=插入新块
      "blockId": "要编辑的块ID（可以是顶层块或子块的ID）",
      "newContent": "修改后的内容（kramdown格式，保留必要的ID标记）"
    },
    {
      "operationType": "insert",  // 插入新块
      "blockId": "参考块的ID（在此块前后插入）",
      "position": "after",  // "before"=在参考块之前插入，"after"=在参考块之后插入（默认）
      "newContent": "新插入的内容（kramdown格式）"
    }
  ]
}
\`\`\`

重要规则：
1. **必须返回JSON格式**：使用上述JSON结构，包裹在 \`\`\`json 代码块中
2. **blockId 必须来自上下文**：从 [BlockID: xxx] 或 {: id="xxx"} 中提取
3. **可以编辑任何有ID的块**：不限于顶层块，子块也可以精确编辑
4. **可以插入新块**：使用 operationType: "insert" 在指定块前后插入新内容
5. **newContent格式**：应该是kramdown格式，如果编辑子块，内容要包含该块的ID标记；插入新块时不需要ID标记
6. **可以批量编辑**：在 editOperations 数组中包含多个编辑操作
7. 思源笔记kramdown格式如果要添加颜色：应该是<span data-type="text">添加颜色的文字1</span>{: style="color: var(--b3-font-color1);"}，优先使用以下颜色变量：
  - --b3-font-color1: 红色
  - --b3-font-color2: 橙色
  - --b3-font-color3: 蓝色
  - --b3-font-color4: 绿色
  - --b3-font-color5: 灰色
8. **添加说明**：在JSON代码块之外，添加文字说明你的修改

示例1 - 编辑顶层块：
好的，我会帮你改进这段内容：

\`\`\`json
{
  "editOperations": [
    {
      "operationType": "update",
      "blockId": "20240101120000-abc123",
      "newContent": "这是修改后的整个文档内容\\n{: id=\\"20240101120000-abc123\\"}"
    }
  ]
}
\`\`\`

示例2 - 编辑子块（推荐）：
我会针对性地修改第二段和第三个列表项：

\`\`\`json
{
  "editOperations": [
    {
      "operationType": "update",
      "blockId": "20240101120100-def456",
      "newContent": "这是修改后的第二段内容，表达更专业。\\n{: id=\\"20240101120100-def456\\"}"
    },
    {
      "operationType": "update",
      "blockId": "20240101120200-ghi789",
      "newContent": "* 这是修改后的列表项\\n  {: id=\\"20240101120200-ghi789\\"}"
    }
  ]
}
\`\`\`

我针对需要改进的具体段落和列表项进行了精确修改。

示例3 - 插入新块：
我会在第二段后面插入一段补充说明：

\`\`\`json
{
  "editOperations": [
    {
      "operationType": "insert",
      "blockId": "20240101120100-def456",
      "position": "after",
      "newContent": "这是新插入的补充段落，提供更多细节信息。"
    }
  ]
}
\`\`\`

我在指定的段落后面添加了补充内容。

示例4 - 混合操作：
我会修改第一段并在其后插入新内容：

\`\`\`json
{
  "editOperations": [
    {
      "operationType": "update",
      "blockId": "20240101120100-def456",
      "newContent": "这是修改后的段落内容。\\n{: id=\\"20240101120100-def456\\"}"
    },
    {
      "operationType": "insert",
      "blockId": "20240101120100-def456",
      "position": "after",
      "newContent": "这是紧跟在修改段落后的新增内容。"
    }
  ]
}
\`\`\`

我修改了原段落并在其后添加了补充信息。

注意：
- 优先编辑子块而不是整个文档，这样更精确且不会影响其他内容
- 只有在用户明确要求修改内容时才返回JSON编辑指令
- 如果只是回答问题，则正常回复即可，不要返回JSON
- 确保JSON格式正确，可以被解析
- 确保blockId来自上下文中的ID标记（**BlockID**: \`xxx\` 或 {: id="xxx"}）
- newContent应保留kramdown的ID标记
- **重要**：newContent中只包含修改后的正文内容，不要包含"## 文档"、"## 块"或"**BlockID**:"这样的上下文标识，这些只是用于你理解上下文的`;

            // 先添加用户的系统提示词（如果有）
            if (settings.aiSystemPrompt) {
                messagesToSend.unshift({ role: 'system', content: settings.aiSystemPrompt });
            }
            // 再添加编辑模式的提示词
            messagesToSend.unshift({ role: 'system', content: editModePrompt });
        } else if (settings.aiSystemPrompt) {
            messagesToSend.unshift({ role: 'system', content: settings.aiSystemPrompt });
        }

        // 使用临时系统提示词（如果设置了）
        if (tempModelSettings.systemPrompt.trim()) {
            // 如果已有系统提示词，替换它；否则添加新的
            const systemMsgIndex = messagesToSend.findIndex(msg => msg.role === 'system');
            if (systemMsgIndex !== -1) {
                messagesToSend[systemMsgIndex].content = tempModelSettings.systemPrompt;
            } else {
                messagesToSend.unshift({ role: 'system', content: tempModelSettings.systemPrompt });
            }
        }

        // 限制上下文消息数量
        const systemMessages = messagesToSend.filter(msg => msg.role === 'system');
        const otherMessages = messagesToSend.filter(msg => msg.role !== 'system');
        const limitedMessages = otherMessages.slice(-tempModelSettings.contextCount);

        // 建立 tool_call_id => tool 消息的索引，便于补全被截断的链条
        const toolResultById = new Map<string, Message>();
        for (const msg of otherMessages) {
            if (msg.role === 'tool' && msg.tool_call_id) {
                toolResultById.set(msg.tool_call_id, msg);
            }
        }

        const limitedMessagesWithToolFix: Message[] = [];
        const includedToolCallIds = new Set<string>();

        for (const msg of limitedMessages) {
            if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                // 先推入 assistant
                limitedMessagesWithToolFix.push(msg);

                // 紧跟补全每一个 tool_call 的结果，保持顺序
                for (const tc of msg.tool_calls) {
                    const toolMsg = toolResultById.get(tc.id);
                    if (toolMsg && !includedToolCallIds.has(tc.id)) {
                        limitedMessagesWithToolFix.push(toolMsg);
                        includedToolCallIds.add(tc.id);
                    }
                }
                continue;
            }

            if (msg.role === 'tool') {
                // 仅在前一条是对应的 assistant 且未加入过时保留，避免孤立 tool
                const prev = limitedMessagesWithToolFix[limitedMessagesWithToolFix.length - 1];
                if (
                    prev &&
                    prev.role === 'assistant' &&
                    prev.tool_calls?.some(tc => tc.id === msg.tool_call_id) &&
                    msg.tool_call_id &&
                    !includedToolCallIds.has(msg.tool_call_id)
                ) {
                    limitedMessagesWithToolFix.push(msg);
                    includedToolCallIds.add(msg.tool_call_id);
                }
                continue;
            }

            // 其他消息正常保留
            limitedMessagesWithToolFix.push(msg);
        }

        messagesToSend = [...systemMessages, ...limitedMessagesWithToolFix];

        // 创建新的 AbortController
        abortController = new AbortController();

        try {
            // 检查是否启用思考模式
            const enableThinking =
                modelConfig.capabilities?.thinking && (modelConfig.thinkingEnabled || false);

            // 准备 Agent 模式的工具列表
            let toolsForAgent: any[] | undefined = undefined;
            if (chatMode === 'agent' && selectedTools.length > 0) {
                // 根据选中的工具名称筛选出对应的工具定义
                toolsForAgent = AVAILABLE_TOOLS.filter(tool =>
                    selectedTools.some(t => t.name === tool.function.name)
                );
            }

            // Agent 模式使用循环调用
            if (chatMode === 'agent' && toolsForAgent && toolsForAgent.length > 0) {
                let shouldContinue = true;
                // 记录第一次工具调用后创建的assistant消息索引
                let firstToolCallMessageIndex: number | null = null;

                while (shouldContinue && !abortController.signal.aborted) {
                    // 标记是否收到工具调用
                    let receivedToolCalls = false;
                    // 用于等待工具执行完成的 Promise
                    let toolExecutionComplete: (() => void) | null = null;
                    const toolExecutionPromise = new Promise<void>(resolve => {
                        toolExecutionComplete = resolve;
                    });

                    await chat(
                        currentProvider,
                        {
                            apiKey: providerConfig.apiKey,
                            model: modelConfig.id,
                            messages: messagesToSend,
                            temperature: tempModelSettings.temperatureEnabled
                                ? tempModelSettings.temperature
                                : undefined,
                            maxTokens:
                                modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                            stream: true,
                            signal: abortController.signal,
                            enableThinking,
                            reasoningEffort: modelConfig.thinkingEffort || 'medium',
                            tools: toolsForAgent,
                            customBody, // 传递自定义参数
                            onThinkingChunk: enableThinking
                                ? async (chunk: string) => {
                                      isThinkingPhase = true;
                                      streamingThinking += chunk;
                                      await scrollToBottom();
                                  }
                                : undefined,
                            onThinkingComplete: enableThinking
                                ? (thinking: string) => {
                                      isThinkingPhase = false;
                                      thinkingCollapsed = {
                                          ...thinkingCollapsed,
                                          [messages.length]: true,
                                      };
                                  }
                                : undefined,
                            onToolCallComplete: async (toolCalls: ToolCall[]) => {
                                console.log('Tool calls received:', toolCalls);
                                receivedToolCalls = true;

                                // 如果是第一次工具调用，创建新的assistant消息
                                if (firstToolCallMessageIndex === null) {
                                    const assistantMessage: Message = {
                                        role: 'assistant',
                                        content: streamingMessage || '',
                                        tool_calls: toolCalls,
                                    };

                                    if (isDeepseekThinkingAgent && streamingThinking) {
                                        assistantMessage.reasoning_content = streamingThinking;
                                        assistantMessage.thinking = streamingThinking;
                                    }
                                    messages = [...messages, assistantMessage];
                                    firstToolCallMessageIndex = messages.length - 1;
                                } else {
                                    // 如果不是第一次，更新现有消息的tool_calls（合并工具调用）
                                    const existingMessage = messages[firstToolCallMessageIndex];
                                    existingMessage.tool_calls = [
                                        ...(existingMessage.tool_calls || []),
                                        ...toolCalls,
                                    ];

                                    if (isDeepseekThinkingAgent && streamingThinking) {
                                        existingMessage.reasoning_content = streamingThinking;
                                        existingMessage.thinking = streamingThinking;
                                    }
                                    messages = [...messages];
                                }
                                streamingMessage = '';

                                // 处理每个工具调用
                                for (const toolCall of toolCalls) {
                                    const toolConfig = selectedTools.find(
                                        t => t.name === toolCall.function.name
                                    );
                                    const autoApprove = toolConfig?.autoApprove || false;

                                    try {
                                        let toolResult: string;

                                        if (autoApprove) {
                                            // 自动批准：直接执行工具
                                            console.log(
                                                `Auto-approving tool call: ${toolCall.function.name}`
                                            );
                                            toolResult = await executeToolCall(toolCall);

                                            // 添加工具结果消息
                                            const toolResultMessage: Message = {
                                                role: 'tool',
                                                tool_call_id: toolCall.id,
                                                name: toolCall.function.name,
                                                content: toolResult,
                                            };
                                            messages = [...messages, toolResultMessage];
                                        } else {
                                            // 需要手动批准：显示批准对话框
                                            console.log(
                                                `Tool call requires approval: ${toolCall.function.name}`
                                            );

                                            // 显示批准对话框
                                            pendingToolCall = toolCall;
                                            isToolApprovalDialogOpen = true;

                                            // 等待用户批准或拒绝
                                            const approved = await new Promise<boolean>(resolve => {
                                                // 临时保存 resolve 函数
                                                (window as any).__toolApprovalResolve = resolve;
                                            });

                                            if (approved) {
                                                toolResult = await executeToolCall(toolCall);

                                                // 添加工具结果消息
                                                const toolResultMessage: Message = {
                                                    role: 'tool',
                                                    tool_call_id: toolCall.id,
                                                    name: toolCall.function.name,
                                                    content: toolResult,
                                                };
                                                messages = [...messages, toolResultMessage];
                                            } else {
                                                // 用户拒绝
                                                const toolResultMessage: Message = {
                                                    role: 'tool',
                                                    tool_call_id: toolCall.id,
                                                    name: toolCall.function.name,
                                                    content: `用户拒绝执行工具 ${toolCall.function.name}`,
                                                };
                                                messages = [...messages, toolResultMessage];
                                            }
                                        }
                                    } catch (error) {
                                        console.error(
                                            `Tool execution failed: ${toolCall.function.name}`,
                                            error
                                        );
                                        const errorMessage: Message = {
                                            role: 'tool',
                                            tool_call_id: toolCall.id,
                                            name: toolCall.function.name,
                                            content: `工具执行失败: ${(error as Error).message}`,
                                        };
                                        messages = [...messages, errorMessage];
                                    }
                                }

                                hasUnsavedChanges = true;

                                // 更新 messagesToSend，准备下一次循环
                                // 只在字段存在时才包含，避免传递 undefined 字段给 API
                                messagesToSend = messages.map(msg => {
                                    const baseMsg: any = {
                                        role: msg.role,
                                        content: msg.content,
                                    };

                                    // 只在有工具调用相关字段时才包含
                                    if (msg.tool_calls) {
                                        baseMsg.tool_calls = msg.tool_calls;
                                    }
                                    if (msg.tool_call_id) {
                                        baseMsg.tool_call_id = msg.tool_call_id;
                                        baseMsg.name = msg.name;
                                    }

                                    if (isDeepseekThinkingAgent && msg.reasoning_content) {
                                        baseMsg.reasoning_content = msg.reasoning_content;
                                    }

                                    return baseMsg;
                                });

                                // 通知工具执行完成
                                toolExecutionComplete?.();
                            },
                            onChunk: async (chunk: string) => {
                                streamingMessage += chunk;
                                await scrollToBottom();
                            },
                            onComplete: async (fullText: string) => {
                                // 如果已经中断，不再添加消息（避免重复）
                                if (isAborted) {
                                    shouldContinue = false;
                                    toolExecutionComplete?.();
                                    return;
                                }

                                // 如果没有收到工具调用，说明对话结束
                                if (!receivedToolCalls) {
                                    shouldContinue = false;

                                    const convertedText = convertLatexToMarkdown(fullText);

                                    // 如果之前有工具调用，将最终回复存储到 finalReply 字段
                                    if (
                                        firstToolCallMessageIndex !== null &&
                                        convertedText.trim()
                                    ) {
                                        const existingMessage = messages[firstToolCallMessageIndex];
                                        // 将AI的最终回复存储到 finalReply 字段
                                        existingMessage.finalReply = convertedText;

                                        if (isDeepseekThinkingAgent && streamingThinking) {
                                            existingMessage.reasoning_content = streamingThinking;
                                        }

                                        // 添加思考内容（如果有）
                                        if (enableThinking && streamingThinking) {
                                            existingMessage.thinking = streamingThinking;
                                        }

                                        messages = [...messages];
                                    } else {
                                        // 如果没有工具调用，创建新的assistant消息
                                        const assistantMessage: Message = {
                                            role: 'assistant',
                                            content: convertedText,
                                        };

                                        if (enableThinking && streamingThinking) {
                                            assistantMessage.thinking = streamingThinking;
                                            if (isDeepseekThinkingAgent) {
                                                assistantMessage.reasoning_content =
                                                    streamingThinking;
                                            }
                                        }

                                        messages = [...messages, assistantMessage];
                                    }

                                    streamingMessage = '';
                                    streamingThinking = '';
                                    isThinkingPhase = false;
                                    isLoading = false;
                                    abortController = null;
                                    hasUnsavedChanges = true;

                                    await saveCurrentSession(true);

                                    // 通知完成（即使没有工具调用）
                                    toolExecutionComplete?.();
                                } else {
                                    // 如果有工具调用，onComplete 不做任何事，等待 onToolCallComplete 完成
                                    // 不调用 toolExecutionComplete，因为工具还在执行中
                                }
                            },
                            onError: (error: Error) => {
                                shouldContinue = false;
                                if (error.message !== 'Request aborted') {
                                    const errorMessage: Message = {
                                        role: 'assistant',
                                        content: `❌ **${t('aiSidebar.errors.requestFailed')}**\n\n${error.message}`,
                                    };
                                    messages = [...messages, errorMessage];
                                    hasUnsavedChanges = true;
                                }
                                isLoading = false;
                                streamingMessage = '';
                                streamingThinking = '';
                                isThinkingPhase = false;
                                abortController = null;

                                // 通知完成（错误时也要结束等待）
                                toolExecutionComplete?.();
                            },
                        },
                        providerConfig.customApiUrl,
                        providerConfig.advancedConfig
                    );

                    // 等待工具执行完成后再继续循环
                    await toolExecutionPromise;
                }
            } else {
                // 非 Agent 模式或没有工具，使用原来的逻辑
                await chat(
                    currentProvider,
                    {
                        apiKey: providerConfig.apiKey,
                        model: modelConfig.id,
                        messages: messagesToSend,
                        temperature: tempModelSettings.temperatureEnabled
                            ? tempModelSettings.temperature
                            : undefined,
                        maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                        stream: true,
                        signal: abortController.signal,
                        enableThinking,
                        reasoningEffort: modelConfig.thinkingEffort || 'medium',
                        customBody, // 传递自定义参数
                        onThinkingChunk: enableThinking
                            ? async (chunk: string) => {
                                  isThinkingPhase = true;
                                  streamingThinking += chunk;
                                  await scrollToBottom();
                              }
                            : undefined,
                        onThinkingComplete: enableThinking
                            ? (thinking: string) => {
                                  isThinkingPhase = false;
                                  thinkingCollapsed = {
                                      ...thinkingCollapsed,
                                      [messages.length]: true,
                                  };
                              }
                            : undefined,
                        onChunk: async (chunk: string) => {
                            streamingMessage += chunk;
                            await scrollToBottom();
                        },
                        onComplete: async (fullText: string) => {
                            // 如果已经中断，不再添加消息（避免重复）
                            if (isAborted) {
                                return;
                            }

                            // 转换 LaTeX 数学公式格式为 Markdown 格式
                            const convertedText = convertLatexToMarkdown(fullText);

                            const assistantMessage: Message = {
                                role: 'assistant',
                                content: convertedText,
                            };

                            // 如果有思考内容，添加到消息中
                            if (enableThinking && streamingThinking) {
                                assistantMessage.thinking = streamingThinking;
                            }

                            // 如果是编辑模式，解析编辑操作
                            if (chatMode === 'edit') {
                                const editOperations = parseEditOperations(convertedText);
                                if (editOperations.length > 0) {
                                    // 异步获取每个块的旧内容（kramdown格式和Markdown格式）
                                    for (const op of editOperations) {
                                        try {
                                            // 获取kramdown格式（用于应用编辑）
                                            const blockData = await getBlockKramdown(op.blockId);
                                            if (blockData && blockData.kramdown) {
                                                op.oldContent = blockData.kramdown;
                                            }

                                            // 获取Markdown格式（用于显示差异）
                                            const mdData = await exportMdContent(
                                                op.blockId,
                                                false,
                                                false,
                                                2,
                                                0,
                                                false
                                            );
                                            if (mdData && mdData.content) {
                                                op.oldContentForDisplay = mdData.content;
                                            }

                                            // 处理newContent用于显示（移除kramdown ID标记）
                                            op.newContentForDisplay = op.newContent
                                                .replace(/\{:\s*id="[^"]+"\s*\}/g, '')
                                                .trim();
                                        } catch (error) {
                                            console.error(`获取块 ${op.blockId} 内容失败:`, error);
                                        }
                                    }
                                    assistantMessage.editOperations = editOperations;

                                    // 如果启用了自动批准，则自动应用所有编辑操作
                                    if (autoApproveEdit) {
                                        messages = [...messages, assistantMessage];
                                        const currentMessageIndex = messages.length - 1;

                                        for (const op of editOperations) {
                                            await applyEditOperation(op, currentMessageIndex);
                                        }

                                        // 更新消息状态
                                        messages = [...messages];
                                    }
                                }
                            }

                            if (
                                !autoApproveEdit ||
                                chatMode !== 'edit' ||
                                !assistantMessage.editOperations?.length
                            ) {
                                messages = [...messages, assistantMessage];
                            }
                            streamingMessage = '';
                            streamingThinking = '';
                            isThinkingPhase = false;
                            isLoading = false;
                            abortController = null;
                            hasUnsavedChanges = true;

                            // AI 回复完成后，自动保存当前会话
                            await saveCurrentSession(true);

                            // 根据AI回答自动重命名会话标题（仅在非编辑模式下）
                            if (chatMode !== 'edit') {
                                autoRenameSession(convertedText);
                            }
                        },
                        onError: (error: Error) => {
                            // 如果是主动中断，不显示错误
                            if (error.message !== 'Request aborted') {
                                // 将错误消息作为一条 assistant 消息添加
                                const errorMessage: Message = {
                                    role: 'assistant',
                                    content: `❌ **${t('aiSidebar.errors.requestFailed')}**\n\n${error.message}`,
                                };
                                messages = [...messages, errorMessage];
                                hasUnsavedChanges = true;
                            }
                            isLoading = false;
                            streamingMessage = '';
                            streamingThinking = '';
                            isThinkingPhase = false;
                            abortController = null;
                        },
                    },
                    providerConfig.customApiUrl,
                    providerConfig.advancedConfig
                );
            }
        } catch (error) {
            console.error('Send message error:', error);
            // onError 回调已经处理了错误消息的添加，这里不需要重复添加
            // 只需要在 onError 没有被调用的情况下（比如网络错误导致的异常）清理状态
            if ((error as Error).name === 'AbortError') {
                // 中断错误已经在 abortMessage 中处理
            } else if (!isLoading) {
                // 如果 isLoading 已经是 false，说明 onError 已经被调用并处理了
                // 不需要做任何事情
            } else {
                // 如果 isLoading 还是 true，说明 onError 没有被调用
                // 这种情况下才需要添加错误消息（比如网络请求失败）
                const errorMessage: Message = {
                    role: 'assistant',
                    content: `❌ **${t('aiSidebar.errors.requestFailed')}**\n\n${(error as Error).message}`,
                };
                messages = [...messages, errorMessage];
                hasUnsavedChanges = true;
                isLoading = false;
                streamingMessage = '';
                streamingThinking = '';
                isThinkingPhase = false;
            }
            abortController = null;
        }
    }

    // 中断消息生成
    function abortMessage() {
        if (abortController) {
            abortController.abort();
            isAborted = true; // 设置中断标志，防止 onComplete 再次添加消息

            // 如果是多模型模式且正在等待选择答案
            if (isWaitingForAnswerSelection && multiModelResponses.length > 0) {
                // 找到第一个成功的响应作为默认选择
                const firstSuccessIndex = multiModelResponses.findIndex(
                    r => !r.error && !r.isLoading
                );

                if (firstSuccessIndex !== -1) {
                    const selectedResponse = multiModelResponses[firstSuccessIndex];
                    const assistantMessage: Message = {
                        role: 'assistant',
                        content: selectedResponse.content || '',
                        thinking: selectedResponse.thinking,
                        multiModelResponses: multiModelResponses.map((response, i) => ({
                            ...response,
                            isSelected: i === firstSuccessIndex,
                            modelName:
                                i === firstSuccessIndex
                                    ? ' ✅' + response.modelName
                                    : response.modelName, // 选择的模型名添加✅
                        })),
                    };

                    messages = [...messages, assistantMessage];
                    hasUnsavedChanges = true;
                }

                // 清除多模型状态
                multiModelResponses = [];
                isWaitingForAnswerSelection = false;
                selectedAnswerIndex = null;
                selectedTabIndex = 0;
                isLoading = false;
                abortController = null;
                return;
            }

            // 单模型模式：如果有已生成的部分，将其保存为消息
            if (streamingMessage || streamingThinking) {
                // 先保存到临时变量
                const tempStreamingMessage = streamingMessage;
                const tempStreamingThinking = streamingThinking;

                // 立即清空流式消息和状态，避免重复渲染
                streamingMessage = '';
                streamingThinking = '';
                isThinkingPhase = false;
                isLoading = false;

                // 转换 LaTeX 数学公式格式为 Markdown 格式
                const convertedMessage = convertLatexToMarkdown(tempStreamingMessage);

                const message: Message = {
                    role: 'assistant',
                    content: convertedMessage + '\n\n' + t('aiSidebar.messages.interrupted'),
                };
                if (tempStreamingThinking) {
                    message.thinking = tempStreamingThinking;
                }
                messages = [...messages, message];
                hasUnsavedChanges = true;
            } else {
                streamingMessage = '';
                streamingThinking = '';
                isThinkingPhase = false;
                isLoading = false;
            }
            abortController = null;
        }
    }

    // 复制对话为Markdown
    function copyAsMarkdown() {
        const markdown = messages
            .filter(msg => msg.role !== 'system')
            .map(msg => {
                const role = msg.role === 'user' ? '👤 **User**' : '🤖 **Assistant**';
                // 获取实际内容（包括多模型响应）
                const content = getActualMessageContent(msg);
                return `${role}\n\n${content}\n`;
            })
            .join('\n---\n\n');

        navigator.clipboard
            .writeText(markdown)
            .then(() => {
                pushMsg(t('aiSidebar.success.copyMarkdownSuccess'));
            })
            .catch(err => {
                pushErrMsg(t('aiSidebar.errors.copyFailed'));
                console.error('Copy failed:', err);
            });
    }

    // 清空对话
    function clearChat() {
        // 如果消息正在生成，先中断
        if (isLoading && abortController) {
            abortMessage();
        }

        // 如果有未选择的多模型响应，先保存它们
        if (isWaitingForAnswerSelection && multiModelResponses.length > 0) {
            const firstSuccessIndex = multiModelResponses.findIndex(r => !r.error && !r.isLoading);

            if (firstSuccessIndex !== -1) {
                const selectedResponse = multiModelResponses[firstSuccessIndex];
                const assistantMessage: Message = {
                    role: 'assistant',
                    content: selectedResponse.content || '',
                    thinking: selectedResponse.thinking,
                    multiModelResponses: multiModelResponses.map((response, i) => ({
                        ...response,
                        isSelected: i === firstSuccessIndex,
                        modelName:
                            i === firstSuccessIndex
                                ? ' ✅' + response.modelName
                                : response.modelName, // 选择的模型名添加✅
                    })),
                };

                messages = [...messages, assistantMessage];
                hasUnsavedChanges = true;
            }
        }

        if (hasUnsavedChanges && messages.filter(m => m.role !== 'system').length > 0) {
            confirm(
                t('aiSidebar.confirm.clearChat.title'),
                t('aiSidebar.confirm.clearChat.message'),
                () => {
                    doClearChat();
                }
            );
        } else {
            doClearChat();
        }
    }

    function doClearChat() {
        messages = settings.aiSystemPrompt
            ? [{ role: 'system', content: settings.aiSystemPrompt }]
            : [];
        contextDocuments = [];
        streamingMessage = '';
        streamingThinking = '';
        isThinkingPhase = false;
        thinkingCollapsed = {};
        currentSessionId = '';
        hasUnsavedChanges = false;

        // 清除多模型状态
        multiModelResponses = [];
        isWaitingForAnswerSelection = false;
        selectedAnswerIndex = null;
        selectedTabIndex = 0;

        pushMsg(t('aiSidebar.success.clearSuccess'));
    }

    // 处理键盘事件
    function handleKeydown(e: KeyboardEvent) {
        const sendMode = settings.sendMessageShortcut || 'ctrl+enter';

        if (sendMode === 'ctrl+enter') {
            // Ctrl+Enter 发送模式
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                if (isLoading) {
                    abortMessage();
                } else {
                    sendMessage();
                }
                return;
            }
        } else {
            // Enter 发送模式（Shift+Enter 换行）
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (isLoading) {
                    abortMessage();
                } else {
                    sendMessage();
                }
                return;
            }
        }
    }

    // 使用思源内置的Lute渲染markdown为HTML
    // 将消息内容转换为字符串
    function getMessageText(content: string | MessageContent[]): string {
        if (typeof content === 'string') {
            return content;
        }
        // 对于多模态内容，只提取文本部分
        return content
            .filter(part => part.type === 'text' && part.text)
            .map(part => part.text)
            .join('\n');
    }

    // 获取消息的实际内容（处理多模型响应）
    function getActualMessageContent(message: Message): string {
        // 如果有多模型响应，返回被选中的模型的内容
        if (message.multiModelResponses && message.multiModelResponses.length > 0) {
            const selectedResponse = message.multiModelResponses.find(r => r.isSelected);
            if (selectedResponse && selectedResponse.content) {
                return getMessageText(selectedResponse.content);
            }
            // 如果没有选中的，返回第一个有内容的
            const firstWithContent = message.multiModelResponses.find(r => r.content);
            if (firstWithContent) {
                return getMessageText(firstWithContent.content);
            }
        }
        // 否则返回常规内容
        return getMessageText(message.content);
    }

    // 将 LaTeX 数学公式格式转换为 Markdown 格式（永久转换）
    function convertLatexToMarkdown(text: string): string {
        // 将 LaTeX 块级数学公式 \[...\] 转换为 $$...$$
        text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula) => {
            const trimmedFormula = formula.trim();
            return `\n\n$$\n${trimmedFormula}\n$$\n\n`;
        });

        // 将 LaTeX 行内数学公式 \(...\) 转换为 $...$
        text = text.replace(/\\\((.*?)\\\)/g, (_match, formula) => {
            return `$${formula}$`;
        });

        return text;
    }

    function formatMessage(content: string | MessageContent[]): string {
        let textContent = getMessageText(content);

        try {
            // 检查window.Lute是否存在
            if (typeof window !== 'undefined' && (window as any).Lute) {
                const lute = (window as any).Lute.New();
                // 使用Md2HTML将markdown转换为HTML，而不是Md2BlockDOM
                // Md2HTML不会生成带data-node-id的块级结构，可以正常跨块选择文本
                const html = lute.Md2HTML(textContent);
                return html;
            }
            // 如果Lute不可用，回退到简单渲染
            return textContent
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                .replace(
                    /```(\w+)?\n([\s\S]*?)```/g,
                    '<pre><code class="language-$1">$2</code></pre>'
                )
                .replace(/\n/g, '<br>');
        } catch (error) {
            console.error('Format message error:', error);
            return textContent;
        }
    }

    // 高亮代码块
    function highlightCodeBlocks(element: HTMLElement) {
        if (!element) return;

        // 使用 tick 确保 DOM 已更新
        tick().then(async () => {
            try {
                // 确保 highlight.js 已加载
                if (!(window as any).hljs) {
                    const loaded = await initHljs();
                    if (!loaded) {
                        console.error('Failed to initialize highlight.js');
                        return;
                    }
                }

                const hljs = (window as any).hljs;

                // 处理思源的代码块结构: div.hljs > div[contenteditable]
                const siyuanCodeBlocks = element.querySelectorAll(
                    'pre > code:not([data-highlighted])'
                );
                siyuanCodeBlocks.forEach((block: HTMLElement) => {
                    // 检查是否已经高亮过（通过检查是否有 hljs 的高亮 class）
                    if (block.querySelector('.hljs-keyword, .hljs-string, .hljs-comment')) {
                        return;
                    }

                    try {
                        const code = block.textContent || '';
                        const parent = block.parentElement as HTMLElement;

                        // 尝试从父元素获取语言信息
                        let language = '';
                        const langAttr =
                            parent.getAttribute('data-node-id') ||
                            parent.getAttribute('data-subtype');

                        // 自动检测语言并高亮
                        let highlighted;
                        if (language) {
                            highlighted = hljs.highlight(code, { language, ignoreIllegals: true });
                            block.classList.add('hljs');
                        } else {
                            highlighted = hljs.highlightAuto(code);
                            block.classList.add('hljs');
                        }
                        block.classList.add('hljs');
                        // 将高亮后的 HTML 设置到 contenteditable 元素中
                        block.innerHTML = highlighted.value;

                        // 标记已处理，添加一个自定义属性
                        block.setAttribute('data-highlighted', 'true');
                    } catch (error) {
                        console.error('Highlight siyuan code block error:', error);
                    }
                });

                // 处理标准的 pre > code 结构（作为后备）
                const standardCodeBlocks = element.querySelectorAll(
                    'pre > code:not([data-highlighted])'
                );
                standardCodeBlocks.forEach((block: HTMLElement) => {
                    if (block.querySelector('.hljs-keyword, .hljs-string, .hljs-comment')) {
                        return;
                    }
                    try {
                        // 尝试从 class 中获取 language
                        let language = '';
                        const codeClass = block.className || '';
                        const match = codeClass.match(/(?:^|\s)language-([a-zA-Z0-9_-]+)/);
                        if (match && match[1]) {
                            language = match[1];
                        }
                        let highlighted;
                        // 如果指定了语言且可识别，使用 hljs.highlight
                        console.log(language);
                        if (language) {
                            const code = block.textContent || '';
                            hljs.highlight(code, {
                                language,
                                ignoreIllegals: true,
                            });
                            block.innerHTML = highlighted.value;
                            block.classList.add('hljs');
                        } else {
                            // 否则使用 highlightElement（自动检测）
                            highlighted = hljs.highlightAuto(block);
                            block.innerHTML = highlighted.value;
                            block.classList.add('hljs');
                        }
                        block.setAttribute('data-highlighted', 'true');
                        if (language) block.setAttribute('data-language', language);
                    } catch (error) {
                        console.error('Highlight standard code block error:', error);
                    }
                });
            } catch (error) {
                console.error('Highlight code blocks error:', error);
            }
        });
    }

    // 初始化 KaTeX
    export const initKatex = async () => {
        if (window.katex) return true;
        // https://github.com/siyuan-note/siyuan/blob/master/app/src/protyle/render/mathRender.ts
        const cdn = Constants.PROTYLE_CDN;
        addStyle(`${cdn}/js/katex/katex.min.css`, 'protyleKatexStyle');
        await addScript(`${cdn}/js/katex/katex.min.js`, 'protyleKatexScript');
        return window.katex !== undefined && window.katex !== null;
    };

    // 初始化 highlight.js
    export const initHljs = async () => {
        if ((window as any).hljs) return;

        const setCodeTheme = (cdn = Constants.PROTYLE_CDN) => {
            const protyleHljsStyle = document.getElementById('protyleHljsStyle') as HTMLLinkElement;
            let css;
            if ((window as any).siyuan.config.appearance.mode === 0) {
                css = (window as any).siyuan.config.appearance.codeBlockThemeLight;
                if (!Constants.SIYUAN_CONFIG_APPEARANCE_LIGHT_CODE.includes(css)) {
                    css = 'default';
                }
            } else {
                css = (window as any).siyuan.config.appearance.codeBlockThemeDark;
                if (!Constants.SIYUAN_CONFIG_APPEARANCE_DARK_CODE.includes(css)) {
                    css = 'github-dark';
                }
            }
            const href = `${cdn}/js/highlight.js/styles/${css}.min.css`;
            if (!protyleHljsStyle) {
                addStyle(href, 'protyleHljsStyle');
            } else if (!protyleHljsStyle.href.includes(href)) {
                protyleHljsStyle.remove();
                addStyle(href, 'protyleHljsStyle');
            }
        };

        const cdn = Constants.PROTYLE_CDN;
        setCodeTheme(cdn);
        await addScript(`${cdn}/js/highlight.js/highlight.min.js`, 'protyleHljsScript');
        await addScript(`${cdn}/js/highlight.js/third-languages.js`, 'protyleHljsThirdScript');
        return (window as any).hljs !== undefined && (window as any).hljs !== null;
    };

    // 辅助：添加样式链接
    const addStyle = (href: string, id: string) => {
        if (document.getElementById(id)) return;
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    };

    // https://github.com/siyuan-note/siyuan/blob/master/app/src/protyle/util/addScript.ts
    export const addScript = (path: string, id: string) => {
        return new Promise(resolve => {
            if (document.getElementById(id)) {
                // 脚本加载后再次调用直接返回
                resolve(false);
                return false;
            }
            const scriptElement = document.createElement('script');
            scriptElement.src = path;
            scriptElement.async = true;
            // 循环调用时 Chrome 不会重复请求 js
            document.head.appendChild(scriptElement);
            scriptElement.onload = () => {
                if (document.getElementById(id)) {
                    // 循环调用需清除 DOM 中的 script 标签
                    scriptElement.remove();
                    resolve(false);
                    return false;
                }
                scriptElement.id = id;
                resolve(true);
            };
        });
    };

    // 渲染单个数学公式块
    function renderMathBlock(element: HTMLElement) {
        try {
            const formula = element.textContent || '';
            if (!formula.trim()) {
                return;
            }

            const isBlock = element.tagName.toUpperCase() === 'DIV';

            // 使用 KaTeX 渲染公式
            const katex = (window as any).katex;
            const html = katex.renderToString(formula, {
                throwOnError: false, // 发生错误时不抛出异常
                displayMode: isBlock, // 使用显示模式（居中显示）
                strict: (errorCode: string) =>
                    errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn',
                trust: true,
            });

            // 清空原始内容并插入渲染后的内容
            element.innerHTML = html;

            // 标记已渲染
            element.setAttribute('data-math-rendered', 'true');
        } catch (error) {
            console.error('Error rendering math formula:', error);
            element.innerHTML = `<span style="color: red;">公式渲染错误</span>`;
            element.setAttribute('data-math-rendered', 'true');
        }
    }

    // 渲染数学公式
    async function renderMathFormulas(element: HTMLElement) {
        if (!element) return;

        // 使用 tick 确保 DOM 已更新
        await tick();

        try {
            // 确保 KaTeX 已加载
            if (!(window as any).katex) {
                const loaded = await initKatex();
                if (!loaded) {
                    console.error('Failed to initialize KaTeX');
                    return;
                }
            }

            const katex = (window as any).katex;

            // 处理新格式的行内数学公式 span.language-math
            const inlineMathElements = element.querySelectorAll(
                'span.language-math:not([data-math-rendered])'
            );

            inlineMathElements.forEach((mathElement: HTMLElement) => {
                try {
                    // 获取数学公式内容（从 textContent 获取）
                    const mathContent = mathElement.textContent?.trim();
                    if (mathContent) {
                        const html = katex.renderToString(mathContent, {
                            throwOnError: false,
                            displayMode: false,
                            strict: (errorCode: string) =>
                                errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn',
                            trust: true,
                        });
                        mathElement.innerHTML = html;
                        mathElement.setAttribute('data-math-rendered', 'true');
                    }
                } catch (error) {
                    console.error('Render inline math error:', error, mathElement);
                    mathElement.setAttribute('data-math-rendered', 'true');
                }
            });

            // 处理新格式的块级数学公式 div.language-math
            const blockMathElements = element.querySelectorAll(
                'div.language-math:not([data-math-rendered])'
            );

            blockMathElements.forEach((mathElement: HTMLElement) => {
                try {
                    // 获取数学公式内容（从 textContent 获取）
                    const mathContent = mathElement.textContent?.trim();
                    if (mathContent) {
                        const html = katex.renderToString(mathContent, {
                            throwOnError: false,
                            displayMode: true,
                            strict: (errorCode: string) =>
                                errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn',
                            trust: true,
                        });
                        mathElement.innerHTML = html;
                        mathElement.setAttribute('data-math-rendered', 'true');
                    }
                } catch (error) {
                    console.error('Render block math error:', error, mathElement);
                    mathElement.setAttribute('data-math-rendered', 'true');
                }
            });

            // 兼容旧格式：处理 Lute 渲染的数学公式元素（带 data-subtype="math" 属性）
            const oldMathElements = element.querySelectorAll(
                '[data-subtype="math"]:not([data-math-rendered])'
            );

            oldMathElements.forEach((mathElement: HTMLElement) => {
                try {
                    // 获取数学公式内容
                    const mathContent = mathElement.getAttribute('data-content');
                    if (!mathContent) {
                        return;
                    }

                    // 临时设置文本内容用于渲染
                    mathElement.textContent = mathContent;

                    // 渲染公式
                    renderMathBlock(mathElement);
                } catch (error) {
                    console.error('Render math formula error:', error, mathElement);
                    // 即使渲染失败也标记，避免重复尝试
                    mathElement.setAttribute('data-math-rendered', 'true');
                }
            });

            // 兼容旧格式：处理 span.katex
            const oldInlineMathElements = element.querySelectorAll(
                'span.katex:not([data-math-rendered])'
            );

            oldInlineMathElements.forEach((mathElement: HTMLElement) => {
                try {
                    const mathContent = mathElement.getAttribute('data-content');
                    if (mathContent) {
                        const html = katex.renderToString(mathContent, {
                            throwOnError: false,
                            displayMode: false,
                            strict: (errorCode: string) =>
                                errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn',
                            trust: true,
                        });
                        mathElement.innerHTML = html;
                        mathElement.setAttribute('data-math-rendered', 'true');
                    }
                } catch (error) {
                    console.error('Render inline math error:', error, mathElement);
                    mathElement.setAttribute('data-math-rendered', 'true');
                }
            });

            // 兼容旧格式：处理 div.katex
            const oldBlockMathElements = element.querySelectorAll(
                'div.katex:not([data-math-rendered])'
            );

            oldBlockMathElements.forEach((mathElement: HTMLElement) => {
                try {
                    const mathContent = mathElement.getAttribute('data-content');
                    if (mathContent) {
                        const html = katex.renderToString(mathContent, {
                            throwOnError: false,
                            displayMode: true,
                            strict: (errorCode: string) =>
                                errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn',
                            trust: true,
                        });
                        mathElement.innerHTML = html;
                        mathElement.setAttribute('data-math-rendered', 'true');
                    }
                } catch (error) {
                    console.error('Render block math error:', error, mathElement);
                    mathElement.setAttribute('data-math-rendered', 'true');
                }
            });
        } catch (error) {
            console.error('Render math formulas error:', error);
        }
    }

    // 清理代码块中不需要的元素并添加语言标签和复制按钮
    function cleanupCodeBlocks(element: HTMLElement) {
        if (!element) return;

        tick().then(() => {
            try {
                // 删除 .protyle-action__menu 元素
                const menuElements = element.querySelectorAll('.protyle-action__menu');
                menuElements.forEach((menu: HTMLElement) => {
                    menu.remove();
                });

                // 删除 .protyle-action__copy 元素上的 b3-tooltips__nw 和 b3-tooltips 类
                const copyButtons = element.querySelectorAll('.protyle-action__copy');
                copyButtons.forEach((btn: HTMLElement) => {
                    btn.classList.remove('b3-tooltips__nw', 'b3-tooltips');
                });

                // 为代码块添加语言标签和复制按钮
                const codeBlocks = element.querySelectorAll('pre > code');
                codeBlocks.forEach((codeElement: HTMLElement) => {
                    const pre = codeElement.parentElement;
                    if (!pre || pre.hasAttribute('data-lang-added')) return;

                    // 尝试从 data-language 或 class 中提取语言名称
                    let language = (codeElement.getAttribute('data-language') as string) || '';
                    if (!language) {
                        const classes = codeElement.className.split(' ');
                        for (const cls of classes) {
                            if (cls.startsWith('language-')) {
                                language = cls.replace('language-', '');
                                break;
                            }
                        }
                    }

                    // 标记已处理
                    pre.setAttribute('data-lang-added', 'true');

                    // 创建工具栏容器
                    const toolbar = document.createElement('div');
                    toolbar.className = 'code-block-toolbar';

                    // 只有当有语言时才创建语言标签
                    // 创建语言标签
                    const langLabel = document.createElement('div');
                    langLabel.className = 'code-block-lang-label';
                    langLabel.textContent = language;
                    toolbar.appendChild(langLabel);

                    // 创建复制按钮
                    const copyButton = document.createElement('button');
                    copyButton.className = 'code-block-copy-btn';
                    copyButton.innerHTML = '<svg><use xlink:href="#iconCopy"></use></svg>';
                    copyButton.title = '复制代码';

                    // 添加复制功能
                    copyButton.addEventListener('click', () => {
                        const code = codeElement.textContent || '';
                        navigator.clipboard
                            .writeText(code)
                            .then(() => {
                                // 显示复制成功提示
                                pushMsg('已复制');
                                // 更新按钮图标
                                copyButton.innerHTML =
                                    '<svg><use xlink:href="#iconCheck"></use></svg>';
                                copyButton.classList.add('copied');
                                setTimeout(() => {
                                    copyButton.innerHTML =
                                        '<svg><use xlink:href="#iconCopy"></use></svg>';
                                    copyButton.classList.remove('copied');
                                }, 2000);
                            })
                            .catch(err => {
                                console.error('Copy failed:', err);
                                pushErrMsg('复制失败');
                            });
                    });

                    // 组装工具栏
                    toolbar.appendChild(copyButton);

                    // 设置 pre 为相对定位
                    pre.style.position = 'relative';

                    // 将工具栏插入到 pre 的开头
                    pre.insertBefore(toolbar, pre.firstChild);
                });
            } catch (error) {
                console.error('Cleanup code blocks error:', error);
            }
        });
    }

    // 为思源块引用链接添加点击事件
    function setupBlockRefLinks(element: HTMLElement) {
        if (!element) return;

        tick().then(() => {
            try {
                // 查找所有思源块引用链接 a[href^="siyuan://blocks/"]
                const blockRefLinks = element.querySelectorAll('a[href^="siyuan://blocks/"]');

                blockRefLinks.forEach((link: HTMLElement) => {
                    // 检查是否已经添加过监听器
                    if (link.hasAttribute('data-block-ref-listener')) {
                        return;
                    }

                    // 标记已添加监听器
                    link.setAttribute('data-block-ref-listener', 'true');
                    link.style.cursor = 'pointer';

                    // 添加点击事件监听器
                    link.addEventListener('click', async (event: Event) => {
                        event.preventDefault();
                        event.stopPropagation();

                        const href = link.getAttribute('href');
                        if (!href) return;

                        // 提取块ID：siyuan://blocks/20251107164532-zmaydt9
                        const match = href.match(/siyuan:\/\/blocks\/(.+)/);
                        if (match && match[1]) {
                            const blockId = match[1];
                            try {
                                await openBlock(blockId);
                            } catch (error) {
                                console.error('Open block error:', error);
                                pushErrMsg(`打开块失败: ${(error as Error).message}`);
                            }
                        }
                    });
                });
            } catch (error) {
                console.error('Setup block ref links error:', error);
            }
        });
    }

    // 复制单条消息
    function copyMessage(content: string | MessageContent[]) {
        const textContent = typeof content === 'string' ? content : getMessageText(content);
        navigator.clipboard
            .writeText(textContent)
            .then(() => {
                pushMsg(t('aiSidebar.success.copySuccess'));
            })
            .catch(err => {
                pushErrMsg(t('aiSidebar.errors.copyFailed'));
                console.error('Copy failed:', err);
            });
    }

    // 处理复制事件，将选中的HTML内容转换为Markdown
    function handleCopyEvent(event: ClipboardEvent) {
        // 获取选区
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            return; // 没有选中内容，不处理
        }

        // 检查选区是否在消息容器内
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;

        // 只在插件本身的消息容器内处理复制，避免影响思源全局的复制行为。
        // messagesContainer 在组件中已被声明并用于渲染消息列表。
        // 我们要求选区既位于 messagesContainer 的子节点内，且在消息内容元素（.b3-typography）内。
        const messagesContainerEl = (messagesContainer as HTMLElement) || null;
        if (!messagesContainerEl) {
            // 没有消息容器引用，则不处理，保留默认复制行为
            return;
        }

        // 查找选区最近的元素节点起点
        let element: HTMLElement | null =
            container.nodeType === Node.ELEMENT_NODE
                ? (container as HTMLElement)
                : (container.parentElement as HTMLElement | null);

        let isInPluginContainer = false;
        let isInMessageContent = false;

        while (element) {
            if (element === messagesContainerEl) {
                isInPluginContainer = true;
            }
            if (element.classList && element.classList.contains('b3-typography')) {
                isInMessageContent = true;
            }
            // 如果同时满足在容器内且位于消息内容，则可处理
            if (isInPluginContainer && isInMessageContent) break;

            element = element.parentElement;
        }

        // 只有当选区在本插件的 messagesContainer 且在 .b3-typography 内，才处理转换
        if (!(isInPluginContainer && isInMessageContent)) {
            return;
        }

        // 阻止默认复制行为
        event.preventDefault();

        try {
            // 获取选中内容的HTML
            const div = document.createElement('div');
            div.appendChild(range.cloneContents());
            const html = div.innerHTML;

            // 检查选区是否包含代码块或 code 元素
            // 使用更可靠的方式：检查选区开始/结束节点的祖先是否包含 code/pre
            const startContainer = range.startContainer as Node | null;
            const endContainer = range.endContainer as Node | null;
            const startElem =
                startContainer && startContainer.nodeType === Node.ELEMENT_NODE
                    ? (startContainer as Element)
                    : (startContainer?.parentElement as Element | null);
            const endElem =
                endContainer && endContainer.nodeType === Node.ELEMENT_NODE
                    ? (endContainer as Element)
                    : (endContainer?.parentElement as Element | null);
            const ancestorContainsCode =
                !!startElem?.closest('pre') || !!endElem?.closest('pre, code');
            // 同时检查 cloneContents 中是否包含高亮器 span 或者 language class 等指示为代码的元素
            const hasHighlightedSpan = !!div.querySelector(
                '[class*="hljs-"], [class*="language-"], [data-language]'
            );
            const containsCodeBlock = ancestorContainsCode || hasHighlightedSpan;

            // 如果选区为代码块或包含高亮 / 具有典型代码特征（如下划线+括号/分号/=），认为是代码片段
            if (containsCodeBlock) {
                const text = selection.toString();
                event.clipboardData?.setData('text/plain', text);
            } else {
                // 使用思源的 Lute 将 HTML 转换为 Markdown
                if (window.Lute) {
                    const lute = window.Lute.New();
                    let markdown = lute.HTML2Md(html);

                    // 将Markdown写入剪贴板
                    event.clipboardData?.setData('text/plain', markdown);
                } else {
                    // 降级：如果Lute不可用，使用纯文本
                    const text = selection.toString();
                    event.clipboardData?.setData('text/plain', text);
                }
            }
        } catch (error) {
            console.error('Copy event handler error:', error);
            // 出错时使用默认行为（纯文本）
            const text = selection.toString();
            event.clipboardData?.setData('text/plain', text);
        }
    }

    // 处理消息框右键菜单
    function handleContextMenu(
        event: MouseEvent,
        messageIndex: number,
        messageType: 'user' | 'assistant',
        isMultiModel = false
    ) {
        event.preventDefault();
        event.stopPropagation();

        // 设置菜单位置
        contextMenuX = event.clientX;
        contextMenuY = event.clientY;
        contextMenuMessageIndex = messageIndex;
        contextMenuMessageType = messageType;
        contextMenuIsMultiModel = !!isMultiModel;
        // 判断当前是否有选区，且选区位于当前消息元素内
        try {
            const sel = window.getSelection();
            selectionInMessage = false;
            selectionHtml = '';
            selectionText = '';

            if (sel && !sel.isCollapsed) {
                const currentTarget = event.currentTarget as HTMLElement | null;
                if (currentTarget) {
                    const anchorNode = sel.anchorNode;
                    const focusNode = sel.focusNode;
                    if (anchorNode && focusNode) {
                        const anchorEl = (anchorNode as Node).parentElement;
                        const focusEl = (focusNode as Node).parentElement;
                        if (
                            anchorEl &&
                            focusEl &&
                            currentTarget.contains(anchorEl) &&
                            currentTarget.contains(focusEl)
                        ) {
                            selectionInMessage = true;
                            // 获取选区的 HTML
                            const range = sel.getRangeAt(0);
                            const div = document.createElement('div');
                            div.appendChild(range.cloneContents());
                            selectionHtml = div.innerHTML;
                            selectionText = sel.toString();
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Context menu selection detection failed:', err);
            selectionInMessage = false;
            selectionHtml = '';
            selectionText = '';
        }

        contextMenuVisible = true;
    }

    // 关闭右键菜单
    function closeContextMenu() {
        contextMenuVisible = false;
        contextMenuMessageIndex = null;
        contextMenuMessageType = null;
    }

    // 处理右键菜单项点击
    async function handleContextMenuAction(
        action:
            | 'copy'
            | 'copy_md'
            | 'copy_plain'
            | 'copy_html'
            | 'edit'
            | 'delete'
            | 'regenerate'
            | 'save'
    ) {
        if (contextMenuMessageIndex === null) return;

        const messageIndex = contextMenuMessageIndex;
        closeContextMenu();

        switch (action) {
            case 'copy': {
                // 旧行为：复制整条消息文本（或多模型整条响应）
                if (contextMenuIsMultiModel) {
                    try {
                        const el = document.elementFromPoint(
                            contextMenuX,
                            contextMenuY
                        ) as HTMLElement | null;
                        const container = el?.closest(
                            '.ai-sidebar__multi-model-card-content, .ai-sidebar__multi-model-tab-panel-content'
                        ) as HTMLElement | null;
                        const text = container
                            ? container.innerText
                            : multiModelResponses[messageIndex]?.content || '';
                        await navigator.clipboard.writeText(text);
                        pushMsg(t('aiSidebar.success.copySuccess'));
                    } catch (err) {
                        console.error('Copy multi-model response failed:', err);
                        pushErrMsg(t('aiSidebar.errors.copyFailed'));
                    }
                } else {
                    const message = messages[messageIndex];
                    if (message) {
                        copyMessage(message.content);
                    }
                }
                break;
            }
            case 'copy_md':
            case 'copy_plain':
            case 'copy_html': {
                // 如果有选区且选区属于消息，按类型复制选区
                if (selectionInMessage && selectionText) {
                    try {
                        if (action === 'copy_md') {
                            // Markdown: 尝试使用 Lute 转换 HTML->Markdown
                            if (window.Lute) {
                                const lute = window.Lute.New();
                                const md = lute.HTML2Md(selectionHtml || selectionText);
                                await navigator.clipboard.writeText(md);
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            } else {
                                // 降级为纯文本
                                await navigator.clipboard.writeText(selectionText);
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            }
                        } else if (action === 'copy_plain') {
                            await navigator.clipboard.writeText(selectionText);
                            pushMsg(t('aiSidebar.success.copySuccess'));
                        } else if (action === 'copy_html') {
                            // 尝试写入富文本（text/html + text/plain）
                            if (navigator.clipboard && (navigator.clipboard as any).write) {
                                const blobPlain = new Blob([selectionText], { type: 'text/plain' });
                                const blobHtml = new Blob([selectionHtml || selectionText], {
                                    type: 'text/html',
                                });
                                const item: any = new ClipboardItem({
                                    'text/plain': blobPlain,
                                    'text/html': blobHtml,
                                });
                                await (navigator.clipboard as any).write([item]);
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            } else {
                                // 回退到纯文本
                                await navigator.clipboard.writeText(selectionText);
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            }
                        }
                    } catch (err) {
                        console.error('Copy selection failed:', err);
                        pushErrMsg(t('aiSidebar.errors.copyFailed'));
                    }
                } else {
                    // 如果是多模型区域且没有选区，复制整个多模型响应内容
                    if (contextMenuIsMultiModel) {
                        try {
                            const el = document.elementFromPoint(
                                contextMenuX,
                                contextMenuY
                            ) as HTMLElement | null;
                            const container = el?.closest(
                                '.ai-sidebar__multi-model-card-content, .ai-sidebar__multi-model-tab-panel-content'
                            ) as HTMLElement | null;
                            const html = container
                                ? container.innerHTML
                                : multiModelResponses[messageIndex]?.content || '';
                            const text = container
                                ? container.innerText
                                : multiModelResponses[messageIndex]?.content || '';

                            if (action === 'copy_md') {
                                if (window.Lute) {
                                    const lute = window.Lute.New();
                                    const md = lute.HTML2Md(html || text);
                                    await navigator.clipboard.writeText(md);
                                } else {
                                    await navigator.clipboard.writeText(text);
                                }
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            } else if (action === 'copy_plain') {
                                await navigator.clipboard.writeText(text);
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            } else if (action === 'copy_html') {
                                if (navigator.clipboard && (navigator.clipboard as any).write) {
                                    const blobPlain = new Blob([text], { type: 'text/plain' });
                                    const blobHtml = new Blob([html || text], {
                                        type: 'text/html',
                                    });
                                    const item: any = new ClipboardItem({
                                        'text/plain': blobPlain,
                                        'text/html': blobHtml,
                                    });
                                    await (navigator.clipboard as any).write([item]);
                                } else {
                                    await navigator.clipboard.writeText(text);
                                }
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            }
                        } catch (err) {
                            console.error('Copy multi-model content failed:', err);
                            pushErrMsg(t('aiSidebar.errors.copyFailed'));
                        }
                    } else {
                        pushErrMsg(t('aiSidebar.errors.noSelection'));
                    }
                }

                // 清理选区状态
                selectionInMessage = false;
                selectionHtml = '';
                selectionText = '';
                break;
            }
            case 'edit':
                startEditMessage(messageIndex);
                break;
            case 'delete':
                deleteMessage(messageIndex);
                break;
            case 'regenerate':
                regenerateMessage(messageIndex);
                break;
            case 'save':
                openSaveToNoteDialog(messageIndex);
                break;
        }
    }

    // 搜索文档
    async function searchDocuments() {
        isSearching = true;
        try {
            // 如果没有输入关键词，显示当前文档
            if (!searchKeyword.trim()) {
                const currentProtyle = getActiveEditor(false)?.protyle;
                const blockId = currentProtyle?.block?.id;

                if (blockId) {
                    // 获取当前文档信息
                    const blocks = await sql(
                        `SELECT * FROM blocks WHERE id = '${blockId}' OR root_id = '${blockId}'`
                    );
                    if (blocks && blocks.length > 0) {
                        // 查找文档块
                        const docBlock = blocks.find(b => b.type === 'd');
                        if (docBlock) {
                            searchResults = [docBlock];
                        } else {
                            // 如果当前块不是文档块，获取所属文档
                            const rootId = blocks[0].root_id;
                            const rootBlocks = await sql(
                                `SELECT * FROM blocks WHERE id = '${rootId}' AND type = 'd'`
                            );
                            searchResults = rootBlocks || [];
                        }
                    } else {
                        searchResults = [];
                    }
                } else {
                    searchResults = [];
                }
                isSearching = false;
                return;
            }

            // 将空格分隔的关键词转换为 SQL LIKE 查询
            // 转义单引号以防止SQL注入
            const keywords = searchKeyword
                .trim()
                .split(/\s+/)
                .map(kw => kw.replace(/'/g, "''"));
            const conditions = keywords.map(kw => `content LIKE '%${kw}%'`).join(' AND ');
            const sqlQuery = `SELECT * FROM blocks WHERE ${conditions} AND type = 'd' ORDER BY updated DESC LIMIT 20`;

            const results = await sql(sqlQuery);
            searchResults = results || [];
        } catch (error) {
            console.error('Search error:', error);
            searchResults = [];
        } finally {
            isSearching = false;
        }
    }

    // 自动搜索（带防抖）
    function autoSearch() {
        // 清除之前的定时器
        if (searchTimeout !== null) {
            clearTimeout(searchTimeout);
        }

        // 设置新的定时器，500ms后执行搜索
        searchTimeout = window.setTimeout(() => {
            searchDocuments();
        }, 500);
    }

    // 监听搜索关键词变化
    $: {
        if (isSearchDialogOpen && searchKeyword !== undefined) {
            autoSearch();
        }
    }

    // 监听对话框关闭，清理搜索状态
    $: {
        if (!isSearchDialogOpen) {
            if (searchTimeout !== null) {
                clearTimeout(searchTimeout);
                searchTimeout = null;
            }
            // 不清空 searchKeyword 和 searchResults，保留用户的搜索历史
        }
    }

    // 添加文档到上下文
    async function addDocumentToContext(docId: string, docTitle: string) {
        // 检查是否已存在
        if (contextDocuments.find(doc => doc.id === docId)) {
            pushMsg(t('aiSidebar.success.documentExists'));
            return;
        }

        try {
            // agent模式下，文档只存储块ID，不获取内容
            if (chatMode === 'agent') {
                contextDocuments = [
                    ...contextDocuments,
                    {
                        id: docId,
                        title: docTitle,
                        content: '', // agent模式下不存储内容，只存储ID
                        type: 'doc',
                    },
                ];
                isSearchDialogOpen = false;
                searchKeyword = '';
                searchResults = [];
                return;
            }

            // 非agent模式：获取文档内容
            const data = await exportMdContent(docId, false, false, 2, 0, false);
            if (data && data.content) {
                contextDocuments = [
                    ...contextDocuments,
                    {
                        id: docId,
                        title: docTitle,
                        content: data.content,
                        type: 'doc',
                    },
                ];
                isSearchDialogOpen = false;
                searchKeyword = '';
                searchResults = [];
            }
        } catch (error) {
            console.error('Add document error:', error);
            pushErrMsg(t('aiSidebar.errors.addDocumentFailed'));
        }
    }

    // 获取当前聚焦的编辑器
    function getProtyle() {
        return getActiveEditor(false)?.protyle;
    }

    // 获取当前聚焦的块ID
    function getFocusedBlockId(): string | null {
        const protyle = getProtyle();
        if (!protyle) return null;

        // 获取ID：当有聚焦块时获取聚焦块ID，否则获取文档ID
        return protyle.block?.id || protyle.options?.blockId || protyle.block?.parentID || null;
    }

    // 通过块ID添加文档
    async function addItemByBlockId(blockId: string, forceFocusedBlock: boolean = false) {
        try {
            // 如果是从拖放操作且有聚焦块，则使用聚焦块
            let targetBlockId = blockId;
            if (forceFocusedBlock) {
                const focusedId = getFocusedBlockId();
                if (focusedId) {
                    targetBlockId = focusedId;
                }
            }

            const blocks = await sql(`SELECT * FROM blocks WHERE id = '${targetBlockId}'`);
            if (blocks && blocks.length > 0) {
                const block = blocks[0];
                let docId = targetBlockId;
                let docTitle = t('common.untitled');

                // 如果是文档块，直接添加
                if (block.type === 'd') {
                    docTitle = block.content || t('common.untitled');
                    await addDocumentToContext(docId, docTitle);
                } else {
                    // 如果是普通块，获取所属文档的标题
                    const rootBlocks = await sql(
                        `SELECT content FROM blocks WHERE id = '${block.root_id}' AND type = 'd'`
                    );
                    if (rootBlocks && rootBlocks.length > 0) {
                        docTitle = rootBlocks[0].content || '未命名文档';
                    }
                    // 添加该块的内容
                    await addBlockToContext(targetBlockId, docTitle);
                }
            }
        } catch (error) {
            console.error('Add block error:', error);
            pushErrMsg(t('aiSidebar.errors.addBlockFailed'));
        }
    }

    // 添加块到上下文（而不是整个文档）
    async function addBlockToContext(blockId: string, blockTitle: string) {
        // 检查是否已存在
        if (contextDocuments.find(doc => doc.id === blockId)) {
            pushMsg(t('aiSidebar.success.blockExists'));
            return;
        }

        try {
            // 获取块信息以判断类型
            const blockInfo = await getBlockByID(blockId);
            const isDoc = blockInfo?.type === 'd'; // 'd' 表示文档块

            // agent模式和edit模式：获取kramdown格式（用于AI），但使用Markdown生成显示标题
            if (chatMode === 'agent' || chatMode === 'edit') {
                const blockData = await getBlockKramdown(blockId);
                if (blockData && blockData.kramdown) {
                    // 获取Markdown格式用于生成友好的显示标题
                    let displayTitle = '块内容';
                    try {
                        const mdData = await exportMdContent(blockId, false, false, 2, 0, false);
                        if (mdData && mdData.content) {
                            const contentPreview = mdData.content.replace(/\n/g, ' ').trim();
                            displayTitle =
                                contentPreview.length > 20
                                    ? contentPreview.substring(0, 20) + '...'
                                    : contentPreview || (isDoc ? '文档内容' : '块内容');
                        }
                    } catch (error) {
                        console.warn('获取Markdown预览失败，使用kramdown生成标题:', error);
                        // 降级使用kramdown生成标题
                        const contentPreview = blockData.kramdown.replace(/\n/g, ' ').trim();
                        displayTitle =
                            contentPreview.length > 20
                                ? contentPreview.substring(0, 20) + '...'
                                : contentPreview || (isDoc ? '文档内容' : '块内容');
                    }

                    contextDocuments = [
                        ...contextDocuments,
                        {
                            id: blockId,
                            title: displayTitle,
                            content: blockData.kramdown, // 存储kramdown格式用于AI
                            type: isDoc ? 'doc' : 'block',
                        },
                    ];
                }
                return;
            }

            // ask模式：获取块的Markdown内容
            const data = await exportMdContent(blockId, false, false, 2, 0, false);
            if (data && data.content) {
                // 检查是否为纯图片块（只包含图片Markdown语法）
                const content = data.content.trim();
                const imageRegex = /^!\[([^\]]*)\]\(([^)]+)\)$/;
                const match = content.match(imageRegex);

                if (match) {
                    // 这是一个纯图片块，自动上传图片
                    const imagePath = match[2]; // 图片路径，如 assets/xxx.png
                    const imageName = match[1] || '图片'; // 图片名称

                    try {
                        // 使用思源 API 获取图片文件
                        // 思源笔记的图片路径格式：assets/xxx-xxxxx.png
                        const blob = await getFileBlob(`/data/${imagePath}`);

                        if (blob) {
                            // 从文件路径提取文件名作为默认名称
                            const fileName = imagePath.split('/').pop() || 'image.png';
                            const file = new File([blob], imageName || fileName, {
                                type: blob.type,
                            });

                            // 将图片转换为 base64 并添加为附件
                            const base64 = await fileToBase64(file);

                            currentAttachments = [
                                ...currentAttachments,
                                {
                                    type: 'image',
                                    name: imageName || fileName,
                                    data: base64,
                                    mimeType: blob.type || 'image/png',
                                },
                            ];

                            pushMsg(t('aiSidebar.success.imageAutoUploaded'));
                            return; // 图片已作为附件添加，不需要再添加为上下文文档
                        } else {
                            console.warn('无法加载图片，将作为普通块处理');
                        }
                    } catch (error) {
                        console.error('自动上传图片失败:', error);
                        pushErrMsg(t('aiSidebar.errors.autoUploadImageFailed'));
                        // 失败时继续作为普通块处理
                    }
                }

                // 不是纯图片块或上传失败，按照原有逻辑处理
                // 从块内容中提取前20个字作为显示标题
                const contentPreview = data.content.replace(/\n/g, ' ').trim();
                const displayTitle =
                    contentPreview.length > 20
                        ? contentPreview.substring(0, 20) + '...'
                        : contentPreview || (isDoc ? '文档内容' : '块内容');

                contextDocuments = [
                    ...contextDocuments,
                    {
                        id: blockId,
                        title: displayTitle,
                        content: data.content,
                        type: isDoc ? 'doc' : 'block',
                    },
                ];
            }
        } catch (error) {
            console.error('Add block error:', error);
            pushErrMsg(t('aiSidebar.errors.addBlockContentFailed'));
        }
    }

    // 删除上下文文档
    function removeContextDocument(docId: string) {
        contextDocuments = contextDocuments.filter(doc => doc.id !== docId);
    }

    // 打开文档
    async function openDocument(docId: string) {
        try {
            await openBlock(docId);
        } catch (error) {
            console.error('Open document error:', error);
            pushErrMsg(t('aiSidebar.errors.openDocumentFailed'));
        }
    }

    // 处理拖放
    function handleDragOver(event: DragEvent) {
        if (event.dataTransfer.types.includes('application/multi-model-sort')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        isDragOver = true;
    }

    function handleDragLeave(event: DragEvent) {
        if (event.dataTransfer.types.includes('application/multi-model-sort')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        // 只在真正离开容器时才设置为false
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        if (
            event.clientX <= rect.left ||
            event.clientX >= rect.right ||
            event.clientY <= rect.top ||
            event.clientY >= rect.bottom
        ) {
            isDragOver = false;
        }
    }

    async function handleDrop(event: DragEvent) {
        if (event.dataTransfer.types.includes('application/multi-model-sort')) {
            return;
        }
        event.preventDefault();
        isDragOver = false;

        const type = event.dataTransfer.types[0];
        if (!type) return;

        if (type.startsWith(Constants.SIYUAN_DROP_GUTTER)) {
            const meta = type.replace(Constants.SIYUAN_DROP_GUTTER, '');
            const info = meta.split(Constants.ZWSP);
            console.log('Dropped gutter info:', info);
            const blockIdStr = info[2];
            const blockIds = blockIdStr
                .split(',')
                .map(id => id.trim())
                .filter(id => id && id !== '/');
            // 批量添加到上下文
            if (blockIds.length > 0) {
                for (const blockid of blockIds) {
                    await addItemByBlockId(blockid, false);
                }
            }
        } else if (type.startsWith(Constants.SIYUAN_DROP_FILE)) {
            // 支持单选和多选拖放
            const ele: HTMLElement = (window as any).siyuan?.dragElement;
            if (ele && ele.innerText) {
                // 获取块ID字符串，可能是单个ID或逗号分隔的多个ID
                const blockIdStr = ele.innerText;

                // 分割成多个块ID（多选时用逗号分隔）
                const blockIds = blockIdStr
                    .split(',')
                    .map(id => id.trim())
                    .filter(id => id && id !== '/');

                // 批量添加到上下文
                if (blockIds.length > 0) {
                    for (const blockid of blockIds) {
                        await addItemByBlockId(blockid, false);
                        // 恢复文档树节点的透明度
                        const item: HTMLElement = document.querySelector(
                            `.file-tree.sy__tree li[data-node-id="${blockid}"]`
                        );
                        if (item) {
                            item.style.opacity = '1';
                        }
                    }
                }

                (window as any).siyuan.dragElement = undefined;
            }
        } else if (event.dataTransfer.types.includes(Constants.SIYUAN_DROP_TAB)) {
            const data = event.dataTransfer.getData(Constants.SIYUAN_DROP_TAB);
            const payload = JSON.parse(data);
            const rootId = payload?.children?.rootId;
            if (rootId) {
                // 拖放页签时：使用拖拽的文档ID，不应覆盖为当前聚焦的块ID
                // 之前传入了 true 来使用聚焦块，这会导致插件错误地使用当前已打开的文档
                // 而不是拖动的文档。改为 false 以使用拖动的文档 ID。
                await addItemByBlockId(rootId, false);
            }
            const tab = document.querySelector(
                `li[data-type="tab-header"][data-id="${payload.id}"]`
            ) as HTMLElement;
            if (tab) {
                tab.style.opacity = 'unset';
            }
        }
    }

    // 会话管理函数
    async function loadSessions() {
        try {
            const data = await plugin.loadData('chat-sessions.json');
            sessions = data?.sessions || [];
        } catch (error) {
            console.error('Load sessions error:', error);
            sessions = [];
        }
    }

    async function saveSessions() {
        try {
            await plugin.saveData('chat-sessions.json', { sessions });
        } catch (error) {
            console.error('Save sessions error:', error);
            pushErrMsg(t('aiSidebar.errors.saveSessionFailed'));
        }
    }

    function generateSessionTitle(): string {
        const userMessages = messages.filter(m => m.role === 'user');
        if (userMessages.length > 0) {
            const firstMessage = getMessageText(userMessages[0].content);
            return firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
        }
        return t('aiSidebar.session.new');
    }

    async function saveCurrentSession(silent: boolean = false) {
        if (messages.filter(m => m.role !== 'system').length === 0) {
            if (!silent) {
                pushErrMsg(t('aiSidebar.errors.emptySession'));
            }
            return;
        }

        const now = Date.now();

        // 【修复】在保存前重新加载最新的会话列表，避免多页签覆盖问题
        await loadSessions();

        if (currentSessionId) {
            // 更新现有会话
            const session = sessions.find(s => s.id === currentSessionId);
            if (session) {
                session.messages = [...messages];
                // 不再重新生成标题，保留原有标题（可能是默认标题、AI生成的标题或用户手动修改的标题）
                session.updatedAt = now;
            } else {
                // 如果会话不存在（可能被其他实例删除），创建为新会话
                const newSession: ChatSession = {
                    id: currentSessionId,
                    title: generateSessionTitle(),
                    messages: [...messages],
                    createdAt: now,
                    updatedAt: now,
                };
                sessions = [newSession, ...sessions];
            }
        } else {
            // 创建新会话
            const newSession: ChatSession = {
                id: `session_${now}`,
                title: generateSessionTitle(),
                messages: [...messages],
                createdAt: now,
                updatedAt: now,
            };
            sessions = [newSession, ...sessions];
            currentSessionId = newSession.id;
        }

        await saveSessions();
        hasUnsavedChanges = false;

        if (!silent) {
            pushMsg(t('aiSidebar.success.saveSessionSuccess'));
        }
    }

    async function loadSession(sessionId: string) {
        // 如果消息正在生成，先中断
        if (isLoading && abortController) {
            abortMessage();
        }

        // 如果有未选择的多模型响应，先保存它们
        if (isWaitingForAnswerSelection && multiModelResponses.length > 0) {
            const firstSuccessIndex = multiModelResponses.findIndex(r => !r.error && !r.isLoading);

            if (firstSuccessIndex !== -1) {
                const selectedResponse = multiModelResponses[firstSuccessIndex];
                const assistantMessage: Message = {
                    role: 'assistant',
                    content: selectedResponse.content || '',
                    thinking: selectedResponse.thinking,
                    multiModelResponses: multiModelResponses.map((response, i) => ({
                        ...response,
                        isSelected: i === firstSuccessIndex,
                        modelName:
                            i === firstSuccessIndex
                                ? '✅' + response.modelName
                                : response.modelName,
                    })),
                };

                messages = [...messages, assistantMessage];
                hasUnsavedChanges = true;
            }
        }

        if (hasUnsavedChanges) {
            confirm(
                t('aiSidebar.confirm.switchSession.title'),
                t('aiSidebar.confirm.switchSession.message'),
                async () => {
                    await saveCurrentSession();
                    await doLoadSession(sessionId);
                },
                async () => {
                    await doLoadSession(sessionId);
                }
            );
        } else {
            await doLoadSession(sessionId);
        }
    }

    async function doLoadSession(sessionId: string) {
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
            messages = [...session.messages];
            // 清空全局上下文文档（上下文现在存储在各个消息中）
            contextDocuments = [];
            // 确保系统提示词存在且是最新的
            if (settings.aiSystemPrompt) {
                const systemMsgIndex = messages.findIndex(m => m.role === 'system');
                if (systemMsgIndex >= 0) {
                    messages[systemMsgIndex].content = settings.aiSystemPrompt;
                } else {
                    messages.unshift({ role: 'system', content: settings.aiSystemPrompt });
                }
            }
            currentSessionId = sessionId;
            hasUnsavedChanges = false;

            // 清除多模型状态
            multiModelResponses = [];
            isWaitingForAnswerSelection = false;
            selectedAnswerIndex = null;
            selectedTabIndex = 0;

            // 切换到历史会话时默认显示最开头（最早消息）而不是底部
            await scrollToTop();
        }
    }

    async function newSession() {
        // 如果消息正在生成，先中断
        if (isLoading && abortController) {
            abortMessage();
        }

        // 如果有未选择的多模型响应，保存它们
        if (isWaitingForAnswerSelection && multiModelResponses.length > 0) {
            // 找到第一个成功的响应作为默认选择（如果所有都失败则不保存）
            const firstSuccessIndex = multiModelResponses.findIndex(r => !r.error && !r.isLoading);

            if (firstSuccessIndex !== -1) {
                // 创建assistant消息，保存所有多模型响应
                const assistantMessage: Message = {
                    role: 'assistant',
                    content: '', // 不显示单独的内容
                    multiModelResponses: multiModelResponses.map((response, i) => ({
                        ...response,
                        isSelected: i === firstSuccessIndex, // 标记第一个成功的为默认选择
                        modelName:
                            i === firstSuccessIndex
                                ? '✅' + response.modelName
                                : response.modelName,
                    })),
                };

                messages = [...messages, assistantMessage];
                hasUnsavedChanges = true;
            }
        }

        // 如果有未保存的更改，自动保存当前会话
        if (hasUnsavedChanges && messages.filter(m => m.role !== 'system').length > 0) {
            await saveCurrentSession();
        }
        doNewSession();
    }

    function doNewSession() {
        messages = settings.aiSystemPrompt
            ? [{ role: 'system', content: settings.aiSystemPrompt }]
            : [];
        contextDocuments = [];
        currentSessionId = '';
        hasUnsavedChanges = false;

        // 清除多模型状态
        multiModelResponses = [];
        isWaitingForAnswerSelection = false;
        selectedAnswerIndex = null;
        selectedTabIndex = 0;
    }

    async function deleteSession(sessionId: string) {
        confirm(
            t('aiSidebar.confirm.deleteSession.title'),
            t('aiSidebar.confirm.deleteSession.message'),
            async () => {
                // 【修复】删除前重新加载最新的会话列表，避免多页签覆盖问题
                await loadSessions();
                sessions = sessions.filter(s => s.id !== sessionId);
                await saveSessions();

                if (currentSessionId === sessionId) {
                    doNewSession();
                }
            }
        );
    }

    // 批量删除会话
    async function batchDeleteSessions(sessionIds: string[]) {
        if (!sessionIds || sessionIds.length === 0) {
            return;
        }

        const count = sessionIds.length;
        confirm(
            '批量删除会话',
            `确定要删除选中的 ${count} 个会话吗？此操作不可恢复。`,
            async () => {
                // 【修复】删除前重新加载最新的会话列表，避免多页签覆盖问题
                await loadSessions();

                // 过滤掉要删除的会话
                sessions = sessions.filter(s => !sessionIds.includes(s.id));
                await saveSessions();

                // 如果当前会话被删除，创建新会话
                if (sessionIds.includes(currentSessionId)) {
                    doNewSession();
                }

                pushMsg(`成功删除 ${count} 个会话`);
            }
        );
    }

    // 处理会话更新（如钉住状态变化）
    async function handleSessionUpdate(updatedSessions: ChatSession[]) {
        // 【修复】更新前重新加载最新的会话列表，避免多页签覆盖问题
        await loadSessions();

        // 找到被更新的会话，只更新这些会话的数据
        for (const updatedSession of updatedSessions) {
            const index = sessions.findIndex(s => s.id === updatedSession.id);
            if (index >= 0) {
                // 只更新会话的属性，保留其他实例可能修改的 messages
                sessions[index] = {
                    ...sessions[index],
                    ...updatedSession,
                };
            }
        }

        await saveSessions();
    }

    // 保存到笔记相关函数
    async function openSaveToNoteDialog(messageIndex: number | null = null) {
        if (messages.length === 0) {
            pushErrMsg(t('aiSidebar.errors.emptySession'));
            return;
        }

        // 保存消息索引
        saveMessageIndex = messageIndex;

        // 初始化对话框数据
        saveDocumentName = '';

        // 解析默认路径
        let defaultPath = settings.exportDefaultPath || '';
        if (defaultPath) {
            try {
                // 使用 renderSprig 解析 sprig 语法
                defaultPath = await renderSprig(defaultPath);
            } catch (error) {
                console.error('Parse default path error:', error);
            }
        }

        // 记录是否有全局默认路径
        hasDefaultPath = !!defaultPath;

        // 获取当前文档信息
        currentDocPath = '/';
        currentDocNotebookId = '';
        const focusedBlockId = getFocusedBlockId();
        if (focusedBlockId) {
            try {
                const block = await getBlockByID(focusedBlockId);
                if (block) {
                    const hpath = await getHPathByID(block.root_id);
                    currentDocPath = hpath;
                    currentDocNotebookId = block.box;
                }
            } catch (error) {
                console.error('Get current document info error:', error);
            }
        }

        // 预先加载笔记本列表（在打开对话框前）
        try {
            const notebooks = await lsNotebooks();
            if (notebooks?.notebooks && notebooks.notebooks.length > 0) {
                // 过滤掉已关闭的笔记本
                saveDialogNotebooks = notebooks.notebooks.filter(n => !n.closed);
            } else {
                saveDialogNotebooks = [];
            }
        } catch (error) {
            console.error('Get notebooks error:', error);
            saveDialogNotebooks = [];
        }

        // 如果全局保存文档位置为空，使用当前文档路径和笔记本（优先使用当前文档的笔记本）
        if (!defaultPath) {
            savePath = toRelativePath(currentDocPath);
            // 优先使用当前文档所在笔记本（如果能取得），并验证该笔记本存在于系统中；若不存在或未取得则回退到第一个笔记本
            // 只有当 currentDocNotebookId 有值时才赋值，否则保持为空，让后续逻辑处理
            if (currentDocNotebookId) {
                saveNotebookId = currentDocNotebookId;
            }

            if (saveDialogNotebooks.length > 0) {
                if (saveNotebookId) {
                    const found = saveDialogNotebooks.find(
                        n => String(n.id) === String(saveNotebookId)
                    );
                    if (!found) {
                        // 当前文档的笔记本ID没有在笔记本列表中找到，使用第一个作为回退
                        saveNotebookId = saveDialogNotebooks[0].id;
                    }
                } else {
                    // 没有获取到当前文档的笔记本ID，回退到第一个笔记本
                    saveNotebookId = saveDialogNotebooks[0].id;
                }
            }
        } else {
            // 如果有全局默认路径，使用全局配置
            savePath = defaultPath;
            // 笔记本优先使用设置中的默认笔记本
            if (settings.exportNotebook) {
                saveNotebookId = settings.exportNotebook;
            } else if (settings.exportLastNotebook) {
                saveNotebookId = settings.exportLastNotebook;
            } else {
                // 使用已加载的笔记本列表
                if (saveDialogNotebooks.length > 0) {
                    saveNotebookId = saveDialogNotebooks[0].id;
                }
            }
        }

        // 重置搜索状态
        savePathSearchKeyword = savePath;
        savePathSearchResults = [];
        showSavePathDropdown = false;

        isSaveToNoteDialogOpen = true;
    }

    function closeSaveToNoteDialog() {
        isSaveToNoteDialogOpen = false;
    }

    // 切换到当前文档路径
    function useCurrentDocPath() {
        if (currentDocPath && currentDocNotebookId) {
            savePath = toRelativePath(currentDocPath);
            saveNotebookId = currentDocNotebookId;
            savePathSearchKeyword = savePath;
            savePathSearchResults = [];
            showSavePathDropdown = false;
        }
    }

    // 搜索保存路径
    // 说明：默认使用 searchDocs() 进行服务器端全文搜索（匹配标题等），
    // 但在某些情况下（例如输入像 `2025` 的年份/目录片段）searchDocs 可能不会匹配到 hPath。
    // 因此我们在 searchDocs 没有返回结果时，针对仅包含数字或路径片段的关键字，
    // 退回到使用 SQL 查询 blocks.hpath 字段做模糊匹配，合并到搜索结果中以提升匹配率。
    async function searchSavePath() {
        if (!savePathSearchKeyword.trim()) {
            savePathSearchResults = [];
            return;
        }

        isSavePathSearching = true;
        try {
            const results = await searchDocs(savePathSearchKeyword);

            // 过滤：只显示选中笔记本中的文档
            if (results && saveNotebookId) {
                savePathSearchResults = (
                    results.filter(doc => doc.box === saveNotebookId) || []
                ).map((doc: any) => ({
                    ...doc,
                    // 将 hPath 规范化为相对于所选笔记本的路径（如果 hPath 包含笔记本名则去掉它）
                    hPath: toRelativePath(doc.hPath || ''),
                }));
            } else {
                savePathSearchResults = (results || []).map((doc: any) => ({
                    ...doc,
                    hPath: toRelativePath(doc.hPath || ''),
                }));
            }

            // 如果 searchDocs 没有返回结果，针对数值或仅路径片段的情况，退回到使用 SQL 的 hpath 模糊匹配
            // 例如：当用户输入 "2025"（年份）时，hPath 里通常会是 /.../2025/...，searchDocs 可能不会匹配到
            // 我们在这里尝试 SQL 查询 blocks.hpath 字段进行模糊匹配以丰富搜索结果
            const isLikelyPathFragment = /^[0-9\-\/]+$/.test(savePathSearchKeyword.trim());

            if (
                (savePathSearchResults.length === 0 ||
                    (savePathSearchResults && savePathSearchResults.length === 0)) &&
                isLikelyPathFragment
            ) {
                try {
                    const kw = savePathSearchKeyword.trim().replace(/'/g, "''");
                    const boxFilter = saveNotebookId
                        ? ` AND box = '${String(saveNotebookId).replace(/'/g, "''")}'`
                        : '';
                    const sqlQuery = `SELECT id, path, hpath, box FROM blocks WHERE type='d' AND hpath LIKE '%${kw}%' ${boxFilter} ORDER BY updated DESC LIMIT 200`;
                    const sqlResults = await sql(sqlQuery);
                    if (sqlResults && sqlResults.length > 0) {
                        // 将 SQL 的结果映射为 searchDocs 的返回格式（hPath 和 path）
                        const mapped = sqlResults.map((r: any) => ({
                            hPath: toRelativePath(r.hpath || r.hPath || ''),
                            path: r.path,
                            box: r.box,
                        }));
                        // 合并并去重
                        const existingHPaths = new Set(
                            savePathSearchResults.map((d: any) => String(d.hPath))
                        );
                        for (const doc of mapped) {
                            if (!existingHPaths.has(String(doc.hPath))) {
                                savePathSearchResults.push(doc);
                            }
                        }
                    }
                } catch (sqlError) {
                    console.error('Fallback SQL search save path error:', sqlError);
                }
            }
        } catch (error) {
            console.error('Search save path error:', error);
            savePathSearchResults = [];
        } finally {
            isSavePathSearching = false;
        }
    }

    // 自动搜索保存路径（带防抖）
    function autoSearchSavePath() {
        if (savePathSearchTimeout) {
            clearTimeout(savePathSearchTimeout);
        }
        savePathSearchTimeout = window.setTimeout(() => {
            searchSavePath();
        }, 300);
    }

    // 监听路径搜索关键词变化
    $: {
        if (isSaveToNoteDialogOpen && savePathSearchKeyword !== savePath) {
            autoSearchSavePath();
        }
    }

    // 选择路径
    function selectSavePath(path: string) {
        // `path` may come from `doc.path` (relative path) or be an hPath.
        // Normalize to a relative path (without notebook prefix) so it won't duplicate the notebook name
        // when used as the document path for createDocWithMd(notebook, path, ...)
        savePath = toRelativePath(path);
        savePathSearchKeyword = savePath;
        showSavePathDropdown = false;
        savePathSearchResults = [];
    }

    // 将 hPath（例如 "收集箱Inbox/2025/202510" 或 "/收集箱Inbox/2025/202510"）转换为相对于笔记本的路径
    function toRelativePath(hpath: string): string {
        if (!hpath) return '';
        let p = String(hpath).trim();
        // 移除开头的斜杠
        p = p.replace(/^\/+/, '');
        const parts = p.split('/');

        // If the path is already a relative path (e.g., '2025/202510'), it shouldn't
        // remove the first segment. Only strip the notebook name if it matches the
        // currently selected notebook's name.
        const currentNotebook = saveDialogNotebooks?.find(
            n => String(n.id) === String(saveNotebookId)
        );
        const currentNotebookName = currentNotebook?.name;
        if (currentNotebookName && parts[0] === currentNotebookName) {
            parts.shift();
            return parts.join('/');
        }

        // Otherwise return the path unchanged
        return p;
    }

    // 确认保存到笔记
    async function confirmSaveToNote() {
        if (!saveNotebookId) {
            pushErrMsg('请选择笔记本');
            return;
        }

        if (!savePath) {
            pushErrMsg('请输入保存路径');
            return;
        }

        try {
            // 生成文档名称
            let docName = saveDocumentName.trim();
            if (!docName) {
                // 优先使用当前会话的标题
                const currentSession = sessions.find(s => s.id === currentSessionId);
                if (currentSession) {
                    docName = currentSession.title;
                } else {
                    // 如果没有会话，才使用默认生成方法
                    docName = generateSessionTitle();
                }
            }

            // 生成 Markdown 内容（不需要一级标题，思源会自动使用文档名作为标题）
            let markdown = '';

            // 确定要保存的消息
            const messagesToSave =
                saveMessageIndex !== null
                    ? [messages[saveMessageIndex]].filter(m => m !== undefined && m !== null)
                    : messages.filter(
                          m =>
                              m &&
                              m !== null &&
                              m !== undefined &&
                              (m.role === 'user' || m.role === 'assistant')
                      );

            for (const message of messagesToSave) {
                if (!message || !message.role) {
                    continue;
                }
                if (message.role === 'user') {
                    markdown += `## User\n\n`;
                } else if (message.role === 'assistant') {
                    markdown += `## AI\n\n`;
                } else {
                    // 跳过其他类型的消息（如 system, tool）
                    continue;
                }

                // 处理消息内容（包括多模型响应）
                const content = getActualMessageContent(message);
                markdown += content + '\n\n';

                // 如果有多模型响应，添加所有模型的回答
                if (message.multiModelResponses && message.multiModelResponses.length > 0) {
                    markdown += `### 多模型对比\n\n`;
                    for (const response of message.multiModelResponses) {
                        const selectedMark = response.isSelected ? ' ✅' : '';
                        markdown += `#### ${response.modelName}${selectedMark}\n\n`;
                        if (response.thinking) {
                            markdown += `**思考过程：**\n\n${response.thinking}\n\n`;
                        }
                        if (response.content) {
                            markdown += `${getMessageText(response.content)}\n\n`;
                        }
                        if (response.error) {
                            markdown += `**错误：** ${response.error}\n\n`;
                        }
                    }
                }

                // 如果有思考内容，添加思考信息
                if (message.thinking) {
                    markdown += `### 思考过程\n\n`;
                    markdown += message.thinking + '\n\n';
                }

                // 如果有工具调用后的最终回复
                if (message.finalReply) {
                    markdown += `### 最终回复\n\n`;
                    markdown += message.finalReply + '\n\n';
                }

                // 如果有附件，添加附件信息
                if (message.attachments && message.attachments.length > 0) {
                    markdown += `### 附件\n\n`;
                    for (const attachment of message.attachments) {
                        if (attachment.type === 'image') {
                            markdown += `![${attachment.name}](${attachment.url || attachment.data})\n\n`;
                        } else {
                            markdown += `- ${attachment.name}\n`;
                        }
                    }
                    markdown += '\n';
                }

                // 如果有上下文文档
                if (message.contextDocuments && message.contextDocuments.length > 0) {
                    markdown += `### 相关上下文\n\n`;
                    for (const doc of message.contextDocuments) {
                        markdown += `- [${doc.title}](siyuan://blocks/${doc.id})\n`;
                    }
                    markdown += '\n';
                }
            }

            // 检查是否有内容需要保存
            if (!markdown.trim()) {
                const errorMsg =
                    messagesToSave.length === 0
                        ? '当前会话没有可保存的消息（user/assistant）'
                        : '消息内容为空，无法保存';
                pushErrMsg(errorMsg);
                return;
            }

            // 创建文档 - sanitize savePath to ensure it is relative (no notebook prefix)
            const sanitizedPath = toRelativePath(savePath);
            const fullPath = `${sanitizedPath}/${docName}`.replace(/\/+/g, '/');
            const docId = await createDocWithMd(saveNotebookId, fullPath, markdown);

            // 记住上次选择
            settings.exportLastPath = savePath;
            settings.exportLastNotebook = saveNotebookId;
            await plugin.saveSettings(settings);

            pushMsg(t('aiSidebar.success.saveToNoteSuccess'));
            closeSaveToNoteDialog();

            // 如果选择了保存后打开笔记，则打开文档
            if (openAfterSave && docId) {
                try {
                    await openBlock(docId);
                } catch (error) {
                    console.error('Open document error:', error);
                    pushErrMsg(t('aiSidebar.errors.openDocumentFailed'));
                }
            }
        } catch (error) {
            console.error('Save to note error:', error);
            pushErrMsg('保存失败: ' + error.message);
        }
    }

    // 打开插件设置
    function openSettings() {
        plugin.openSetting();
    }

    // 切换在新窗口打开菜单
    function toggleOpenWindowMenu(event: MouseEvent) {
        event.stopPropagation();
        showOpenWindowMenu = !showOpenWindowMenu;
    }

    // 在页签打开
    function openInTab() {
        plugin.openAITab();
        showOpenWindowMenu = false;
    }

    // 在新窗口打开
    function openInNewWindow() {
        plugin.openAIWindow();
        showOpenWindowMenu = false;
    }

    // 提示词管理函数
    async function loadPrompts() {
        try {
            const data = await plugin.loadData('prompts.json');
            prompts = data?.prompts || [];
        } catch (error) {
            console.error('Load prompts error:', error);
            prompts = [];
        }
    }

    async function savePrompts() {
        try {
            await plugin.saveData('prompts.json', { prompts });
        } catch (error) {
            console.error('Save prompts error:', error);
            pushErrMsg(t('aiSidebar.errors.savePromptFailed'));
        }
    }

    function openPromptManager() {
        isPromptSelectorOpen = false;
        isPromptManagerOpen = true;
        editingPrompt = null;
        newPromptTitle = '';
        newPromptContent = '';
    }

    function closePromptManager() {
        isPromptManagerOpen = false;
        editingPrompt = null;
        newPromptTitle = '';
        newPromptContent = '';
    }

    async function saveNewPrompt() {
        if (!newPromptTitle.trim() || !newPromptContent.trim()) {
            pushErrMsg(t('aiSidebar.errors.emptyPromptContent'));
            return;
        }

        const now = Date.now();
        if (editingPrompt) {
            // 编辑现有提示词
            const index = prompts.findIndex(p => p.id === editingPrompt.id);
            if (index >= 0) {
                prompts[index] = {
                    ...prompts[index],
                    title: newPromptTitle.trim(),
                    content: newPromptContent.trim(),
                };
                prompts = [...prompts];
            }
        } else {
            // 创建新提示词
            const newPrompt: Prompt = {
                id: `prompt_${now}`,
                title: newPromptTitle.trim(),
                content: newPromptContent.trim(),
                createdAt: now,
            };
            prompts = [newPrompt, ...prompts];
        }

        await savePrompts();
        closePromptManager();
    }

    function editPrompt(prompt: Prompt) {
        editingPrompt = prompt;
        newPromptTitle = prompt.title;
        newPromptContent = prompt.content;
        isPromptSelectorOpen = false;
        isPromptManagerOpen = true;
    }

    // 工具配置管理
    async function loadToolsConfig() {
        try {
            const data = await plugin.loadData('agent-tools-config.json');
            if (data?.selectedTools && Array.isArray(data.selectedTools)) {
                selectedTools = data.selectedTools;
            } else {
                selectedTools = [];
            }
        } catch (error) {
            console.error('[ToolConfig] Load error:', error);
            selectedTools = [];
        } finally {
            // 标记配置已加载完成，此后才允许自动保存
            isToolConfigLoaded = true;
        }
    }

    async function saveToolsConfig() {
        // 只在配置加载完成后才保存，避免初始化时覆盖已保存的配置
        if (!isToolConfigLoaded) {
            return;
        }
        try {
            await plugin.saveData('agent-tools-config.json', { selectedTools });
        } catch (error) {
            console.error('[ToolConfig] Save error:', error);
        }
    }

    // 监听工具选择变化，自动保存
    $: {
        // 只在配置加载完成后，且确实有变化时才保存
        if (isToolConfigLoaded && selectedTools) {
            // 使用 tick 确保在下一个事件循环保存，避免频繁保存
            tick().then(() => {
                saveToolsConfig();
            });
        }
    }

    // 获取工具的显示名称
    function getToolDisplayName(toolName: string): string {
        const key = `tools.${toolName}.name`;
        const name = t(key);
        return name === key ? toolName : name;
    }

    // 批准工具调用
    function approveToolCall() {
        if ((window as any).__toolApprovalResolve) {
            (window as any).__toolApprovalResolve(true);
            delete (window as any).__toolApprovalResolve;
        }
        isToolApprovalDialogOpen = false;
        pendingToolCall = null;
    }

    // 拒绝工具调用
    function rejectToolCall() {
        if ((window as any).__toolApprovalResolve) {
            (window as any).__toolApprovalResolve(false);
            delete (window as any).__toolApprovalResolve;
        }
        isToolApprovalDialogOpen = false;
        pendingToolCall = null;
    }

    function usePrompt(prompt: Prompt) {
        currentInput = prompt.content;
        isPromptSelectorOpen = false;
        tick().then(() => {
            autoResizeTextarea();
            textareaElement?.focus();
        });
    }

    // 点击外部关闭提示词选择器
    function handleClickOutside(event: MouseEvent) {
        const target = event.target as HTMLElement;

        // 关闭右键菜单
        if (contextMenuVisible && !target.closest('.ai-sidebar__context-menu')) {
            closeContextMenu();
        }

        // 关闭打开窗口菜单
        if (showOpenWindowMenu && !target.closest('.ai-sidebar__open-window-menu-container')) {
            showOpenWindowMenu = false;
        }

        if (isPromptSelectorOpen) {
            const selector = document.querySelector('.ai-sidebar__prompt-selector');
            const buttons = document.querySelectorAll('.ai-sidebar__prompt-actions button');

            let clickedButton = false;
            buttons.forEach(button => {
                if (button.contains(target)) {
                    clickedButton = true;
                }
            });

            if (selector && !selector.contains(target) && !clickedButton) {
                isPromptSelectorOpen = false;
            }
        }
    }

    // 编辑模式相关函数
    // 解析AI返回的编辑操作（JSON格式）
    function parseEditOperations(content: string): EditOperation[] {
        const operations: EditOperation[] = [];

        try {
            // 尝试匹配JSON代码块: ```json\n{...}\n```
            const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/gi;
            let match = jsonBlockRegex.exec(content);

            if (match) {
                const jsonStr = match[1].trim();
                const data = JSON.parse(jsonStr);

                if (data.editOperations && Array.isArray(data.editOperations)) {
                    for (const op of data.editOperations) {
                        if (op.blockId && op.newContent !== undefined) {
                            operations.push({
                                operationType: op.operationType || 'update', // 默认为update
                                blockId: op.blockId,
                                newContent: op.newContent,
                                oldContent: undefined, // 稍后获取
                                status: 'pending',
                                position: op.position || 'after', // 默认在后面插入
                            });
                        }
                    }
                }
            } else {
                // 尝试直接解析JSON（不在代码块中）
                const data = JSON.parse(content);
                if (data.editOperations && Array.isArray(data.editOperations)) {
                    for (const op of data.editOperations) {
                        if (op.blockId && op.newContent !== undefined) {
                            operations.push({
                                operationType: op.operationType || 'update', // 默认为update
                                blockId: op.blockId,
                                newContent: op.newContent,
                                oldContent: undefined,
                                status: 'pending',
                                position: op.position || 'after', // 默认在后面插入
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('解析编辑操作失败:', error);
        }

        return operations;
    }

    // 应用编辑操作
    async function applyEditOperation(operation: EditOperation, messageIndex: number) {
        try {
            const operationType = operation.operationType || 'update';

            if (operationType === 'insert') {
                // 插入新块
                const position = operation.position || 'after';

                // 根据位置确定参数
                let nextID: string | null;
                let previousID: string | null;

                if (position === 'before') {
                    // 在指定块之前插入
                    nextID = operation.blockId;
                } else {
                    // 在指定块之后插入（默认）
                    previousID = operation.blockId;
                }
                let lute = window.Lute.New();
                let newBlockDom = lute.Md2BlockDOM(operation.newContent);
                let newBlockId = newBlockDom.match(/data-node-id="([^"]*)"/)[1];

                // 创建可撤回的事务
                if (newBlockId) {
                    try {
                        const currentProtyle = getProtyle();
                        if (currentProtyle) {
                            // 获取父块ID
                            const block = await getBlockByID(operation.blockId);
                            const parentID = block?.root_id || currentProtyle.block.id;
                            const doOperations = [];
                            if (nextID) {
                                doOperations.push({
                                    action: 'insert',
                                    id: newBlockId,
                                    data: newBlockDom,
                                    parentID: parentID,
                                    nextID: nextID,
                                });
                            } else {
                                doOperations.push({
                                    action: 'insert',
                                    id: newBlockId,
                                    data: newBlockDom,
                                    parentID: parentID,
                                    previousID: previousID,
                                });
                            }

                            const undoOperations = [
                                {
                                    action: 'delete',
                                    id: newBlockId,
                                    data: null,
                                },
                            ];

                            // 执行事务以支持撤回
                            currentProtyle.getInstance().transaction(doOperations, undoOperations);
                            setTimeout(() => {
                                currentProtyle.getInstance()?.reload(false);
                            }, 500);
                        }
                    } catch (transactionError) {
                        console.warn('创建撤回事务失败，但块已插入:', transactionError);
                    }
                }

                // 更新操作状态
                const message = messages[messageIndex];
                if (message.editOperations) {
                    const op = message.editOperations.find(
                        o =>
                            o.blockId === operation.blockId && o.newContent === operation.newContent
                    );
                    if (op) {
                        op.status = 'applied';
                    }
                }
                messages = [...messages];
                hasUnsavedChanges = true;

                pushMsg(t('aiSidebar.success.insertBlockSuccess'));
            } else {
                // 更新现有块
                // 获取当前块内容
                const blockData = await getBlockKramdown(operation.blockId);
                if (!blockData || !blockData.kramdown) {
                    pushErrMsg(t('aiSidebar.errors.getBlockFailed'));
                    return;
                }

                // 保存旧内容用于显示（如果还没有保存）
                if (!operation.oldContent) {
                    operation.oldContent = blockData.kramdown;
                }

                // 保存旧的DOM用于撤回操作
                const oldBlockDomRes = await getBlockDOM(operation.blockId);

                // 使用 updateBlock API 更新块内容
                await updateBlock('markdown', operation.newContent, operation.blockId);
                await refreshSql();
                // 获取当前编辑器实例并创建可撤回的事务
                try {
                    const currentProtyle = getProtyle();
                    if (currentProtyle) {
                        await refreshSql();
                        const oldBlockDom = oldBlockDomRes?.dom;
                        const newBlockDomRes = await getBlockDOM(operation.blockId);
                        const newBlockDom = newBlockDomRes?.dom;
                        currentProtyle
                            .getInstance()
                            .updateTransaction(operation.blockId, newBlockDom, oldBlockDom);
                    }
                } catch (transactionError) {
                    console.warn('创建撤回事务失败，但块内容已更新:', transactionError);
                }

                // 更新操作状态
                const message = messages[messageIndex];
                if (message.editOperations) {
                    const op = message.editOperations.find(o => o.blockId === operation.blockId);
                    if (op) {
                        op.status = 'applied';
                    }
                }
                messages = [...messages];
                hasUnsavedChanges = true;

                pushMsg(t('aiSidebar.success.applyEditSuccess'));
            }
        } catch (error) {
            console.error('应用编辑失败:', error);
            pushErrMsg(t('aiSidebar.errors.applyEditFailed'));
        }
    }

    // 拒绝编辑操作
    function rejectEditOperation(operation: EditOperation, messageIndex: number) {
        const message = messages[messageIndex];
        if (message.editOperations) {
            const op = message.editOperations.find(o => o.blockId === operation.blockId);
            if (op) {
                op.status = 'rejected';
            }
        }
        messages = [...messages];
        hasUnsavedChanges = true;
        pushMsg(t('aiSidebar.success.rejectEditSuccess'));
    }

    // 查看差异
    async function viewDiff(operation: EditOperation) {
        const operationType = operation.operationType || 'update';

        if (operationType === 'insert') {
            // 插入操作：旧内容为空，新内容为要插入的内容
            const newMdContent =
                operation.newContentForDisplay ||
                operation.newContent.replace(/\{:\s*id="[^"]+"\s*\}/g, '').trim();

            currentDiffOperation = {
                ...operation,
                oldContent: '', // 插入操作没有旧内容
                newContent: operation.newContentForDisplay || newMdContent,
            };
        } else {
            // 更新操作
            // 使用保存的Markdown格式内容来显示差异
            // 这样可以看到真正的修改前内容，即使块已经被修改了
            const oldMdContent = operation.oldContentForDisplay || operation.oldContent || '';
            const newMdContent =
                operation.newContentForDisplay ||
                operation.newContent.replace(/\{:\s*id="[^"]+"\s*\}/g, '').trim();

            // 如果没有保存的显示内容（兼容旧数据），尝试实时获取
            if (!operation.oldContentForDisplay) {
                try {
                    const oldMdData = await exportMdContent(
                        operation.blockId,
                        false,
                        false,
                        2,
                        0,
                        false
                    );
                    if (oldMdData?.content) {
                        operation.oldContentForDisplay = oldMdData.content;
                    }
                } catch (error) {
                    console.error('获取块内容失败:', error);
                }
            }

            // 创建用于显示的临时operation对象
            currentDiffOperation = {
                ...operation,
                oldContent: operation.oldContentForDisplay || oldMdContent,
                newContent: operation.newContentForDisplay || newMdContent,
            };
        }

        isDiffDialogOpen = true;
    }

    // 关闭差异对话框
    function closeDiffDialog() {
        isDiffDialogOpen = false;
        currentDiffOperation = null;
    }

    // 简单的差异高亮（按行对比）
    function generateSimpleDiff(
        oldText: string,
        newText: string
    ): { type: 'removed' | 'added' | 'unchanged'; line: string }[] {
        const oldLines = oldText.split('\n');
        const newLines = newText.split('\n');
        const result: { type: 'removed' | 'added' | 'unchanged'; line: string }[] = [];

        // 简单的行对比（可以使用更复杂的diff算法）
        const maxLen = Math.max(oldLines.length, newLines.length);
        let oldIdx = 0;
        let newIdx = 0;

        while (oldIdx < oldLines.length || newIdx < newLines.length) {
            const oldLine = oldLines[oldIdx] || '';
            const newLine = newLines[newIdx] || '';

            if (oldLine === newLine) {
                result.push({ type: 'unchanged', line: oldLine });
                oldIdx++;
                newIdx++;
            } else if (oldIdx < oldLines.length && newIdx < newLines.length) {
                // 两行都存在但不同
                result.push({ type: 'removed', line: oldLine });
                result.push({ type: 'added', line: newLine });
                oldIdx++;
                newIdx++;
            } else if (oldIdx < oldLines.length) {
                // 只有旧行
                result.push({ type: 'removed', line: oldLine });
                oldIdx++;
            } else {
                // 只有新行
                result.push({ type: 'added', line: newLine });
                newIdx++;
            }
        }

        return result;
    }

    // 消息操作函数
    // 开始编辑消息
    function startEditMessage(index: number) {
        editingMessageIndex = index;
        editingMessageContent = getActualMessageContent(messages[index]);
        isEditDialogOpen = true;
    }

    // 取消编辑消息
    function cancelEditMessage() {
        editingMessageIndex = null;
        editingMessageContent = '';
        isEditDialogOpen = false;
    }

    // 保存编辑的消息
    function saveEditMessage() {
        if (editingMessageIndex === null) return;

        const message = messages[editingMessageIndex];
        const newContent = editingMessageContent.trim();

        // 如果是多模型响应，更新被选中的模型的内容
        if (message.multiModelResponses && message.multiModelResponses.length > 0) {
            const selectedIndex = message.multiModelResponses.findIndex(r => r.isSelected);
            if (selectedIndex !== -1) {
                // 更新被选中模型的内容
                message.multiModelResponses[selectedIndex].content = newContent;
            }
            // 同时更新主 content 字段（用于显示和其他操作）
            message.content = newContent;
        } else {
            // 普通消息，直接更新 content
            message.content = newContent;
        }

        messages = [...messages];
        hasUnsavedChanges = true;

        editingMessageIndex = null;
        editingMessageContent = '';
        isEditDialogOpen = false;
    }

    // 删除消息
    function deleteMessage(index: number) {
        confirm(
            t('aiSidebar.confirm.deleteMessage.title'),
            t('aiSidebar.confirm.deleteMessage.message'),
            () => {
                messages = messages.filter((_, i) => i !== index);
                hasUnsavedChanges = true;
            }
        );
    }

    // 重新生成AI回复
    async function regenerateMessage(index: number) {
        if (isLoading) {
            pushErrMsg(t('aiSidebar.errors.generating'));
            return;
        }

        const targetMessage = messages[index];
        if (!targetMessage) {
            pushErrMsg(t('aiSidebar.errors.noMessage'));
            return;
        }

        // 检查目标消息或后续消息是否包含多模型响应
        let useMultiModel = false;
        let previousMultiModels: Array<{ provider: string; modelId: string }> = [];

        if (targetMessage.role === 'assistant' && targetMessage.multiModelResponses) {
            useMultiModel = true;
            // 提取之前使用的模型列表
            previousMultiModels = targetMessage.multiModelResponses.map(r => ({
                provider: r.provider,
                modelId: r.modelId,
            }));
        }

        // 如果是用户消息，删除该消息及之后的所有消息，然后重新发送
        // 如果是AI消息，删除该消息及之后的所有消息，然后重新请求
        if (targetMessage.role === 'user') {
            // 检查下一条消息是否是多模型响应
            const nextMessage = messages[index + 1];
            if (
                nextMessage &&
                nextMessage.role === 'assistant' &&
                nextMessage.multiModelResponses
            ) {
                useMultiModel = true;
                previousMultiModels = nextMessage.multiModelResponses.map(r => ({
                    provider: r.provider,
                    modelId: r.modelId,
                }));
            }

            // 删除该用户消息及之后的所有消息
            messages = messages.slice(0, index);
            hasUnsavedChanges = true;

            // 重新添加该用户消息并发送
            const userMessage: Message = {
                role: 'user',
                content: targetMessage.content,
                attachments: targetMessage.attachments,
                contextDocuments: targetMessage.contextDocuments,
            };
            messages = [...messages, userMessage];
        } else {
            // AI消息：删除从此消息开始的所有后续消息
            messages = messages.slice(0, index);
            hasUnsavedChanges = true;
        }

        // 获取最后一条用户消息
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        if (!lastUserMessage) {
            pushErrMsg(t('aiSidebar.errors.noUserMessage'));
            return;
        }

        // 如果之前使用了多模型，且在问答模式下，重新使用多模型
        if (useMultiModel && previousMultiModels.length > 0 && chatMode === 'ask') {
            // 过滤掉无效的模型（提供商或模型已被删除）
            const validPreviousModels = previousMultiModels.filter(model => {
                const config = getProviderAndModelConfig(model.provider, model.modelId);
                return config !== null;
            });

            // 如果没有有效的模型，回退到单模型生成
            if (validPreviousModels.length === 0) {
                pushMsg(
                    t('aiSidebar.info.noValidMultiModels') ||
                        '之前选择的多模型已失效，将使用当前选择的模型重新生成'
                );
                // 继续执行后面的单模型生成逻辑
            } else {
                // 临时保存当前的多模型选择
                const originalMultiModels = [...selectedMultiModels];
                const originalEnableMultiModel = enableMultiModel;

                // 设置为之前使用的有效模型
                selectedMultiModels = validPreviousModels;
                enableMultiModel = true;

                // 调用多模型发送
                await sendMultiModelMessage();

                // 恢复原来的设置
                selectedMultiModels = originalMultiModels;
                enableMultiModel = originalEnableMultiModel;

                return; // 多模型发送完成，直接返回
            }
        }

        // 重新发送请求
        isLoading = true;
        isAborted = false; // 重置中断标志
        streamingMessage = '';
        streamingThinking = '';
        isThinkingPhase = false;
        autoScroll = true; // 重新生成时启用自动滚动

        await scrollToBottom(true);

        // 获取最后一条用户消息关联的上下文文档，并获取最新内容
        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        const userContextDocs = lastUserMessage.contextDocuments || [];
        for (const doc of userContextDocs) {
            try {
                let content: string;

                if (chatMode === 'edit') {
                    // 编辑模式：获取kramdown格式，保留块ID结构
                    const blockData = await getBlockKramdown(doc.id);
                    if (blockData && blockData.kramdown) {
                        content = blockData.kramdown;
                    } else {
                        // 降级使用缓存内容
                        content = doc.content;
                    }
                } else {
                    // 问答模式：获取Markdown格式
                    const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                    if (data && data.content) {
                        content = data.content;
                    } else {
                        // 降级使用缓存内容
                        content = doc.content;
                    }
                }

                contextDocumentsWithLatestContent.push({
                    id: doc.id,
                    title: doc.title,
                    content: content,
                    type: doc.type,
                });
            } catch (error) {
                console.error(`Failed to fetch latest content for block ${doc.id}:`, error);
                // 如果获取失败，使用原有内容
                contextDocumentsWithLatestContent.push(doc);
            }
        }

        // 准备发送给AI的消息（包含系统提示词和上下文文档）
        // 深拷贝消息数组，避免修改原始消息
        const messagesToSend = messages
            .filter(msg => msg.role !== 'system')
            .map((msg, index, array) => {
                const baseMsg: any = {
                    role: msg.role,
                    content: msg.content,
                };

                // 只处理历史用户消息的上下文（不是最后一条消息）
                // 最后一条消息将在后面用最新内容处理
                const isLastMessage = index === array.length - 1;
                if (
                    !isLastMessage &&
                    msg.role === 'user' &&
                    msg.contextDocuments &&
                    msg.contextDocuments.length > 0
                ) {
                    const hasImages = msg.attachments?.some(att => att.type === 'image');

                    // 获取原始消息内容
                    const originalContent =
                        typeof msg.content === 'string' ? msg.content : getMessageText(msg.content);

                    // 构建上下文文本
                    const contextText = msg.contextDocuments
                        .map(doc => {
                            const label = doc.type === 'doc' ? '文档' : '块';
                            return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                        })
                        .join('\n\n---\n\n');

                    // 如果有图片附件，使用多模态格式
                    if (hasImages) {
                        const contentParts: any[] = [];

                        // 添加文本内容和上下文
                        let textContent = originalContent;
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                        contentParts.push({ type: 'text', text: textContent });

                        // 添加图片
                        msg.attachments?.forEach(att => {
                            if (att.type === 'image') {
                                contentParts.push({
                                    type: 'image_url',
                                    image_url: { url: att.data },
                                });
                            }
                        });

                        // 添加文本文件内容
                        const fileTexts = msg.attachments
                            ?.filter(att => att.type === 'file')
                            .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                            .join('\n\n---\n\n');

                        if (fileTexts) {
                            contentParts.push({
                                type: 'text',
                                text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                            });
                        }

                        baseMsg.content = contentParts;
                    } else {
                        // 纯文本格式
                        let enhancedContent = originalContent;

                        // 添加文本文件附件
                        if (msg.attachments && msg.attachments.length > 0) {
                            const attachmentTexts = msg.attachments
                                .map(att => {
                                    if (att.type === 'file') {
                                        return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                    }
                                    return '';
                                })
                                .filter(Boolean)
                                .join('\n\n---\n\n');

                            if (attachmentTexts) {
                                enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                            }
                        }

                        // 添加上下文文档
                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;

                        baseMsg.content = enhancedContent;
                    }
                }

                return baseMsg;
            });

        // 处理最后一条用户消息，添加附件和上下文文档
        if (messagesToSend.length > 0) {
            const lastMessage = messagesToSend[messagesToSend.length - 1];
            if (lastMessage.role === 'user') {
                const lastUserMessage = messages[messages.length - 1];
                const hasImages = lastUserMessage.attachments?.some(att => att.type === 'image');

                // 如果有图片附件，使用多模态格式
                if (hasImages) {
                    const contentParts: any[] = [];

                    // 先添加用户输入
                    let textContent =
                        typeof lastUserMessage.content === 'string'
                            ? lastUserMessage.content
                            : getMessageText(lastUserMessage.content);

                    // 然后添加上下文文档（如果有）
                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                            })
                            .join('\n\n---\n\n');
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    contentParts.push({ type: 'text', text: textContent });

                    // 添加图片
                    lastUserMessage.attachments?.forEach(att => {
                        if (att.type === 'image') {
                            contentParts.push({
                                type: 'image_url',
                                image_url: { url: att.data },
                            });
                        }
                    });

                    // 添加文本文件内容
                    const fileTexts = lastUserMessage.attachments
                        ?.filter(att => att.type === 'file')
                        .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                        .join('\n\n---\n\n');

                    if (fileTexts) {
                        contentParts.push({
                            type: 'text',
                            text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                        });
                    }

                    lastMessage.content = contentParts;
                } else {
                    // 纯文本格式
                    let enhancedContent =
                        typeof lastUserMessage.content === 'string'
                            ? lastUserMessage.content
                            : getMessageText(lastUserMessage.content);

                    // 添加文本文件附件
                    if (lastUserMessage.attachments && lastUserMessage.attachments.length > 0) {
                        const attachmentTexts = lastUserMessage.attachments
                            .map(att => {
                                if (att.type === 'file') {
                                    return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                }
                                return '';
                            })
                            .filter(Boolean)
                            .join('\n\n---\n\n');

                        if (attachmentTexts) {
                            enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                        }
                    }

                    // 添加上下文文档
                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                            })
                            .join('\n\n---\n\n');
                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    lastMessage.content = enhancedContent;
                }
            }
        }

        if (settings.aiSystemPrompt) {
            messagesToSend.unshift({ role: 'system', content: settings.aiSystemPrompt });
        }

        // 创建新的 AbortController
        abortController = new AbortController();

        const providerConfig = getCurrentProviderConfig();
        const modelConfig = getCurrentModelConfig();

        if (!providerConfig || !modelConfig) {
            pushErrMsg(t('aiSidebar.errors.noProvider'));
            isLoading = false;
            return;
        }

        // 解析自定义参数
        let customBody = {};
        if (modelConfig.customBody) {
            try {
                customBody = JSON.parse(modelConfig.customBody);
            } catch (e) {
                console.error('Failed to parse custom body:', e);
                pushErrMsg('自定义参数 JSON 格式错误');
                isLoading = false;
                return;
            }
        }

        try {
            const enableThinking =
                modelConfig.capabilities?.thinking && (modelConfig.thinkingEnabled || false);

            await chat(
                currentProvider,
                {
                    apiKey: providerConfig.apiKey,
                    model: modelConfig.id,
                    messages: messagesToSend,
                    temperature: modelConfig.temperature,
                    maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                    stream: true,
                    signal: abortController.signal,
                    customBody,
                    enableThinking,
                    reasoningEffort: modelConfig.thinkingEffort || 'medium',
                    onThinkingChunk: enableThinking
                        ? async (chunk: string) => {
                              isThinkingPhase = true;
                              streamingThinking += chunk;
                              await scrollToBottom();
                          }
                        : undefined,
                    onThinkingComplete: enableThinking
                        ? (thinking: string) => {
                              isThinkingPhase = false;
                              thinkingCollapsed[messages.length] = true;
                          }
                        : undefined,
                    onChunk: async (chunk: string) => {
                        streamingMessage += chunk;
                        await scrollToBottom();
                    },
                    onComplete: async (fullText: string) => {
                        // 如果已经中断，不再添加消息（避免重复）
                        if (isAborted) {
                            return;
                        }

                        // 转换 LaTeX 数学公式格式为 Markdown 格式
                        const convertedText = convertLatexToMarkdown(fullText);

                        const assistantMessage: Message = {
                            role: 'assistant',
                            content: convertedText,
                        };

                        if (enableThinking && streamingThinking) {
                            assistantMessage.thinking = streamingThinking;
                        }

                        messages = [...messages, assistantMessage];
                        streamingMessage = '';
                        streamingThinking = '';
                        isThinkingPhase = false;
                        isLoading = false;
                        abortController = null;
                        hasUnsavedChanges = true;

                        // AI 回复完成后，自动保存当前会话
                        await saveCurrentSession(true);
                    },
                    onError: (error: Error) => {
                        if (error.message !== 'Request aborted') {
                            // 将错误消息作为一条 assistant 消息添加
                            const errorMessage: Message = {
                                role: 'assistant',
                                content: `❌ **${t('aiSidebar.errors.requestFailed')}**\n\n${error.message}`,
                            };
                            messages = [...messages, errorMessage];
                            hasUnsavedChanges = true;
                        }
                        isLoading = false;
                        streamingMessage = '';
                        streamingThinking = '';
                        isThinkingPhase = false;
                        abortController = null;
                    },
                },
                providerConfig.customApiUrl,
                providerConfig.advancedConfig
            );
        } catch (error) {
            console.error('Regenerate message error:', error);
            // onError 回调已经处理了错误消息的添加，这里不需要重复添加
            if ((error as Error).name === 'AbortError') {
                // 中断错误已经在 abortMessage 中处理
            } else if (!isLoading) {
                // 如果 isLoading 已经是 false，说明 onError 已经被调用并处理了
                // 不需要做任何事情
            } else {
                // 如果 isLoading 还是 true，说明 onError 没有被调用
                // 这种情况下才需要添加错误消息
                const errorMessage: Message = {
                    role: 'assistant',
                    content: `❌ **${t('aiSidebar.errors.requestFailed')}**\n\n${(error as Error).message}`,
                };
                messages = [...messages, errorMessage];
                hasUnsavedChanges = true;
                isLoading = false;
                streamingMessage = '';
                streamingThinking = '';
                isThinkingPhase = false;
            }
            abortController = null;
        }
    }

    // 将消息数组分组，合并连续的 AI 相关消息
    interface MessageGroup {
        type: 'user' | 'assistant';
        messages: Message[];
        startIndex: number; // 原始消息数组中的起始索引
    }

    function groupMessages(messages: Message[]): MessageGroup[] {
        const groups: MessageGroup[] = [];
        let currentGroup: MessageGroup | null = null;

        messages.forEach((message, index) => {
            // 跳过 system 消息
            if (message.role === 'system') {
                return;
            }

            if (message.role === 'user') {
                // 用户消息：结束当前组，开始新的用户组
                if (currentGroup) {
                    groups.push(currentGroup);
                }
                currentGroup = {
                    type: 'user',
                    messages: [message],
                    startIndex: index,
                };
            } else if (message.role === 'assistant' || message.role === 'tool') {
                // AI 或工具消息
                if (!currentGroup || currentGroup.type === 'user') {
                    // 如果没有当前组或当前组是用户组，结束当前组并开始新的 AI 组
                    if (currentGroup) {
                        groups.push(currentGroup);
                    }
                    currentGroup = {
                        type: 'assistant',
                        messages: [message],
                        startIndex: index,
                    };
                } else {
                    // 继续添加到当前 AI 组
                    currentGroup.messages.push(message);
                }
            }
        });

        // 添加最后一个组
        if (currentGroup) {
            groups.push(currentGroup);
        }

        return groups;
    }

    // 响应式计算消息组
    $: messageGroups = groupMessages(messages);
</script>

<div class="ai-sidebar" class:ai-sidebar--fullscreen={isFullscreen} bind:this={sidebarContainer}>
    <div class="ai-sidebar__header">
        <h3 class="ai-sidebar__title">
            {#if hasUnsavedChanges}
                <span class="ai-sidebar__unsaved" title={t('aiSidebar.unsavedChanges')}>●</span>
            {/if}
        </h3>
        <div class="ai-sidebar__actions">
            <button
                class="b3-button b3-button--text"
                on:click={newSession}
                title={t('aiSidebar.session.new')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
            </button>
            <SessionManager
                bind:sessions
                bind:currentSessionId
                bind:isOpen={isSessionManagerOpen}
                on:refresh={loadSessions}
                on:load={e => loadSession(e.detail.sessionId)}
                on:delete={e => deleteSession(e.detail.sessionId)}
                on:batchDelete={e => batchDeleteSessions(e.detail.sessionIds)}
                on:new={newSession}
                on:update={e => handleSessionUpdate(e.detail.sessions)}
            />
            <div class="ai-sidebar__open-window-menu-container" style="position: relative;">
                <button
                    class="b3-button b3-button--text"
                    bind:this={openWindowMenuButton}
                    on:click={toggleOpenWindowMenu}
                    title="在新窗口打开"
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconOpenWindow"></use></svg>
                </button>
                {#if showOpenWindowMenu}
                    <div class="ai-sidebar__open-window-menu">
                        <button class="b3-menu__item" on:click={openInTab}>
                            <svg class="b3-menu__icon">
                                <use xlink:href="#iconOpenWindow"></use>
                            </svg>
                            <span class="b3-menu__label">在页签打开</span>
                        </button>
                        <button class="b3-menu__item" on:click={openInNewWindow}>
                            <svg class="b3-menu__icon">
                                <use xlink:href="#iconOpenWindow"></use>
                            </svg>
                            <span class="b3-menu__label">在新窗口打开</span>
                        </button>
                    </div>
                {/if}
            </div>
            <button
                class="b3-button b3-button--text"
                on:click={copyAsMarkdown}
                title={t('aiSidebar.actions.copyAllChat')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
            </button>
            <button
                class="b3-button b3-button--text"
                on:click={() => openSaveToNoteDialog()}
                title={t('aiSidebar.actions.saveToNote')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconDownload"></use></svg>
            </button>
            <button
                class="b3-button b3-button--text"
                on:click={clearChat}
                title={t('aiSidebar.actions.clear')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
            </button>
            <button
                class="b3-button b3-button--text"
                on:click={toggleFullscreen}
                title={isFullscreen ? '退出全屏' : '全屏查看'}
            >
                <svg class="b3-button__icon">
                    <use
                        xlink:href={isFullscreen ? '#iconFullscreenExit' : '#iconFullscreen'}
                    ></use>
                </svg>
            </button>
            <button
                class="b3-button b3-button--text"
                on:click={openSettings}
                title={t('aiSidebar.actions.settings')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
            </button>
        </div>
    </div>

    <div
        class="ai-sidebar__messages"
        class:ai-sidebar__messages--drag-over={isDragOver}
        bind:this={messagesContainer}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
        on:drop={handleDrop}
        on:scroll={handleScroll}
    >
        {#each messageGroups as group, groupIndex (groupIndex)}
            {@const firstMessage = group.messages[0]}
            {@const messageIndex = group.startIndex}
            <div
                class="ai-message ai-message--{group.type}"
                on:contextmenu={e => handleContextMenu(e, messageIndex, group.type)}
            >
                <div class="ai-message__header">
                    <span class="ai-message__role">
                        {group.type === 'user' ? '👤 User' : '🤖 AI'}
                    </span>
                </div>

                <!-- 遍历组内的所有消息 -->
                {#each group.messages as message, msgIndex}
                    <!-- 跳过 tool 角色的消息，因为它们已经在工具调用区域显示 -->
                    {#if message.role === 'tool'}
                        <!-- 不渲染 tool 消息 -->
                    {:else}
                        <!-- 显示思考过程 -->
                        {#if message.role === 'assistant' && message.thinking && !(message.multiModelResponses && message.multiModelResponses.length > 0)}
                            {@const thinkingIndex = messageIndex + msgIndex}
                            <div class="ai-message__thinking">
                                <div
                                    class="ai-message__thinking-header"
                                    on:click={() => {
                                        thinkingCollapsed[thinkingIndex] =
                                            !thinkingCollapsed[thinkingIndex];
                                    }}
                                >
                                    <svg
                                        class="ai-message__thinking-icon"
                                        class:collapsed={thinkingCollapsed[thinkingIndex]}
                                    >
                                        <use xlink:href="#iconRight"></use>
                                    </svg>
                                    <span class="ai-message__thinking-title">💭 思考过程</span>
                                </div>
                                {#if !thinkingCollapsed[thinkingIndex]}
                                    <div class="ai-message__thinking-content b3-typography">
                                        {@html formatMessage(message.thinking)}
                                    </div>
                                {/if}
                            </div>
                        {/if}

                        <!-- 显示消息内容（只有在有实际内容时才显示，且没有多模型响应时才显示） -->
                        {#if message.content && message.content
                                .toString()
                                .trim() && !(message.role === 'assistant' && message.multiModelResponses && message.multiModelResponses.length > 0)}
                            <div
                                class="ai-message__content b3-typography"
                                style={messageFontSize ? `font-size: ${messageFontSize}px;` : ''}
                            >
                                {@html formatMessage(message.content)}
                            </div>
                        {/if}

                        <!-- 显示多模型响应（历史消息） -->
                        {#if message.role === 'assistant' && message.multiModelResponses && message.multiModelResponses.length > 0}
                            <div class="ai-message__multi-model-responses">
                                <div class="ai-message__multi-model-header">
                                    <h4>🤖 多模型响应</h4>
                                </div>
                                <!-- 使用页签样式显示历史多模型响应 -->
                                <div class="ai-message__multi-model-tabs">
                                    <div class="ai-message__multi-model-tab-headers">
                                        {#each message.multiModelResponses as response, index}
                                            {@const tabKey = `history_multi_${messageIndex}_${msgIndex}`}
                                            {@const currentTabIndex =
                                                thinkingCollapsed[`${tabKey}_selectedTab`] ??
                                                message.multiModelResponses.findIndex(
                                                    r => r.isSelected
                                                ) ??
                                                0}
                                            <button
                                                class="ai-message__multi-model-tab-header"
                                                class:ai-message__multi-model-tab-header--active={currentTabIndex ===
                                                    index}
                                                on:click={() => {
                                                    thinkingCollapsed[`${tabKey}_selectedTab`] =
                                                        index;
                                                    thinkingCollapsed = { ...thinkingCollapsed };
                                                }}
                                            >
                                                <span class="ai-message__multi-model-tab-title">
                                                    {response.modelName}
                                                </span>
                                                {#if response.error}
                                                    <span
                                                        class="ai-message__multi-model-tab-status ai-message__multi-model-tab-status--error"
                                                    >
                                                        ❌
                                                    </span>
                                                {/if}
                                            </button>
                                        {/each}
                                    </div>
                                    <div class="ai-message__multi-model-tab-content">
                                        {#each message.multiModelResponses as response, index}
                                            {@const tabKey = `history_multi_${messageIndex}_${msgIndex}`}
                                            {@const currentTabIndex =
                                                thinkingCollapsed[`${tabKey}_selectedTab`] ??
                                                message.multiModelResponses.findIndex(
                                                    r => r.isSelected
                                                ) ??
                                                0}
                                            {#if currentTabIndex === index}
                                                <div class="ai-message__multi-model-tab-panel">
                                                    <!-- 添加面板头部，包含复制按钮 -->
                                                    <div
                                                        class="ai-message__multi-model-tab-panel-header"
                                                    >
                                                        <div
                                                            class="ai-message__multi-model-tab-panel-title"
                                                        >
                                                            <span
                                                                class="ai-message__multi-model-tab-panel-model-name"
                                                            >
                                                                {response.modelName}
                                                            </span>
                                                        </div>
                                                        <div
                                                            class="ai-message__multi-model-tab-panel-actions"
                                                        >
                                                            {#if !response.error && response.content}
                                                                <button
                                                                    class="b3-button b3-button--text"
                                                                    on:click={() =>
                                                                        regenerateHistoryModelResponse(
                                                                            messageIndex + msgIndex,
                                                                            index
                                                                        )}
                                                                    title={t(
                                                                        'aiSidebar.actions.regenerate'
                                                                    )}
                                                                >
                                                                    <svg class="b3-button__icon">
                                                                        <use
                                                                            xlink:href="#iconRefresh"
                                                                        ></use>
                                                                    </svg>
                                                                </button>
                                                                <button
                                                                    class="b3-button b3-button--text ai-sidebar__multi-model-copy-btn"
                                                                    on:click={() =>
                                                                        copyMessage(
                                                                            response.content || ''
                                                                        )}
                                                                    title={t(
                                                                        'aiSidebar.actions.copyMessage'
                                                                    )}
                                                                >
                                                                    <svg class="b3-button__icon">
                                                                        <use
                                                                            xlink:href="#iconCopy"
                                                                        ></use>
                                                                    </svg>
                                                                </button>
                                                            {/if}
                                                        </div>
                                                    </div>

                                                    {#if response.thinking}
                                                        {@const isCollapsed =
                                                            response.thinkingCollapsed ?? true}
                                                        <div class="ai-message__thinking">
                                                            <div
                                                                class="ai-message__thinking-header"
                                                                on:click={() => {
                                                                    message.multiModelResponses[
                                                                        index
                                                                    ].thinkingCollapsed =
                                                                        !isCollapsed;
                                                                    messages = [...messages];
                                                                }}
                                                            >
                                                                <svg
                                                                    class="ai-message__thinking-icon"
                                                                    class:collapsed={isCollapsed}
                                                                >
                                                                    <use
                                                                        xlink:href="#iconRight"
                                                                    ></use>
                                                                </svg>
                                                                <span
                                                                    class="ai-message__thinking-title"
                                                                >
                                                                    💭 思考过程
                                                                </span>
                                                            </div>
                                                            {#if !isCollapsed}
                                                                <div
                                                                    class="ai-message__thinking-content b3-typography"
                                                                >
                                                                    {@html formatMessage(
                                                                        response.thinking
                                                                    )}
                                                                </div>
                                                            {/if}
                                                        </div>
                                                    {/if}

                                                    <div
                                                        class="ai-message__multi-model-tab-panel-content b3-typography"
                                                        style={messageFontSize
                                                            ? `font-size: ${messageFontSize}px;`
                                                            : ''}
                                                        on:contextmenu={e =>
                                                            handleContextMenu(
                                                                e,
                                                                messageIndex + msgIndex,
                                                                'assistant'
                                                            )}
                                                    >
                                                        {#if response.error}
                                                            <div
                                                                class="ai-message__multi-model-tab-panel-error"
                                                            >
                                                                {response.error}
                                                            </div>
                                                        {:else if response.content}
                                                            {@html formatMessage(response.content)}
                                                        {/if}
                                                    </div>
                                                </div>
                                            {/if}
                                        {/each}
                                    </div>
                                </div>
                            </div>
                        {/if}

                        <!-- 显示上下文文档和附件 -->
                        {#if (message.contextDocuments && message.contextDocuments.length > 0) || (message.attachments && message.attachments.length > 0)}
                            {@const contextCount =
                                (message.contextDocuments?.length || 0) +
                                (message.attachments?.length || 0)}
                            <div class="ai-message__context-docs">
                                <div class="ai-message__context-docs-title">
                                    📎 {t('aiSidebar.context.content')} ({contextCount})
                                </div>

                                <!-- 显示附件 -->
                                {#if message.attachments && message.attachments.length > 0}
                                    <div class="ai-message__context-docs-list">
                                        {#each message.attachments as attachment}
                                            <div class="ai-message__attachment">
                                                {#if attachment.type === 'image'}
                                                    <img
                                                        src={attachment.data}
                                                        alt={attachment.name}
                                                        class="ai-message__attachment-image"
                                                    />
                                                    <span class="ai-message__attachment-name">
                                                        {attachment.name}
                                                    </span>
                                                {:else}
                                                    <div class="ai-message__attachment-file">
                                                        <svg class="ai-message__attachment-icon">
                                                            <use xlink:href="#iconFile"></use>
                                                        </svg>
                                                        <span class="ai-message__attachment-name">
                                                            {attachment.name}
                                                        </span>
                                                    </div>
                                                {/if}
                                            </div>
                                        {/each}
                                    </div>
                                {/if}

                                <!-- 显示上下文文档链接 -->
                                {#if message.contextDocuments && message.contextDocuments.length > 0}
                                    <div class="ai-message__context-docs-list">
                                        {#each message.contextDocuments as doc}
                                            <div class="ai-sidebar__context-doc-item">
                                                <button
                                                    class="ai-sidebar__context-doc-link"
                                                    on:click={() => openDocument(doc.id)}
                                                    title={doc.title}
                                                >
                                                    {doc.type === 'doc' ? '📄' : '📝'}
                                                    {doc.title}
                                                </button>
                                                <button
                                                    class="b3-button b3-button--text ai-sidebar__context-doc-copy"
                                                    on:click={() => copyMessage(doc.content || '')}
                                                    title={t('aiSidebar.actions.copyMessage')}
                                                >
                                                    <svg class="b3-button__icon">
                                                        <use xlink:href="#iconCopy"></use>
                                                    </svg>
                                                </button>
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/if}

                        <!-- 显示工具调用 -->
                        {#if message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0}
                            <div class="ai-message__tool-calls">
                                <div class="ai-message__tool-calls-title">
                                    🔧 {t('tools.calling')} ({message.tool_calls.length})
                                </div>
                                {#each message.tool_calls as toolCall}
                                    {@const toolResult = group.messages
                                        .slice(msgIndex + 1)
                                        .find(
                                            m => m.role === 'tool' && m.tool_call_id === toolCall.id
                                        )}
                                    {@const toolName = toolCall.function.name}
                                    {@const toolDisplayName = getToolDisplayName(toolName)}
                                    {@const isCompleted = !!toolResult}
                                    {@const toolCallCollapsed = !toolCallsExpanded[toolCall.id]}

                                    <div class="ai-message__tool-call">
                                        <div
                                            class="ai-message__tool-call-header"
                                            on:click={() => {
                                                toolCallsExpanded[toolCall.id] =
                                                    !toolCallsExpanded[toolCall.id];
                                                toolCallsExpanded = { ...toolCallsExpanded };
                                            }}
                                        >
                                            <div class="ai-message__tool-call-name">
                                                <svg
                                                    class="ai-message__tool-call-icon"
                                                    class:collapsed={toolCallCollapsed}
                                                >
                                                    <use xlink:href="#iconRight"></use>
                                                </svg>
                                                <span>{toolDisplayName}</span>
                                                {#if isCompleted}
                                                    <span class="ai-message__tool-call-status">
                                                        ✅
                                                    </span>
                                                {:else}
                                                    <span class="ai-message__tool-call-status">
                                                        ⏳
                                                    </span>
                                                {/if}
                                            </div>
                                        </div>

                                        {#if !toolCallCollapsed}
                                            {@const paramsKey = `${toolCall.id}_params`}
                                            {@const paramsExpanded =
                                                toolCallResultsExpanded[paramsKey] !== false}
                                            {@const resultKey = `${toolCall.id}_result`}
                                            {@const resultExpanded =
                                                toolCallResultsExpanded[resultKey] !== false}
                                            <div class="ai-message__tool-call-details">
                                                <!-- 工具参数 -->
                                                <div class="ai-message__tool-call-params">
                                                    <div
                                                        class="ai-message__tool-call-section-header"
                                                        on:click={() => {
                                                            toolCallResultsExpanded[paramsKey] =
                                                                !paramsExpanded;
                                                            toolCallResultsExpanded = {
                                                                ...toolCallResultsExpanded,
                                                            };
                                                        }}
                                                    >
                                                        <svg
                                                            class="ai-message__tool-call-icon"
                                                            class:collapsed={!paramsExpanded}
                                                        >
                                                            <use xlink:href="#iconRight"></use>
                                                        </svg>
                                                        <strong>
                                                            {t('tools.selector.parameters')}
                                                        </strong>
                                                    </div>
                                                    {#if paramsExpanded}
                                                        <pre
                                                            class="ai-message__tool-call-code">{toolCall
                                                                .function.arguments}</pre>
                                                    {/if}
                                                </div>

                                                <!-- 工具结果 -->
                                                {#if toolResult}
                                                    <div class="ai-message__tool-call-result">
                                                        <div
                                                            class="ai-message__tool-call-section-header"
                                                            on:click={() => {
                                                                toolCallResultsExpanded[resultKey] =
                                                                    !resultExpanded;
                                                                toolCallResultsExpanded = {
                                                                    ...toolCallResultsExpanded,
                                                                };
                                                            }}
                                                        >
                                                            <svg
                                                                class="ai-message__tool-call-icon"
                                                                class:collapsed={!resultExpanded}
                                                            >
                                                                <use xlink:href="#iconRight"></use>
                                                            </svg>
                                                            <strong>{t('tools.result')}</strong>
                                                        </div>
                                                        {#if resultExpanded}
                                                            <pre
                                                                class="ai-message__tool-call-code">{toolResult.content}</pre>
                                                        {/if}
                                                    </div>
                                                {/if}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        <!-- 显示工具调用后的最终回复 -->
                        {#if message.role === 'assistant' && message.finalReply}
                            <div
                                class="ai-message__content ai-message__final-reply b3-typography"
                                style={messageFontSize ? `font-size: ${messageFontSize}px;` : ''}
                            >
                                {@html formatMessage(message.finalReply)}
                            </div>
                        {/if}

                        <!-- 显示编辑操作 -->
                        {#if message.role === 'assistant' && message.editOperations && message.editOperations.length > 0}
                            <div class="ai-message__edit-operations">
                                <div class="ai-message__edit-operations-title">
                                    📝 {t('aiSidebar.edit.title')} ({message.editOperations.length})
                                </div>
                                {#each message.editOperations as operation}
                                    <div
                                        class="ai-message__edit-operation"
                                        class:ai-message__edit-operation--applied={operation.status ===
                                            'applied'}
                                        class:ai-message__edit-operation--rejected={operation.status ===
                                            'rejected'}
                                    >
                                        <div class="ai-message__edit-operation-header">
                                            <span class="ai-message__edit-operation-id">
                                                {#if operation.operationType === 'insert'}
                                                    {t('aiSidebar.edit.insertBlock')}:
                                                    {operation.position === 'before'
                                                        ? t('aiSidebar.edit.before')
                                                        : t('aiSidebar.edit.after')}
                                                    {operation.blockId}
                                                {:else}
                                                    {t('aiSidebar.edit.blockId')}: {operation.blockId}
                                                {/if}
                                            </span>
                                            <span class="ai-message__edit-operation-status">
                                                {#if operation.status === 'applied'}
                                                    ✓ {t('aiSidebar.actions.applied')}
                                                {:else if operation.status === 'rejected'}
                                                    ✗ {t('aiSidebar.actions.rejected')}
                                                {:else}
                                                    ⏳ {t('aiSidebar.edit.changes')}
                                                {/if}
                                            </span>
                                        </div>
                                        <div class="ai-message__edit-operation-actions">
                                            <!-- 查看差异按钮：所有状态都可以查看 -->
                                            <button
                                                class="b3-button b3-button--text"
                                                on:click={() => viewDiff(operation)}
                                                title={t('aiSidebar.actions.viewDiff')}
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconEye"></use>
                                                </svg>
                                                {t('aiSidebar.actions.viewDiff')}
                                            </button>

                                            {#if operation.status === 'pending'}
                                                <!-- 应用和拒绝按钮：仅在pending状态显示 -->
                                                <button
                                                    class="b3-button b3-button--outline"
                                                    on:click={() =>
                                                        applyEditOperation(
                                                            operation,
                                                            messageIndex + msgIndex
                                                        )}
                                                    title={t('aiSidebar.actions.applyEdit')}
                                                >
                                                    <svg class="b3-button__icon">
                                                        <use xlink:href="#iconCheck"></use>
                                                    </svg>
                                                    {t('aiSidebar.actions.applyEdit')}
                                                </button>
                                                <button
                                                    class="b3-button b3-button--text"
                                                    on:click={() =>
                                                        rejectEditOperation(
                                                            operation,
                                                            messageIndex + msgIndex
                                                        )}
                                                    title={t('aiSidebar.actions.rejectEdit')}
                                                >
                                                    <svg class="b3-button__icon">
                                                        <use xlink:href="#iconClose"></use>
                                                    </svg>
                                                    {t('aiSidebar.actions.rejectEdit')}
                                                </button>
                                            {/if}
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    {/if}
                {/each}

                <!-- 消息操作按钮（组级别，只显示一次） -->
                <div class="ai-message__actions">
                    <button
                        class="b3-button b3-button--text ai-message__action"
                        on:click={() => copyMessage(getActualMessageContent(firstMessage))}
                        title={t('aiSidebar.actions.copyMessage')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                    </button>
                    <button
                        class="b3-button b3-button--text ai-message__action"
                        on:click={() => openSaveToNoteDialog(messageIndex)}
                        title={t('aiSidebar.actions.saveToNote')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconDownload"></use></svg>
                    </button>
                    <button
                        class="b3-button b3-button--text ai-message__action"
                        on:click={() => startEditMessage(messageIndex)}
                        title={t('aiSidebar.actions.editMessage')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                    </button>
                    <button
                        class="b3-button b3-button--text ai-message__action"
                        on:click={() => deleteMessage(messageIndex)}
                        title={t('aiSidebar.actions.deleteMessage')}
                    >
                        <svg class="b3-button__icon">
                            <use xlink:href="#iconTrashcan"></use>
                        </svg>
                    </button>
                    <button
                        class="b3-button b3-button--text ai-message__action"
                        on:click={() => regenerateMessage(messageIndex)}
                        title={group.type === 'user'
                            ? t('aiSidebar.actions.resend')
                            : t('aiSidebar.actions.regenerate')}
                    >
                        <svg class="b3-button__icon">
                            <use xlink:href="#iconRefresh"></use>
                        </svg>
                    </button>
                </div>
            </div>
        {/each}

        {#if isLoading && (streamingMessage || streamingThinking)}
            <div
                class="ai-message ai-message--assistant ai-message--streaming"
                on:contextmenu={e => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
            >
                <div class="ai-message__header">
                    <span class="ai-message__role">🤖 AI</span>
                    <span class="ai-message__streaming-indicator">●</span>
                </div>

                <!-- 显示流式思考过程 -->
                {#if streamingThinking}
                    <div class="ai-message__thinking">
                        <div class="ai-message__thinking-header">
                            <svg class="ai-message__thinking-icon">
                                <use xlink:href="#iconRight"></use>
                            </svg>
                            <span class="ai-message__thinking-title">
                                💭 思考中{isThinkingPhase ? '...' : ' (已完成)'}
                            </span>
                        </div>
                        {#if !isThinkingPhase}
                            <div class="ai-message__thinking-content b3-typography">
                                {@html formatMessage(streamingThinking)}
                            </div>
                        {:else}
                            <div
                                class="ai-message__thinking-content ai-message__thinking-content--streaming b3-typography"
                            >
                                {@html formatMessage(streamingThinking)}
                            </div>
                        {/if}
                    </div>
                {/if}

                {#if streamingMessage}
                    <div
                        class="ai-message__content b3-typography"
                        style={messageFontSize ? `font-size: ${messageFontSize}px;` : ''}
                    >
                        {@html formatMessage(streamingMessage)}
                    </div>
                {/if}
            </div>
        {/if}

        <!-- 多模型响应 -->
        {#if multiModelResponses.length > 0}
            <div class="ai-sidebar__multi-model-responses">
                <div class="ai-sidebar__multi-model-header">
                    <div class="ai-sidebar__multi-model-header-top">
                        <h3>{t('multiModel.responses')}</h3>
                        <div class="ai-sidebar__multi-model-layout-selector">
                            <button
                                class="b3-button b3-button--text b3-button--small"
                                class:b3-button--primary={multiModelLayout === 'card'}
                                on:click={() => (multiModelLayout = 'card')}
                                title={t('multiModel.layout.card')}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconLayout"></use>
                                </svg>
                                {t('multiModel.layout.card')}
                            </button>
                            <button
                                class="b3-button b3-button--text b3-button--small"
                                class:b3-button--primary={multiModelLayout === 'tab'}
                                on:click={() => (multiModelLayout = 'tab')}
                                title={t('multiModel.layout.tab')}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconTab"></use>
                                </svg>
                                {t('multiModel.layout.tab')}
                            </button>
                        </div>
                    </div>
                    {#if isWaitingForAnswerSelection}
                        <div class="ai-sidebar__multi-model-hint">
                            {t('multiModel.waitingSelection')}
                        </div>
                    {/if}
                </div>
                {#if multiModelLayout === 'card'}
                    <div class="ai-sidebar__multi-model-cards">
                        {#each multiModelResponses as response, index}
                            <div
                                class="ai-sidebar__multi-model-card"
                                class:ai-sidebar__multi-model-card--selected={selectedAnswerIndex ===
                                    index}
                            >
                                <div class="ai-sidebar__multi-model-card-header">
                                    <div class="ai-sidebar__multi-model-card-title">
                                        <span class="ai-sidebar__multi-model-card-model-name">
                                            {response.modelName}
                                            {#if selectedAnswerIndex === index}
                                                <span
                                                    class="ai-sidebar__multi-model-selected-indicator"
                                                >
                                                    ✅
                                                </span>
                                            {/if}
                                        </span>
                                        {#if response.isLoading}
                                            <span
                                                class="ai-sidebar__multi-model-card-status ai-sidebar__multi-model-card-status--loading"
                                            >
                                                ⏳ {t('multiModel.loading')}
                                            </span>
                                        {:else if response.error}
                                            <span
                                                class="ai-sidebar__multi-model-card-status ai-sidebar__multi-model-card-status--error"
                                            >
                                                ❌ {t('multiModel.error')}
                                            </span>
                                        {/if}
                                    </div>
                                    <div class="ai-sidebar__multi-model-card-actions">
                                        {#if !response.isLoading && !response.error}
                                            <button
                                                class="b3-button b3-button--text ai-sidebar__multi-model-copy-btn"
                                                on:click={() => copyMessage(response.content || '')}
                                                title={t('aiSidebar.actions.copyMessage')}
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconCopy"></use>
                                                </svg>
                                            </button>
                                        {/if}
                                        {#if !response.isLoading && isWaitingForAnswerSelection}
                                            <button
                                                class="b3-button b3-button--text"
                                                on:click={() => regenerateModelResponse(index)}
                                                title={t('aiSidebar.actions.regenerate')}
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconRefresh"></use>
                                                </svg>
                                            </button>
                                            <button
                                                class="b3-button b3-button--primary ai-sidebar__multi-model-select-btn"
                                                on:click={() => selectMultiModelAnswer(index)}
                                            >
                                                {selectedAnswerIndex === index
                                                    ? t('multiModel.answerSelected')
                                                    : t('multiModel.selectAnswer')}
                                            </button>
                                        {/if}
                                    </div>
                                </div>

                                <!-- 思考过程 -->
                                {#if response.thinking}
                                    <div class="ai-message__thinking">
                                        <div
                                            class="ai-message__thinking-header"
                                            on:click={() => {
                                                multiModelResponses[index].thinkingCollapsed =
                                                    !multiModelResponses[index].thinkingCollapsed;
                                                multiModelResponses = [...multiModelResponses];
                                            }}
                                        >
                                            <svg
                                                class="ai-message__thinking-icon"
                                                class:collapsed={response.thinkingCollapsed}
                                            >
                                                <use xlink:href="#iconRight"></use>
                                            </svg>
                                            <span class="ai-message__thinking-title">
                                                💭 {t('aiSidebar.thinkingProcess')}
                                            </span>
                                        </div>
                                        {#if !response.thinkingCollapsed}
                                            <div class="ai-message__thinking-content b3-typography">
                                                {@html formatMessage(response.thinking)}
                                            </div>
                                        {/if}
                                    </div>
                                {/if}

                                <div
                                    class="ai-sidebar__multi-model-card-content b3-typography"
                                    style={messageFontSize
                                        ? `font-size: ${messageFontSize}px;`
                                        : ''}
                                    on:contextmenu={e =>
                                        handleContextMenu(e, index, 'assistant', true)}
                                >
                                    {#if response.error}
                                        <div class="ai-sidebar__multi-model-card-error">
                                            {response.error}
                                        </div>
                                    {:else if response.content}
                                        {@html formatMessage(response.content)}
                                    {:else if response.isLoading}
                                        <div class="ai-sidebar__multi-model-card-loading">
                                            {t('multiModel.loading')}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>
                {:else}
                    <div class="ai-sidebar__multi-model-tabs">
                        <div class="ai-sidebar__multi-model-tab-headers">
                            {#each multiModelResponses as response, index}
                                <button
                                    class="ai-sidebar__multi-model-tab-header"
                                    class:ai-sidebar__multi-model-tab-header--active={selectedTabIndex ===
                                        index}
                                    on:click={() => (selectedTabIndex = index)}
                                >
                                    <span class="ai-sidebar__multi-model-tab-title">
                                        {response.modelName}
                                        {#if selectedAnswerIndex === index}
                                            <span
                                                class="ai-sidebar__multi-model-selected-indicator"
                                            >
                                                ✅
                                            </span>
                                        {/if}
                                    </span>
                                    {#if response.isLoading}
                                        <span
                                            class="ai-sidebar__multi-model-tab-status ai-sidebar__multi-model-tab-status--loading"
                                        >
                                            ⏳
                                        </span>
                                    {:else if response.error}
                                        <span
                                            class="ai-sidebar__multi-model-tab-status ai-sidebar__multi-model-tab-status--error"
                                        >
                                            ❌
                                        </span>
                                    {/if}
                                </button>
                            {/each}
                        </div>
                        <div class="ai-sidebar__multi-model-tab-content">
                            {#if multiModelResponses[selectedTabIndex]}
                                {@const response = multiModelResponses[selectedTabIndex]}
                                <div class="ai-sidebar__multi-model-tab-panel">
                                    <div class="ai-sidebar__multi-model-tab-panel-header">
                                        <div class="ai-sidebar__multi-model-tab-panel-title">
                                            <span
                                                class="ai-sidebar__multi-model-tab-panel-model-name"
                                            >
                                                {response.modelName}
                                                {#if selectedAnswerIndex === selectedTabIndex}
                                                    <span
                                                        class="ai-sidebar__multi-model-selected-indicator"
                                                    >
                                                        ✅
                                                    </span>
                                                {/if}
                                            </span>
                                            {#if response.isLoading}
                                                <span
                                                    class="ai-sidebar__multi-model-tab-panel-status ai-sidebar__multi-model-tab-panel-status--loading"
                                                >
                                                    ⏳ {t('multiModel.loading')}
                                                </span>
                                            {:else if response.error}
                                                <span
                                                    class="ai-sidebar__multi-model-tab-panel-status ai-sidebar__multi-model-tab-panel-status--error"
                                                >
                                                    ❌ {t('multiModel.error')}
                                                </span>
                                            {/if}
                                        </div>
                                        <div class="ai-sidebar__multi-model-tab-panel-actions">
                                            {#if !response.isLoading && !response.error}
                                                <button
                                                    class="b3-button b3-button--text ai-sidebar__multi-model-copy-btn"
                                                    on:click={() =>
                                                        copyMessage(response.content || '')}
                                                    title={t('aiSidebar.actions.copyMessage')}
                                                >
                                                    <svg class="b3-button__icon">
                                                        <use xlink:href="#iconCopy"></use>
                                                    </svg>
                                                </button>
                                            {/if}
                                            {#if !response.isLoading && isWaitingForAnswerSelection}
                                                <button
                                                    class="b3-button b3-button--text"
                                                    on:click={() =>
                                                        regenerateModelResponse(selectedTabIndex)}
                                                    title={t('aiSidebar.actions.regenerate')}
                                                >
                                                    <svg class="b3-button__icon">
                                                        <use xlink:href="#iconRefresh"></use>
                                                    </svg>
                                                </button>
                                                <button
                                                    class="b3-button b3-button--primary ai-sidebar__multi-model-select-btn"
                                                    on:click={() =>
                                                        selectMultiModelAnswer(selectedTabIndex)}
                                                >
                                                    {selectedAnswerIndex === selectedTabIndex
                                                        ? t('multiModel.answerSelected')
                                                        : t('multiModel.selectAnswer')}
                                                </button>
                                            {/if}
                                        </div>
                                    </div>

                                    {#if response.thinking}
                                        <div class="ai-message__thinking">
                                            <div
                                                class="ai-message__thinking-header"
                                                on:click={() => {
                                                    multiModelResponses[
                                                        selectedTabIndex
                                                    ].thinkingCollapsed =
                                                        !multiModelResponses[selectedTabIndex]
                                                            .thinkingCollapsed;
                                                    multiModelResponses = [...multiModelResponses];
                                                }}
                                            >
                                                <svg
                                                    class="ai-message__thinking-icon"
                                                    class:collapsed={response.thinkingCollapsed}
                                                >
                                                    <use xlink:href="#iconRight"></use>
                                                </svg>
                                                <span class="ai-message__thinking-title">
                                                    💭 思考过程
                                                </span>
                                            </div>
                                            {#if !response.thinkingCollapsed}
                                                <div
                                                    class="ai-message__thinking-content b3-typography"
                                                >
                                                    {@html formatMessage(response.thinking)}
                                                </div>
                                            {/if}
                                        </div>
                                    {/if}

                                    <div
                                        class="ai-sidebar__multi-model-tab-panel-content b3-typography"
                                        style={messageFontSize
                                            ? `font-size: ${messageFontSize}px;`
                                            : ''}
                                        on:contextmenu={e =>
                                            handleContextMenu(
                                                e,
                                                selectedTabIndex,
                                                'assistant',
                                                true
                                            )}
                                    >
                                        {#if response.error}
                                            <div class="ai-sidebar__multi-model-tab-panel-error">
                                                {response.error}
                                            </div>
                                        {:else if response.content}
                                            {@html formatMessage(response.content)}
                                        {:else if response.isLoading}
                                            <div class="ai-sidebar__multi-model-tab-panel-loading">
                                                {t('multiModel.loading')}
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>
        {/if}

        {#if messages.filter(msg => msg.role !== 'system').length === 0 && !isLoading}
            <div class="ai-sidebar__empty">
                <div class="ai-sidebar__empty-icon">💬</div>
                <p>{t('aiSidebar.empty.greeting')}</p>
            </div>
        {/if}
    </div>

    <div
        class="ai-sidebar__input-container"
        bind:this={inputContainer}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
        on:drop={handleDrop}
    >
        <!-- 模式选择 -->
        <div class="ai-sidebar__mode-selector">
            <label for="chat-mode-select" class="ai-sidebar__mode-label">
                {t('aiSidebar.mode.label')}:
            </label>
            <select
                id="chat-mode-select"
                class="b3-select ai-sidebar__mode-select"
                bind:value={chatMode}
            >
                <option value="ask">{t('aiSidebar.mode.ask')}</option>
                <option value="edit">{t('aiSidebar.mode.edit')}</option>
                <option value="agent">{t('aiSidebar.mode.agent')}</option>
            </select>

            <!-- 自动批准复选框（仅在编辑模式下显示） -->
            {#if chatMode === 'edit'}
                <label class="ai-sidebar__auto-approve-label">
                    <input type="checkbox" class="b3-switch" bind:checked={autoApproveEdit} />
                    <span>{t('aiSidebar.mode.autoApprove')}</span>
                </label>
            {/if}

            <!-- Agent模式工具选择按钮 -->
            {#if chatMode === 'agent'}
                <button
                    class="b3-button b3-button--text ai-sidebar__tool-selector-btn"
                    on:click={() => (isToolSelectorOpen = !isToolSelectorOpen)}
                    title={t('aiSidebar.agent.selectTools')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                    <span>{t('aiSidebar.agent.tools')} ({selectedTools.length})</span>
                </button>
            {/if}

            <!-- 多模型对话按钮（仅在问答模式下显示） -->
            {#if chatMode === 'ask'}
                <div class="ai-sidebar__multi-model-selector-wrapper">
                    <MultiModelSelector
                        {providers}
                        bind:selectedModels={selectedMultiModels}
                        bind:enableMultiModel
                        on:change={handleMultiModelChange}
                        on:toggleEnable={handleToggleMultiModel}
                        on:toggleThinking={handleToggleModelThinking}
                    />
                </div>
            {/if}
        </div>

        <!-- 上下文文档和附件列表 -->
        {#if contextDocuments.length > 0 || currentAttachments.length > 0}
            <div class="ai-sidebar__context-docs">
                <div class="ai-sidebar__context-docs-list">
                    <!-- 显示上下文文档 -->
                    {#each contextDocuments as doc (doc.id)}
                        <div class="ai-sidebar__context-doc-item">
                            <button
                                class="ai-sidebar__context-doc-remove"
                                on:click={() => removeContextDocument(doc.id)}
                                title="移除文档"
                            >
                                ×
                            </button>
                            <button
                                class="ai-sidebar__context-doc-link"
                                on:click={() => openDocument(doc.id)}
                                title="点击查看文档"
                            >
                                📄 {doc.title}
                            </button>
                            <button
                                class="b3-button b3-button--text ai-sidebar__context-doc-copy"
                                on:click={() => copyMessage(doc.content || '')}
                                title={t('aiSidebar.actions.copyMessage')}
                            >
                                <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                            </button>
                        </div>
                    {/each}

                    <!-- 显示当前附件 -->
                    {#each currentAttachments as attachment, index}
                        <div class="ai-sidebar__context-doc-item">
                            <button
                                class="ai-sidebar__context-doc-remove"
                                on:click={() => removeAttachment(index)}
                                title="移除附件"
                            >
                                ×
                            </button>
                            {#if attachment.type === 'image'}
                                <img
                                    src={attachment.data}
                                    alt={attachment.name}
                                    class="ai-sidebar__context-attachment-preview"
                                    title={attachment.name}
                                />
                                <span class="ai-sidebar__context-doc-name" title={attachment.name}>
                                    🖼️ {attachment.name}
                                </span>
                            {:else}
                                <svg class="ai-sidebar__context-attachment-icon">
                                    <use xlink:href="#iconFile"></use>
                                </svg>
                                <span class="ai-sidebar__context-doc-name" title={attachment.name}>
                                    📄 {attachment.name}
                                </span>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>
        {/if}

        <div class="ai-sidebar__input-row">
            <div class="ai-sidebar__input-wrapper">
                <textarea
                    bind:this={textareaElement}
                    bind:value={currentInput}
                    on:keydown={handleKeydown}
                    on:paste={handlePaste}
                    placeholder={t('aiSidebar.input.placeholder')}
                    class="ai-sidebar__input"
                    rows="1"
                ></textarea>
                <button
                    class="b3-button ai-sidebar__send-btn"
                    class:b3-button--primary={!isLoading}
                    class:ai-sidebar__send-btn--abort={isLoading}
                    on:click={isLoading ? abortMessage : sendMessage}
                    disabled={!isLoading && !currentInput.trim() && currentAttachments.length === 0}
                    title={isLoading ? '中断生成' : '发送消息'}
                >
                    {#if isLoading}
                        <svg class="b3-button__icon">
                            <use xlink:href="#iconPause"></use>
                        </svg>
                    {:else}
                        <svg class="b3-button__icon"><use xlink:href="#iconUp"></use></svg>
                    {/if}
                </button>
            </div>
        </div>

        <!-- 隐藏的文件上传 input -->
        <input
            type="file"
            bind:this={fileInputElement}
            on:change={handleFileSelect}
            accept="image/*,.txt,.md,.json,.xml,.csv,text/*"
            multiple
            style="display: none;"
        />
        <div class="ai-sidebar__bottom-row">
            <button
                class="b3-button b3-button--text ai-sidebar__upload-btn"
                on:click={triggerFileUpload}
                disabled={isUploadingFile || isLoading}
                title={t('aiSidebar.actions.upload')}
            >
                {#if isUploadingFile}
                    <svg class="b3-button__icon ai-sidebar__loading-icon">
                        <use xlink:href="#iconRefresh"></use>
                    </svg>
                {:else}
                    <svg class="b3-button__icon"><use xlink:href="#iconUpload"></use></svg>
                {/if}
            </button>
            <button
                class="b3-button b3-button--text ai-sidebar__search-btn"
                on:click={() => {
                    isSearchDialogOpen = !isSearchDialogOpen;
                    // 打开对话框时，如果搜索关键词为空，自动加载当前文档
                    if (isSearchDialogOpen && !searchKeyword.trim()) {
                        searchDocuments();
                    }
                }}
                title={t('aiSidebar.actions.search')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconSearch"></use></svg>
            </button>
            <div class="ai-sidebar__prompt-actions">
                <button
                    class="b3-button b3-button--text"
                    on:click={() => (isPromptSelectorOpen = !isPromptSelectorOpen)}
                    title={t('aiSidebar.prompt.title')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconQuote"></use></svg>
                </button>
            </div>
            <!-- 模型设置按钮 -->
            <ModelPresetButton
                {providers}
                {currentProvider}
                {currentModelId}
                appliedSettings={tempModelSettings}
                on:apply={handleApplyModelSettings}
                {plugin}
            />
            {#if !(chatMode === 'ask' && enableMultiModel)}
                <div class="ai-sidebar__model-selector-wrapper">
                    {#if showThinkingToggle}
                        <div class="ai-sidebar__thinking-toggle-container">
                            <button
                                class="ai-sidebar__thinking-toggle b3-button b3-button--text"
                                class:ai-sidebar__thinking-toggle--active={isThinkingModeEnabled}
                                on:click={toggleThinkingMode}
                                title={isThinkingModeEnabled
                                    ? t('thinking.enabled')
                                    : t('thinking.disabled')}
                                disabled={!currentProvider || !currentModelId}
                            >
                                {t('thinking.toggle')}
                            </button>
                            {#if showThinkingEffortSelector}
                                <select
                                    class="ai-sidebar__thinking-effort-select b3-select"
                                    value={currentThinkingEffort}
                                    on:change={handleThinkingEffortChange}
                                    title={t('thinking.effort.title')}
                                >
                                    {#if isCurrentModelGemini}
                                        <option value="auto">{t('thinking.effort.auto')}</option>
                                    {/if}
                                    <option value="low">{t('thinking.effort.low')}</option>
                                    <option value="medium">{t('thinking.effort.medium')}</option>
                                    <option value="high">{t('thinking.effort.high')}</option>
                                </select>
                            {/if}
                        </div>
                    {/if}
                    <div class="ai-sidebar__model-selector-container">
                        <ModelSelector
                            {providers}
                            {currentProvider}
                            {currentModelId}
                            on:select={handleModelSelect}
                        />
                    </div>
                </div>
            {/if}
        </div>

        <!-- 提示词选择器下拉菜单 -->
        {#if isPromptSelectorOpen}
            <div class="ai-sidebar__prompt-selector">
                <div class="ai-sidebar__prompt-list">
                    <!-- 新建提示词按钮 -->
                    <button
                        class="ai-sidebar__prompt-item ai-sidebar__prompt-item--new"
                        on:click={openPromptManager}
                    >
                        <svg class="ai-sidebar__prompt-item-icon">
                            <use xlink:href="#iconAdd"></use>
                        </svg>
                        <span class="ai-sidebar__prompt-item-title">
                            {t('aiSidebar.prompt.new')}
                        </span>
                    </button>

                    {#if prompts.length > 0}
                        <div class="ai-sidebar__prompt-divider-small"></div>
                        {#each prompts as prompt (prompt.id)}
                            <button
                                class="ai-sidebar__prompt-item"
                                on:click={() => usePrompt(prompt)}
                                title={prompt.content}
                            >
                                <span class="ai-sidebar__prompt-item-title">{prompt.title}</span>
                                <button
                                    class="ai-sidebar__prompt-item-edit"
                                    on:click|stopPropagation={() => editPrompt(prompt)}
                                    title="编辑"
                                >
                                    <svg class="b3-button__icon">
                                        <use xlink:href="#iconEdit"></use>
                                    </svg>
                                </button>
                            </button>
                        {/each}
                    {/if}
                </div>
            </div>
        {/if}
    </div>

    <!-- 提示词管理对话框 -->
    {#if isPromptManagerOpen}
        <div class="ai-sidebar__prompt-dialog">
            <div class="ai-sidebar__prompt-dialog-overlay" on:click={closePromptManager}></div>
            <div class="ai-sidebar__prompt-dialog-content">
                <div class="ai-sidebar__prompt-dialog-header">
                    <h4>
                        {editingPrompt ? t('aiSidebar.prompt.edit') : t('aiSidebar.prompt.create')}
                    </h4>
                    <button class="b3-button b3-button--text" on:click={closePromptManager}>
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                <div class="ai-sidebar__prompt-dialog-body">
                    <div class="ai-sidebar__prompt-form">
                        <div class="ai-sidebar__prompt-form-field">
                            <label class="ai-sidebar__prompt-form-label">标题</label>
                            <input
                                type="text"
                                bind:value={newPromptTitle}
                                placeholder={t('aiSidebar.prompt.titlePlaceholder')}
                                class="b3-text-field"
                            />
                        </div>
                        <div class="ai-sidebar__prompt-form-field">
                            <label class="ai-sidebar__prompt-form-label">内容</label>
                            <textarea
                                bind:value={newPromptContent}
                                placeholder="输入提示词内容"
                                class="b3-text-field ai-sidebar__prompt-textarea"
                                rows="20"
                            ></textarea>
                        </div>
                        <div class="ai-sidebar__prompt-form-actions">
                            <button
                                class="b3-button b3-button--cancel"
                                on:click={closePromptManager}
                            >
                                取消
                            </button>
                            <button class="b3-button b3-button--primary" on:click={saveNewPrompt}>
                                {editingPrompt ? '更新' : '保存'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    {/if}

    <!-- 搜索对话框 -->
    {#if isSearchDialogOpen}
        <div class="ai-sidebar__search-dialog">
            <div
                class="ai-sidebar__search-dialog-overlay"
                on:click={() => (isSearchDialogOpen = false)}
            ></div>
            <div class="ai-sidebar__search-dialog-content">
                <div class="ai-sidebar__search-dialog-header">
                    <h4>{t('aiSidebar.search.title')}</h4>
                    <button
                        class="b3-button b3-button--text"
                        on:click={() => (isSearchDialogOpen = false)}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                <div class="ai-sidebar__search-dialog-body">
                    <div class="ai-sidebar__search-input-row">
                        <input
                            type="text"
                            bind:value={searchKeyword}
                            on:input={autoSearch}
                            on:paste={autoSearch}
                            placeholder={t('aiSidebar.search.placeholder')}
                            class="b3-text-field"
                        />
                        {#if isSearching}
                            <div class="ai-sidebar__search-loading">
                                <svg class="b3-button__icon ai-sidebar__loading-icon">
                                    <use xlink:href="#iconRefresh"></use>
                                </svg>
                            </div>
                        {/if}
                    </div>
                    <div class="ai-sidebar__search-results">
                        {#if searchResults.length > 0}
                            {#each searchResults as result (result.id)}
                                <div class="ai-sidebar__search-result-item">
                                    <div class="ai-sidebar__search-result-title">
                                        {result.content || t('common.untitled')}
                                        {#if !searchKeyword.trim()}
                                            <span class="ai-sidebar__search-current-doc-badge">
                                                {t('aiSidebar.search.currentDoc')}
                                            </span>
                                        {/if}
                                    </div>
                                    <button
                                        class="b3-button b3-button--text"
                                        on:click={() =>
                                            addDocumentToContext(
                                                result.id,
                                                result.content || t('common.untitled')
                                            )}
                                    >
                                        {t('aiSidebar.search.add')}
                                    </button>
                                </div>
                            {/each}
                        {:else if !isSearching && searchKeyword}
                            <div class="ai-sidebar__search-empty">
                                {t('aiSidebar.search.noResults')}
                            </div>
                        {:else if !isSearching && !searchKeyword}
                            <div class="ai-sidebar__search-empty">
                                {t('aiSidebar.search.noCurrentDoc')}
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    {/if}

    <!-- 编辑消息弹窗 -->
    {#if isEditDialogOpen}
        <div class="ai-sidebar__edit-dialog">
            <div class="ai-sidebar__edit-dialog-overlay" on:click={cancelEditMessage}></div>
            <div class="ai-sidebar__edit-dialog-content">
                <div class="ai-sidebar__edit-dialog-header">
                    <h3>{t('aiSidebar.actions.editMessage')}</h3>
                    <button class="b3-button b3-button--cancel" on:click={cancelEditMessage}>
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                <div class="ai-sidebar__edit-dialog-body">
                    <textarea
                        class="ai-sidebar__edit-dialog-textarea"
                        bind:value={editingMessageContent}
                        rows="15"
                        autofocus
                    ></textarea>
                </div>
                <div class="ai-sidebar__edit-dialog-footer">
                    <button class="b3-button b3-button--cancel" on:click={cancelEditMessage}>
                        {t('aiSidebar.actions.cancel')}
                    </button>
                    <button class="b3-button b3-button--text" on:click={saveEditMessage}>
                        {t('aiSidebar.actions.save')}
                    </button>
                </div>
            </div>
        </div>
    {/if}

    <!-- 差异对比对话框 -->
    {#if isDiffDialogOpen && currentDiffOperation}
        <div class="ai-sidebar__diff-dialog">
            <div class="ai-sidebar__diff-dialog-overlay" on:click={closeDiffDialog}></div>
            <div class="ai-sidebar__diff-dialog-content">
                <div class="ai-sidebar__diff-dialog-header">
                    <h3>
                        {#if currentDiffOperation.operationType === 'insert'}
                            {t('aiSidebar.edit.insertBlock')} - {t('aiSidebar.actions.viewDiff')}
                        {:else}
                            {t('aiSidebar.actions.viewDiff')}
                        {/if}
                    </h3>
                    {#if currentDiffOperation.operationType !== 'insert'}
                        <div class="ai-sidebar__diff-mode-selector">
                            <button
                                class="b3-button b3-button--text"
                                class:b3-button--primary={diffViewMode === 'diff'}
                                on:click={() => (diffViewMode = 'diff')}
                            >
                                {t('aiSidebar.diff.modeUnified')}
                            </button>
                            <button
                                class="b3-button b3-button--text"
                                class:b3-button--primary={diffViewMode === 'split'}
                                on:click={() => (diffViewMode = 'split')}
                            >
                                {t('aiSidebar.diff.modeSplit')}
                            </button>
                        </div>
                    {/if}
                    <button class="b3-button b3-button--cancel" on:click={closeDiffDialog}>
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                <div class="ai-sidebar__diff-dialog-body">
                    <div class="ai-sidebar__diff-info">
                        {#if currentDiffOperation.operationType === 'insert'}
                            <strong>{t('aiSidebar.edit.insertBlock')}:</strong>
                            {currentDiffOperation.position === 'before'
                                ? t('aiSidebar.edit.before')
                                : t('aiSidebar.edit.after')}
                            {currentDiffOperation.blockId}
                        {:else}
                            <strong>{t('aiSidebar.edit.blockId')}:</strong>
                            {currentDiffOperation.blockId}
                        {/if}
                    </div>
                    {#if currentDiffOperation.operationType === 'insert'}
                        <!-- 插入操作：只显示新内容 -->
                        <div class="ai-sidebar__diff-content">
                            <div
                                class="ai-sidebar__diff-split-header"
                                style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;"
                            >
                                <span>{t('aiSidebar.edit.insertContent')}</span>
                                <button
                                    class="b3-button b3-button--text b3-button--small"
                                    on:click={() => {
                                        navigator.clipboard.writeText(
                                            currentDiffOperation.newContent
                                        );
                                        pushMsg(t('aiSidebar.success.copySuccess'));
                                    }}
                                    title={t('aiSidebar.actions.copyNewContent')}
                                >
                                    <svg class="b3-button__icon">
                                        <use xlink:href="#iconCopy"></use>
                                    </svg>
                                    {t('aiSidebar.actions.copy')}
                                </button>
                            </div>
                            <pre
                                class="ai-sidebar__diff-split-content"
                                style="border: 1px solid var(--b3-theme-success); background-color: var(--b3-theme-success-lighter);">{currentDiffOperation.newContent}</pre>
                        </div>
                    {:else if currentDiffOperation.oldContent}
                        {#if diffViewMode === 'diff'}
                            <!-- Diff模式：传统的行对比视图 -->
                            <div class="ai-sidebar__diff-actions">
                                <button
                                    class="b3-button b3-button--text b3-button--small"
                                    on:click={() => {
                                        navigator.clipboard.writeText(
                                            currentDiffOperation.oldContent
                                        );
                                        pushMsg(t('aiSidebar.success.copySuccess'));
                                    }}
                                    title={t('aiSidebar.actions.copyOldContent')}
                                >
                                    <svg class="b3-button__icon">
                                        <use xlink:href="#iconCopy"></use>
                                    </svg>
                                    {t('aiSidebar.actions.copyBefore')}
                                </button>
                                <button
                                    class="b3-button b3-button--text b3-button--small"
                                    on:click={() => {
                                        navigator.clipboard.writeText(
                                            currentDiffOperation.newContent
                                        );
                                        pushMsg(t('aiSidebar.success.copySuccess'));
                                    }}
                                    title={t('aiSidebar.actions.copyNewContent')}
                                >
                                    <svg class="b3-button__icon">
                                        <use xlink:href="#iconCopy"></use>
                                    </svg>
                                    {t('aiSidebar.actions.copyAfter')}
                                </button>
                            </div>
                            <div class="ai-sidebar__diff-content">
                                {#each generateSimpleDiff(currentDiffOperation.oldContent, currentDiffOperation.newContent) as line}
                                    <div
                                        class="ai-sidebar__diff-line ai-sidebar__diff-line--{line.type}"
                                    >
                                        {#if line.type === 'removed'}
                                            <span class="ai-sidebar__diff-marker">-</span>
                                        {:else if line.type === 'added'}
                                            <span class="ai-sidebar__diff-marker">+</span>
                                        {:else}
                                            <span class="ai-sidebar__diff-marker"></span>
                                        {/if}
                                        <span class="ai-sidebar__diff-text">{line.line}</span>
                                    </div>
                                {/each}
                            </div>
                        {:else}
                            <!-- Split模式：左右分栏视图 -->
                            <div class="ai-sidebar__diff-split">
                                <div class="ai-sidebar__diff-split-column">
                                    <div class="ai-sidebar__diff-split-header">
                                        <span>{t('aiSidebar.edit.before')}</span>
                                        <button
                                            class="b3-button b3-button--text b3-button--small"
                                            on:click={() => {
                                                navigator.clipboard.writeText(
                                                    currentDiffOperation.oldContent
                                                );
                                                pushMsg(t('aiSidebar.success.copySuccess'));
                                            }}
                                            title={t('aiSidebar.actions.copyOldContent')}
                                        >
                                            <svg class="b3-button__icon">
                                                <use xlink:href="#iconCopy"></use>
                                            </svg>
                                        </button>
                                    </div>
                                    <pre
                                        class="ai-sidebar__diff-split-content">{currentDiffOperation.oldContent}</pre>
                                </div>
                                <div class="ai-sidebar__diff-split-column">
                                    <div class="ai-sidebar__diff-split-header">
                                        <span>{t('aiSidebar.edit.after')}</span>
                                        <button
                                            class="b3-button b3-button--text b3-button--small"
                                            on:click={() => {
                                                navigator.clipboard.writeText(
                                                    currentDiffOperation.newContent
                                                );
                                                pushMsg(t('aiSidebar.success.copySuccess'));
                                            }}
                                            title={t('aiSidebar.actions.copyNewContent')}
                                        >
                                            <svg class="b3-button__icon">
                                                <use xlink:href="#iconCopy"></use>
                                            </svg>
                                        </button>
                                    </div>
                                    <pre
                                        class="ai-sidebar__diff-split-content">{currentDiffOperation.newContent}</pre>
                                </div>
                            </div>
                        {/if}
                    {:else}
                        <div class="ai-sidebar__diff-loading">
                            {t('common.loading')}
                        </div>
                    {/if}
                </div>
                <div class="ai-sidebar__diff-dialog-footer">
                    <button class="b3-button b3-button--cancel" on:click={closeDiffDialog}>
                        {t('common.close')}
                    </button>
                </div>
            </div>
        </div>
    {/if}

    <!-- 右键菜单 -->
    {#if contextMenuVisible}
        <div
            class="ai-sidebar__context-menu"
            style="left: {contextMenuX}px; top: {contextMenuY}px;"
        >
            {#if contextMenuIsMultiModel}
                {#if selectionInMessage}
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_md')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>复制（Markdown，默认）</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_plain')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>复制（纯文本）</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_html')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>复制（富文本）</span>
                    </button>
                {:else}
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_md')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>复制（Markdown，默认）</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_plain')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>复制（纯文本）</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_html')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>复制（富文本）</span>
                    </button>
                {/if}
            {:else}
                {#if selectionInMessage}
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_md')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>复制（Markdown，默认）</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_plain')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>复制（纯文本）</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_html')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>复制（富文本）</span>
                    </button>
                {:else}
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copyMessage')}</span>
                    </button>
                {/if}

                <button
                    class="ai-sidebar__context-menu-item"
                    on:click={() => handleContextMenuAction('edit')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                    <span>{t('aiSidebar.actions.editMessage')}</span>
                </button>
                <button
                    class="ai-sidebar__context-menu-item"
                    on:click={() => handleContextMenuAction('delete')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                    <span>{t('aiSidebar.actions.deleteMessage')}</span>
                </button>
                <div class="ai-sidebar__context-menu-divider"></div>
                <button
                    class="ai-sidebar__context-menu-item"
                    on:click={() => handleContextMenuAction('save')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconDownload"></use></svg>
                    <span>{t('aiSidebar.actions.saveToNote')}</span>
                </button>
                <button
                    class="ai-sidebar__context-menu-item"
                    on:click={() => handleContextMenuAction('regenerate')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                    <span>
                        {contextMenuMessageType === 'user'
                            ? t('aiSidebar.actions.resend')
                            : t('aiSidebar.actions.regenerate')}
                    </span>
                </button>
            {/if}
        </div>
    {/if}

    <!-- 工具选择器对话框 -->
    {#if isToolSelectorOpen}
        <ToolSelector bind:selectedTools on:close={() => (isToolSelectorOpen = false)} />
    {/if}

    <!-- 保存到笔记对话框 -->
    {#if isSaveToNoteDialogOpen}
        <div class="save-to-note-dialog__overlay" on:click={closeSaveToNoteDialog}></div>
        <div class="save-to-note-dialog">
            <div class="save-to-note-dialog__header">
                <h3>{t('aiSidebar.session.saveToNote.title')}</h3>
                <button
                    class="b3-button b3-button--text"
                    on:click={closeSaveToNoteDialog}
                    title={t('common.close')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                </button>
            </div>

            <!-- 如果有全局默认路径，显示切换到当前文档的按钮 -->
            {#if hasDefaultPath && currentDocPath && currentDocNotebookId}
                <div class="save-to-note-dialog__switch-bar">
                    <button
                        class="b3-button b3-button--outline"
                        on:click={useCurrentDocPath}
                        title={t('aiSidebar.session.saveToNote.useCurrentDoc')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconFile"></use></svg>
                        <span>{t('aiSidebar.session.saveToNote.useCurrentDoc')}</span>
                    </button>
                </div>
            {/if}

            <div class="save-to-note-dialog__content">
                <div class="save-to-note-dialog__field">
                    <label>{t('aiSidebar.session.saveToNote.documentName')}</label>
                    <input
                        type="text"
                        class="b3-text-field"
                        bind:value={saveDocumentName}
                        placeholder={t('aiSidebar.session.saveToNote.documentNamePlaceholder')}
                    />
                </div>

                <div class="save-to-note-dialog__field">
                    <label>{t('aiSidebar.session.saveToNote.notebook')}</label>
                    <select
                        class="b3-select"
                        bind:value={saveNotebookId}
                        on:change={searchSavePath}
                    >
                        {#if saveDialogNotebooks.length > 0}
                            {#each saveDialogNotebooks as notebook}
                                <option value={notebook.id}>{notebook.name}</option>
                            {/each}
                        {:else}
                            <option value="">{t('common.loading')}</option>
                        {/if}
                    </select>
                </div>

                <div class="save-to-note-dialog__field">
                    <label>{t('aiSidebar.session.saveToNote.path')}</label>
                    <div class="save-to-note-dialog__path-input-wrapper">
                        <input
                            type="text"
                            class="b3-text-field"
                            bind:value={savePathSearchKeyword}
                            on:focus={() => (showSavePathDropdown = true)}
                            on:blur={() => {
                                setTimeout(() => (showSavePathDropdown = false), 200);
                            }}
                            placeholder={t('aiSidebar.session.saveToNote.pathPlaceholder')}
                        />
                        <!-- 路径搜索结果下拉框 -->
                        {#if showSavePathDropdown && (savePathSearchResults.length > 0 || isSavePathSearching)}
                            <div class="save-to-note-dialog__path-dropdown">
                                {#if isSavePathSearching}
                                    <div class="save-to-note-dialog__path-loading">
                                        {t('aiSidebar.session.saveToNote.searching')}
                                    </div>
                                {:else if savePathSearchResults.length > 0}
                                    {#each savePathSearchResults as doc}
                                        <div
                                            class="save-to-note-dialog__path-item"
                                            on:click={() => selectSavePath(doc.hPath)}
                                            on:keydown={e => {
                                                if (e.key === 'Enter') selectSavePath(doc.hPath);
                                            }}
                                            role="button"
                                            tabindex="0"
                                            title={doc.hPath}
                                        >
                                            <svg class="b3-button__icon">
                                                <use xlink:href="#iconFile"></use>
                                            </svg>
                                            <span>{doc.hPath}</span>
                                        </div>
                                    {/each}
                                {/if}
                            </div>
                        {/if}
                    </div>
                </div>
            </div>

            <div class="save-to-note-dialog__footer">
                <label class="save-to-note-dialog__footer-option">
                    <input type="checkbox" class="b3-switch" bind:checked={openAfterSave} />
                    <span>{t('aiSidebar.session.saveToNote.openAfterSave')}</span>
                </label>
                <div class="save-to-note-dialog__footer-buttons">
                    <button class="b3-button b3-button--cancel" on:click={closeSaveToNoteDialog}>
                        {t('aiSidebar.session.saveToNote.cancel')}
                    </button>
                    <button class="b3-button b3-button--primary" on:click={confirmSaveToNote}>
                        {t('aiSidebar.session.saveToNote.confirm')}
                    </button>
                </div>
            </div>
        </div>
    {/if}

    <!-- 工具批准对话框 -->
    {#if isToolApprovalDialogOpen && pendingToolCall}
        <div class="tool-approval-dialog__overlay" on:click={rejectToolCall}></div>
        <div class="tool-approval-dialog">
            <div class="tool-approval-dialog__header">
                <h3>{t('tools.waitingApproval')}</h3>
                <button
                    class="b3-button b3-button--text"
                    on:click={rejectToolCall}
                    title={t('common.close')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                </button>
            </div>

            <div class="tool-approval-dialog__content">
                <div class="tool-approval-dialog__tool-info">
                    <div class="tool-approval-dialog__tool-name">
                        <svg class="b3-button__icon">
                            <use xlink:href="#iconSettings"></use>
                        </svg>
                        <strong>{getToolDisplayName(pendingToolCall.function.name)}</strong>
                    </div>
                    <div class="tool-approval-dialog__tool-id">
                        ID: {pendingToolCall.id}
                    </div>
                </div>

                <div class="tool-approval-dialog__params">
                    <div class="tool-approval-dialog__section-title">
                        {t('tools.selector.parameters')}:
                    </div>
                    <pre class="tool-approval-dialog__code">{pendingToolCall.function
                            .arguments}</pre>
                </div>

                <div class="tool-approval-dialog__warning">
                    <svg class="b3-button__icon"><use xlink:href="#iconInfo"></use></svg>
                    <span>请仔细检查参数，确认无误后再批准执行</span>
                </div>
            </div>

            <div class="tool-approval-dialog__footer">
                <button class="b3-button b3-button--cancel" on:click={rejectToolCall}>
                    <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    {t('tools.reject')}
                </button>
                <button class="b3-button b3-button--primary" on:click={approveToolCall}>
                    <svg class="b3-button__icon"><use xlink:href="#iconCheck"></use></svg>
                    {t('tools.approve')}
                </button>
            </div>
        </div>
    {/if}
</div>

<style lang="scss">
    .ai-sidebar {
        display: flex;
        flex-direction: column;
        height: 100%;
        background-color: var(--b3-theme-background);
        overflow: hidden;
    }

    .ai-sidebar__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid var(--b3-border-color);
        flex-shrink: 0;
        min-width: 0; /* 允许在flex布局中缩小 */
    }

    .ai-sidebar__title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 1; /* 标题可以缩小 */
        min-width: 0; /* 允许标题缩小 */
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ai-sidebar__unsaved {
        color: var(--b3-theme-primary);
        font-size: 12px;
        animation: pulse 2s ease-in-out infinite;
        flex-shrink: 0; /* 防止未保存标记被压缩 */
    }

    .ai-sidebar__actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0; /* 操作按钮不缩小 */
        flex-wrap: wrap; /* 在窄宽度下换行 */
        justify-content: flex-end;
    }

    .ai-sidebar__open-window-menu-container {
        position: relative;
    }

    .ai-sidebar__open-window-menu {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 4px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        box-shadow: var(--b3-dialog-shadow);
        z-index: 1000;
        min-width: 150px;
        overflow: hidden;
    }

    .ai-sidebar__open-window-menu .b3-menu__item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        width: 100%;
        border: none;
        background: none;
        text-align: left;
        cursor: pointer;
        color: var(--b3-theme-on-background);
        font-size: 14px;
        transition: background-color 0.2s;

        &:hover {
            background: var(--b3-list-hover);
        }

        .b3-menu__icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }

        .b3-menu__label {
            flex: 1;
        }
    }

    .ai-sidebar__context-docs {
        flex-shrink: 0;
    }

    .ai-sidebar__context-docs-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
        margin-bottom: 8px;
    }

    .ai-sidebar__context-docs-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .ai-sidebar__context-doc-item {
        display: inline-flex;
        align-items: center;
        padding: 4px 4px;
        background: var(--b3-theme-background);
        border-radius: 12px;
        border: 1px solid var(--b3-border-color);
        transition: all 0.2s ease;
        cursor: pointer;
        max-width: 100%;

        &:hover {
            background: var(--b3-theme-surface);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            transform: translateY(-1px);
        }
    }

    .ai-sidebar__context-doc-remove {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        padding: 0;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.15s ease;

        &:hover {
            background: var(--b3-theme-error-lighter);
            color: var(--b3-theme-error);
            transform: scale(1.1);
        }
    }

    .ai-sidebar__context-doc-copy {
        flex-shrink: 0;
        padding: 2px;
        border: none;
        background: none;
        cursor: pointer;
        color: var(--b3-theme-on-surface-light);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.15s ease;

        .b3-button__icon {
            width: 14px;
            height: 14px;
        }

        &:hover {
            color: var(--b3-theme-primary);
            background: var(--b3-theme-primary-lightest);
            transform: scale(1.1);
        }
    }

    .ai-sidebar__context-doc-link {
        flex: 1;
        text-align: left;
        padding: 0 4px;
        border: none;
        background: none;
        color: var(--b3-theme-primary);
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        transition: color 0.15s ease;

        &:hover {
            color: var(--b3-theme-primary);
        }
    }

    .ai-sidebar__context-doc-name {
        flex: 1;
        font-size: 13px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0 4px;
    }

    .ai-sidebar__context-attachment-preview {
        width: 28px;
        height: 28px;
        object-fit: cover;
        border-radius: 6px;
        flex-shrink: 0;
        border: 1px solid var(--b3-border-color);
    }

    .ai-sidebar__context-attachment-icon {
        width: 18px;
        height: 18px;
        color: var(--b3-theme-on-surface-light);
        flex-shrink: 0;
    }

    .ai-sidebar__messages {
        flex: 1;
        position: relative;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        transition: background-color 0.2s;

        &.ai-sidebar__messages--drag-over {
            background: var(--b3-theme-primary-lightest);
            border: 2px dashed var(--b3-theme-primary);
        }
    }

    .ai-sidebar__empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--b3-theme-on-surface-light);
        text-align: center;
    }

    .ai-sidebar__empty-icon {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
    }

    .ai-sidebar__empty-hint {
        font-size: 12px;
        margin-top: 8px;
    }

    .ai-message {
        display: flex;
        flex-direction: column;
        gap: 8px;
        animation: fadeIn 0.3s ease-in;
        cursor: context-menu;

        &:hover {
            .ai-message__content {
                box-shadow: 0 0 0 1px var(--b3-border-color);
            }
        }
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .ai-message__header {
        display: flex;
        align-items: center;
        margin-bottom: 8px;
    }

    .ai-message__role {
        font-size: 12px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .ai-message__actions {
        display: flex;
        align-items: center;
        gap: 4px;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .ai-message:hover .ai-message__actions {
        opacity: 1;
    }

    .ai-message__action {
        flex-shrink: 0;
    }

    .ai-message__streaming-indicator {
        color: var(--b3-theme-primary);
        animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.3;
        }
    }

    // 思考过程样式
    .ai-message__thinking {
        margin-bottom: 12px;
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        overflow: hidden;
        background: var(--b3-theme-surface);
    }

    .ai-message__thinking-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        cursor: pointer;
        user-select: none;
        background: var(--b3-theme-surface);
        transition: background 0.2s;

        &:hover {
            background: var(--b3-theme-background);
        }
    }

    .ai-message__thinking-icon {
        width: 14px;
        height: 14px;
        color: var(--b3-theme-on-surface-light);
        transition: transform 0.2s;
        transform: rotate(90deg);

        &.collapsed {
            transform: rotate(0deg);
        }
    }

    .ai-message__thinking-title {
        font-size: 12px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
    }

    .ai-message__thinking-content {
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-background);
        font-size: 13px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.6;
        max-height: 400px;
        overflow-y: auto;
        user-select: text; // 允许鼠标选择文本进行复制
        cursor: text; // 显示文本选择光标

        &.ai-message__thinking-content--streaming {
            animation: fadeIn 0.3s ease-out;
        }
    }

    // 工具调用样式
    .ai-message__tool-calls {
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        overflow: hidden;
        background: var(--b3-theme-surface);
    }

    .ai-message__tool-calls-title {
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
        background: var(--b3-theme-surface);
        border-bottom: 1px solid var(--b3-border-color);
    }

    .ai-message__tool-call {
        border-bottom: 1px solid var(--b3-border-color);

        &:last-child {
            border-bottom: none;
        }
    }

    .ai-message__tool-call-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        cursor: pointer;
        user-select: none;
        background: var(--b3-theme-background);
        transition: background 0.2s;

        &:hover {
            background: var(--b3-theme-primary-lightest);
        }
    }

    .ai-message__tool-call-name {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
    }

    .ai-message__tool-call-icon {
        width: 14px;
        height: 14px;
        color: var(--b3-theme-on-surface-light);
        transition: transform 0.2s;
        transform: rotate(90deg);

        &.collapsed {
            transform: rotate(0deg);
        }
    }

    .ai-message__tool-call-status {
        font-size: 14px;
        margin-left: auto;
    }

    .ai-message__tool-call-details {
        padding: 12px;
        background: var(--b3-theme-background);
        border-top: 1px solid var(--b3-border-color);
    }

    .ai-message__tool-call-params,
    .ai-message__tool-call-result {
        margin-bottom: 12px;

        &:last-child {
            margin-bottom: 0;
        }
    }

    .ai-message__tool-call-section-header {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        padding: 4px;
        margin-bottom: 6px;
        border-radius: 4px;
        transition: background-color 0.2s;

        &:hover {
            background: var(--b3-list-hover);
        }

        strong {
            font-size: 12px;
            color: var(--b3-theme-on-surface);
        }

        .ai-message__tool-call-icon {
            width: 12px;
            height: 12px;
            flex-shrink: 0;
            transition: transform 0.2s;
            fill: var(--b3-theme-on-surface);

            &.collapsed {
                transform: rotate(0deg);
            }

            &:not(.collapsed) {
                transform: rotate(90deg);
            }
        }
    }

    .ai-message__tool-call-code {
        margin: 0;
        padding: 8px 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        font-family: var(--b3-font-family-code);
        font-size: 12px;
        line-height: 1.5;
        color: var(--b3-theme-on-surface);
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-x: auto;
        max-height: 300px;
        overflow-y: auto;
        user-select: text; // 允许鼠标选择文本进行复制
        cursor: text; // 显示文本选择光标
    }

    .ai-message__tool-result-placeholder {
        display: none;
    }

    // 工具调用后的最终回复样式
    .ai-message__final-reply {
        margin-top: 12px;
        border-top: 1px solid var(--b3-border-color);
        padding-top: 12px;
    }

    .ai-message__content {
        padding: 10px 12px;
        border-radius: 8px;
        line-height: 1.6;
        word-wrap: break-word;
        overflow-x: auto;
        user-select: text; // 允许鼠标选择文本进行复制
        cursor: text; // 显示文本选择光标
        box-shadow: 0 0 0 1px var(--b3-border-color);
    }

    .ai-message--user {
        .ai-message__header {
            justify-content: flex-end;
        }

        .ai-message__content {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-on-background);
            margin-left: auto;
            max-width: 85%;
        }

        .ai-message__actions {
            justify-content: flex-end;
        }
    }

    .ai-message--assistant {
        .ai-message__header {
            justify-content: flex-start;
        }

        .ai-message__content {
            background: var(--b3-theme-background);
            color: var(--b3-theme-on-background);
            max-width: 90%;
        }

        .ai-message__actions {
            justify-content: flex-start;
        }
    }

    .ai-sidebar__input-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px 12px;
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-background);
        flex-shrink: 0;
        position: relative;
        transition: background-color 0.2s;
    }

    .ai-sidebar__mode-selector {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
    }

    .ai-sidebar__mode-label {
        font-size: 13px;
        color: var(--b3-theme-on-surface);
        font-weight: 500;
        flex-shrink: 0;
    }

    .ai-sidebar__mode-select {
        flex: 0 0 auto;
        min-width: 120px;
        font-size: 13px;
    }

    .ai-sidebar__auto-approve-label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--b3-theme-on-surface);
        cursor: pointer;
        user-select: none;

        span {
            white-space: nowrap;
        }
    }

    .ai-sidebar__tool-selector-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-primary-lightest);
        }

        .b3-button__icon {
            width: 14px;
            height: 14px;
        }
    }

    .ai-sidebar__multi-model-selector-wrapper {
        margin-left: auto;
    }

    .ai-sidebar__input-row {
        display: flex;
        gap: 0;
    }

    .ai-sidebar__input-wrapper {
        flex: 1;
        position: relative;
        display: flex;
        align-items: flex-end;
        border: 1px solid var(--b3-border-color);
        border-radius: 12px;
        background: var(--b3-theme-background);
        transition: border-color 0.2s;

        &:focus-within {
            border-color: var(--b3-theme-primary);
        }

        &:hover {
            border-color: var(--b3-theme-primary-light);
        }
    }

    .ai-sidebar__input {
        flex: 1;
        resize: none;
        border: none;
        border-radius: 12px;
        padding: 12px 16px;
        padding-right: 48px; /* 为发送按钮留出空间 */
        font-family: var(--b3-font-family);
        font-size: 14px;
        line-height: 1.5;
        background: transparent;
        color: var(--b3-theme-on-background);
        min-height: 44px;
        max-height: 200px;
        overflow-y: auto;

        &:focus {
            outline: none;
        }

        &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        &::placeholder {
            color: var(--b3-theme-on-surface-light);
        }
    }

    .ai-sidebar__bottom-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
    }

    .ai-sidebar__upload-btn,
    .ai-sidebar__search-btn {
        flex-shrink: 0;
    }

    .ai-sidebar__prompt-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .ai-sidebar__model-selector-wrapper {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
        flex-shrink: 0;
    }

    .ai-sidebar__thinking-toggle-container {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .ai-sidebar__thinking-toggle {
        font-size: 12px;
        padding: 4px 8px;
        min-width: auto;
        transition: all 0.2s;
        color: var(--b3-theme-primary);
        background: transparent;
    }

    .ai-sidebar__thinking-toggle:hover:not(:disabled) {
        background: var(--b3-theme-surface);
    }

    .ai-sidebar__thinking-toggle--active {
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        font-weight: 600;
    }

    .ai-sidebar__thinking-toggle:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .ai-sidebar__thinking-effort-select {
        font-size: 11px;
        padding: 2px 4px;
        min-width: 50px;
        max-width: 70px;
        height: 24px;
        border-radius: 4px;
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        cursor: pointer;
        transition: all 0.2s;

        &:hover {
            border-color: var(--b3-theme-primary);
        }

        &:focus {
            outline: none;
            border-color: var(--b3-theme-primary);
            box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest);
        }
    }

    .ai-sidebar__model-selector-container {
        flex: 1;
        display: flex;
        justify-content: flex-end;
        /* 保证在 flex 布局中可以缩小，避免在窄宽度下溢出 */
        min-width: 0;
        max-width: 100%;

        /* 只对模型选择器按钮内的文本应用省略处理，避免影响弹窗显示 */
        :global(.model-selector__button) {
            min-width: 0;
            max-width: 100%;
        }

        :global(.model-selector__current) {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }

    // 消息附件样式
    .ai-message__attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 8px;
    }

    .ai-message__attachment {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-width: 200px;
    }

    .ai-message__attachment-image {
        width: 100%;
        max-height: 150px;
        object-fit: cover;
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
    }

    .ai-message__attachment-file {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
    }

    .ai-message__attachment-icon {
        width: 20px;
        height: 20px;
        color: var(--b3-theme-on-surface-light);
        flex-shrink: 0;
    }

    .ai-message__attachment-name {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    // 消息上下文文档样式
    .ai-message__context-docs {
        margin-bottom: 12px;
        padding: 10px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
    }

    .ai-message__context-docs-title {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        margin-bottom: 8px;
        font-weight: 500;
    }

    .ai-message__context-docs-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .ai-message__context-doc-link {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        font-size: 12px;
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        border: 1px solid var(--b3-theme-primary-light);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        text-decoration: none;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;

        &:hover {
            background: var(--b3-theme-primary-lighter);
            border-color: var(--b3-theme-primary);
        }
    }

    // 消息编辑样式
    .ai-message__edit {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px 0;
    }

    .ai-message__edit-textarea {
        width: 100%;
        min-height: 100px;
        padding: 10px 12px;
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        font-family: var(--b3-font-family);
        font-size: 14px;
        line-height: 1.6;
        resize: vertical;

        &:focus {
            outline: none;
            border-color: var(--b3-theme-primary);
        }
    }

    .ai-message__edit-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }

    // 提示词选择器样式
    .ai-sidebar__prompt-selector {
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.1);
        max-height: 300px;
        overflow-y: auto;
        margin-bottom: 8px;
        z-index: 100;
    }

    .ai-sidebar__prompt-list {
        padding: 4px;
    }

    .ai-sidebar__prompt-item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        text-align: left;
        padding: 8px 12px;
        border: none;
        background: none;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        border-radius: 4px;
        transition: background-color 0.2s;
        font-size: 14px;
        position: relative;

        &:hover {
            background: var(--b3-theme-primary-lightest);

            .ai-sidebar__prompt-item-edit {
                opacity: 1;
            }
        }
    }

    .ai-sidebar__prompt-item--new {
        font-weight: 600;
        color: var(--b3-theme-primary);

        &:hover {
            background: var(--b3-theme-primary-lighter);
        }
    }

    .ai-sidebar__prompt-item-icon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
    }

    .ai-sidebar__prompt-item-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ai-sidebar__prompt-item-edit {
        opacity: 0;
        padding: 4px;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 4px;
        transition:
            opacity 0.2s,
            background-color 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;

        &:hover {
            background: var(--b3-theme-surface);
            color: var(--b3-theme-primary);
        }

        .b3-button__icon {
            width: 14px;
            height: 14px;
        }
    }

    .ai-sidebar__prompt-divider-small {
        height: 1px;
        background: var(--b3-border-color);
        margin: 4px 0;
    }

    .ai-sidebar__prompt-empty {
        padding: 16px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-size: 13px;
    }

    .ai-sidebar__send-btn {
        position: absolute;
        right: 6px;
        bottom: 6px;
        width: 36px;
        height: 36px;
        min-width: 36px;
        border-radius: 50%;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: all 0.2s ease;

        &:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }

        &:not(:disabled):hover {
            transform: scale(1.05);
        }

        &.ai-sidebar__send-btn--abort {
            background-color: #ef4444;
            color: white;

            &:hover {
                background-color: #dc2626;
            }
        }

        .b3-button__icon {
            width: 18px;
            height: 18px;
        }
    }

    .ai-sidebar__loading-icon {
        animation: rotate 1s linear infinite;
    }

    @keyframes rotate {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    // 提示词管理对话框样式
    .ai-sidebar__prompt-dialog {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .ai-sidebar__prompt-dialog-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
    }

    .ai-sidebar__prompt-dialog-content {
        position: relative;
        width: 90%;
        max-width: 600px;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        max-height: 80vh;
    }

    .ai-sidebar__prompt-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid var(--b3-border-color);

        h4 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }
    }

    .ai-sidebar__prompt-dialog-body {
        padding: 16px;
        overflow-y: auto;
    }

    .ai-sidebar__prompt-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .ai-sidebar__prompt-form-field {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .ai-sidebar__prompt-form-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .ai-sidebar__prompt-textarea {
        min-height: 120px;
        resize: vertical;
        font-family: var(--b3-font-family);
    }

    .ai-sidebar__prompt-form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }

    .ai-sidebar__prompt-divider {
        margin: 24px 0;
        border-top: 1px solid var(--b3-border-color);
    }

    .ai-sidebar__prompt-saved-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .ai-sidebar__prompt-saved-title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .ai-sidebar__prompt-saved-items {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .ai-sidebar__prompt-saved-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);

        &:hover {
            background: var(--b3-theme-primary-lightest);
        }
    }

    .ai-sidebar__prompt-saved-info {
        flex: 1;
        min-width: 0;
    }

    .ai-sidebar__prompt-saved-item-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
        margin-bottom: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ai-sidebar__prompt-saved-item-content {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.4;
        word-break: break-word;
    }

    .ai-sidebar__prompt-saved-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    // 搜索对话框样式
    .ai-sidebar__search-dialog {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .ai-sidebar__search-dialog-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
    }

    .ai-sidebar__search-dialog-content {
        position: relative;
        width: 90%;
        max-width: 500px;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        max-height: 80vh;
    }

    .ai-sidebar__search-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid var(--b3-border-color);

        h4 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }
    }

    .ai-sidebar__search-dialog-body {
        padding: 16px;
        overflow-y: auto;
    }

    .ai-sidebar__search-input-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;

        input {
            flex: 1;
        }
    }

    .ai-sidebar__search-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        color: var(--b3-theme-primary);
    }

    .ai-sidebar__search-results {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 400px;
        overflow-y: auto;
    }

    .ai-sidebar__search-result-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);

        &:hover {
            background: var(--b3-theme-primary-lightest);
        }
    }

    .ai-sidebar__search-result-title {
        flex: 1;
        font-size: 14px;
        color: var(--b3-theme-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .ai-sidebar__search-current-doc-badge {
        display: inline-block;
        padding: 2px 8px;
        font-size: 12px;
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        border-radius: 4px;
        white-space: nowrap;
        flex-shrink: 0;
    }

    .ai-sidebar__search-empty {
        text-align: center;
        padding: 32px;
        color: var(--b3-theme-on-surface-light);
    }

    // 编辑消息对话框样式
    .ai-sidebar__edit-dialog {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .ai-sidebar__edit-dialog-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
    }

    .ai-sidebar__edit-dialog-content {
        position: relative;
        width: 90%;
        max-width: 700px;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        max-height: 80vh;
    }

    .ai-sidebar__edit-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid var(--b3-border-color);

        h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }

        .b3-button {
            padding: 4px;
            min-width: auto;
        }
    }

    .ai-sidebar__edit-dialog-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
    }

    .ai-sidebar__edit-dialog-textarea {
        width: 100%;
        min-height: 300px;
        padding: 12px;
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        font-family: var(--b3-font-family);
        font-size: 14px;
        line-height: 1.6;
        resize: vertical;
        transition: border-color 0.2s ease;

        &:focus {
            outline: none;
            border-color: var(--b3-theme-primary);
        }
    }

    .ai-sidebar__edit-dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px;
        border-top: 1px solid var(--b3-border-color);
    }

    // 编辑操作样式
    .ai-message__edit-operations {
        margin-top: 12px;
        padding: 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
    }

    .ai-message__edit-operations-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
        margin-bottom: 12px;
    }

    .ai-message__edit-operation {
        padding: 12px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        margin-bottom: 8px;

        &:last-child {
            margin-bottom: 0;
        }

        &--applied {
            border-color: var(--b3-theme-success);
            background: var(--b3-theme-success-lightest);
        }

        &--rejected {
            border-color: var(--b3-theme-error);
            background: var(--b3-theme-error-lightest);
            opacity: 0.7;
        }
    }

    .ai-message__edit-operation-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        font-size: 12px;
    }

    .ai-message__edit-operation-id {
        color: var(--b3-theme-on-surface);
        font-family: var(--b3-font-family-code);
    }

    .ai-message__edit-operation-status {
        font-weight: 600;

        .ai-message__edit-operation--applied & {
            color: var(--b3-theme-success);
        }

        .ai-message__edit-operation--rejected & {
            color: var(--b3-theme-error);
        }
    }

    .ai-message__edit-operation-actions {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    // 差异对比对话框样式
    .ai-sidebar__diff-dialog {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .ai-sidebar__diff-dialog-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
    }

    .ai-sidebar__diff-dialog-content {
        position: relative;
        width: 90%;
        max-width: 900px;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        max-height: 80vh;
    }

    .ai-sidebar__diff-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid var(--b3-border-color);
        gap: 12px;

        h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }

        .b3-button {
            padding: 4px;
            min-width: auto;
        }
    }

    .ai-sidebar__diff-mode-selector {
        display: flex;
        gap: 4px;

        .b3-button {
            padding: 4px 12px;
            font-size: 12px;
        }
    }

    .ai-sidebar__diff-dialog-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
    }

    .ai-sidebar__diff-info {
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        margin-bottom: 16px;
        font-size: 13px;

        strong {
            color: var(--b3-theme-on-surface);
        }
    }

    .ai-sidebar__diff-content {
        font-family: var(--b3-font-family-code);
        font-size: 13px;
        line-height: 1.6;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        overflow: auto;
    }

    .ai-sidebar__diff-line {
        display: flex;
        padding: 2px 12px;
        min-height: 24px;

        &--removed {
            background: rgba(255, 0, 0, 0.1);
            color: var(--b3-theme-error);
        }

        &--added {
            background: rgba(0, 255, 0, 0.1);
            color: var(--b3-theme-success);
        }

        &--unchanged {
            color: var(--b3-theme-on-surface);
        }
    }

    .ai-sidebar__diff-marker {
        display: inline-block;
        width: 20px;
        flex-shrink: 0;
        font-weight: 600;
    }

    .ai-sidebar__diff-text {
        flex: 1;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .ai-sidebar__diff-loading {
        text-align: center;
        padding: 32px;
        color: var(--b3-theme-on-surface-light);
    }

    .ai-sidebar__diff-split {
        display: flex;
        gap: 12px;
        height: 100%;
        min-height: 400px;
    }

    .ai-sidebar__diff-split-column {
        flex: 1;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        background: var(--b3-theme-surface);
        overflow: hidden;
    }

    .ai-sidebar__diff-split-header {
        padding: 8px 12px;
        background: var(--b3-theme-surface-light);
        border-bottom: 1px solid var(--b3-border-color);
        font-weight: 600;
        font-size: 13px;
        color: var(--b3-theme-on-surface);
    }

    .ai-sidebar__diff-split-content {
        flex: 1;
        margin: 0;
        padding: 12px;
        overflow: auto;
        font-family: var(--b3-font-family-code);
        font-size: 13px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--b3-theme-on-surface);
    }

    .ai-sidebar__diff-dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px;
        border-top: 1px solid var(--b3-border-color);
    }

    // 保存到笔记对话框样式
    .save-to-note-dialog__overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999;
    }

    .save-to-note-dialog {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        width: 90%;
        max-width: 500px;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        z-index: 1000;
        overflow: hidden;
    }

    .save-to-note-dialog__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);

        h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 500;
            color: var(--b3-theme-on-surface);
        }
    }

    .save-to-note-dialog__switch-bar {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 12px 16px;
        background: var(--b3-theme-surface);
        border-bottom: 1px solid var(--b3-border-color);

        button {
            padding: 6px 12px;
            font-size: 13px;
            color: var(--b3-theme-primary);
            background: transparent;
            border: 1px solid var(--b3-theme-primary);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;

            &:hover {
                background: var(--b3-theme-primary);
                color: var(--b3-theme-on-primary);
            }
        }
    }

    .save-to-note-dialog__content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .save-to-note-dialog__field {
        display: flex;
        flex-direction: column;
        gap: 8px;

        label {
            font-size: 13px;
            font-weight: 500;
            color: var(--b3-theme-on-surface);
        }

        input,
        select {
            width: 100%;
            font-size: 14px;
            border: 1px solid var(--b3-border-color);
            border-radius: 4px;
            background: var(--b3-theme-background);
            color: var(--b3-theme-on-background);

            &:focus {
                outline: none;
                border-color: var(--b3-theme-primary);
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest);
            }
        }
    }

    .save-to-note-dialog__path-input-wrapper {
        position: relative;
    }

    .save-to-note-dialog__path-dropdown {
        max-height: 300px;
        overflow-y: auto;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        z-index: 10;
    }

    // 路径搜索结果弹窗样式 - 作为独立popup显示在对话框上层
    .save-to-note-dialog__path-popup {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 90%;
        max-width: 500px;
        max-height: 400px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        z-index: 1001; // 确保在对话框上层
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .save-to-note-dialog__path-results {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
    }

    .save-to-note-dialog__path-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        cursor: pointer;
        transition: background 0.2s;
        border-radius: 4px;
        margin: 2px 0;

        &:hover {
            background: var(--b3-theme-primary-lightest);
        }

        .b3-button__icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            color: var(--b3-theme-on-surface-light);
        }

        span {
            flex: 1;
            font-size: 13px;
            color: var(--b3-theme-on-surface);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    }

    .save-to-note-dialog__path-loading {
        padding: 16px;
        text-align: center;
        font-size: 13px;
        color: var(--b3-theme-on-surface-light);
    }

    .save-to-note-dialog__footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 16px;
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);

        .save-to-note-dialog__footer-option {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            user-select: none;

            span {
                color: var(--b3-theme-on-surface);
                font-size: 14px;
            }

            .b3-switch {
                cursor: pointer;
            }
        }

        .save-to-note-dialog__footer-buttons {
            display: flex;
            gap: 8px;
        }

        .b3-button {
            min-width: 100px;
        }
    }

    // 工具批准对话框样式
    .tool-approval-dialog__overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999;
    }

    .tool-approval-dialog {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        width: 90%;
        max-width: 600px;
        max-height: 80vh;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        z-index: 1000;
        overflow: hidden;
    }

    .tool-approval-dialog__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);

        h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 500;
            color: var(--b3-theme-on-surface);
        }
    }

    .tool-approval-dialog__content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
    }

    .tool-approval-dialog__tool-info {
        margin-bottom: 16px;
        padding: 12px;
        background: var(--b3-theme-primary-lightest);
        border-radius: 6px;
        border: 1px solid var(--b3-theme-primary-lighter);
    }

    .tool-approval-dialog__tool-name {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
        font-size: 14px;
        color: var(--b3-theme-on-surface);

        .b3-button__icon {
            width: 18px;
            height: 18px;
            color: var(--b3-theme-primary);
        }

        strong {
            font-weight: 600;
        }
    }

    .tool-approval-dialog__tool-id {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        font-family: var(--b3-font-family-code);
    }

    .tool-approval-dialog__params {
        margin-bottom: 16px;
    }

    .tool-approval-dialog__section-title {
        margin-bottom: 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .tool-approval-dialog__code {
        margin: 0;
        padding: 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        font-family: var(--b3-font-family-code);
        font-size: 12px;
        line-height: 1.6;
        color: var(--b3-theme-on-surface);
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-x: auto;
        max-height: 300px;
        overflow-y: auto;
    }

    .tool-approval-dialog__warning {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: var(--b3-theme-error-lightest);
        border: 1px solid var(--b3-theme-error-lighter);
        border-radius: 6px;
        font-size: 13px;
        color: var(--b3-theme-on-surface);

        .b3-button__icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            color: var(--b3-theme-error);
        }
    }

    .tool-approval-dialog__footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px;
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);

        .b3-button {
            min-width: 100px;
        }
    }

    // 右键菜单样式
    .ai-sidebar__context-menu {
        position: fixed;
        z-index: 10000;
        min-width: 160px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        padding: 4px;
        animation: fadeIn 0.15s ease-out;
    }

    .ai-sidebar__context-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 12px;
        border: none;
        background: transparent;
        color: var(--b3-theme-on-surface);
        font-size: 14px;
        text-align: left;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.2s;

        &:hover {
            background: var(--b3-theme-background);
        }

        .b3-button__icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }

        span {
            flex: 1;
        }
    }

    .ai-sidebar__context-menu-divider {
        height: 1px;
        margin: 4px 0;
        background: var(--b3-border-color);
    }

    // 多模型响应样式
    .ai-sidebar__multi-model-responses {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 12px 0;
        animation: fadeIn 0.3s ease-in;
    }

    .ai-sidebar__multi-model-header {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 16px;
    }

    .ai-sidebar__multi-model-header-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }

    .ai-sidebar__multi-model-header-top h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
        flex-shrink: 0;
    }

    .ai-sidebar__multi-model-hint {
        font-size: 13px;
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid var(--b3-theme-primary-light);
        text-align: center;
        font-weight: 500;
    }

    .ai-sidebar__multi-model-cards {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        padding: 8px 4px;
        scroll-snap-type: x mandatory;

        &::-webkit-scrollbar {
            height: 6px;
        }

        &::-webkit-scrollbar-track {
            background: var(--b3-theme-surface);
            border-radius: 3px;
        }

        &::-webkit-scrollbar-thumb {
            background: var(--b3-theme-on-surface-light);
            border-radius: 3px;

            &:hover {
                background: var(--b3-theme-on-surface);
            }
        }
    }

    .ai-sidebar__multi-model-card {
        flex: 0 0 50%;
        max-width: 400px;
        min-width: 300px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: var(--b3-theme-background);
        border: 2px solid var(--b3-border-color);
        border-radius: 8px;
        scroll-snap-align: start;
        transition: all 0.2s ease;

        &:hover {
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            border-color: var(--b3-theme-primary-light);
        }

        &--selected {
            border-color: var(--b3-theme-primary);
            background: var(--b3-theme-primary-lightest);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
    }

    .ai-sidebar__multi-model-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .ai-sidebar__multi-model-card-title {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
    }

    .ai-sidebar__multi-model-card-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .ai-sidebar__multi-model-copy-btn {
        flex-shrink: 0;
        padding: 4px 8px;
        height: auto;

        .b3-button__icon {
            width: 14px;
            height: 14px;
        }
    }

    .ai-sidebar__multi-model-card-model-name,
    .ai-sidebar__multi-model-tab-title,
    .ai-sidebar__multi-model-tab-panel-model-name {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .ai-sidebar__multi-model-selected-indicator,
    .ai-message__multi-model-selected-indicator {
        color: var(--b3-theme-success);
        font-size: 14px;
        font-weight: 600;
    }

    .ai-sidebar__multi-model-card-status {
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;

        &--loading {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
        }

        &--error {
            background: var(--b3-theme-error-lighter);
            color: var(--b3-theme-error);
        }
    }

    .ai-sidebar__multi-model-select-btn {
        flex-shrink: 0;
        font-size: 12px;
        padding: 4px 12px;
        height: auto;
        white-space: nowrap;
    }

    .ai-sidebar__multi-model-card-content {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
        user-select: text; // 允许文本选择

        &::-webkit-scrollbar {
            width: 6px;
        }

        &::-webkit-scrollbar-track {
            background: var(--b3-theme-surface);
            border-radius: 3px;
        }

        &::-webkit-scrollbar-thumb {
            background: var(--b3-theme-on-surface-light);
            border-radius: 3px;

            &:hover {
                background: var(--b3-theme-on-surface);
            }
        }
    }

    .ai-sidebar__multi-model-card-loading {
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-style: italic;
        padding: 20px;
    }

    .ai-sidebar__multi-model-card-error {
        color: var(--b3-theme-error);
        font-size: 12px;
        padding: 12px;
        background: var(--b3-theme-error-lighter);
        border-radius: 4px;
        word-break: break-word;
    }

    .ai-sidebar__multi-model-layout-selector {
        display: flex;
        gap: 4px;
        align-items: center;
    }

    .ai-sidebar__multi-model-tabs {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .ai-sidebar__multi-model-tab-headers {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid var(--b3-border-color);
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;

        &::-webkit-scrollbar {
            display: none;
        }
    }

    .ai-sidebar__multi-model-tab-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 4px 4px 0 0;
        transition: all 0.2s;
        white-space: nowrap;
        min-width: 120px;
        justify-content: center;

        &:hover {
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-surface);
        }

        &--active {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
            border-bottom: 2px solid var(--b3-theme-primary);
        }
    }

    .ai-sidebar__multi-model-tab-title {
        font-size: 12px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ai-sidebar__multi-model-tab-status {
        font-size: 10px;
        flex-shrink: 0;

        &--loading {
            color: var(--b3-theme-primary);
        }

        &--error {
            color: var(--b3-theme-error);
        }
    }

    .ai-sidebar__multi-model-tab-content {
        flex: 1;
        min-height: 300px;
    }

    .ai-sidebar__multi-model-tab-panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
    }

    .ai-sidebar__multi-model-tab-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .ai-sidebar__multi-model-tab-panel-title {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
    }

    .ai-sidebar__multi-model-tab-panel-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .ai-sidebar__multi-model-tab-panel-model-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .ai-sidebar__multi-model-tab-panel-status {
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;

        &--loading {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
        }

        &--error {
            background: var(--b3-theme-error-lighter);
            color: var(--b3-theme-error);
        }
    }

    .ai-sidebar__multi-model-tab-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
        user-select: text; // 允许文本选择

        &::-webkit-scrollbar {
            width: 6px;
        }

        &::-webkit-scrollbar-track {
            background: var(--b3-theme-surface);
            border-radius: 3px;
        }

        &::-webkit-scrollbar-thumb {
            background: var(--b3-theme-on-surface-light);
            border-radius: 3px;

            &:hover {
                background: var(--b3-theme-on-surface);
            }
        }
    }

    .ai-sidebar__multi-model-tab-panel-loading {
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-style: italic;
        padding: 20px;
    }

    .ai-sidebar__multi-model-tab-panel-error {
        color: var(--b3-theme-error);
        font-size: 12px;
        padding: 12px;
        background: var(--b3-theme-error-lighter);
        border-radius: 4px;
        word-break: break-word;
    }

    // 历史消息中的多模型响应样式
    .ai-message__multi-model-responses {
        margin-top: 12px;
        padding: 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
    }

    .ai-message__multi-model-header {
        margin-bottom: 12px;

        h4 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-surface);
        }
    }

    // 历史消息中的多模型页签样式
    .ai-message__multi-model-tabs {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .ai-message__multi-model-tab-headers {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid var(--b3-border-color);
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;

        &::-webkit-scrollbar {
            display: none;
        }
    }

    .ai-message__multi-model-tab-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 4px 4px 0 0;
        transition: all 0.2s;
        white-space: nowrap;
        min-width: 100px;
        justify-content: center;

        &:hover {
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-surface);
        }

        &--active {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
            border-bottom: 2px solid var(--b3-theme-primary);
        }
    }

    .ai-message__multi-model-tab-title {
        font-size: 12px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ai-message__multi-model-tab-status {
        font-size: 10px;
        flex-shrink: 0;

        &--error {
            color: var(--b3-theme-error);
        }
    }

    .ai-message__multi-model-tab-content {
        flex: 1;
    }

    .ai-message__multi-model-tab-panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
    }

    .ai-message__multi-model-tab-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .ai-message__multi-model-tab-panel-title {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
    }

    .ai-message__multi-model-tab-panel-model-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .ai-message__multi-model-tab-panel-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .ai-message__multi-model-tab-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
        user-select: text; // 允许文本选择

        &::-webkit-scrollbar {
            width: 6px;
        }

        &::-webkit-scrollbar-track {
            background: var(--b3-theme-surface);
            border-radius: 3px;
        }

        &::-webkit-scrollbar-thumb {
            background: var(--b3-theme-on-surface-light);
            border-radius: 3px;

            &:hover {
                background: var(--b3-theme-on-surface);
            }
        }
    }

    .ai-message__multi-model-tab-panel-error {
        color: var(--b3-theme-error);
        font-size: 12px;
        padding: 12px;
        background: var(--b3-theme-error-lighter);
        border-radius: 4px;
        word-break: break-word;
    }

    // 保留旧的卡片样式（如果还需要）
    .ai-message__multi-model-cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .ai-message__multi-model-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        transition: all 0.2s ease;

        &--selected {
            border-color: var(--b3-theme-success);
            background: var(--b3-theme-success-lightest);
        }
    }

    .ai-message__multi-model-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .ai-message__multi-model-card-title {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
    }

    .ai-message__multi-model-card-model-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .ai-message__multi-model-selected-indicator {
        color: var(--b3-theme-success);
        font-size: 14px;
    }

    .ai-message__multi-model-card-status {
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;

        &--error {
            background: var(--b3-theme-error-lighter);
            color: var(--b3-theme-error);
        }
    }

    .ai-message__multi-model-card-content {
        flex: 1;
        overflow-y: auto;
        padding: 4px;

        &::-webkit-scrollbar {
            width: 6px;
        }

        &::-webkit-scrollbar-track {
            background: var(--b3-theme-surface);
            border-radius: 3px;
        }

        &::-webkit-scrollbar-thumb {
            background: var(--b3-theme-on-surface-light);
            border-radius: 3px;

            &:hover {
                background: var(--b3-theme-on-surface);
            }
        }
    }

    .ai-message__multi-model-card-error {
        color: var(--b3-theme-error);
        font-size: 12px;
        padding: 12px;
        background: var(--b3-theme-error-lighter);
        border-radius: 4px;
        word-break: break-word;
    }

    // 响应式布局
    @media (max-width: 768px) {
        .ai-sidebar__header {
            padding: 6px 10px;
        }

        .ai-sidebar__title {
            font-size: 14px;
        }

        .ai-sidebar__messages {
            padding: 10px;
            gap: 10px;
        }

        .ai-message--user .ai-message__content {
            max-width: 90%;
        }

        .ai-message--assistant .ai-message__content {
            max-width: 95%;
        }

        .ai-sidebar__input-container {
            padding: 6px 10px;
        }

        .ai-sidebar__input {
            padding: 10px 14px;
            padding-right: 46px;
        }

        .ai-sidebar__send-btn {
            width: 32px;
            height: 32px;
            min-width: 32px;

            .b3-button__icon {
                width: 16px;
                height: 16px;
            }
        }
    }

    @media (max-width: 480px) {
        .ai-sidebar__token-count {
            font-size: 10px;
            padding: 2px 6px;
        }

        .ai-message__content {
            font-size: 13px;
            padding: 8px 10px;
        }

        .ai-sidebar__input {
            font-size: 13px;
            padding: 8px 12px;
            padding-right: 42px;
        }

        .ai-sidebar__send-btn {
            width: 30px;
            height: 30px;
            min-width: 30px;
            right: 5px;
            bottom: 5px;

            .b3-button__icon {
                width: 14px;
                height: 14px;
            }
        }

        // 多模型页签响应式样式
        .ai-sidebar__multi-model-tabs {
            gap: 8px;
        }

        .ai-sidebar__multi-model-tab-headers {
            gap: 1px;
        }

        .ai-sidebar__multi-model-tab-header {
            padding: 6px 10px;
            min-width: 100px;
        }

        .ai-sidebar__multi-model-tab-title {
            font-size: 11px;
        }

        .ai-sidebar__multi-model-tab-status {
            font-size: 9px;
        }

        .ai-sidebar__multi-model-tab-panel {
            padding: 12px;
        }

        .ai-sidebar__multi-model-tab-panel-title {
            font-size: 13px;
        }

        .ai-sidebar__multi-model-tab-panel-status {
            font-size: 11px;
            padding: 1px 4px;
        }

        .ai-sidebar__multi-model-tab-panel-content {
            max-height: 400px;
        }
    }

    // 代码块工具栏样式
    :global(.code-block-toolbar) {
        position: relative;
        top: 0;
        left: 0;
        right: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 12px;
        background: var(--b3-theme-surface);
        border-bottom: 1px solid var(--b3-border-color);
        z-index: 1;
    }

    // 代码块语言标签样式（左上角）
    :global(.code-block-lang-label) {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        font-family: var(--b3-font-family-code);
        line-height: 1.2;
        user-select: none;
        font-weight: 500;
    }

    // 代码块复制按钮样式
    :global(.code-block-copy-btn) {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        height: 12px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.2s;

        svg {
            width: 14px;
            height: 14px;
        }

        &:hover {
            background: var(--b3-list-hover);
            color: var(--b3-theme-on-surface);
        }

        &.copied {
            color: var(--b3-theme-primary);
        }
    }

    // 代码块容器样式
    :global(.ai-message__content pre) {
        position: relative;
        margin: 8px 0;
        padding: 0 !important;
        border-radius: 6px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        box-shadow: var(--b3-tooltips-shadow);
        overflow: hidden;
        max-height: 600px; /* 限制代码块最大高度 */
        display: flex;
        flex-direction: column;

        code {
            display: block;
            padding: 12px !important; /* 代码内容的内边距 */
            margin: 0;
            margin-top: 37px; /* 为固定的工具栏留出空间 */
            overflow: auto; /* 启用滚动 */
            flex: 1;
            min-height: 0;
            font-family: var(--b3-font-family-code);
            font-size: 0.9em;
            line-height: 1.5;
            background: transparent !important;

            /* 自定义滚动条 */
            &::-webkit-scrollbar {
                width: 8px;
                height: 8px;
            }

            &::-webkit-scrollbar-track {
                background: var(--b3-theme-background);
                border-radius: 4px;
            }

            &::-webkit-scrollbar-thumb {
                background: var(--b3-scroll-color);
                border-radius: 4px;

                &:hover {
                    background: var(--b3-theme-on-surface-light);
                }
            }
        }
    }

    // 全屏模式样式
    .ai-sidebar--fullscreen {
        position: fixed !important;
        top: var(--b3-toolbar-height) !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        z-index: 10 !important;
        background: var(--b3-theme-background) !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        display: flex !important;
        flex-direction: column !important;
    }

    .ai-sidebar--fullscreen .ai-sidebar__header {
        background: var(--b3-theme-surface) !important;
        border-bottom: 1px solid var(--b3-border-color) !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
    }

    .ai-sidebar--fullscreen .ai-sidebar__messages {
        flex: 1 !important;
        padding: 20px !important;
        gap: 16px !important;
        max-height: calc(100vh - 140px) !important;
    }

    .ai-sidebar--fullscreen .ai-sidebar__input-container {
        background: var(--b3-theme-surface) !important;
        border-top: 1px solid var(--b3-border-color) !important;
        box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1) !important;
        padding: 16px 20px !important;
    }

    .ai-sidebar--fullscreen .ai-message__content {
        font-size: 15px !important;
        line-height: 1.7 !important;
        padding: 16px 18px !important;
    }

    .ai-sidebar--fullscreen .ai-sidebar__input {
        font-size: 15px !important;
        padding: 14px 18px !important;
        padding-right: 52px !important;
        min-height: 50px !important;
        max-height: 300px !important;
    }

    .ai-sidebar--fullscreen .ai-sidebar__send-btn {
        width: 40px !important;
        height: 40px !important;
        min-width: 40px !important;

        .b3-button__icon {
            width: 20px !important;
            height: 20px !important;
        }
    }
</style>
