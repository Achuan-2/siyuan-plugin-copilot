<script lang="ts">
    import { onMount, tick, onDestroy } from 'svelte';
    import {
        chat,
        getProviderConfig,
        type Message,
        type MessageAttachment,
        type EditOperation,
        type ToolCall,
        type ContextDocument,
        type ThinkingEffort,
        isSupportedThinkingGeminiModel,
        isSupportedThinkingClaudeModel,
        isGemini3Model,
    } from './ai-chat';
    import type { MessageContent } from './ai-chat';
    import { getActiveEditor, openTab } from 'siyuan';
    import { WEBAPP_TAB_TYPE } from './index';
    import {
        pushMsg,
        pushErrMsg,
        sql,
        exportMdContent,
        openBlock,
        getBlockKramdown,
        getBlockByID,
        getFileBlob,
        renderSprig,
        createDocWithMd,
        lsNotebooks,
        searchDocs,
        getHPathByID,
        putFile,
        removeFile,
    } from './api';
    import { saveAsset, loadAsset, base64ToBlob, readAssetAsText, createGeneratedImageFileName } from './utils/assets';
    import {
        parseMultipleWebPages,
        fetchWithWebView,
        parseWebPageToMarkdown,
    } from './utils/webParser';
    import MultiModelSelector from './components/MultiModelSelector.svelte';
    import SessionManager from './components/SessionManager.svelte';
    import ToolSelector, { type ToolConfig } from './components/ToolSelector.svelte';
    import ModelPresetButton from './components/ModelPreset.svelte';
    import TranslateDialog from './components/TranslateDialog.svelte';
    import WebAppManager from './components/WebAppManager.svelte';
    import type { ProviderConfig } from './defaultSettings';
    import { settingsStore } from './stores/settings';
    import { confirm, Constants, platformUtils } from 'siyuan';
    import { i18n } from './utils/i18n';
    import {
        AVAILABLE_TOOLS,
        createGetSiyuanSkillsTool,
        executeToolCall,
        TOOL_CATEGORIES,
        QA_TOOL_CATEGORIES,
        soul,
    } from './tools';

    // Agent 模式工具使用强制规则（统一常量）
    const AGENT_TOOL_USAGE_INSTRUCTION = `=== 工具使用强制规则 ===
如果启用了SOUL工具，系统会自动将SOUL文档内容添加到系统提示词中。当用户说记住、下达风格更改要求等情况时，你需要调用soul工具来记录用户要求。
**绝对禁止：在未调用 get_siyuan_skills 获取文档的情况下。**
**必须遵守的使用流程：**
1. 分析用户需求，确定需要使用的工具
2. **必须**先调用 get_siyuan_skills(toolName="目标工具名称") 获取完整文档
3. 仔细阅读返回的文档（包含参数说明、使用示例、注意事项）
4. 根据文档正确构造参数，调用目标工具
5. 根据工具返回结果继续后续操作
**为什么要这样做？**
- 每个工具都有复杂的参数和特定的使用场景，直接使用而不看文档极有可能导致错误操作`;

    export let plugin: any;
    export let initialMessage: string = ''; // 初始消息
    export let mode: 'sidebar' | 'dialog' = 'sidebar'; // 使用模式：sidebar或dialog
    export let respondToGlobalActions: boolean = false; // 是否响应全局事件（仅标签页实例）

    interface ChatSession {
        id: string;
        title: string;
        messages?: Message[]; // 可选，元数据模式下不包含消息
        createdAt: number;
        updatedAt: number;
        messageCount?: number; // 消息数量
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
    let isInitialLoading = true;

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
    const pendingAttachmentSaveTasks = new Set<Promise<void>>();

    // 网页链接功能
    let isWebLinkDialogOpen = false;
    let webLinkInput = '';
    let isFetchingWebContent = false;

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
    let draggingPromptId: string | null = null;
    let promptDropTargetId: string | null = null;
    let promptDropAtEnd = false;
    let suppressPromptClickOnce = false;
    const PROMPTS_SYNC_EVENT = 'copilot-prompts-updated';
    const promptSyncSourceId = `prompt-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
    let providersForModelSelector: Record<string, any> = {};

    // 显示设置
    let messageFontSize = 12;
    let multiModelViewMode: 'tab' | 'card' = 'tab'; // 多模型回答样式

    // 模型临时设置
    let tempModelSettings = {
        contextCount: -1, // -1表示使用不限制
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
        chatMode: 'ask' as 'ask' | 'agent' | 'draw',
    };

    // 对话模式
    type ChatMode = 'ask' | 'agent' | 'draw';
    let chatMode: ChatMode = 'ask';
    let isDiffDialogOpen = false;
    let currentDiffOperation: EditOperation | null = null;
    type DiffViewMode = 'diff' | 'split';
    let diffViewMode: DiffViewMode = 'diff'; // diff查看模式：diff或split

    // 画图模式
    type DrawImageSize = 'auto' | string;
    type DrawImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'standard' | 'hd';
    type DrawImageSizeOption = { value: DrawImageSize; label: string };

    const DRAW_IMAGE_BASE_UNIT = 640;
    const DRAW_IMAGE_SIZE_STEP = 16;
    const DRAW_IMAGE_SIZE_OPTIONS: DrawImageSizeOption[] = [
        { value: 'auto', label: 'auto 默认' },
        { value: '1024x1024', label: '1024x1024 1:1 正方形' },
        { value: '1536x1024', label: '1536x1024 3:2 横版' },
        { value: '1024x1536', label: '1024x1536 2:3 竖版' },
        { value: '1536x1152', label: '1536x1152 4:3 横版' },
        { value: '1152x1536', label: '1152x1536 3:4 竖版' },
        { value: '1504x640', label: '1504x640 2.35:1 横版' },
        { value: '2048x2048', label: '2048x2048 1:1 2K正方形' },
        { value: '2048x1152', label: '2048x1152 16:9 2K横版' },
        { value: '3840x2160', label: '3840x2160 16:9 4K横版' },
        { value: '2160x3840', label: '2160x3840 9:16 4K竖版' },
    ];
    const GEMINI_DRAW_IMAGE_SIZE_OPTIONS: DrawImageSizeOption[] = [
        { value: 'auto', label: 'auto 默认' },
        { value: '1024x1024', label: '1024x1024 1:1 1K正方形' },
        { value: '1536x1024', label: '1536x1024 3:2 1K横版' },
        { value: '1024x1536', label: '1024x1536 2:3 1K竖版' },
        { value: '1536x1152', label: '1536x1152 4:3 横版' },
        { value: '1152x1536', label: '1152x1536 3:4 竖版' },
        { value: '1504x640', label: '1504x640 2.35:1 横版' },
        { value: '2048x2048', label: '2048x2048 1:1 2K正方形' },
        { value: '2048x1152', label: '2048x1152 16:9 2K横版' },
        { value: '3840x2160', label: '3840x2160 16:9 4K横版' },
        { value: '2160x3840', label: '2160x3840 9:16 4K竖版' },
    ];
    const GEMINI_ASPECT_ONLY_DRAW_IMAGE_SIZE_OPTIONS: DrawImageSizeOption[] = [
        { value: 'auto', label: 'auto 默认' },
        { value: '1024x1024', label: '1024x1024 1:1 正方形' },
        { value: '1536x1024', label: '1536x1024 3:2 横版' },
        { value: '1024x1536', label: '1024x1536 2:3 竖版' },
        { value: '1536x1152', label: '1536x1152 4:3 横版' },
        { value: '1152x1536', label: '1152x1536 3:4 竖版' },
        { value: '1504x640', label: '1504x640 2.35:1 横版' },
        { value: '2048x1152', label: '2048x1152 16:9 横版' },
        { value: '2160x3840', label: '2160x3840 9:16 竖版' },
    ];
    const DRAW_IMAGE_QUALITY_OPTIONS: Array<{ value: DrawImageQuality; label: string }> = [
        { value: 'auto', label: 'auto 默认' },
        { value: 'low', label: 'low 低' },
        { value: 'medium', label: 'medium 中' },
        { value: 'high', label: 'high 高' },
        { value: 'standard', label: 'standard 标准' },
        { value: 'hd', label: 'hd 高清' },
    ];

    let drawImageSize: DrawImageSize = 'auto';
    let drawImageSizeOptions = DRAW_IMAGE_SIZE_OPTIONS;
    let drawAutoDetectedSizeOption: DrawImageSizeOption | null = null;
    let drawImageCount = 1;
    let drawImageQuality: DrawImageQuality = 'auto';
    let drawModeNoModelWarned = false;

    // 图片查看器
    let isImageViewerOpen = false;
    let isImageViewerFullscreen = false;
    let currentImageSrc = '';
    let currentImageName = '';

    // 翻译功能
    let isTranslateDialogOpen = false;
    let translateInputLanguage = 'auto'; // 自动检测
    let translateOutputLanguage = 'zh-CN'; // 简体中文
    let translateInputText = '';
    let translateOutputText = '';
    let isTranslating = false;
    let translateProvider = '';
    let translateModelId = '';
    let translateHistory: Array<{
        id: string;
        inputLanguage: string;
        outputLanguage: string;
        timestamp: number;
        provider: string;
        modelId: string;
        preview: string; // 输入文本的预览（前100字符）
    }> = [];
    let showTranslateHistory = false;
    let translateAbortController: AbortController | null = null;
    let currentTranslateId: string | null = null; // 当前查看的翻译ID

    // 小程序功能
    let isWebAppManagerOpen = false;
    let showWebAppMenu = false;
    let webAppMenuButton: HTMLButtonElement;
    let webAppMenuDropdown: HTMLDivElement;
    let webAppDropdownTop = 0;
    let webAppDropdownLeft = 0;
    let webApps: Array<{
        id: string;
        name: string;
        url: string;
        icon?: string;
        createdAt: number;
        updatedAt: number;
    }> = [];

    // 消息内容显示缓存（存储每个消息的显示内容，键为content的哈希）
    const messageDisplayCache = new Map<string, { loading: boolean; content: string }>();

    // 获取content的简单哈希（用作缓存键）
    function getContentHash(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    // 获取用于显示的消息内容（将 assets 路径替换为 blob URL）
    function getDisplayContent(content: string | MessageContent[]): string {
        const textContent = typeof content === 'string' ? content : getMessageText(content);

        // 检查是否包含 assets 路径
        if (!textContent.includes('/data/storage/petal/siyuan-plugin-copilot/assets/')) {
            return formatMessage(textContent);
        }

        // 使用content本身的哈希作为缓存键
        const cacheKey = getContentHash(textContent);

        // 如果缓存中存在且已加载完成，直接返回
        const cached = messageDisplayCache.get(cacheKey);
        if (cached && !cached.loading) {
            return cached.content;
        }

        // 如果正在加载，返回原始内容
        if (cached && cached.loading) {
            return formatMessage(textContent);
        }

        // 标记为加载中
        messageDisplayCache.set(cacheKey, { loading: true, content: '' });

        // 异步加载assets图片
        replaceAssetPathsWithBlob(textContent).then(processedContent => {
            const formattedContent = formatMessage(processedContent);
            messageDisplayCache.set(cacheKey, { loading: false, content: formattedContent });
            // 触发重新渲染
            messages = [...messages];
        });

        // 先返回原始内容
        return formatMessage(textContent);
    }

    // 打开图片查看器
    function openImageViewer(src: string, name: string) {
        currentImageSrc = src;
        currentImageName = name;
        isImageViewerOpen = true;
    }

    // 关闭图片查看器
    function closeImageViewer() {
        isImageViewerOpen = false;
        currentImageSrc = '';
        currentImageName = '';
        isImageViewerFullscreen = false;
    }

    // 切换图片查看器全屏
    function toggleImageViewerFullscreen() {
        isImageViewerFullscreen = !isImageViewerFullscreen;
    }

    // 下载图片
    async function downloadImage(src: string, filename: string) {
        try {
            const link = document.createElement('a');
            link.href = src;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            pushMsg('图片下载成功');
        } catch (error) {
            console.error('下载图片失败:', error);
            pushErrMsg('下载图片失败');
        }
    }

    // 复制图片为PNG
    async function copyImageAsPng(src: string) {
        try {
            const response = await fetch(src);
            const blob = await response.blob();

            // 如果已经是 image/png，直接复制
            if (blob.type === 'image/png') {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'image/png': blob,
                    }),
                ]);
            } else {
                // 否则转换为 PNG
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = URL.createObjectURL(blob);
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                });

                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('无法创建 Canvas 上下文');
                ctx.drawImage(img, 0, 0);

                const pngBlob = await new Promise<Blob | null>(resolve =>
                    canvas.toBlob(resolve, 'image/png')
                );
                if (!pngBlob) throw new Error('转换图片失败');

                await navigator.clipboard.write([
                    new ClipboardItem({
                        'image/png': pngBlob,
                    }),
                ]);
                URL.revokeObjectURL(img.src);
            }

            pushMsg('图片已复制到剪贴板');
        } catch (error) {
            console.error('复制图片失败:', error);
            pushErrMsg('复制图片失败，请尝试下载后复制');
        }
    }

    // 翻译功能相关函数
    // 打开翻译对话框
    function openTranslateDialog() {
        isTranslateDialogOpen = true;
        showTranslateHistory = false;

        // 如果还没有选择翻译模型，使用当前对话的模型作为默认值
        if (!translateProvider && currentProvider) {
            translateProvider = currentProvider;
            translateModelId = currentModelId;
        }
    }

    // 关闭翻译对话框
    function closeTranslateDialog() {
        isTranslateDialogOpen = false;
        showTranslateHistory = false;
    }

    // 清空翻译对话框
    function clearTranslateDialog() {
        translateInputText = '';
        translateOutputText = '';
        currentTranslateId = null;
    }

    // 加载翻译历史列表
    async function loadTranslateHistoryList() {
        try {
            const data = await plugin.loadData('translate-history.json');
            translateHistory = data?.history || [];
        } catch (error) {
            console.error('Load translate history error:', error);
            translateHistory = [];
        }
    }

    // 从独立文件加载单个翻译项
    async function loadTranslateItem(
        id: string
    ): Promise<{ inputText: string; outputText: string } | null> {
        try {
            const translatePath = `/data/storage/petal/siyuan-plugin-copilot/translate/${id}.json`;
            const blob = await getFileBlob(translatePath);
            const text = await blob.text();
            return JSON.parse(text);
        } catch (error) {
            console.error('Load translate item error:', error);
            return null;
        }
    }

    // 小程序功能相关函数
    // 切换小程序菜单
    async function toggleWebAppMenu(event: MouseEvent) {
        event.stopPropagation();
        showWebAppMenu = !showWebAppMenu;
        if (showWebAppMenu) {
            await updateWebAppDropdownPosition();
            setTimeout(() => {
                document.addEventListener('click', closeWebAppMenuOnOutsideClick);
            }, 0);
        } else {
            document.removeEventListener('click', closeWebAppMenuOnOutsideClick);
        }
    }

    // 计算下拉菜单位置
    async function updateWebAppDropdownPosition() {
        if (!webAppMenuButton || !showWebAppMenu) return;

        await tick();

        const rect = webAppMenuButton.getBoundingClientRect();
        const dropdownWidth = webAppMenuDropdown?.offsetWidth || 200;
        const dropdownHeight = webAppMenuDropdown?.offsetHeight || 300;

        // 计算垂直位置
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;

        if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
            // 显示在按钮下方
            webAppDropdownTop = rect.bottom + 4;
        } else {
            // 显示在按钮上方
            webAppDropdownTop = rect.top - dropdownHeight - 4;
        }

        // 计算水平位置（右对齐）
        webAppDropdownLeft = rect.right - dropdownWidth;

        // 确保下拉菜单不会超出视口左边界
        if (webAppDropdownLeft < 8) {
            webAppDropdownLeft = 8;
        }

        // 确保下拉菜单不会超出视口右边界
        if (webAppDropdownLeft + dropdownWidth > window.innerWidth - 8) {
            webAppDropdownLeft = window.innerWidth - dropdownWidth - 8;
        }
    }

    // 点击外部关闭小程序菜单
    function closeWebAppMenuOnOutsideClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest('.ai-sidebar__webapp-menu-container')) {
            showWebAppMenu = false;
            document.removeEventListener('click', closeWebAppMenuOnOutsideClick);
        }
    }

    // 打开小程序管理器
    function openWebAppManager() {
        showWebAppMenu = false;
        document.removeEventListener('click', closeWebAppMenuOnOutsideClick);
        isWebAppManagerOpen = true;
    }

    // 关闭小程序管理器
    function closeWebAppManager() {
        isWebAppManagerOpen = false;
    }

    // 保存小程序设置
    async function saveWebApps(event: CustomEvent<{ webApps: any[] }>) {
        webApps = event.detail.webApps;
        settings.webApps = webApps;
        await plugin.saveData('settings.json', settings);

        // 为每个小程序注册图标
        for (const app of webApps) {
            if (app.icon && app.icon.startsWith('data:image')) {
                plugin.registerWebAppIcon(app.id, app.icon);
            }
        }
    }

    // 打开小程序
    function openWebApp(event: CustomEvent<{ app: any }>) {
        const app = event.detail.app;
        openWebAppDirect(app);
    }

    // 获取小程序图标URL（兼容base64和文件路径格式）
    function getWebAppIconUrl(icon: string): string {
        if (!icon) return '';
        // 如果已经是base64格式，直接返回
        if (icon.startsWith('data:')) {
            return icon;
        }
        // 兼容旧的文件名格式
        return `/data/storage/petal/siyuan-plugin-copilot/webappIcon/${icon}`;
    }

    // 直接打开小程序
    function openWebAppDirect(app: any) {
        showWebAppMenu = false;
        document.removeEventListener('click', closeWebAppMenuOnOutsideClick);

        // 如果小程序有自定义图标，使用自定义图标，否则使用默认图标
        const iconId =
            app.icon && app.icon.startsWith('data:image')
                ? plugin.getWebAppIconId(app.id)
                : 'iconCopilotWebApp';

        // 使用 openTab API 打开小程序
        openTab({
            app: plugin.app,
            custom: {
                icon: iconId,
                title: app.name,
                id: plugin.name + WEBAPP_TAB_TYPE,
                data: {
                    app: app,
                    time: Date.now(), // 添加时间戳，确保每次点击都能打开新标签页
                },
            },
        });
    }

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

                if (doc.type === 'webpage') {
                    // 网页类型：保持原内容不变（已经获取到内容）
                    content = doc.content;
                } else if ((chatMode === 'agent' || chatMode === 'ask') && userToolCount > 0) {
                    // agent模式或启用工具的问答模式：文档只保留ID，块获取kramdown
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
                    url: doc.url,
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
            pushErrMsg(i18n('aiSidebar.errors.noMessage'));
            return;
        }

        // 如果目标模型正在加载中，则拒绝重复触发
        if (response.isLoading) {
            pushErrMsg(i18n('aiSidebar.errors.generating'));
            return;
        }

        const config = getProviderAndModelConfig(response.provider, response.modelId);
        if (!config) {
            pushErrMsg(i18n('aiSidebar.info.noValidModel') || '无效的模型');
            return;
        }

        const { providerConfig, modelConfig } = config;
        if (!providerConfig || !providerConfig.apiKey) {
            pushErrMsg(i18n('aiSidebar.errors.noApiKey'));
            return;
        }

        // 标记为加载中并清空内容/错误/工具调用历史
        multiModelResponses[index] = {
            ...multiModelResponses[index],
            isLoading: true,
            error: undefined,
            content: '',
            thinking: '',
            thinkingCollapsed: false,
            toolCalls: [], // 清空上次的工具调用记录
        };
        multiModelResponses = [...multiModelResponses];

        // 获取最后一条用户消息并准备上下文
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        if (!lastUserMessage) {
            pushErrMsg(i18n('aiSidebar.errors.noUserMessage'));
            multiModelResponses[index].isLoading = false;
            multiModelResponses = [...multiModelResponses];
            return;
        }

        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        const userContextDocs = lastUserMessage.contextDocuments || [];
        for (const doc of userContextDocs) {
            try {
                let content: string;
                if ((chatMode === 'agent' || chatMode === 'ask') && userToolCount > 0) {
                    if (doc.type === 'doc') {
                        content = '';
                    } else {
                        const blockData = await getBlockKramdown(doc.id);
                        content = (blockData && blockData.kramdown) || doc.content;
                    }
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

        const messagesToSend = await prepareMessagesForAI(
            messages,
            contextDocumentsWithLatestContent,
            userContent,
            userMessage,
            // 传入当前模型的 thinking 状态，以便正确处理历史 assistant 消息中的 reasoning_content
            !!(
                modelConfig.capabilities?.thinking &&
                (response.thinkingEnabled ?? modelConfig.thinkingEnabled ?? false)
            )
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
            // 准备 Agent/Ask 模式的工具列表
            let toolsForAgent: any[] | undefined = undefined;
            if ((chatMode === 'agent' || chatMode === 'ask') && userToolCount > 0) {
                const currentSelectedTools = chatMode === 'ask' ? selectedToolsAsk : selectedTools;
                const selectedToolDefs = AVAILABLE_TOOLS.filter(tool =>
                    currentSelectedTools.some(t => t.name === tool.function.name)
                );
                const filteredToolDefs = selectedToolDefs.filter(
                    tool => tool.function.name !== 'get_siyuan_skills'
                );
                const descTool =
                    chatMode === 'ask'
                        ? createGetSiyuanSkillsTool(
                              filteredToolDefs.map(tool => tool.function.name)
                          )
                        : AVAILABLE_TOOLS.find(t => t.function.name === 'get_siyuan_skills');
                toolsForAgent = descTool ? [descTool, ...filteredToolDefs] : filteredToolDefs;
            }

            // 准备联网搜索工具（如果启用）
            let webSearchTools: any[] | undefined = undefined;
            if (modelConfig.capabilities?.webSearch && modelConfig.webSearchEnabled) {
                const modelIdLower = modelConfig.id.toLowerCase();
                if (modelIdLower.includes('gemini')) {
                    webSearchTools = [
                        {
                            type: 'function',
                            function: {
                                name: 'googleSearch',
                            },
                        },
                    ];
                }
            }

            // 合并工具列表
            const finalTools = [...(toolsForAgent || []), ...(webSearchTools || [])];
            const toolsToPass = finalTools.length > 0 ? finalTools : undefined;

            // 多模型工具调用循环
            let modelMessagesToSend = [...messagesToSend];
            let shouldContinue = true;
            let fullText = '';
            let totalThinking = '';

            while (shouldContinue && !localAbort.signal.aborted) {
                let hasNewToolCalls = false;
                let lastAssistantContent = '';
                let turnThinking = '';

                await chat(
                    response.provider,
                    {
                        apiKey: providerConfig.apiKey,
                        useForwardProxy: providerConfig.useForwardProxy || false,
                        model: modelConfig.id,
                        messages: modelMessagesToSend,
                        temperature: tempModelSettings.temperatureEnabled
                            ? tempModelSettings.temperature
                            : modelConfig.temperature,
                        maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                        stream: true,
                        signal: localAbort.signal,
                        customBody, // 同时检查模型能力和用户是否启用，与 sendMultiModelMessage 保持一致
                        enableThinking:
                            modelConfig.capabilities?.thinking &&
                            (response.thinkingEnabled ?? modelConfig.thinkingEnabled ?? false),
                        reasoningEffort:
                            response.thinkingEffort ?? modelConfig.thinkingEffort ?? 'low',
                        tools: toolsToPass,
                        onThinkingChunk: async (chunk: string) => {
                            turnThinking += chunk;
                            totalThinking += chunk;
                            if (multiModelResponses[index]) {
                                multiModelResponses[index].thinking = totalThinking;
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
                            lastAssistantContent += chunk;
                            if (multiModelResponses[index]) {
                                multiModelResponses[index].content = fullText;
                                multiModelResponses = [...multiModelResponses];
                            }
                        },
                        onToolCallComplete: async (toolCalls: ToolCall[]) => {
                            hasNewToolCalls = true;

                            // 1. 将 assistant 消息（包含 tool_calls）添加到当前模型的上下文
                            const isReasoningEnabled =
                                modelConfig.capabilities?.thinking &&
                                (response.thinkingEnabled ?? modelConfig.thinkingEnabled ?? false);

                            const assistantMsg: any = {
                                role: 'assistant',
                                content: lastAssistantContent,
                                tool_calls: toolCalls,
                            };

                            // 特别是 Kimi 等模型，如果启用了 thinking，assistant 消息必须包含 reasoning_content
                            if (isReasoningEnabled) {
                                assistantMsg.reasoning_content = turnThinking;
                            }

                            modelMessagesToSend.push(assistantMsg);

                            // 2. 执行工具并添加结果，同时记录该轮工具调用前的思考内容
                            for (const tc of toolCalls) {
                                // 更新 UI 显示正在调用，并记录该工具调用前的思考内容
                                if (multiModelResponses[index]) {
                                    multiModelResponses[index].toolCalls = [
                                        ...(multiModelResponses[index].toolCalls || []),
                                        { ...tc, status: 'calling', thinkingBefore: turnThinking },
                                    ];
                                    multiModelResponses = [...multiModelResponses];
                                }

                                // 检查是否自动批准
                                const currentSelectedTools =
                                    chatMode === 'ask' ? selectedToolsAsk : selectedTools;
                                const toolConfig = currentSelectedTools.find(
                                    t => t.name === tc.function.name
                                );
                                const isSystemTool = tc.function.name === 'get_siyuan_skills';
                                const autoApprove =
                                    isSystemTool || (toolConfig && toolConfig.autoApprove) || false;

                                let toolResult: string;
                                if (autoApprove) {
                                    console.log(
                                        `[RegenerateMultiModel] Auto-approving tool: ${tc.function.name}`
                                    );
                                    toolResult = await executeToolCall(tc);
                                } else {
                                    console.log(
                                        `[RegenerateMultiModel] Skipping non-auto-approved tool: ${tc.function.name}`
                                    );
                                    toolResult = `工具 ${tc.function.name} 需要手动批准。在多模型对比模式下，为了避免 UI 冲突，该工具未被自动执行。请在设置中将该工具设为“自动批准”。`;
                                }

                                modelMessagesToSend.push({
                                    role: 'tool',
                                    tool_call_id: tc.id,
                                    name: tc.function.name,
                                    content: toolResult,
                                });

                                // 更新 UI 显示结果
                                if (multiModelResponses[index]) {
                                    const callIndex = multiModelResponses[
                                        index
                                    ].toolCalls.findIndex(c => c.id === tc.id);
                                    if (callIndex !== -1) {
                                        multiModelResponses[index].toolCalls[callIndex].status =
                                            'completed';
                                        multiModelResponses[index].toolCalls[callIndex].result =
                                            toolResult;
                                        multiModelResponses = [...multiModelResponses];
                                    }
                                }
                            }

                            lastAssistantContent = '';
                            if (multiModelResponses[index]) {
                                multiModelResponses[index].isLoading = true;
                                multiModelResponses = [...multiModelResponses];
                            }
                        },
                        onComplete: async (text: string) => {
                            if (multiModelResponses[index]) {
                                const convertedText = convertLatexToMarkdown(text);
                                // 处理content中的base64图片，保存为assets文件
                                const processedContent =
                                    await saveBase64ImagesInContent(convertedText);
                                multiModelResponses[index].content = processedContent;
                                multiModelResponses[index].thinking = totalThinking;
                                multiModelResponses[index].isLoading = false;
                                if (
                                    totalThinking &&
                                    !multiModelResponses[index].thinkingCollapsed
                                ) {
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

                if (!hasNewToolCalls) {
                    shouldContinue = false;
                }
            }
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
            pushErrMsg(i18n('aiSidebar.errors.noMessage'));
            return;
        }

        const response = msg.multiModelResponses[responseIndex];
        if (!response) {
            pushErrMsg(i18n('aiSidebar.errors.noMessage'));
            return;
        }

        if (response.isLoading) {
            pushErrMsg(i18n('aiSidebar.errors.generating'));
            return;
        }

        const config = getProviderAndModelConfig(response.provider, response.modelId);
        if (!config) {
            pushErrMsg(i18n('aiSidebar.info.noValidModel') || '无效的模型');
            return;
        }

        const { providerConfig, modelConfig } = config;
        if (!providerConfig || !providerConfig.apiKey) {
            pushErrMsg(i18n('aiSidebar.errors.noApiKey'));
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
            pushErrMsg(i18n('aiSidebar.errors.noUserMessage'));
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
                const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                content = (data && data.content) || doc.content;
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

        const messagesToSend = await prepareMessagesForAI(
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
                    useForwardProxy: providerConfig.useForwardProxy || false,
                    model: modelConfig.id,
                    messages: messagesToSend,
                    temperature: tempModelSettings.temperatureEnabled
                        ? tempModelSettings.temperature
                        : modelConfig.temperature,
                    maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                    stream: true,
                    signal: localAbort.signal,
                    customBody,
                    enableThinking:
                        modelConfig.capabilities?.thinking &&
                        (modelConfig.thinkingEnabled || false),
                    reasoningEffort: modelConfig.thinkingEffort || 'low',
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
                        const convertedText = convertLatexToMarkdown(text);
                        // 处理content中的base64图片，保存为assets文件
                        const processedContent = await saveBase64ImagesInContent(convertedText);
                        msg.multiModelResponses[responseIndex].content = processedContent;
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
    let selectedToolsAsk: ToolConfig[] = []; // 问答模式选中的工具配置列表
    let toolAutoApproveSettings: Record<string, boolean> = {}; // 所有工具的 autoApprove 配置（包括未选中的）
    let toolAutoApproveSettingsAsk: Record<string, boolean> = {}; // 问答模式所有工具的 autoApprove 配置
    // 用户选择的工具数量（排除系统工具 get_siyuan_skills）
    $: userToolCount =
        chatMode === 'draw'
            ? 0
            : (chatMode === 'ask' ? selectedToolsAsk || [] : selectedTools || []).filter(
                  t => t.name !== 'get_siyuan_skills'
              ).length;

    $: providersForModelSelector =
        chatMode === 'draw' ? filterProvidersByImageGeneration(providers) : providers;

    $: {
        const currentConfig = getProviderAndModelConfig(currentProvider, currentModelId);
        drawImageSizeOptions = mergeDrawAutoDetectedSizeOption(
            getDrawImageSizeOptions(currentConfig?.providerConfig, currentConfig?.modelConfig)
        );
        if (!drawImageSizeOptions.some(option => option.value === drawImageSize)) {
            drawImageSize = 'auto';
        }
    }

    $: if (chatMode === 'draw' && !isInitialLoading) {
        syncDrawingModeState();
    }

    // 记忆当前选择的模式
    $: if (chatMode && settings && !isInitialLoading) {
        // 同步到临时设置以便在预设按钮中正确显示
        if (tempModelSettings.chatMode !== chatMode) {
            tempModelSettings.chatMode = chatMode;
        }
        if (settings.lastUsedChatMode !== chatMode) {
            settings.lastUsedChatMode = chatMode;
            plugin.saveSettings(settings);
        }
    }
    let toolCallsInProgress: Set<string> = new Set(); // 正在执行的工具调用ID
    let toolCallsExpanded: Record<string, boolean> = {}; // 工具调用是否展开，默认折叠
    let toolCallResultsExpanded: Record<string, boolean> = {}; // 工具结果是否展开，默认折叠
    type PendingDocDiff = {
        docId: string;
        docTitle: string;
        oldDocTitle: string;
        newDocTitle: string;
        oldContent: string;
        newContent: string;
        affectedBlockIds: Set<string>;
    };
    const pendingDocDiffsByMessage = new Map<number, Map<string, PendingDocDiff>>();
    let pendingToolCall: ToolCall | null = null; // 待批准的工具调用
    let isToolApprovalDialogOpen = false; // 工具批准对话框是否打开
    let isToolConfigLoaded = false; // 标记工具配置是否已加载
    let lastSavedToolsConfigSnapshot = JSON.stringify({
        selectedTools: [],
        toolAutoApproveSettings: {},
    }); // 最近一次已加载/已保存的工具配置快照
    let thinkingBeforeToolCalls: string = ''; // 工具调用前的思考内容

    // 多模型对话
    let enableMultiModel = false; // 是否启用多模型模式
    let selectedMultiModels: Array<{
        provider: string;
        modelId: string;
        thinkingEnabled?: boolean;
        thinkingEffort?: ThinkingEffort;
    }> = []; // 选中的多个模型

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
        thinkingEffort?: ThinkingEffort; // 思考努力程度
        toolCalls?: Array<{
            id: string;
            type: string;
            function: {
                name: string;
                arguments: string;
            };
            status?: 'calling' | 'completed';
            result?: string;
            thinkingBefore?: string; // 该工具调用前的思考内容
        }>; // 工具调用历史
        conversationMessages?: Message[]; // 该模型的完整对话消息历史（包含 tool_calls 和 tool 响应）
    }> = []; // 多模型响应
    let isWaitingForAnswerSelection = false; // 是否在等待用户选择答案
    let selectedAnswerIndex: number | null = null; // 用户选择的答案索引
    let multiModelLayout: 'card' | 'tab' = 'tab'; // 多模型布局模式：card 或 tab（会在初始化时从设置读取）
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

        // 初始化模式
        if (!settings.selectedModelPresetId && settings.lastUsedChatMode) {
            chatMode =
                settings.lastUsedChatMode === 'agent' || settings.lastUsedChatMode === 'draw'
                    ? settings.lastUsedChatMode
                    : 'ask';
        }

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

        // 初始化多模型视图样式设置
        multiModelViewMode = settings.multiModelViewMode || 'tab';
        multiModelLayout = multiModelViewMode; // 同时初始化多模型布局

        // 加载历史会话
        await loadSessions();

        // 加载提示词
        await loadPrompts();

        // 加载 Agent 模式的工具配置
        await loadToolsConfig();

        // 加载翻译历史和设置
        await loadTranslateHistoryList();
        translateProvider = settings.translateProvider || currentProvider || '';
        translateModelId = settings.translateModelId || currentModelId || '';
        translateInputLanguage = settings.translateInputLanguage || 'auto';
        translateOutputLanguage = settings.translateOutputLanguage || 'zh-CN';

        // 加载小程序设置
        webApps = settings.webApps || [];

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
                }

                // 实时更新多模型视图样式设置
                if (newSettings.multiModelViewMode !== undefined) {
                    multiModelViewMode = newSettings.multiModelViewMode;
                    multiModelLayout = newSettings.multiModelViewMode; // 同步更新多模型布局
                }

                // 更新系统提示词
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
        // 监听文档总结事件
        window.addEventListener('copilot-summarize-doc', handleSummarizeDoc as EventListener);
        // 监听提示词更新事件（多实例同步）
        window.addEventListener(PROMPTS_SYNC_EVENT, handlePromptsUpdated as EventListener);

        isInitialLoading = false;
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
        // 移除文档总结事件监听器
        window.removeEventListener('copilot-summarize-doc', handleSummarizeDoc as EventListener);
        // 移除提示词更新事件监听器
        window.removeEventListener(PROMPTS_SYNC_EVENT, handlePromptsUpdated as EventListener);

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
                    minimax: { apiKey: '', customApiUrl: '', models: [] },
                    customProviders: [],
                    disabledBuiltInProviders: [],
                    providerOrder: [],
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
                            temperature: settings.aiTemperature || 1,
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

        // 兼容新增内置平台
        if (settings.aiProviders && !settings.aiProviders.minimax) {
            settings.aiProviders.minimax = { apiKey: '', customApiUrl: '', models: [] };
        }

        // 确保 disabledBuiltInProviders 数组存在
        if (settings.aiProviders && !settings.aiProviders.disabledBuiltInProviders) {
            settings.aiProviders.disabledBuiltInProviders = [];
        }

        // 确保 providerOrder 数组存在
        if (settings.aiProviders && !settings.aiProviders.providerOrder) {
            settings.aiProviders.providerOrder = [];
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
        streamingMessage;
        streamingThinking;

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
                setupImageClickHandlers(messagesContainer);
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
            pushErrMsg(i18n('aiSidebar.errors.imageOnly'));
            return;
        }

        // 先立即显示预览，资源保存在后台进行，减少拖拽后的卡顿感
        const blobUrl = URL.createObjectURL(file);
        const attachment: MessageAttachment = {
            type: 'image',
            name: file.name,
            data: blobUrl,
            path: '',
            mimeType: file.type,
        };
        currentAttachments = [...currentAttachments, attachment];

        isUploadingFile = true;
        const saveTask = (async () => {
            try {
                const assetPath = await saveAsset(file, file.name);
                currentAttachments = currentAttachments.map(att =>
                    att === attachment ? { ...att, path: assetPath } : att
                );
            } catch (error) {
                console.error('Add image error:', error);
                // 保存失败时移除该附件，避免后续会话中保留无效 blob URL
                currentAttachments = currentAttachments.filter(att => att !== attachment);
                pushErrMsg(i18n('aiSidebar.errors.addImageFailed'));
            }
        })();

        pendingAttachmentSaveTasks.add(saveTask);
        saveTask.finally(() => {
            pendingAttachmentSaveTasks.delete(saveTask);
            if (pendingAttachmentSaveTasks.size === 0) {
                isUploadingFile = false;
            }
        });
    }

    // 添加文件附件
    async function addFileAttachment(file: File) {
        if (chatMode === 'draw' && !file.type.startsWith('image/')) {
            pushErrMsg('画图模式只能上传图片');
            return;
        }

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
            pushErrMsg(i18n('aiSidebar.errors.textAndImageOnly'));
            return;
        }

        // 检查文件大小 (文本文件最大 5MB，图片最大 10MB)
        const maxSize = isImage ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
        if (file.size > maxSize) {
            pushErrMsg(i18n('aiSidebar.errors.fileTooLarge'));
            return;
        }

        try {
            if (isImage) {
                await addImageAttachment(file);
            } else {
                isUploadingFile = true;
                // 文本读取与资源保存并行，减少等待时间
                const [content, assetPath] = await Promise.all([
                    file.text(),
                    saveAsset(file, file.name),
                ]);

                currentAttachments = [
                    ...currentAttachments,
                    {
                        type: 'file',
                        name: file.name,
                        data: content, // 内存中保持 content 方便立即发送给 AI
                        path: assetPath,
                        mimeType: file.type,
                    },
                ];
            }
        } catch (error) {
            console.error('Add file error:', error);
            pushErrMsg(i18n('aiSidebar.errors.addFileFailed'));
        } finally {
            if (pendingAttachmentSaveTasks.size === 0) {
                isUploadingFile = false;
            }
        }
    }

    // 附件保存可能在后台进行，发送前等待完成，确保 path 持久化可用
    async function waitForPendingAttachmentSaves() {
        if (pendingAttachmentSaveTasks.size === 0) return;
        await Promise.all(Array.from(pendingAttachmentSaveTasks));
    }

    async function addFilesInBatches(files: File[], concurrency = 3) {
        for (let i = 0; i < files.length; i += concurrency) {
            const batch = files.slice(i, i + concurrency);
            await Promise.all(batch.map(file => addFileAttachment(file)));
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

        await addFilesInBatches(Array.from(files));

        // 清空 input，允许重复选择同一文件
        input.value = '';
    }

    // 移除附件
    function removeAttachment(index: number) {
        currentAttachments = currentAttachments.filter((_, i) => i !== index);
    }

    // 打开网页链接对话框
    function openWebLinkDialog() {
        isWebLinkDialogOpen = true;
        webLinkInput = '';
    }

    // 关闭网页链接对话框
    function closeWebLinkDialog() {
        isWebLinkDialogOpen = false;
        webLinkInput = '';
    }

    // 爬取网页内容并转换为Markdown
    async function fetchWebPages() {
        if (!webLinkInput.trim()) {
            pushErrMsg('请输入至少一个链接');
            return;
        }

        // 解析多个链接（按换行符分割）
        const links = webLinkInput
            .split('\n')
            .map(link => link.trim())
            .filter(link => link.length > 0);

        if (links.length === 0) {
            pushErrMsg('请输入有效的链接');
            return;
        }

        isFetchingWebContent = true;
        let successCount = 0;

        try {
            // 使用工具函数批量解析网页
            const results = await parseMultipleWebPages(links, (current, total, url, success) => {
                if (success) {
                    pushMsg(`正在获取 (${current}/${total}): ${url}`);
                }
            });

            // 处理解析结果
            for (const result of results) {
                if (result.success) {
                    // 从 URL 中提取文件名
                    const urlObj = new URL(result.url);
                    const fileName = `${urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.md`;

                    // 保存为 SiYuan 资源
                    const assetPath = await saveAsset(
                        new Blob([result.markdown], { type: 'text/markdown' }),
                        fileName
                    );

                    // 添加到附件列表，标记为网页类型
                    currentAttachments = [
                        ...currentAttachments,
                        {
                            type: 'file',
                            name: result.url,
                            data: result.markdown,
                            path: assetPath,
                            mimeType: 'text/markdown',
                            isWebPage: true, // 标记为网页附件
                            url: result.url, // 保存原始URL
                        },
                    ];

                    successCount++;
                    pushMsg(`✓ 成功获取: ${result.title || result.url}`);
                } else {
                    // 解析失败，尝试使用 WebView 模式
                    pushMsg(`普通模式失败，尝试 WebView 模式: ${result.url}`);

                    try {
                        const webviewResult = await fetchWithWebView(result.url);

                        if (webviewResult.success && webviewResult.markdown) {
                            // 从 URL 中提取文件名
                            const urlObj = new URL(result.url);
                            const fileName = `${urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.md`;

                            // 保存为 SiYuan 资源
                            const assetPath = await saveAsset(
                                new Blob([webviewResult.markdown], { type: 'text/markdown' }),
                                fileName
                            );

                            // 添加到附件列表，标记为网页类型
                            currentAttachments = [
                                ...currentAttachments,
                                {
                                    type: 'file',
                                    name: result.url,
                                    data: webviewResult.markdown,
                                    path: assetPath,
                                    mimeType: 'text/markdown',
                                    isWebPage: true, // 标记为网页附件
                                    url: result.url, // 保存原始URL
                                },
                            ];

                            successCount++;
                            pushMsg(`✓ WebView 模式成功: ${webviewResult.title || result.url}`);
                        } else {
                            // WebView 也失败了
                            if (
                                result.error?.includes('CORS') ||
                                result.error?.includes('Failed to fetch')
                            ) {
                                pushErrMsg(`✗ CORS 限制: ${result.url} - 该网站不允许跨域访问`);
                            } else {
                                pushErrMsg(`✗ 获取失败: ${result.url} - ${result.error}`);
                            }
                        }
                    } catch (webviewError) {
                        console.error('WebView fetch error:', webviewError);
                        pushErrMsg(`✗ WebView 模式也失败了: ${result.url}`);
                    }
                }
            }

            // 如果有成功的结果，关闭弹窗
            if (successCount > 0) {
                closeWebLinkDialog();
            }
        } catch (error) {
            console.error('Fetch web pages error:', error);
            pushErrMsg('获取网页内容失败');
        } finally {
            isFetchingWebContent = false;
        }
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
            selectedModels?: Array<{
                provider: string;
                modelId: string;
                thinkingEnabled?: boolean;
                thinkingEffort?: ThinkingEffort;
            }>;
            enableMultiModel?: boolean;
            chatMode?: 'ask' | 'agent' | 'draw';
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
        };

        // 应用聊天模式
        if (newSettings.chatMode) {
            chatMode = newSettings.chatMode;
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

    // 联网模式状态（响应式）
    $: isWebSearchModeEnabled = (() => {
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
        return modelConfig?.capabilities?.webSearch ? modelConfig.webSearchEnabled || false : false;
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

    // 是否显示联网模式按钮（只有 Gemini 模型支持联网）
    $: showWebSearchToggle = (() => {
        if (!currentProvider || !currentModelId) {
            return false;
        }

        // 只有模型名称以 gemini 开头的模型显示联网搜索按钮
        if (!currentModelId.toLowerCase().startsWith('gemini')) {
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
        return modelConfig?.capabilities?.webSearch || false;
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

    // 当前模型是否是 Gemini 3 系列（用于限制思考程度选项）
    $: isCurrentModelGemini3 = currentModelId ? isGemini3Model(currentModelId) : false;

    // 当前思考程度设置
    $: currentThinkingEffort = (() => {
        if (!currentProvider || !currentModelId) {
            return 'low' as ThinkingEffort;
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
            return 'low' as ThinkingEffort;
        }

        const modelConfig = providerConfig.models?.find((m: any) => m.id === currentModelId);
        return (modelConfig?.thinkingEffort || 'low') as ThinkingEffort;
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

    // 切换联网模式
    async function toggleWebSearchMode() {
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

        // 只有当模型支持联网能力时，才能切换
        if (!modelConfig.capabilities.webSearch) {
            return;
        }

        // 切换联网模式启用状态
        modelConfig.webSearchEnabled = !modelConfig.webSearchEnabled;

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

    function modelSupportsImageGeneration(model: any): boolean {
        return !!model?.capabilities?.imageGeneration;
    }

    function isGeminiImageApi(providerConfig: any, modelConfig?: any): boolean {
        const customUrls = [
            providerConfig?.customApiUrl,
            providerConfig?.advancedConfig?.customChatUrl,
            providerConfig?.advancedConfig?.customModelsUrl,
        ]
            .filter(Boolean)
            .join(' ');

        return (
            currentProvider === 'gemini' ||
            providerConfig?.advancedConfig?.chatInterface === 'gemini' ||
            /generativelanguage\.googleapis\.com/i.test(customUrls) ||
            /^gemini-/i.test(modelConfig?.id || '')
        );
    }

    function geminiModelSupportsImageSize(modelId: string): boolean {
        return /gemini-3(?:\.\d+)?-(?:flash|pro)-image/i.test(modelId || '');
    }

    function getDrawImageSizeOptions(providerConfig: any, modelConfig: any) {
        if (!isGeminiImageApi(providerConfig, modelConfig)) {
            return DRAW_IMAGE_SIZE_OPTIONS;
        }

        return geminiModelSupportsImageSize(modelConfig?.id || '')
            ? GEMINI_DRAW_IMAGE_SIZE_OPTIONS
            : GEMINI_ASPECT_ONLY_DRAW_IMAGE_SIZE_OPTIONS;
    }

    function mergeDrawAutoDetectedSizeOption(options: DrawImageSizeOption[]) {
        if (
            !drawAutoDetectedSizeOption ||
            options.some(option => option.value === drawAutoDetectedSizeOption?.value)
        ) {
            return options;
        }

        const [autoOption, ...restOptions] = options;
        return [autoOption, drawAutoDetectedSizeOption, ...restOptions];
    }

    function roundToDrawSizeUnit(value: number): number {
        return Math.max(64, Math.min(8192, Math.round(value / DRAW_IMAGE_SIZE_STEP) * DRAW_IMAGE_SIZE_STEP));
    }

    function normalizeDrawImagePixelSize(width: number, height: number) {
        return {
            width: roundToDrawSizeUnit(width),
            height: roundToDrawSizeUnit(height),
        };
    }

    function parseDrawImageSizeValue(size: string): { width: number; height: number } | null {
        const match = String(size || '').match(/^(\d{2,5})x(\d{2,5})$/i);
        if (!match) return null;
        const width = Number(match[1]);
        const height = Number(match[2]);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            return null;
        }
        return { width, height };
    }

    function findKnownDrawRatioLabel(ratio: number): string | null {
        const knownRatios = [
            { value: 1, label: '1:1' },
            { value: 3 / 2, label: '3:2' },
            { value: 2 / 3, label: '2:3' },
            { value: 2.35, label: '2.35:1' },
            { value: 16 / 9, label: '16:9' },
            { value: 9 / 16, label: '9:16' },
            { value: 21 / 9, label: '21:9' },
            { value: 4 / 3, label: '4:3' },
            { value: 3 / 4, label: '3:4' },
        ];
        const matched = knownRatios.find(item => Math.abs(item.value - ratio) < 0.015);
        return matched?.label || null;
    }

    function formatDrawRatio(width: number, height: number): string {
        const knownLabel = findKnownDrawRatioLabel(width / height);
        if (knownLabel) return knownLabel;

        if (width >= height) {
            return `${Number((width / height).toFixed(2))}:1`;
        }

        return `1:${Number((height / width).toFixed(2))}`;
    }

    function createDrawImageSizeOption(width: number, height: number): DrawImageSizeOption {
        const normalizedSize = normalizeDrawImagePixelSize(width, height);
        const size = `${normalizedSize.width}x${normalizedSize.height}`;
        const orientation =
            normalizedSize.width === normalizedSize.height
                ? '正方形'
                : normalizedSize.width > normalizedSize.height
                  ? '横版'
                  : '竖版';
        const existingOption = DRAW_IMAGE_SIZE_OPTIONS.find(option => option.value === size);
        return existingOption || {
            value: size,
            label: `${size} ${formatDrawRatio(normalizedSize.width, normalizedSize.height)} ${orientation} 自动识别`,
        };
    }

    function createDrawImageSizeOptionFromRatio(widthRatio: number, heightRatio: number) {
        const minRatio = Math.min(widthRatio, heightRatio);
        if (!Number.isFinite(minRatio) || minRatio <= 0) return null;

        const scale = DRAW_IMAGE_BASE_UNIT / minRatio;
        const width = roundToDrawSizeUnit(widthRatio * scale);
        const height = roundToDrawSizeUnit(heightRatio * scale);
        return createDrawImageSizeOption(width, height);
    }

    function getPromptImageSizeMatch(prompt: string) {
        const sizePatterns = [
            /(?:^|[^\d.])(\d{2,5})\s*(?:x|×|\*)\s*(\d{2,5})(?=$|[^\d.])/i,
            /宽\s*(\d{2,5})\s*(?:px|像素)?\s*[，,、\s]*(?:高|高度)\s*(\d{2,5})/i,
        ];

        for (const pattern of sizePatterns) {
            const match = prompt.match(pattern);
            if (!match) continue;
            const width = Number(match[1]);
            const height = Number(match[2]);
            if (
                Number.isFinite(width) &&
                Number.isFinite(height) &&
                width >= 64 &&
                height >= 64 &&
                width <= 8192 &&
                height <= 8192
            ) {
                return createDrawImageSizeOption(width, height);
            }
        }

        return null;
    }

    function getPromptImageRatioMatch(prompt: string) {
        const ratioPatterns = [
            /(?:比例|宽高比|画幅|纵横比|aspect\s*ratio|ratio)\s*(?:为|是|=|:|：)?\s*(\d+(?:\.\d+)?)\s*(?:[:：]|比)\s*(\d+(?:\.\d+)?)/i,
            /(?:^|[^\d.])(\d+\.\d+)\s*[:：]\s*(\d+(?:\.\d+)?)(?=$|[^\d.])/i,
            /(?:^|[^\d.])(1|2|3|4|9|16|21)\s*[:：]\s*(1|2|3|4|9|16|21)(?=$|[^\d.])/i,
        ];

        for (const pattern of ratioPatterns) {
            const match = prompt.match(pattern);
            if (!match) continue;
            const widthRatio = Number(match[1]);
            const heightRatio = Number(match[2]);
            if (
                Number.isFinite(widthRatio) &&
                Number.isFinite(heightRatio) &&
                widthRatio > 0 &&
                heightRatio > 0 &&
                widthRatio <= 50 &&
                heightRatio <= 50
            ) {
                return createDrawImageSizeOptionFromRatio(widthRatio, heightRatio);
            }
        }

        return null;
    }

    function applyPromptDrawImageSize(prompt: string) {
        if (drawImageSize !== 'auto') return;

        const detectedOption = getPromptImageSizeMatch(prompt) || getPromptImageRatioMatch(prompt);
        if (!detectedOption) return;

        drawImageSize = detectedOption.value;
        drawAutoDetectedSizeOption = drawImageSizeOptions.some(
            option => option.value === detectedOption.value
        )
            ? null
            : detectedOption;
    }

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
                    models: providerConfig.models.filter(modelSupportsImageGeneration),
                };
            }
        }

        if (Array.isArray(sourceProviders.customProviders)) {
            filteredProviders.customProviders = sourceProviders.customProviders
                .map((provider: any) => ({
                    ...provider,
                    models: (provider.models || []).filter(modelSupportsImageGeneration),
                }))
                .filter((provider: any) => provider.models.length > 0);
        }

        return filteredProviders;
    }

    function findFirstImageGenerationModel() {
        const builtInProviders = [
            'Achuan',
            'gemini',
            'deepseek',
            'openai',
            'volcano',
            'moonshot',
            'minimax',
        ];
        const orderedProviders = [
            ...new Set([...(providers?.providerOrder || []), ...builtInProviders]),
        ];

        for (const providerId of orderedProviders) {
            const providerConfig = providers?.[providerId];
            const model = providerConfig?.models?.find(modelSupportsImageGeneration);
            if (model && providerConfig.enabled !== false) {
                return { provider: providerId, modelId: model.id };
            }
        }

        if (Array.isArray(providers?.customProviders)) {
            for (const providerConfig of providers.customProviders) {
                const model = providerConfig?.models?.find(modelSupportsImageGeneration);
                if (model && providerConfig.enabled !== false) {
                    return { provider: providerConfig.id, modelId: model.id };
                }
            }
        }

        return null;
    }

    function hasMessageImageForDrawEdit(message: Message): boolean {
        return !!(
            message.generatedImages?.length ||
            message.attachments?.some(att => att.type === 'image') ||
            (typeof message.content === 'string' && /!\[.*?\]\(([^)]+)\)/.test(message.content))
        );
    }

    function getLastAssistantMessageForDrawEdit(): Message | null {
        return (
            [...messages]
                .reverse()
                .find(msg => msg.role === 'assistant' && hasMessageImageForDrawEdit(msg)) || null
        );
    }

    function getDrawSelectableImageCount(message: Message): number {
        const generatedCount = message.generatedImages?.length || 0;
        const attachmentCount = message.attachments?.filter(att => att.type === 'image').length || 0;
        return Math.max(generatedCount, attachmentCount);
    }

    function getDrawSelectedImageIndex(message: Message): number | null {
        const imageCount = getDrawSelectableImageCount(message);
        if (imageCount <= 0) return null;
        if (imageCount === 1) return 0;

        const selectedIndex = message.drawSelectedImageIndex;
        return Number.isInteger(selectedIndex) &&
            selectedIndex !== undefined &&
            selectedIndex >= 0 &&
            selectedIndex < imageCount
            ? selectedIndex
            : null;
    }

    function isDrawImageSelectionRequired(message: Message): boolean {
        return (
            message.role === 'assistant' &&
            getDrawSelectableImageCount(message) > 1 &&
            getDrawSelectedImageIndex(message) === null
        );
    }

    function shouldShowDrawImageChoice(message: Message): boolean {
        return message.role === 'assistant' && getDrawSelectableImageCount(message) > 1;
    }

    function getImageAttachmentIndex(message: Message, attachmentIndex: number): number {
        return (
            message.attachments
                ?.slice(0, attachmentIndex + 1)
                .filter(att => att.type === 'image').length || 0
        ) - 1;
    }

    function isDrawAttachmentSelected(message: Message, attachmentIndex: number): boolean {
        if (!shouldShowDrawImageChoice(message)) return false;
        const imageIndex = getImageAttachmentIndex(message, attachmentIndex);
        return getDrawSelectedImageIndex(message) === imageIndex;
    }

    function hasPendingDrawImageSelectionForEdit(): boolean {
        const lastAssistantMsg = getLastAssistantMessageForDrawEdit();
        return !!lastAssistantMsg && isDrawImageSelectionRequired(lastAssistantMsg);
    }

    function selectDrawGeneratedImage(messageIndex: number, imageIndex: number) {
        const message = messages[messageIndex];
        if (!message || !shouldShowDrawImageChoice(message)) return;

        message.drawSelectedImageIndex = imageIndex;
        message.drawImageSelectionRequired = false;
        messages = [...messages];
        hasUnsavedChanges = true;
        saveCurrentSession(true).catch(error => {
            console.error('Failed to save draw image selection:', error);
        });
        pushMsg(`已选择第 ${imageIndex + 1} 张图片用于继续编辑`);
    }

    function syncDrawingModeState() {
        if (enableMultiModel) {
            enableMultiModel = false;
            multiModelResponses = [];
            isWaitingForAnswerSelection = false;
            selectedAnswerIndex = null;
        }

        if (isToolSelectorOpen) {
            isToolSelectorOpen = false;
        }

        if (contextDocuments.length > 0) {
            contextDocuments = [];
        }

        const imageAttachments = currentAttachments.filter(att => att.type === 'image');
        if (imageAttachments.length !== currentAttachments.length) {
            currentAttachments = imageAttachments;
        }

        const currentConfig = getProviderAndModelConfig(currentProvider, currentModelId);
        if (modelSupportsImageGeneration(currentConfig?.modelConfig)) {
            drawModeNoModelWarned = false;
            return;
        }

        const firstImageModel = findFirstImageGenerationModel();
        if (firstImageModel) {
            currentProvider = firstImageModel.provider;
            currentModelId = firstImageModel.modelId;
            settings.currentProvider = firstImageModel.provider;
            settings.currentModelId = firstImageModel.modelId;
            plugin.saveSettings(settings);
            drawModeNoModelWarned = false;
        } else if (!drawModeNoModelWarned) {
            drawModeNoModelWarned = true;
            pushErrMsg('画图模式需要先为至少一个模型勾选“生图”能力');
        }
    }

    function normalizeDrawImageCount() {
        const parsed = Number(drawImageCount);
        drawImageCount = Math.max(1, Math.min(10, Number.isFinite(parsed) ? parsed : 1));
    }

    // 多模型发送消息
    async function sendMultiModelMessage() {
        // 保存用户输入和附件
        const userContent = currentInput.trim();
        const userAttachments = [...currentAttachments];
        const userContextDocuments = [...contextDocuments];

        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        if (userContextDocuments.length > 0) {
            for (const doc of userContextDocuments) {
                try {
                    let content: string;
                    if ((chatMode === 'agent' || chatMode === 'ask') && userToolCount > 0) {
                        // agent模式或启用工具的问答模式：文档只保留ID，块获取kramdown
                        if (doc.type === 'doc') {
                            content = '';
                        } else {
                            const blockData = await getBlockKramdown(doc.id);
                            content = (blockData && blockData.kramdown) || doc.content;
                        }
                    } else {
                        const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                        content = (data && data.content) || doc.content;
                    }
                    contextDocumentsWithLatestContent.push({
                        id: doc.id,
                        title: doc.title,
                        content: content,
                        type: doc.type,
                    });
                } catch (error) {
                    console.error(`Failed to get latest content for block ${doc.id}:`, error);
                    contextDocumentsWithLatestContent.push(doc);
                }
            }
        }

        // 检查最后一条消息是否已经是用户消息（重新生成的情况）
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        const isRegenerate = lastMessage && lastMessage.role === 'user' && !userContent;

        // 只有在不是重新生成的情况下才创建新的用户消息
        if (!isRegenerate) {
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
        }
        currentInput = '';
        currentAttachments = [];
        contextDocuments = [];
        isLoading = true;
        isWaitingForAnswerSelection = true;
        selectedAnswerIndex = null; // 重置选择的答案索引，因为这是新的多模型对话
        hasUnsavedChanges = true;
        autoScroll = true;
        isAborted = false; // 重置中断标志

        await scrollToBottom(true);

        // 如果是第一条用户消息且没有会话ID，立即创建会话
        // 只有在非重新生成的情况下才执行
        if (!isRegenerate) {
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
        }

        await scrollToBottom(true);

        // 获取最后一条用户消息（用于 prepareMessagesForAI）
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        if (!lastUserMessage) {
            pushErrMsg(i18n('aiSidebar.errors.noUserMessage'));
            isLoading = false;
            return;
        }

        // 准备消息数组（包含上下文）
        // 对于重新生成的情况，使用已有的上下文；对于新消息，使用新获取的上下文
        const contextToUse =
            isRegenerate && lastUserMessage.contextDocuments
                ? lastUserMessage.contextDocuments
                : contextDocumentsWithLatestContent;

        const messagesToSend = await prepareMessagesForAI(
            messages,
            contextToUse,
            lastUserMessage.content as string,
            lastUserMessage
        );

        // 过滤掉无效的模型并初始化多模型响应数组
        const validModels = selectedMultiModels.filter(model => {
            const config = getProviderAndModelConfig(model.provider, model.modelId);
            return config !== null;
        });

        // 如果有无效模型，给出提示
        if (validModels.length < selectedMultiModels.length) {
            const invalidCount = selectedMultiModels.length - validModels.length;
            pushMsg(
                `有 ${invalidCount} 个模型已从配置中删除，将使用剩余的 ${validModels.length} 个模型`
            );
        }

        // 如果没有有效模型，退回到单模型
        if (validModels.length === 0) {
            pushErrMsg('所选的多模型已全部失效，请重新选择模型');
            enableMultiModel = false;
            return;
        }

        multiModelResponses = validModels.map(model => {
            const config = getProviderAndModelConfig(model.provider, model.modelId);
            return {
                provider: model.provider,
                modelId: model.modelId,
                modelName: config?.modelConfig?.name || model.modelId,
                content: '',
                thinking: '',
                isLoading: true,
                thinkingCollapsed: false,
                toolCalls: [], // 存储工具调用历史
                // 使用模型实例的 thinkingEnabled 值，如果没有则使用 modelConfig 中的默认值
                thinkingEnabled:
                    model.thinkingEnabled ?? config?.modelConfig?.thinkingEnabled ?? false,
                // 使用模型实例的 thinkingEffort 值，如果没有则使用 modelConfig 中的默认值
                thinkingEffort:
                    model.thinkingEffort ?? config?.modelConfig?.thinkingEffort ?? 'low',
            };
        });

        // 创建新的 AbortController
        abortController = new AbortController();

        // 标记是否已经创建了助手消息（用于多模型第一次返回时保存会话）
        let assistantMessageCreated = false;
        let assistantMessageIndex = -1;

        // 并发请求所有有效模型
        const promises = validModels.map(async (model, index) => {
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
                let totalThinking = '';

                // 准备 Agent/Ask 模式的工具列表
                let toolsForAgent: any[] | undefined = undefined;
                if ((chatMode === 'agent' || chatMode === 'ask') && userToolCount > 0) {
                    const currentSelectedTools =
                        chatMode === 'ask' ? selectedToolsAsk : selectedTools;
                    const selectedToolDefs = AVAILABLE_TOOLS.filter(tool =>
                        currentSelectedTools.some(t => t.name === tool.function.name)
                    );
                    const filteredToolDefs = selectedToolDefs.filter(
                        tool => tool.function.name !== 'get_siyuan_skills'
                    );
                    const descTool =
                        chatMode === 'ask'
                            ? createGetSiyuanSkillsTool(
                                  filteredToolDefs.map(tool => tool.function.name)
                              )
                            : AVAILABLE_TOOLS.find(t => t.function.name === 'get_siyuan_skills');
                    toolsForAgent = descTool ? [descTool, ...filteredToolDefs] : filteredToolDefs;
                }

                // 准备联网搜索工具（如果启用）
                let webSearchTools: any[] | undefined = undefined;
                if (modelConfig.capabilities?.webSearch && modelConfig.webSearchEnabled) {
                    const modelIdLower = modelConfig.id.toLowerCase();

                    if (modelIdLower.includes('gemini')) {
                        webSearchTools = [
                            {
                                type: 'function',
                                function: {
                                    name: 'googleSearch',
                                },
                            },
                        ];
                    }
                }

                // 合并工具列表
                const finalTools = [...(toolsForAgent || []), ...(webSearchTools || [])];
                const toolsToPass = finalTools.length > 0 ? finalTools : undefined;

                // 多模型工具调用循环
                let modelMessagesToSend = [...messagesToSend];
                let shouldContinue = true;

                while (shouldContinue && !abortController.signal.aborted) {
                    let hasNewToolCalls = false;
                    let lastAssistantContent = '';
                    let turnThinking = '';

                    await chat(
                        model.provider,
                        {
                            apiKey: providerConfig.apiKey,
                            useForwardProxy: providerConfig.useForwardProxy || false,
                            model: modelConfig.id,
                            messages: modelMessagesToSend,
                            temperature: tempModelSettings.temperatureEnabled
                                ? tempModelSettings.temperature
                                : modelConfig.temperature,
                            maxTokens:
                                modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                            stream: true,
                            signal: abortController.signal,
                            // 使用模型实例的 thinkingEnabled 值
                            enableThinking:
                                modelConfig.capabilities?.thinking &&
                                (model.thinkingEnabled ?? modelConfig.thinkingEnabled ?? false),
                            // 使用模型实例的 thinkingEffort 值，如果没有则使用 modelConfig 中的默认值
                            reasoningEffort:
                                model.thinkingEffort ?? modelConfig.thinkingEffort ?? 'low',
                            tools: toolsToPass,
                            customBody,
                            onThinkingChunk: async (chunk: string) => {
                                turnThinking += chunk;
                                totalThinking += chunk;
                                if (multiModelResponses[index]) {
                                    multiModelResponses[index].thinking = totalThinking;
                                    multiModelResponses = [...multiModelResponses];
                                }
                            },
                            onThinkingComplete: () => {
                                if (
                                    multiModelResponses[index] &&
                                    multiModelResponses[index].thinking
                                ) {
                                    multiModelResponses[index].thinkingCollapsed = true;
                                    multiModelResponses = [...multiModelResponses];
                                }
                            },
                            onChunk: async (chunk: string) => {
                                fullText += chunk;
                                lastAssistantContent += chunk;
                                if (multiModelResponses[index]) {
                                    multiModelResponses[index].content = fullText;
                                    multiModelResponses = [...multiModelResponses];
                                }
                            },
                            onToolCallComplete: async (toolCalls: ToolCall[]) => {
                                hasNewToolCalls = true;

                                // 1. 将 assistant 消息（包含 tool_calls）添加到当前模型的上下文
                                const isReasoningEnabled =
                                    modelConfig.capabilities?.thinking &&
                                    (model.thinkingEnabled ?? modelConfig.thinkingEnabled ?? false);

                                const assistantMsg: any = {
                                    role: 'assistant',
                                    content: lastAssistantContent,
                                    tool_calls: toolCalls,
                                };

                                // 特别是 Kimi 等模型，如果启用了 thinking，assistant 消息必须包含 reasoning_content
                                if (isReasoningEnabled) {
                                    assistantMsg.reasoning_content = turnThinking;
                                }

                                modelMessagesToSend.push(assistantMsg);

                                // 2. 执行工具并添加结果，同时记录该轮工具调用前的思考内容
                                for (const tc of toolCalls) {
                                    // 更新 UI 显示正在调用，并记录该工具调用前的思考内容
                                    if (multiModelResponses[index]) {
                                        multiModelResponses[index].toolCalls = [
                                            ...(multiModelResponses[index].toolCalls || []),
                                            {
                                                ...tc,
                                                status: 'calling',
                                                thinkingBefore: turnThinking,
                                            },
                                        ];
                                        multiModelResponses = [...multiModelResponses];
                                    }

                                    // 检查是否自动批准
                                    const currentSelectedTools =
                                        chatMode === 'ask' ? selectedToolsAsk : selectedTools;
                                    const toolConfig = currentSelectedTools.find(
                                        t => t.name === tc.function.name
                                    );
                                    const isSystemTool = tc.function.name === 'get_siyuan_skills';
                                    const autoApprove =
                                        isSystemTool ||
                                        (toolConfig && toolConfig.autoApprove) ||
                                        false;

                                    let toolResult: string;
                                    if (autoApprove) {
                                        console.log(
                                            `[MultiModel] Auto-approving tool: ${tc.function.name}`
                                        );
                                        toolResult = await executeToolCall(tc);
                                    } else {
                                        // 多模型模式下，非自动批准的工具暂时直接拒绝，避免 UI 冲突
                                        console.log(
                                            `[MultiModel] Skipping non-auto-approved tool: ${tc.function.name}`
                                        );
                                        toolResult = `工具 ${tc.function.name} 需要手动批准。在多模型对比模式下，为了避免 UI 冲突，该工具未被自动执行。请在选择该模型后的单模型模式下重新尝试，或在设置中将该工具设为“自动批准”。`;
                                    }

                                    modelMessagesToSend.push({
                                        role: 'tool',
                                        tool_call_id: tc.id,
                                        name: tc.function.name,
                                        content: toolResult,
                                    });

                                    // 更新 UI 显示结果
                                    if (multiModelResponses[index]) {
                                        const callIndex = multiModelResponses[
                                            index
                                        ].toolCalls.findIndex(c => c.id === tc.id);
                                        if (callIndex !== -1) {
                                            multiModelResponses[index].toolCalls[callIndex].status =
                                                'completed';
                                            multiModelResponses[index].toolCalls[callIndex].result =
                                                toolResult;
                                            multiModelResponses = [...multiModelResponses];
                                        }
                                    }
                                }

                                lastAssistantContent = '';
                                // 标记模型仍在加载（等待下一轮响应）
                                if (multiModelResponses[index]) {
                                    multiModelResponses[index].isLoading = true;
                                    // 保存当前模型的对话历史（包含 tool_calls 和 tool 响应）
                                    multiModelResponses[index].conversationMessages = [
                                        ...modelMessagesToSend,
                                    ];
                                    multiModelResponses = [...multiModelResponses];
                                }
                            },
                            onComplete: async (text: string) => {
                                // 如果已经中断，不再处理完成回调
                                if (isAborted) {
                                    return;
                                }
                                // 如果用户已经选择答案，不再更新消息
                                if (!isWaitingForAnswerSelection) {
                                    return;
                                }
                                if (multiModelResponses[index]) {
                                    const convertedText = convertLatexToMarkdown(text);
                                    // 处理content中的base64图片，保存为assets文件
                                    const processedContent =
                                        await saveBase64ImagesInContent(convertedText);
                                    multiModelResponses[index].content = processedContent;
                                    multiModelResponses[index].thinking = totalThinking;
                                    multiModelResponses[index].isLoading = false;
                                    // 保存最终的对话历史（包含最后一次 assistant 回复）
                                    multiModelResponses[index].conversationMessages = [
                                        ...modelMessagesToSend,
                                    ];
                                    if (
                                        totalThinking &&
                                        !multiModelResponses[index].thinkingCollapsed
                                    ) {
                                        multiModelResponses[index].thinkingCollapsed = true;
                                    }
                                    multiModelResponses = [...multiModelResponses];

                                    // 【修复】首个模型完成时，尝试更新已有的多模型助手消息，或者创建新消息
                                    if (!assistantMessageCreated) {
                                        // 先标记已创建，防止并发的 onComplete 也进入此分支
                                        assistantMessageCreated = true;

                                        const lastMessage = messages[messages.length - 1];
                                        if (
                                            lastMessage &&
                                            lastMessage.role === 'assistant' &&
                                            lastMessage.multiModelResponses
                                        ) {
                                            // 如果已经存在（例如因为 abortMessage 已经提前创建了），则直接更新
                                            lastMessage.multiModelResponses = [
                                                ...multiModelResponses,
                                            ];
                                            // 保持 content 为空，等用户选择后填充
                                            assistantMessageIndex = messages.length - 1;
                                            messages = [...messages];
                                        } else {
                                            // 创建包含多模型响应的助手消息
                                            const assistantMessage: Message = {
                                                role: 'assistant',
                                                content: '', // 暂时为空，等用户选择后填充
                                                multiModelResponses: [...multiModelResponses],
                                            };
                                            messages = [...messages, assistantMessage];
                                            assistantMessageIndex = messages.length - 1;
                                        }
                                        hasUnsavedChanges = true;

                                        // 立即保存会话文件
                                        await saveCurrentSession(true);
                                    } else if (
                                        assistantMessageIndex >= 0 &&
                                        messages[assistantMessageIndex]
                                    ) {
                                        // 后续模型完成时更新助手消息的 multiModelResponses
                                        messages[assistantMessageIndex].multiModelResponses = [
                                            ...multiModelResponses,
                                        ];
                                        messages = [...messages];

                                        // 保存更新后的会话
                                        await saveCurrentSession(true);
                                    }
                                }
                            },
                            onError: (error: Error) => {
                                // 如果是主动中断，不显示错误
                                if (
                                    error.message !== 'Request aborted' &&
                                    multiModelResponses[index]
                                ) {
                                    // 如果用户已经选择答案，不再更新消息
                                    if (!isWaitingForAnswerSelection) {
                                        return;
                                    }
                                    multiModelResponses[index].error = error.message;
                                    multiModelResponses[index].isLoading = false;
                                    multiModelResponses = [...multiModelResponses];

                                    // 【修复】模型出错时也尝试更新或创建助手消息
                                    if (!assistantMessageCreated) {
                                        assistantMessageCreated = true;
                                        const lastMessage = messages[messages.length - 1];
                                        if (
                                            lastMessage &&
                                            lastMessage.role === 'assistant' &&
                                            lastMessage.multiModelResponses
                                        ) {
                                            lastMessage.multiModelResponses = [
                                                ...multiModelResponses,
                                            ];
                                            assistantMessageIndex = messages.length - 1;
                                            messages = [...messages];
                                        } else {
                                            const assistantMessage: Message = {
                                                role: 'assistant',
                                                content: '',
                                                multiModelResponses: [...multiModelResponses],
                                            };
                                            messages = [...messages, assistantMessage];
                                            assistantMessageIndex = messages.length - 1;
                                        }
                                        hasUnsavedChanges = true;
                                        saveCurrentSession(true);
                                    } else if (
                                        assistantMessageIndex >= 0 &&
                                        messages[assistantMessageIndex]
                                    ) {
                                        messages[assistantMessageIndex].multiModelResponses = [
                                            ...multiModelResponses,
                                        ];
                                        messages = [...messages];
                                        saveCurrentSession(true);
                                    }
                                }
                            },
                        },
                        providerConfig.customApiUrl,
                        providerConfig.advancedConfig
                    );

                    if (!hasNewToolCalls) {
                        shouldContinue = false;
                    }
                }
            } catch (error) {
                // 如果是主动中断，不显示错误
                if ((error as Error).message !== 'Request aborted' && multiModelResponses[index]) {
                    // 如果用户已经选择答案，不再更新消息
                    if (!isWaitingForAnswerSelection) {
                        return;
                    }
                    multiModelResponses[index].error = (error as Error).message;
                    multiModelResponses[index].isLoading = false;
                    multiModelResponses = [...multiModelResponses];

                    // 【修复】catch 块中也尝试更新或创建助手消息
                    if (!assistantMessageCreated) {
                        assistantMessageCreated = true;
                        const lastMessage = messages[messages.length - 1];
                        if (
                            lastMessage &&
                            lastMessage.role === 'assistant' &&
                            lastMessage.multiModelResponses
                        ) {
                            lastMessage.multiModelResponses = [...multiModelResponses];
                            assistantMessageIndex = messages.length - 1;
                            messages = [...messages];
                        } else {
                            const assistantMessage: Message = {
                                role: 'assistant',
                                content: '',
                                multiModelResponses: [...multiModelResponses],
                            };
                            messages = [...messages, assistantMessage];
                            assistantMessageIndex = messages.length - 1;
                        }
                        hasUnsavedChanges = true;
                        saveCurrentSession(true);
                    } else if (assistantMessageIndex >= 0 && messages[assistantMessageIndex]) {
                        messages[assistantMessageIndex].multiModelResponses = [
                            ...multiModelResponses,
                        ];
                        messages = [...messages];
                        saveCurrentSession(true);
                    }
                }
            }
        });

        // 等待所有请求完成
        await Promise.all(promises);

        isLoading = false;
        abortController = null;
    }

    // 准备发送给AI的消息（提取为独立函数以便复用）
    async function prepareMessagesForAI(
        messages: Message[],
        contextDocumentsWithLatestContent: ContextDocument[],
        userContent: string,
        lastUserMessage: Message,
        thinkingEnabled: boolean = false
    ) {
        // 过滤掉空的 assistant 消息，防止某些 Provider（例如 Kimi）报错
        // 但保留有生图的 assistant 消息
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
                    const hasGeneratedImages =
                        msg.generatedImages && msg.generatedImages.length > 0;
                    // 保留有 tool_calls、reasoning_content 或 generatedImages 的 assistant 消息，即便正文为空
                    return (
                        (text && text.toString().trim() !== '') ||
                        hasToolCalls ||
                        hasReasoning ||
                        hasGeneratedImages
                    );
                }
                return true;
            })
            .map((msg, index, array) => {
                const baseMsg: any = {
                    role: msg.role,
                    content: msg.content,
                };

                // 只有在启用 thinking 模式时才保留相关内容
                // 特别是 Kimi 等模型，如果启用了 thinking，历史 assistant 消息必须包含 reasoning_content
                const shouldKeepReasoning = thinkingEnabled && userToolCount > 0;

                if (msg.tool_calls) {
                    baseMsg.tool_calls = msg.tool_calls;
                }
                if (msg.tool_call_id) {
                    baseMsg.tool_call_id = msg.tool_call_id;
                }
                if (msg.name) {
                    baseMsg.name = msg.name;
                }

                if (shouldKeepReasoning) {
                    if (msg.reasoning_content !== undefined) {
                        baseMsg.reasoning_content = msg.reasoning_content;
                    } else if (msg.role === 'assistant' && msg.tool_calls) {
                        // 如果启用了思考模式且有工具调用，确保 reasoning_content 字段存在（即使为空）
                        baseMsg.reasoning_content = '';
                    }
                }

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
                            const label =
                                doc.type === 'doc'
                                    ? '文档'
                                    : doc.type === 'webpage'
                                      ? '网页'
                                      : '块';

                            // agent模式或启用工具的问答模式：文档块只传递ID，不传递内容
                            if (
                                (chatMode === 'agent' || chatMode === 'ask') &&
                                userToolCount > 0 &&
                                doc.type === 'doc'
                            ) {
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

                // 查找上一条assistant消息是否有生成的图片（用于图片编辑）
                let previousGeneratedImages: any[] = [];
                const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
                if (lastAssistantMsg) {
                    // 检查generatedImages或attachments中的图片
                    if (
                        lastAssistantMsg.generatedImages &&
                        lastAssistantMsg.generatedImages.length > 0
                    ) {
                        // 从路径加载图片并转换为 blob URL
                        previousGeneratedImages = await Promise.all(
                            lastAssistantMsg.generatedImages.map(async img => {
                                let imageUrl = '';
                                if (img.path) {
                                    // 从路径加载图片
                                    imageUrl = (await loadAsset(img.path)) || '';
                                } else if (img.data) {
                                    // 兼容旧数据（base64格式）
                                    imageUrl = `data:${img.mimeType || 'image/png'};base64,${img.data}`;
                                }
                                return {
                                    type: 'image_url',
                                    image_url: { url: imageUrl },
                                };
                            })
                        );
                    } else if (
                        lastAssistantMsg.attachments &&
                        lastAssistantMsg.attachments.length > 0
                    ) {
                        // 从附件中获取图片
                        const imageAttachments = lastAssistantMsg.attachments.filter(
                            att => att.type === 'image'
                        );
                        previousGeneratedImages = await Promise.all(
                            imageAttachments.map(async att => {
                                let imageUrl = att.data;
                                // 如果附件有路径且当前data不可用，从路径重新加载
                                if (att.path && (!imageUrl || !imageUrl.startsWith('blob:'))) {
                                    imageUrl = (await loadAsset(att.path)) || att.data;
                                }
                                return {
                                    type: 'image_url',
                                    image_url: { url: imageUrl },
                                };
                            })
                        );
                    } else if (typeof lastAssistantMsg.content === 'string') {
                        // 从Markdown内容中提取图片 ![alt](url)
                        const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
                        const content = lastAssistantMsg.content;
                        let match;
                        while ((match = imageRegex.exec(content)) !== null) {
                            const url = match[1];
                            // 处理 assets 路径的图片
                            if (
                                url.startsWith('/data/storage/petal/siyuan-plugin-copilot/assets/')
                            ) {
                                try {
                                    const blobUrl = await loadAsset(url);
                                    if (blobUrl) {
                                        previousGeneratedImages.push({
                                            type: 'image_url',
                                            image_url: { url: blobUrl },
                                        });
                                    }
                                } catch (error) {
                                    console.error('Failed to load asset image:', error);
                                }
                            } else if (url.startsWith('http://') || url.startsWith('https://')) {
                                // HTTP/HTTPS URL 直接使用
                                previousGeneratedImages.push({
                                    type: 'image_url',
                                    image_url: { url: url },
                                });
                            }
                        }
                    }
                }

                if (hasImages || previousGeneratedImages.length > 0) {
                    const contentParts: any[] = [];
                    let textContent = userContent;

                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label =
                                    doc.type === 'doc'
                                        ? '文档'
                                        : doc.type === 'webpage'
                                          ? '网页'
                                          : '块';

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

                    // 添加用户上传的图片附件
                    lastUserMessage.attachments?.forEach(att => {
                        if (att.type === 'image') {
                            contentParts.push({
                                type: 'image_url',
                                image_url: { url: att.data },
                            });
                        }
                    });

                    // 添加上一次生成的图片（用于图片编辑）
                    previousGeneratedImages.forEach(img => {
                        contentParts.push(img);
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
                                const label =
                                    doc.type === 'doc'
                                        ? '文档'
                                        : doc.type === 'webpage'
                                          ? '网页'
                                          : '块';

                                // agent模式或启用工具的问答模式：文档块只传递ID，不传递内容
                                if (
                                    (chatMode === 'agent' || chatMode === 'ask') &&
                                    userToolCount > 0 &&
                                    doc.type === 'doc'
                                ) {
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

        // 使用临时系统提示词（如果设置了）- 优先使用临时系统提示词作为基础
        let baseSystemPrompt = settings.aiSystemPrompt || '';
        if (tempModelSettings.systemPrompt.trim()) {
            baseSystemPrompt = tempModelSettings.systemPrompt;
        }

        // Agent/Ask 模式带有工具时，添加工具使用强制规则
        let hasToolInstruction = false;
        let hasSoulEnabled = false;
        if ((chatMode === 'agent' || chatMode === 'ask') && userToolCount > 0) {
            // 如果已有基础提示词，添加换行后追加工具说明；否则直接使用工具说明
            if (baseSystemPrompt.trim()) {
                baseSystemPrompt += '\n\n' + AGENT_TOOL_USAGE_INSTRUCTION;
            } else {
                baseSystemPrompt = AGENT_TOOL_USAGE_INSTRUCTION;
            }
            hasToolInstruction = true;

            // 检查是否启用了SOUL工具
            const currentSelectedTools = chatMode === 'ask' ? selectedToolsAsk : selectedTools;
            hasSoulEnabled = currentSelectedTools.some(t => t.name === 'soul');
        }

        // 如果启用了SOUL工具，自动获取SOUL文档内容并追加到系统提示词
        if (hasSoulEnabled) {
            try {
                const soulResult = await soul({ operation: 'getDoc' });
                if (soulResult.success && soulResult.content) {
                    const soulContent = `\n\n=== SOUL记忆 ===\n\n以下是用户设置的SOUL文档内容，包含用户的偏好设置和要求，请在回复时遵循这些要求：\n\n${soulResult.content}`;
                    baseSystemPrompt += soulContent;
                }
            } catch (error) {
                console.error('[SOUL] 自动获取文档内容失败:', error);
                // 获取失败时不阻止对话继续进行
            }
        }

        // 添加最终的系统提示词（只要基础提示词或工具说明不为空就添加）
        if (baseSystemPrompt.trim() || hasToolInstruction) {
            messagesToSend.unshift({ role: 'system', content: baseSystemPrompt });
        }

        // 限制上下文消息数量
        const systemMessages = messagesToSend.filter(msg => msg.role === 'system');
        const otherMessages = messagesToSend.filter(msg => msg.role !== 'system');
        const limitedMessages =
            tempModelSettings.contextCount < 0
                ? otherMessages
                : otherMessages.slice(-tempModelSettings.contextCount);

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

        // 不再强制重置布局，保持用户选择的布局样式
        // multiModelLayout = 'tab';

        // 【修复】从选中的模型对话历史中提取 tool 调用链消息
        // 这些消息需要被添加到 messages 数组中，以便重新生成时能正确重建上下文
        // 注意：多模型模式下工具调用已保存在 multiModelResponses 中，不需要再插入到主消息流
        const toolMessages: Message[] = [];
        if (
            selectedResponse.conversationMessages &&
            selectedResponse.conversationMessages.length > 0
        ) {
            for (const msg of selectedResponse.conversationMessages) {
                // 只提取 tool 响应消息，不提取包含 tool_calls 的 assistant 消息
                // 因为多模型模式下工具调用已经在每个模型卡片中显示了
                if (msg.role === 'tool' && msg.tool_call_id) {
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: msg.tool_call_id,
                        name: msg.name,
                        content: msg.content,
                    });
                }
            }
        }

        // 【关键修复】将 tool 响应消息插入到 messages 中
        // 注意：必须先插入 tool 消息，再更新/创建 assistant 消息
        if (toolMessages.length > 0) {
            let lastUserMessageIndex = -1;
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                    lastUserMessageIndex = i;
                    break;
                }
            }

            if (lastUserMessageIndex >= 0) {
                // 在用户消息之后插入 tool 消息
                const insertIndex = lastUserMessageIndex + 1;
                messages = [
                    ...messages.slice(0, insertIndex),
                    ...toolMessages,
                    ...messages.slice(insertIndex),
                ];
            }
        }

        // 【修复】更新当前这轮待选择的助手消息，而不是错误覆盖历史轮次
        // 注意：必须从后往前找，优先命中最新一条未完成选择的多模型消息
        let assistantMsgIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role !== 'assistant' || !msg.multiModelResponses) continue;

            const hasSelectedAnswer = msg.multiModelResponses.some(r => r.isSelected);
            const hasFinalContent =
                typeof msg.content === 'string' && msg.content.trim().length > 0;

            // 当前轮次通常是“未选择 + 空内容”，优先匹配它
            if (!hasSelectedAnswer && !hasFinalContent) {
                assistantMsgIndex = i;
                break;
            }

            // 回退策略：至少保证命中最后一条多模型助手消息，而不是第一条
            if (assistantMsgIndex === -1) {
                assistantMsgIndex = i;
            }
        }
        if (assistantMsgIndex >= 0) {
            // 更新已有的助手消息
            messages[assistantMsgIndex].content = selectedResponse.content; // 设置为选择的答案内容
            messages[assistantMsgIndex].thinking = selectedResponse.thinking || ''; // 保存思考内容
            messages[assistantMsgIndex].multiModelResponses = multiModelResponses.map(
                (response, i) => ({
                    ...response,
                    isSelected: i === index, // 标记哪个被选择
                    modelName: i === index ? ' ✅' + response.modelName : response.modelName, // 选择的模型名添加✅
                })
            );
        } else {
            // 如果没有找到助手消息（不应该发生），在最后创建新消息
            const assistantMessage: Message = {
                role: 'assistant',
                content: selectedResponse.content,
                thinking: selectedResponse.thinking || '',
                multiModelResponses: multiModelResponses.map((response, i) => ({
                    ...response,
                    isSelected: i === index,
                    modelName: i === index ? ' ✅' + response.modelName : response.modelName,
                })),
            };
            messages = [...messages, assistantMessage];
        }

        // 触发响应式更新
        messages = [...messages];

        // 清除多模型状态（全局多模型响应清除），但记录已选索引用于UI
        multiModelResponses = [];
        isWaitingForAnswerSelection = false;
        selectedAnswerIndex = index;
        hasUnsavedChanges = true;

        // 自动保存会话
        saveCurrentSession(true);
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
                    useForwardProxy: providerConfig.useForwardProxy || false,
                    model: modelConfig.id,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: modelConfig.temperature,
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

    function getBuiltInImageApiBaseUrl(providerId: string): string {
        try {
            return getProviderConfig(providerId as any)?.baseUrl || '';
        } catch (error) {
            return '';
        }
    }

    function normalizeOpenAIImageApiBaseUrl(rawUrl: string): string {
        let url = rawUrl.trim().replace(/#$/, '').replace(/\/+$/, '');
        url = url
            .replace(/\/v1\/chat\/completions$/i, '/v1')
            .replace(/\/chat\/completions$/i, '')
            .replace(/\/v1\/images\/(?:generations|edits)$/i, '/v1')
            .replace(/\/images\/(?:generations|edits)$/i, '')
            .replace(/\/v1\/models$/i, '/v1')
            .replace(/\/models$/i, '');

        if (/\/v\d+(?:beta)?$/i.test(url)) {
            return url;
        }

        return `${url}/v1`;
    }

    function getOpenAIImageEndpointUrl(providerConfig: any, endpoint: '/images/generations' | '/images/edits') {
        const rawBaseUrl =
            providerConfig?.customApiUrl?.trim() || getBuiltInImageApiBaseUrl(currentProvider);
        if (!rawBaseUrl) {
            throw new Error('当前平台未配置 API URL，无法调用图片接口');
        }

        return `${normalizeOpenAIImageApiBaseUrl(rawBaseUrl)}${endpoint}`;
    }

    function normalizeGeminiImageApiBaseUrl(rawUrl: string): string {
        return rawUrl
            .trim()
            .replace(/#$/, '')
            .replace(/\/+$/, '')
            .replace(/\/v\d+(?:beta)?\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/i, '')
            .replace(/\/v\d+(?:beta)?\/models$/i, '');
    }

    function getGeminiImageEndpointUrl(providerConfig: any, modelConfig: any): string {
        const rawBaseUrl =
            providerConfig?.advancedConfig?.customChatUrl?.trim() ||
            providerConfig?.customApiUrl?.trim() ||
            getBuiltInImageApiBaseUrl(currentProvider);
        if (!rawBaseUrl) {
            throw new Error('当前平台未配置 API URL，无法调用 Gemini 图片接口');
        }

        const modelId = String(modelConfig?.id || '').replace(/^models\//, '');
        const normalizedUrl = rawBaseUrl
            .trim()
            .replace(/#$/, '')
            .replace(/\/+$/, '')
            .replace(/\{model\}/g, modelId);
        if (/:(?:streamGenerateContent|generateContent)(?:\?.*)?$/i.test(normalizedUrl)) {
            return normalizedUrl.replace(/:streamGenerateContent/i, ':generateContent');
        }

        return `${normalizeGeminiImageApiBaseUrl(rawBaseUrl)}/v1beta/models/${modelId}:generateContent`;
    }

    async function getImageApiError(response: Response, fallback: string): Promise<string> {
        try {
            const errorData = await response.json();
            const detailMsg =
                errorData.error?.message ||
                errorData.message ||
                errorData.error ||
                JSON.stringify(errorData);
            return `${fallback}: ${response.status} ${response.statusText}\n\n${detailMsg}`;
        } catch (error) {
            try {
                const errorText = await response.text();
                return `${fallback}: ${response.status} ${response.statusText}${
                    errorText ? `\n\n${errorText}` : ''
                }`;
            } catch (textError) {
                return `${fallback}: ${response.status} ${response.statusText}`;
            }
        }
    }

    async function imageAttachmentToBlob(attachment: MessageAttachment): Promise<Blob> {
        if (attachment.path) {
            const blob = await getFileBlob(attachment.path);
            if (blob) return blob;
        }

        if (attachment.data) {
            const response = await fetch(attachment.data);
            return await response.blob();
        }

        throw new Error(`无法读取图片：${attachment.name}`);
    }

    async function blobToBase64String(blob: Blob): Promise<string> {
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
            reader.readAsDataURL(blob);
        });
        return dataUrl.split(',')[1] || '';
    }

    function getClosestGeminiAspectRatio(width: number, height: number): string {
        const ratio = width / height;
        const supportedRatios = [
            { value: 1, label: '1:1' },
            { value: 4 / 3, label: '4:3' },
            { value: 3 / 4, label: '3:4' },
            { value: 3 / 2, label: '3:2' },
            { value: 2 / 3, label: '2:3' },
            { value: 16 / 9, label: '16:9' },
            { value: 9 / 16, label: '9:16' },
            { value: 21 / 9, label: '21:9' },
        ];

        return supportedRatios.reduce((best, item) =>
            Math.abs(item.value - ratio) < Math.abs(best.value - ratio) ? item : best
        ).label;
    }

    function getGeminiImageConfig(modelId: string, size: DrawImageSize) {
        const sizeMap: Record<string, { aspectRatio: string; imageSize?: '2K' | '4K' }> = {
            '1024x1024': { aspectRatio: '1:1' },
            '1536x1024': { aspectRatio: '3:2' },
            '1024x1536': { aspectRatio: '2:3' },
            '1536x1152': { aspectRatio: '4:3' },
            '1152x1536': { aspectRatio: '3:4' },
            '1504x640': { aspectRatio: '21:9' },
            '2048x2048': { aspectRatio: '1:1', imageSize: '2K' },
            '2048x1152': { aspectRatio: '16:9', imageSize: '2K' },
            '3840x2160': { aspectRatio: '16:9', imageSize: '4K' },
            '2160x3840': { aspectRatio: '9:16', imageSize: '4K' },
        };
        const parsedSize = parseDrawImageSizeValue(size);
        const config = sizeMap[size] || (parsedSize
            ? { aspectRatio: getClosestGeminiAspectRatio(parsedSize.width, parsedSize.height) }
            : null);
        if (!config) return null;

        if (!geminiModelSupportsImageSize(modelId)) {
            return { aspectRatio: config.aspectRatio };
        }

        return config;
    }

    async function buildGeminiImageParts(
        prompt: string,
        editImageSources: MessageAttachment[]
    ) {
        const parts: Array<Record<string, any>> = [{ text: prompt }];

        for (const imageSource of editImageSources) {
            const blob = await imageAttachmentToBlob(imageSource);
            parts.push({
                inline_data: {
                    mime_type: blob.type || imageSource.mimeType || 'image/png',
                    data: await blobToBase64String(blob),
                },
            });
        }

        return parts;
    }

    function extractGeminiImagesFromResponse(data: any, prompt: string) {
        const images: any[] = [];

        for (const candidate of data?.candidates || []) {
            const parts = candidate?.content?.parts || [];
            const responseText = parts
                .map((part: any) => part.text)
                .filter(Boolean)
                .join('\n');

            for (const part of parts) {
                const inlineData = part.inline_data || part.inlineData;
                if (!inlineData?.data) continue;

                images.push({
                    data: inlineData.data,
                    mimeType: inlineData.mime_type || inlineData.mimeType || 'image/png',
                    revisedPrompt: responseText || prompt,
                });
            }
        }

        return images;
    }

    async function requestGeminiDrawImages(
        providerConfig: any,
        modelConfig: any,
        prompt: string,
        editImageSources: MessageAttachment[],
        signal: AbortSignal
    ) {
        const isEdit = editImageSources.length > 0;
        const url = getGeminiImageEndpointUrl(providerConfig, modelConfig);
        const imageConfig = getGeminiImageConfig(modelConfig.id, drawImageSize);
        const generationConfig: Record<string, any> = {
            responseModalities: ['Image'],
        };
        if (imageConfig) {
            generationConfig.imageConfig = imageConfig;
        }

        const requestOnce = async () => {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': providerConfig.apiKey,
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: 'user',
                            parts: await buildGeminiImageParts(prompt, editImageSources),
                        },
                    ],
                    generationConfig,
                }),
                signal,
            });

            if (!response.ok) {
                throw new Error(
                    await getImageApiError(response, isEdit ? 'Gemini 图片编辑失败' : 'Gemini 图片生成失败')
                );
            }

            return extractGeminiImagesFromResponse(await response.json(), prompt);
        };

        const count = Math.max(1, Math.min(10, Number(drawImageCount) || 1));
        const rawImages = (await Promise.all(Array.from({ length: count }, () => requestOnce()))).flat();
        const savedImages = await Promise.all(rawImages.map(saveGeneratedImageFromApiResult));
        return savedImages.filter(Boolean);
    }

    async function collectPreviousGeneratedImagesForDraw(): Promise<MessageAttachment[]> {
        const lastAssistantMsg = getLastAssistantMessageForDrawEdit();
        if (!lastAssistantMsg) {
            return [];
        }

        if (lastAssistantMsg.generatedImages && lastAssistantMsg.generatedImages.length > 0) {
            const selectedIndex = getDrawSelectedImageIndex(lastAssistantMsg);
            if (lastAssistantMsg.generatedImages.length > 1 && selectedIndex === null) {
                return [];
            }
            const imagesToUse =
                selectedIndex === null
                    ? lastAssistantMsg.generatedImages
                    : [lastAssistantMsg.generatedImages[selectedIndex]];
            return await Promise.all(
                imagesToUse.map(async (img: any, index) => {
                    const mimeType = img.mimeType || 'image/png';
                    let data = img.previewUrl || img.url || '';
                    if (!data && img.path) {
                        data = (await loadAsset(img.path)) || '';
                    } else if (!data && img.data) {
                        data = `data:${mimeType};base64,${img.data}`;
                    }

                    return {
                        type: 'image' as const,
                        name: createGeneratedImageFileName(mimeType, index),
                        data,
                        path: img.path,
                        mimeType,
                    };
                })
            );
        }

        const imageAttachments =
            lastAssistantMsg.attachments?.filter(att => att.type === 'image') || [];
        if (imageAttachments.length > 0) {
            const selectedIndex = getDrawSelectedImageIndex(lastAssistantMsg);
            if (imageAttachments.length > 1 && selectedIndex === null) {
                return [];
            }
            const attachmentsToUse =
                selectedIndex === null ? imageAttachments : [imageAttachments[selectedIndex]];
            return await Promise.all(
                attachmentsToUse.map(async att => {
                    if (att.data || !att.path) {
                        return att;
                    }
                    return {
                        ...att,
                        data: (await loadAsset(att.path)) || '',
                    };
                })
            );
        }

        if (typeof lastAssistantMsg.content === 'string') {
            const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
            const imageAttachmentsFromMarkdown: MessageAttachment[] = [];
            let match;
            while ((match = imageRegex.exec(lastAssistantMsg.content)) !== null) {
                const url = match[2];
                const data = url.startsWith('/data/storage/petal/siyuan-plugin-copilot/assets/')
                    ? (await loadAsset(url)) || ''
                    : url;
                if (data) {
                    imageAttachmentsFromMarkdown.push({
                        type: 'image',
                        name: match[1] || createGeneratedImageFileName('image/png', imageAttachmentsFromMarkdown.length),
                        data,
                        path: url.startsWith('/data/storage/petal/siyuan-plugin-copilot/assets/')
                            ? url
                            : undefined,
                        mimeType: 'image/png',
                    });
                }
            }
            return imageAttachmentsFromMarkdown;
        }

        return [];
    }

    async function collectDrawEditImageSources(userImageAttachments: MessageAttachment[]) {
        if (userImageAttachments.length > 0) {
            return userImageAttachments;
        }

        return await collectPreviousGeneratedImagesForDraw();
    }

    async function saveGeneratedImageFromApiResult(image: any, index: number) {
        const mimeType = image.mime_type || image.mimeType || 'image/png';
        let blob: Blob | null = null;
        let previewUrl = image.url || '';

        if (image.b64_json || image.data) {
            blob = base64ToBlob(image.b64_json || image.data, mimeType);
        } else if (image.url) {
            try {
                const response = await fetch(image.url);
                blob = await response.blob();
            } catch (error) {
                console.error('Failed to download generated image:', error);
            }
        }

        if (!blob) {
            return {
                mimeType,
                data: '',
                path: '',
                previewUrl,
                revisedPrompt: image.revised_prompt || image.revisedPrompt,
            };
        }

        const actualMimeType = blob.type || mimeType;
        const name = createGeneratedImageFileName(actualMimeType, index);
        const assetPath = await saveAsset(blob, name);
        previewUrl = URL.createObjectURL(blob);

        return {
            name,
            mimeType: actualMimeType,
            data: '',
            path: assetPath,
            previewUrl,
            revisedPrompt: image.revised_prompt || image.revisedPrompt,
        };
    }

    async function requestDrawImages(
        providerConfig: any,
        modelConfig: any,
        prompt: string,
        editImageSources: MessageAttachment[],
        signal: AbortSignal
    ) {
        if (isGeminiImageApi(providerConfig, modelConfig)) {
            return await requestGeminiDrawImages(
                providerConfig,
                modelConfig,
                prompt,
                editImageSources,
                signal
            );
        }

        const isEdit = editImageSources.length > 0;
        const url = getOpenAIImageEndpointUrl(
            providerConfig,
            isEdit ? '/images/edits' : '/images/generations'
        );

        let response: Response;
        if (isEdit) {
            const formData = new FormData();
            formData.append('model', modelConfig.id);
            formData.append('prompt', prompt);
            formData.append('n', String(drawImageCount));
            formData.append('size', drawImageSize);
            formData.append('quality', drawImageQuality);

            for (const [index, imageSource] of editImageSources.entries()) {
                const blob = await imageAttachmentToBlob(imageSource);
                const mimeType = blob.type || imageSource.mimeType || 'image/png';
                const ext = mimeType.split('/')[1] || 'png';
                formData.append(
                    'image',
                    new File([blob], imageSource.name || `image-${index + 1}.${ext}`, {
                        type: mimeType,
                    })
                );
            }

            response = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${providerConfig.apiKey}`,
                },
                body: formData,
                signal,
            });
        } else {
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${providerConfig.apiKey}`,
                },
                body: JSON.stringify({
                    model: modelConfig.id,
                    prompt,
                    n: drawImageCount,
                    size: drawImageSize,
                    quality: drawImageQuality,
                }),
                signal,
            });
        }

        if (!response.ok) {
            throw new Error(await getImageApiError(response, isEdit ? '图片编辑失败' : '图片生成失败'));
        }

        const data = await response.json();
        const rawImages = Array.isArray(data.data)
            ? data.data
            : Array.isArray(data.images)
              ? data.images
              : data.url || data.b64_json || typeof data.data === 'string'
                ? [data]
                : [];

        const savedImages = await Promise.all(rawImages.map(saveGeneratedImageFromApiResult));
        return savedImages.filter(Boolean);
    }

    function buildDrawAssistantContent(images: any[], isEdit: boolean): string {
        const revisedPrompts = images
            .map(img => img.revisedPrompt)
            .filter(Boolean)
            .map(prompt => `- ${prompt}`)
            .join('\n');

        const title = isEdit ? '图片编辑完成' : '图片生成完成';
        if (!revisedPrompts) {
            return `${title}，共 ${images.length} 张。`;
        }

        return `${title}，共 ${images.length} 张。`;
    }

    // 画图模式：拉取 contextDocuments 的最新 Markdown 内容
    async function collectDrawModeContextDocuments(
        sourceDocs: ContextDocument[]
    ): Promise<ContextDocument[]> {
        if (!sourceDocs || sourceDocs.length === 0) return [];
        const result: ContextDocument[] = [];
        for (const doc of sourceDocs) {
            try {
                const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                result.push({
                    id: doc.id,
                    title: doc.title,
                    content: data?.content || doc.content,
                    type: doc.type,
                });
            } catch (error) {
                console.error(`Failed to get latest content for block ${doc.id}:`, error);
                result.push(doc);
            }
        }
        return result;
    }

    // 画图模式：把 contextDocuments 作为参考资料拼到提示词末尾
    function buildDrawPromptWithContext(
        prompt: string,
        contextDocs: ContextDocument[]
    ): string {
        if (!contextDocs || contextDocs.length === 0) return prompt;
        const contextText = contextDocs
            .map(doc => {
                const label =
                    doc.type === 'doc' ? '文档' : doc.type === 'webpage' ? '网页' : '块';
                if (doc.content) {
                    return `## ${label}: ${doc.title}\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                }
                return `## ${label}: ${doc.title}`;
            })
            .join('\n\n---\n\n');
        return `${prompt}\n\n---\n\n以下是生图素材：\n\n${contextText}`;
    }

    function buildDrawPromptWithSystemPrompt(prompt: string): string {
        const tempSystemPrompt = tempModelSettings.systemPrompt?.trim();
        if (!tempSystemPrompt) return prompt;
        return `【生图系统提示词】\n${tempSystemPrompt}\n\n---\n\n【用户生图需求】\n${prompt}`;
    }

    async function sendDrawModeMessage(providerConfig: any, modelConfig: any) {
        const userContent = currentInput.trim();
        if (!userContent) {
            pushErrMsg('请输入画图提示词');
            isLoading = false;
            return;
        }

        if (!modelSupportsImageGeneration(modelConfig)) {
            pushErrMsg('画图模式只能使用已勾选“生图”能力的模型');
            isLoading = false;
            return;
        }

        normalizeDrawImageCount();
        applyPromptDrawImageSize(userContent);

        const contextDocumentsWithLatestContent = await collectDrawModeContextDocuments(
            contextDocuments
        );
        const promptWithSystemPrompt = buildDrawPromptWithSystemPrompt(userContent);
        const promptWithContext = buildDrawPromptWithContext(
            promptWithSystemPrompt,
            contextDocumentsWithLatestContent
        );

        const userAttachments = [...currentAttachments];
        const userImageAttachments = userAttachments.filter(att => att.type === 'image');
        if (userImageAttachments.length === 0 && hasPendingDrawImageSelectionForEdit()) {
            pushErrMsg('请先选择一张满意的图片，再继续编辑');
            isLoading = false;
            return;
        }
        const editImageSources = await collectDrawEditImageSources(userImageAttachments);
        const isEdit = editImageSources.length > 0;

        const userMessage: Message = {
            role: 'user',
            content: userContent,
            attachments: userImageAttachments.length > 0 ? userImageAttachments : undefined,
            contextDocuments:
                contextDocumentsWithLatestContent.length > 0
                    ? [...contextDocumentsWithLatestContent]
                    : undefined,
        };

        messages = [...messages, userMessage];
        currentInput = '';
        currentAttachments = [];
        contextDocuments = [];
        isAborted = false;
        streamingMessage = isEdit ? '正在编辑图片' : '正在生成图片';
        streamingThinking = '';
        isThinkingPhase = false;
        hasUnsavedChanges = true;
        autoScroll = true;

        await scrollToBottom(true);

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
            autoRenameSession(userContent);
        }

        abortController = new AbortController();

        try {
            const generatedImages = await requestDrawImages(
                providerConfig,
                modelConfig,
                promptWithContext,
                editImageSources,
                abortController.signal
            );

            if (isAborted) {
                return;
            }

            if (generatedImages.length === 0) {
                throw new Error('图片接口没有返回可用图片');
            }

            const assistantMessage: Message = {
                role: 'assistant',
                content: buildDrawAssistantContent(generatedImages, isEdit),
                generatedImages: generatedImages.map(img => ({
                    name: img.name,
                    mimeType: img.mimeType,
                    data: '',
                    path: img.path,
                    url: img.previewUrl && !img.path ? img.previewUrl : undefined,
                })),
                drawImageSelectionRequired: generatedImages.length > 1,
                drawSelectedImageIndex: generatedImages.length === 1 ? 0 : undefined,
                attachments: generatedImages.map((img, index) => ({
                    type: 'image' as const,
                    name: img.name || createGeneratedImageFileName(img.mimeType, index),
                    data: img.previewUrl,
                    path: img.path,
                    mimeType: img.mimeType || 'image/png',
                })),
            };

            messages = [...messages, assistantMessage];
            streamingMessage = '';
            isLoading = false;
            abortController = null;
            hasUnsavedChanges = true;

            await saveCurrentSession(true);
            autoRenameSession(userContent);
        } catch (error) {
            if ((error as Error).name === 'AbortError' || (error as Error).message === 'Request aborted') {
                isAborted = true;
            } else {
                const errorMessage: Message = {
                    role: 'assistant',
                    content: `❌ **${i18n('aiSidebar.errors.requestFailed')}**\n\n${(error as Error).message}`,
                };
                messages = [...messages, errorMessage];
                hasUnsavedChanges = true;
            }
            streamingMessage = '';
            isLoading = false;
            abortController = null;
        }
    }

    async function regenerateDrawModeMessage(
        lastUserMessage: Message,
        providerConfig: any,
        modelConfig: any
    ) {
        const userContent =
            typeof lastUserMessage.content === 'string'
                ? lastUserMessage.content.trim()
                : getMessageText(lastUserMessage.content).trim();

        if (!userContent) {
            pushErrMsg('请输入画图提示词');
            isLoading = false;
            return;
        }

        if (!modelSupportsImageGeneration(modelConfig)) {
            pushErrMsg('画图模式只能使用已勾选“生图”能力的模型');
            isLoading = false;
            return;
        }

        normalizeDrawImageCount();
        applyPromptDrawImageSize(userContent);

        const contextDocumentsWithLatestContent = await collectDrawModeContextDocuments(
            lastUserMessage.contextDocuments || []
        );
        const promptWithSystemPrompt = buildDrawPromptWithSystemPrompt(userContent);
        const promptWithContext = buildDrawPromptWithContext(
            promptWithSystemPrompt,
            contextDocumentsWithLatestContent
        );

        const userImageAttachments =
            lastUserMessage.attachments?.filter(att => att.type === 'image') || [];
        if (userImageAttachments.length === 0 && hasPendingDrawImageSelectionForEdit()) {
            pushErrMsg('请先选择一张满意的图片，再继续编辑');
            isLoading = false;
            return;
        }
        const editImageSources = await collectDrawEditImageSources(userImageAttachments);
        const isEdit = editImageSources.length > 0;

        abortController = new AbortController();
        streamingMessage = isEdit ? '正在编辑图片' : '正在生成图片';

        try {
            const generatedImages = await requestDrawImages(
                providerConfig,
                modelConfig,
                promptWithContext,
                editImageSources,
                abortController.signal
            );

            if (isAborted) {
                return;
            }

            if (generatedImages.length === 0) {
                throw new Error('图片接口没有返回可用图片');
            }

            const assistantMessage: Message = {
                role: 'assistant',
                content: buildDrawAssistantContent(generatedImages, isEdit),
                generatedImages: generatedImages.map(img => ({
                    name: img.name,
                    mimeType: img.mimeType,
                    data: '',
                    path: img.path,
                    url: img.previewUrl && !img.path ? img.previewUrl : undefined,
                })),
                drawImageSelectionRequired: generatedImages.length > 1,
                drawSelectedImageIndex: generatedImages.length === 1 ? 0 : undefined,
                attachments: generatedImages.map((img, index) => ({
                    type: 'image' as const,
                    name: img.name || createGeneratedImageFileName(img.mimeType, index),
                    data: img.previewUrl,
                    path: img.path,
                    mimeType: img.mimeType || 'image/png',
                })),
            };

            messages = [...messages, assistantMessage];
            streamingMessage = '';
            isLoading = false;
            abortController = null;
            hasUnsavedChanges = true;

            await saveCurrentSession(true);
        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                const errorMessage: Message = {
                    role: 'assistant',
                    content: `❌ **${i18n('aiSidebar.errors.requestFailed')}**\n\n${(error as Error).message}`,
                };
                messages = [...messages, errorMessage];
                hasUnsavedChanges = true;
            }
            streamingMessage = '';
            isLoading = false;
            abortController = null;
        }
    }

    // 发送消息
    async function sendMessage() {
        if ((!currentInput.trim() && currentAttachments.length === 0) || isLoading) return;

        // 【修复】立即设置加载状态，防止并发点击触发多次发送
        isLoading = true;

        // 等待拖拽后仍在后台落盘的附件，保证会话里有稳定的 path
        try {
            await waitForPendingAttachmentSaves();
        } catch (e) {
            console.error('Failed to wait for attachments:', e);
        }

        // 如果处于等待选择答案状态，阻止发送
        if (isWaitingForAnswerSelection) {
            pushErrMsg(i18n('multiModel.waitingSelection'));
            isLoading = false;
            return;
        }

        // 检查设置
        const providerConfig = getCurrentProviderConfig();
        if (!providerConfig) {
            pushErrMsg(i18n('aiSidebar.errors.noProvider'));
            isLoading = false;
            return;
        }

        if (!providerConfig.apiKey) {
            pushErrMsg(i18n('aiSidebar.errors.noApiKey'));
            isLoading = false;
            return;
        }

        const modelConfig = getCurrentModelConfig();
        if (!modelConfig) {
            pushErrMsg(i18n('aiSidebar.errors.noModel'));
            isLoading = false;
            return;
        }

        if (chatMode === 'draw') {
            await sendDrawModeMessage(providerConfig, modelConfig);
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

        // 如果启用了多模型模式且在问答模式
        if (enableMultiModel && chatMode === 'ask' && selectedMultiModels.length > 0) {
            try {
                await sendMultiModelMessage();
            } finally {
                // sendMultiModelMessage 内部会处理 isLoading，但为了安全这里也检查
            }
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

                    if ((chatMode === 'agent' || chatMode === 'ask') && userToolCount > 0) {
                        // agent模式或启用工具的问答模式：文档只传递ID
                        if (doc.type === 'doc') {
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
        // isLoading 已经在函数开始时设置为 true
        isAborted = false; // 重置中断标志
        streamingMessage = '';
        streamingThinking = '';
        thinkingBeforeToolCalls = ''; // 重置工具调用前的思考内容
        isThinkingPhase = false;
        hasUnsavedChanges = true;
        autoScroll = true; // 发送新消息时启用自动滚动

        await scrollToBottom(true);

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
        if (
            (chatMode === 'agent' || chatMode === 'ask') &&
            userToolCount > 0 &&
            currentProvider === 'deepseek'
        ) {
            messages = messages.map(msg => {
                if (msg.role === 'assistant' && msg.reasoning_content) {
                    const { reasoning_content, ...rest } = msg as any;
                    return rest as Message;
                }
                return msg;
            });
        }

        const isDeepseekThinkingAgent =
            (chatMode === 'agent' || chatMode === 'ask') &&
            userToolCount > 0 &&
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

                // 检测是否是 DeepSeek 推理模型
                const isDeepSeekReasonerModel = /deepseek-(reasoner|r1)/i.test(modelConfig.id);

                // 只有在启用 thinking 模式或者是 DeepSeek 推理模型时才保留 reasoning_content
                // Kimi 等模型在未启用 thinking 时看到 reasoning_content 会报错
                const shouldKeepReasoning = isDeepseekThinkingAgent || isDeepSeekReasonerModel;
                if (shouldKeepReasoning && msg.reasoning_content !== undefined) {
                    baseMsg.reasoning_content = msg.reasoning_content;
                }

                // 在启用 thinking 模式或是 DeepSeek 推理模型且有 tool_calls 时，确保 reasoning_content 字段存在
                if (shouldKeepReasoning && msg.tool_calls && msg.tool_calls.length > 0) {
                    if (baseMsg.reasoning_content === undefined) {
                        baseMsg.reasoning_content = '';
                    }
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
                            const label =
                                doc.type === 'doc'
                                    ? '文档'
                                    : doc.type === 'webpage'
                                      ? '网页'
                                      : '块';

                            // agent模式或启用工具的问答模式：文档块只传递ID，不传递内容
                            if (
                                (chatMode === 'agent' || chatMode === 'ask') &&
                                userToolCount > 0 &&
                                doc.type === 'doc'
                            ) {
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

                // 查找上一条assistant消息是否有生成的图片（用于图片编辑）
                let previousGeneratedImages: any[] = [];
                const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
                if (lastAssistantMsg) {
                    // 检查generatedImages或attachments中的图片
                    if (
                        lastAssistantMsg.generatedImages &&
                        lastAssistantMsg.generatedImages.length > 0
                    ) {
                        previousGeneratedImages = lastAssistantMsg.generatedImages.map(img => ({
                            type: 'image_url' as const,
                            image_url: {
                                url: `data:${img.mimeType || 'image/png'};base64,${img.data}`,
                            },
                        }));
                    } else if (
                        lastAssistantMsg.attachments &&
                        lastAssistantMsg.attachments.length > 0
                    ) {
                        previousGeneratedImages = lastAssistantMsg.attachments
                            .filter(att => att.type === 'image')
                            .map(att => ({
                                type: 'image_url' as const,
                                image_url: { url: att.data },
                            }));
                    } else if (typeof lastAssistantMsg.content === 'string') {
                        // 从Markdown内容中提取图片 ![alt](url)
                        const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
                        const content = lastAssistantMsg.content;
                        let match;
                        while ((match = imageRegex.exec(content)) !== null) {
                            const url = match[1];
                            // 处理 assets 路径的图片
                            if (
                                url.startsWith('/data/storage/petal/siyuan-plugin-copilot/assets/')
                            ) {
                                try {
                                    const blobUrl = await loadAsset(url);
                                    if (blobUrl) {
                                        previousGeneratedImages.push({
                                            type: 'image_url' as const,
                                            image_url: { url: blobUrl },
                                        });
                                    }
                                } catch (error) {
                                    console.error('Failed to load asset image:', error);
                                }
                            } else if (url.startsWith('http://') || url.startsWith('https://')) {
                                // HTTP/HTTPS URL 直接使用
                                previousGeneratedImages.push({
                                    type: 'image_url' as const,
                                    image_url: { url: url },
                                });
                            }
                        }
                    }
                }

                // 如果有图片附件或上一条有生成的图片，使用多模态格式
                if (hasImages || previousGeneratedImages.length > 0) {
                    const contentParts: any[] = [];

                    // 先添加用户输入
                    let textContent = userContent;

                    // 然后添加上下文文档（如果有）
                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label =
                                    doc.type === 'doc'
                                        ? '文档'
                                        : doc.type === 'webpage'
                                          ? '网页'
                                          : '块';

                                // agent模式或启用工具的问答模式：文档块只传递ID，不传递内容
                                if (
                                    (chatMode === 'agent' || chatMode === 'ask') &&
                                    userToolCount > 0 &&
                                    doc.type === 'doc'
                                ) {
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

                    // 添加用户上传的图片
                    lastUserMessage.attachments?.forEach(att => {
                        if (att.type === 'image') {
                            contentParts.push({
                                type: 'image_url',
                                image_url: { url: att.data },
                            });
                        }
                    });

                    // 添加上一次生成的图片（用于图片编辑）
                    previousGeneratedImages.forEach(img => {
                        contentParts.push(img);
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
                                const label =
                                    doc.type === 'doc'
                                        ? '文档'
                                        : doc.type === 'webpage'
                                          ? '网页'
                                          : '块';

                                // agent模式或启用工具的问答模式：文档块只传递ID，不传递内容
                                if (
                                    (chatMode === 'agent' || chatMode === 'ask') &&
                                    userToolCount > 0 &&
                                    doc.type === 'doc'
                                ) {
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
        if ((chatMode === 'agent' || chatMode === 'ask') && userToolCount > 0) {
            // Agent 模式或启用工具的问答模式下添加工具使用强制规则
            let baseSystemPrompt = settings.aiSystemPrompt || '';
            if (baseSystemPrompt.trim()) {
                baseSystemPrompt += '\n\n' + AGENT_TOOL_USAGE_INSTRUCTION;
            } else {
                baseSystemPrompt = AGENT_TOOL_USAGE_INSTRUCTION;
            }
            messagesToSend.unshift({ role: 'system', content: baseSystemPrompt });
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
        const limitedMessages =
            tempModelSettings.contextCount < 0
                ? otherMessages
                : otherMessages.slice(-tempModelSettings.contextCount);

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

            // 准备工具列表
            let toolsForAgent: any[] | undefined = undefined;
            if ((chatMode === 'agent' || chatMode === 'ask') && userToolCount > 0) {
                // 根据选中的工具名称筛选出对应的工具定义
                const currentSelectedTools = chatMode === 'ask' ? selectedToolsAsk : selectedTools;
                const selectedToolDefs = AVAILABLE_TOOLS.filter(tool =>
                    currentSelectedTools.some(t => t.name === tool.function.name)
                );
                const filteredToolDefs = selectedToolDefs.filter(
                    tool => tool.function.name !== 'get_siyuan_skills'
                );
                const descTool =
                    chatMode === 'ask'
                        ? createGetSiyuanSkillsTool(
                              filteredToolDefs.map(tool => tool.function.name)
                          )
                        : AVAILABLE_TOOLS.find(t => t.function.name === 'get_siyuan_skills');
                toolsForAgent = descTool ? [descTool, ...filteredToolDefs] : filteredToolDefs;
            }

            // 准备联网搜索工具（如果启用）
            let webSearchTools: any[] | undefined = undefined;
            if (
                modelConfig.capabilities?.webSearch &&
                modelConfig.webSearchEnabled &&
                chatMode !== 'agent'
            ) {
                // 根据模型类型构建不同的联网工具配置
                const modelIdLower = modelConfig.id.toLowerCase();

                if (modelIdLower.includes('gemini')) {
                    // Gemini 模型使用 googleSearch 函数
                    webSearchTools = [
                        {
                            type: 'function',
                            function: {
                                name: 'googleSearch',
                            },
                        },
                    ];
                } else if (modelIdLower.includes('claude')) {
                    // Claude 模型使用 web_search 工具
                    // webSearchTools = [
                    //     {
                    //         type: 'web_search_20250305',
                    //         name: 'web_search',
                    //         max_uses: modelConfig.webSearchMaxUses || 5,
                    //     },
                    // ];
                }
            }

            // Agent 模式或启用工具的问答模式使用循环调用
            if (
                (chatMode === 'agent' || chatMode === 'ask') &&
                toolsForAgent &&
                toolsForAgent.length > 0
            ) {
                let shouldContinue = true;
                // 记录第一次工具调用后创建的assistant消息索引
                let firstToolCallMessageIndex: number | null = null;
                // 记录当前是第几轮工具调用
                let currentToolCallRound = 0;

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
                            useForwardProxy: providerConfig.useForwardProxy || false,
                            model: modelConfig.id,
                            messages: messagesToSend,
                            temperature: tempModelSettings.temperatureEnabled
                                ? tempModelSettings.temperature
                                : modelConfig.temperature,
                            maxTokens:
                                modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                            stream: true,
                            signal: abortController.signal,
                            enableThinking,
                            reasoningEffort: modelConfig.thinkingEffort || 'low',
                            tools: toolsForAgent,
                            customBody,
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
                                receivedToolCalls = true;

                                // 获取当前工具调用的起始索引
                                const toolCallStartIndex =
                                    firstToolCallMessageIndex !== null
                                        ? messages[firstToolCallMessageIndex].tool_calls?.length ||
                                          0
                                        : 0;

                                // 计算当前轮次的折叠索引
                                const baseIndex =
                                    firstToolCallMessageIndex !== null
                                        ? firstToolCallMessageIndex * 100 + currentToolCallRound
                                        : messages.length * 100;

                                // 如果是第一次工具调用，创建新的assistant消息
                                if (firstToolCallMessageIndex === null) {
                                    const assistantMessage: Message = {
                                        role: 'assistant',
                                        content: streamingMessage || '',
                                        tool_calls: toolCalls,
                                        toolCallThinkings: [
                                            {
                                                toolCallIndex: 0,
                                                thinkingBefore: streamingThinking || '',
                                                contentBefore: streamingMessage || '',
                                            },
                                        ],
                                    };

                                    // 只有在启用 thinking 模式时才添加 reasoning_content
                                    // Kimi 等模型在未启用 thinking 时看到 reasoning_content 会报错
                                    if (isDeepseekThinkingAgent) {
                                        assistantMessage.reasoning_content =
                                            streamingThinking || '';
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

                                    // 添加新一轮工具调用的思考记录
                                    if (!existingMessage.toolCallThinkings) {
                                        existingMessage.toolCallThinkings = [];
                                    }
                                    existingMessage.toolCallThinkings.push({
                                        toolCallIndex: toolCallStartIndex,
                                        thinkingBefore: streamingThinking || '',
                                        contentBefore: streamingMessage || '',
                                    });

                                    // 只有在启用 thinking 模式时才更新 reasoning_content
                                    if (isDeepseekThinkingAgent) {
                                        existingMessage.reasoning_content = streamingThinking || '';
                                    }

                                    messages = [...messages];
                                }

                                // 自动折叠当前思考过程
                                thinkingCollapsed[baseIndex] = true;
                                thinkingCollapsed = { ...thinkingCollapsed };

                                currentToolCallRound++;
                                streamingMessage = '';
                                // 清空 streamingThinking，准备接收工具调用后的思考内容
                                streamingThinking = '';

                                // 处理每个工具调用
                                for (const toolCall of toolCalls) {
                                    const currentSelectedToolsInLoop =
                                        chatMode === 'ask' ? selectedToolsAsk : selectedTools;
                                    const toolConfig = currentSelectedToolsInLoop.find(
                                        t => t.name === toolCall.function.name
                                    );
                                    // get_siyuan_skills 是系统工具，默认自动批准
                                    const isSystemTool =
                                        toolCall.function.name === 'get_siyuan_skills';
                                    const autoApprove =
                                        isSystemTool || toolConfig?.autoApprove || false;
                                    const toolChangeContext =
                                        await resolveToolChangeContext(toolCall);
                                    if (firstToolCallMessageIndex !== null && toolChangeContext) {
                                        await ensureDocDiffSnapshotBefore(
                                            firstToolCallMessageIndex,
                                            toolChangeContext
                                        );
                                    }

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
                                            if (
                                                firstToolCallMessageIndex !== null &&
                                                toolChangeContext
                                            ) {
                                                await refreshDocDiffSnapshotAfter(
                                                    firstToolCallMessageIndex,
                                                    toolChangeContext
                                                );
                                            }
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
                                                if (
                                                    firstToolCallMessageIndex !== null &&
                                                    toolChangeContext
                                                ) {
                                                    await refreshDocDiffSnapshotAfter(
                                                        firstToolCallMessageIndex,
                                                        toolChangeContext
                                                    );
                                                }
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
                                messagesToSend = messages
                                    .filter(msg => msg.role !== 'system') // 过滤掉旧的系统消息
                                    .map(msg => {
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

                                        // 检测是否是 DeepSeek 推理模型
                                        const isDeepSeekReasonerModel2 =
                                            /deepseek-(reasoner|r1)/i.test(modelConfig.id);

                                        // 只有在启用 thinking 模式或者是 DeepSeek 推理模型时才保留 reasoning_content
                                        // Kimi 等模型在未启用 thinking 时看到 reasoning_content 会报错
                                        const shouldKeepReasoning2 =
                                            isDeepseekThinkingAgent || isDeepSeekReasonerModel2;
                                        if (
                                            shouldKeepReasoning2 &&
                                            msg.reasoning_content !== undefined
                                        ) {
                                            baseMsg.reasoning_content = msg.reasoning_content;
                                        }

                                        // 在启用 thinking 模式或是 DeepSeek 推理模型且有 tool_calls 时，确保 reasoning_content 字段存在
                                        if (
                                            shouldKeepReasoning2 &&
                                            msg.tool_calls &&
                                            msg.tool_calls.length > 0
                                        ) {
                                            if (baseMsg.reasoning_content === undefined) {
                                                baseMsg.reasoning_content = '';
                                            }
                                        }

                                        // 对于用户消息，如果有上下文文档，需要重新注入上下文内容
                                        // 因为 msg.content 只存储了原始输入，不包含上下文
                                        if (
                                            msg.role === 'user' &&
                                            msg.contextDocuments &&
                                            msg.contextDocuments.length > 0
                                        ) {
                                            const contextText = msg.contextDocuments
                                                .map(doc => {
                                                    const label =
                                                        doc.type === 'doc'
                                                            ? '文档'
                                                            : doc.type === 'webpage'
                                                              ? '网页'
                                                              : '块';
                                                    if (doc.type === 'doc') {
                                                        return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                                    } else {
                                                        return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                                                    }
                                                })
                                                .join('\n\n---\n\n');
                                            baseMsg.content += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                                        }

                                        return baseMsg;
                                    });

                                // 添加系统提示词到消息列表开头（工具使用说明已在 prepareMessagesForAI 中添加）
                                if (settings.aiSystemPrompt) {
                                    messagesToSend.unshift({
                                        role: 'system',
                                        content: settings.aiSystemPrompt,
                                    });
                                }

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
                                    if (firstToolCallMessageIndex !== null) {
                                        pendingDocDiffsByMessage.delete(firstToolCallMessageIndex);
                                    }
                                    toolExecutionComplete?.();
                                    return;
                                }

                                // 如果没有收到工具调用，说明对话结束
                                if (!receivedToolCalls) {
                                    shouldContinue = false;

                                    const convertedText = convertLatexToMarkdown(fullText);

                                    // 处理content中的base64图片，保存为assets文件
                                    const processedContent =
                                        await saveBase64ImagesInContent(convertedText);

                                    // 如果之前有工具调用，将最终回复存储到 finalReply 字段
                                    if (
                                        firstToolCallMessageIndex !== null &&
                                        processedContent.trim()
                                    ) {
                                        const existingMessage = messages[firstToolCallMessageIndex];
                                        // 将AI的最终回复存储到 finalReply 字段
                                        existingMessage.finalReply = processedContent;

                                        // 只有在启用 thinking 模式时才更新 reasoning_content
                                        if (isDeepseekThinkingAgent) {
                                            // 构建完整的 reasoning_content，包含所有轮次的思考
                                            let fullReasoning = '';
                                            if (existingMessage.toolCallThinkings) {
                                                for (
                                                    let i = 0;
                                                    i < existingMessage.toolCallThinkings.length;
                                                    i++
                                                ) {
                                                    const round =
                                                        existingMessage.toolCallThinkings[i];
                                                    if (i > 0) fullReasoning += '\n\n';
                                                    fullReasoning += `[第${i + 1}轮思考]\n${round.thinkingBefore}`;
                                                }
                                            }
                                            existingMessage.reasoning_content = fullReasoning;
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
                                    if (firstToolCallMessageIndex !== null) {
                                        commitPendingDocDiffsToMessage(firstToolCallMessageIndex);
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
                                if (firstToolCallMessageIndex !== null) {
                                    pendingDocDiffsByMessage.delete(firstToolCallMessageIndex);
                                }
                                if (error.message !== 'Request aborted') {
                                    const errorMessage: Message = {
                                        role: 'assistant',
                                        content: `❌ **${i18n('aiSidebar.errors.requestFailed')}**\n\n${error.message}`,
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

                // 检查是否启用图片生成
                const enableImageGeneration = modelConfig.capabilities?.imageGeneration || false;
                // 用于保存生成的图片
                let generatedImages: any[] = [];

                await chat(
                    currentProvider,
                    {
                        apiKey: providerConfig.apiKey,
                        useForwardProxy: providerConfig.useForwardProxy || false,
                        model: modelConfig.id,
                        messages: messagesToSend,
                        temperature: tempModelSettings.temperatureEnabled
                            ? tempModelSettings.temperature
                            : modelConfig.temperature,
                        maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                        stream: true,
                        signal: abortController.signal,
                        enableThinking,
                        reasoningEffort: modelConfig.thinkingEffort || 'low',
                        tools: webSearchTools, // 传递联网搜索工具
                        customBody,
                        enableImageGeneration,
                        onImageGenerated: async (images: any[]) => {
                            // 立即保存生成的图片到 SiYuan 资源文件夹并转换为 blob URL
                            generatedImages = await Promise.all(
                                images.map(async (img, idx) => {
                                    const blob = base64ToBlob(
                                        img.data,
                                        img.mimeType || 'image/png'
                                    );
                                    const name = createGeneratedImageFileName(
                                        img.mimeType || 'image/png',
                                        idx
                                    );
                                    const assetPath = await saveAsset(blob, name);
                                    return {
                                        ...img,
                                        name,
                                        path: assetPath,
                                        // 给前端显示用的 blob url
                                        previewUrl: URL.createObjectURL(blob),
                                    };
                                })
                            );
                        },
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

                            // 处理content中的base64图片，保存为assets文件
                            const processedContent = await saveBase64ImagesInContent(convertedText);

                            const assistantMessage: Message = {
                                role: 'assistant',
                                content: processedContent,
                            };

                            // 如果有思考内容，添加到消息中
                            if (enableThinking && streamingThinking) {
                                assistantMessage.thinking = streamingThinking;
                            }

                            // 如果有生成的图片，保存到消息中
                            if (generatedImages.length > 0) {
                                // 保存图片信息（不包含base64数据，只保存路径）
                                assistantMessage.generatedImages = generatedImages.map(img => ({
                                    mimeType: img.mimeType,
                                    data: '', // 不保存base64数据，节省空间
                                    path: img.path,
                                }));

                                // 添加为附件以便显示（使用blob URL）
                                assistantMessage.attachments = generatedImages.map((img, idx) => ({
                                    type: 'image' as const,
                                    name:
                                        img.name ||
                                        createGeneratedImageFileName(
                                            img.mimeType || 'image/png',
                                            idx
                                        ),
                                    data: img.previewUrl, // 使用 blob URL 显示
                                    path: img.path, // 保存路径用于持久化
                                    mimeType: img.mimeType || 'image/png',
                                }));
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

                            // 根据AI回答自动重命名会话标题
                            autoRenameSession(convertedText);
                        },
                        onError: (error: Error) => {
                            // 如果是主动中断，不显示错误
                            if (error.message !== 'Request aborted') {
                                // 将错误消息作为一条 assistant 消息添加
                                const errorMessage: Message = {
                                    role: 'assistant',
                                    content: `❌ **${i18n('aiSidebar.errors.requestFailed')}**\n\n${error.message}`,
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
                    content: `❌ **${i18n('aiSidebar.errors.requestFailed')}**\n\n${(error as Error).message}`,
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
                    const updatedMultiModelResponses = multiModelResponses.map((response, i) => ({
                        ...response,
                        isSelected: i === firstSuccessIndex,
                        modelName:
                            i === firstSuccessIndex
                                ? ' ✅' + response.modelName
                                : response.modelName, // 选择的模型名添加✅
                    }));

                    // 【修复】检查是否已经存在该 turns 的助手消息，避免重复添加
                    const lastMessage = messages[messages.length - 1];
                    if (
                        lastMessage &&
                        lastMessage.role === 'assistant' &&
                        lastMessage.multiModelResponses
                    ) {
                        lastMessage.content = selectedResponse.content || '';
                        lastMessage.thinking = selectedResponse.thinking || '';
                        lastMessage.multiModelResponses = updatedMultiModelResponses;
                        messages = [...messages];
                    } else {
                        const assistantMessage: Message = {
                            role: 'assistant',
                            content: selectedResponse.content || '',
                            thinking: selectedResponse.thinking,
                            multiModelResponses: updatedMultiModelResponses,
                        };
                        messages = [...messages, assistantMessage];
                    }
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
                    content: convertedMessage + '\n\n' + i18n('aiSidebar.messages.interrupted'),
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
                pushMsg(i18n('aiSidebar.success.copyMarkdownSuccess'));
            })
            .catch(err => {
                pushErrMsg(i18n('aiSidebar.errors.copyFailed'));
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
                const updatedMultiModelResponses = multiModelResponses.map((response, i) => ({
                    ...response,
                    isSelected: i === firstSuccessIndex,
                    modelName:
                        i === firstSuccessIndex ? ' ✅' + response.modelName : response.modelName, // 选择的模型名添加✅
                }));

                const lastMessage = messages[messages.length - 1];
                if (
                    lastMessage &&
                    lastMessage.role === 'assistant' &&
                    lastMessage.multiModelResponses
                ) {
                    lastMessage.content = selectedResponse.content || '';
                    lastMessage.thinking = selectedResponse.thinking || '';
                    lastMessage.multiModelResponses = updatedMultiModelResponses;
                    messages = [...messages];
                } else {
                    const assistantMessage: Message = {
                        role: 'assistant',
                        content: selectedResponse.content || '',
                        thinking: selectedResponse.thinking,
                        multiModelResponses: updatedMultiModelResponses,
                    };
                    messages = [...messages, assistantMessage];
                }
                hasUnsavedChanges = true;
            }
        }

        if (hasUnsavedChanges && messages.filter(m => m.role !== 'system').length > 0) {
            confirm(
                i18n('aiSidebar.confirm.clearChat.title'),
                i18n('aiSidebar.confirm.clearChat.message'),
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

        pushMsg(i18n('aiSidebar.success.clearSuccess'));
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
        // 如果有工具调用后的最终回复，优先返回
        if (message.finalReply) {
            return message.finalReply;
        }
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

    // 将消息内容中的 base64 图片保存为 assets 文件并替换为路径
    async function saveBase64ImagesInContent(content: string): Promise<string> {
        // 匹配 Markdown 图片语法中的 base64 数据
        const base64ImageRegex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
        const matches = Array.from(content.matchAll(base64ImageRegex));

        if (matches.length === 0) {
            return content;
        }

        let result = content;
        for (const match of matches) {
            const fullMatch = match[0];
            const altText = match[1];
            const dataUrl = match[2];

            try {
                // 解析 data URL
                const dataUrlMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (!dataUrlMatch) continue;

                const mimeType = dataUrlMatch[1];
                const base64Data = dataUrlMatch[2];

                // 保存到 assets
                const blob = base64ToBlob(base64Data, mimeType);
                const ext = mimeType.split('/')[1] || 'png';
                const assetPath = await saveAsset(blob, `image-${Date.now()}.${ext}`);

                // 替换为 assets 路径
                result = result.replace(fullMatch, `![${altText}](${assetPath})`);

                console.log(`Saved generated image to assets: ${assetPath}`);
            } catch (error) {
                console.error('Failed to save base64 image:', error);
            }
        }

        return result;
    }

    // 将消息内容中的 assets 路径替换为 blob URL（用于显示）
    async function replaceAssetPathsWithBlob(content: string): Promise<string> {
        // 匹配 Markdown 图片语法中的 assets 路径
        const assetImageRegex =
            /!\[([^\]]*)\]\((\/data\/storage\/petal\/siyuan-plugin-copilot\/assets\/[^)]+)\)/g;
        const matches = Array.from(content.matchAll(assetImageRegex));

        if (matches.length === 0) {
            return content;
        }

        let result = content;
        for (const match of matches) {
            const fullMatch = match[0];
            const altText = match[1];
            const assetPath = match[2];

            try {
                const blobUrl = await loadAsset(assetPath);
                if (blobUrl) {
                    result = result.replace(fullMatch, `![${altText}](${blobUrl})`);
                }
            } catch (error) {
                console.error('Failed to load asset for display:', error);
            }
        }

        return result;
    }

    function formatMessage(content: string | MessageContent[]): string {
        let textContent = getMessageText(content);

        try {
            // 检查window.Lute是否存在
            if (typeof window !== 'undefined' && (window as any).Lute) {
                const lute = (window as any).Lute.New();
                // 启用行内数学公式支持，将 $...$ 解析为 <span class="language-math">...</span>
                lute.SetInlineMath(true);
                // 允许 $ 后面紧跟数字，如 $7.24 s$
                lute.SetInlineMathAllowDigitAfterOpenMarker(true);
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
                        // 保存原始内容，用于复制时还原
                        if (!mathElement.hasAttribute('data-content')) {
                            mathElement.setAttribute('data-content', mathContent);
                        }

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
                        // 保存原始内容，用于复制时还原
                        if (!mathElement.hasAttribute('data-content')) {
                            mathElement.setAttribute('data-content', mathContent);
                        }

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

    // 为消息中的图片添加点击事件，调用图片查看器
    function setupImageClickHandlers(element: HTMLElement) {
        if (!element) return;

        tick().then(() => {
            try {
                // 查找所有图片 img
                const images = element.querySelectorAll(
                    '.ai-message__content img, .ai-message__thinking-content img'
                );

                images.forEach((img: HTMLImageElement) => {
                    // 检查是否已经添加过监听器
                    if (img.hasAttribute('data-image-viewer-listener')) {
                        return;
                    }

                    // 标记已添加监听器
                    img.setAttribute('data-image-viewer-listener', 'true');
                    img.style.cursor = 'zoom-in';

                    // 添加点击事件监听器
                    img.addEventListener('click', (event: Event) => {
                        event.preventDefault();
                        event.stopPropagation();

                        const src = img.getAttribute('src');
                        const alt = img.getAttribute('alt') || 'image';
                        if (src) {
                            openImageViewer(src, alt);
                        }
                    });
                });
            } catch (error) {
                console.error('Setup image click handlers error:', error);
            }
        });
    }

    // 复制单条消息
    function copyMessage(content: string | MessageContent[]) {
        const textContent = typeof content === 'string' ? content : getMessageText(content);
        navigator.clipboard
            .writeText(textContent)
            .then(() => {
                pushMsg(i18n('aiSidebar.success.copySuccess'));
            })
            .catch(err => {
                pushErrMsg(i18n('aiSidebar.errors.copyFailed'));
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

            // 检查是否包含公式元素
            const containsMath = !!div.querySelector(
                '.language-math, [data-subtype="math"], .katex'
            );

            // 检查是否在纯代码块内（开始和结束都在代码块内，且不包含公式）
            let isPureCodeBlock = false;
            if (!containsMath) {
                const startInCode = startElem && !!startElem.closest('pre, code');
                const endInCode = endElem && !!endElem.closest('pre, code');
                isPureCodeBlock = startInCode && endInCode;
            }

            // 如果是纯代码块选择（不包含公式），使用纯文本复制
            if (isPureCodeBlock) {
                const text = selection.toString();
                event.clipboardData?.setData('text/plain', text);
            } else {
                // 包含公式或混合内容，使用占位符方式处理
                const { html, placeholders } = extractMathFormulasToPlaceholders(div);

                // 使用思源的 Lute 将 HTML 转换为 Markdown
                if (window.Lute) {
                    const lute = window.Lute.New();
                    let markdown = lute.HTML2Md(html);

                    // 将占位符还原为公式
                    markdown = restorePlaceholdersToFormulas(markdown, placeholders);

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

    // 提取公式并替换为占位符，避免被 Lute 转义
    function extractMathFormulasToPlaceholders(container: HTMLElement): {
        html: string;
        placeholders: Map<string, string>;
    } {
        const placeholders = new Map<string, string>();
        let placeholderIndex = 0;

        // 生成唯一的占位符ID
        const generatePlaceholder = (formula: string, isBlock: boolean): string => {
            const id = `MATHFORMULA${placeholderIndex}ENDMATHFORMULA`;
            placeholderIndex++;
            placeholders.set(id, isBlock ? `\n$$\n${formula}\n$$\n` : `$${formula}$`);
            return id;
        };

        // 处理新格式的行内公式 span.language-math
        const inlineMathElements = Array.from(container.querySelectorAll('span.language-math'));
        inlineMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            if (!originalContent) {
                // 尝试从未渲染的元素中提取
                const mathSpans = mathElement.querySelectorAll('span.katex-mathml');
                if (mathSpans.length > 0) {
                    const annotation = mathSpans[0].querySelector(
                        'annotation[encoding="application/x-tex"]'
                    );
                    if (annotation) {
                        originalContent = annotation.textContent?.trim() || '';
                    }
                }
            }

            if (originalContent) {
                const placeholder = generatePlaceholder(originalContent, false);
                const textNode = document.createTextNode(placeholder);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理新格式的块级公式 div.language-math
        const blockMathElements = Array.from(container.querySelectorAll('div.language-math'));
        blockMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            if (!originalContent) {
                const mathSpans = mathElement.querySelectorAll('span.katex-mathml');
                if (mathSpans.length > 0) {
                    const annotation = mathSpans[0].querySelector(
                        'annotation[encoding="application/x-tex"]'
                    );
                    if (annotation) {
                        originalContent = annotation.textContent?.trim() || '';
                    }
                }
            }

            if (originalContent) {
                const placeholder = generatePlaceholder(originalContent, true);
                const textNode = document.createTextNode(placeholder);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理旧格式的公式元素（带 data-subtype="math" 属性）
        const oldMathElements = Array.from(container.querySelectorAll('[data-subtype="math"]'));
        oldMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            if (originalContent) {
                const placeholder = generatePlaceholder(originalContent, false);
                const textNode = document.createTextNode(placeholder);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理所有 KaTeX 渲染后的元素
        const katexElements = Array.from(container.querySelectorAll('.katex'));
        katexElements.forEach((katexElement: HTMLElement) => {
            // 检查是否已被处理
            if (!katexElement.parentNode) {
                return;
            }

            let originalContent = '';

            // 首先尝试从 KaTeX 的 MathML annotation 中获取
            const annotation = katexElement.querySelector(
                'annotation[encoding="application/x-tex"]'
            );
            if (annotation) {
                originalContent = annotation.textContent?.trim() || '';
            }

            // 如果没有，尝试从父元素的 data-content 获取
            if (!originalContent) {
                const parent = katexElement.parentElement;
                if (parent) {
                    originalContent = parent.getAttribute('data-content') || '';
                }
            }

            if (originalContent) {
                const isDisplay = katexElement.classList.contains('katex-display');
                const placeholder = generatePlaceholder(originalContent, isDisplay);
                const textNode = document.createTextNode(placeholder);
                katexElement.parentNode?.replaceChild(textNode, katexElement);
            }
        });

        return { html: container.innerHTML, placeholders };
    }

    // 将占位符还原为公式
    function restorePlaceholdersToFormulas(
        markdown: string,
        placeholders: Map<string, string>
    ): string {
        let result = markdown;

        // 按照占位符ID排序，确保按顺序替换
        const sortedPlaceholders = Array.from(placeholders.entries()).sort((a, b) => {
            const aNum = parseInt(a[0].match(/\d+/)?.[0] || '0');
            const bNum = parseInt(b[0].match(/\d+/)?.[0] || '0');
            return aNum - bNum;
        });

        sortedPlaceholders.forEach(([placeholder, formula]) => {
            // 使用全局替换，处理可能被 Lute 转义的情况
            result = result.split(placeholder).join(formula);
            // 也处理可能被转义的版本
            result = result.split(placeholder.replace(/\$/g, '\\$')).join(formula);
        });

        return result;
    }

    // 将渲染后的公式元素还原为 Markdown 格式（已弃用，保留以防需要）
    function restoreMathFormulasToMarkdown(container: HTMLElement) {
        // 处理新格式的行内公式 span.language-math
        const inlineMathElements = container.querySelectorAll('span.language-math');
        inlineMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            // 如果没有 data-content 属性，尝试从 KaTeX annotation 获取
            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            // 如果还是没有，尝试从原始 textContent 获取（渲染前的状态）
            if (!originalContent) {
                originalContent = mathElement.textContent?.trim() || '';
            }

            if (originalContent) {
                // 还原为行内公式格式 $...$
                const textNode = document.createTextNode(`$${originalContent}$`);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理新格式的块级公式 div.language-math
        const blockMathElements = container.querySelectorAll('div.language-math');
        blockMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            // 如果没有 data-content 属性，尝试从 KaTeX annotation 获取
            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            // 如果还是没有，尝试从原始 textContent 获取
            if (!originalContent) {
                originalContent = mathElement.textContent?.trim() || '';
            }

            if (originalContent) {
                // 还原为块级公式格式 $$...$$
                const textNode = document.createTextNode(`\n$$\n${originalContent}\n$$\n`);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理旧格式的公式元素（带 data-subtype="math" 属性）
        const oldMathElements = container.querySelectorAll('[data-subtype="math"]');
        oldMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            if (originalContent) {
                const textNode = document.createTextNode(`$${originalContent}$`);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理 KaTeX 渲染后的元素（包含 .katex class），这是最通用的处理方式
        const katexElements = container.querySelectorAll('.katex');
        katexElements.forEach((katexElement: HTMLElement) => {
            // 避免重复处理已经被上面逻辑处理过的元素
            if (!katexElement.parentNode) {
                return;
            }

            let originalContent = '';

            // 首先尝试从父元素的 data-content 获取
            const parent = katexElement.parentElement;
            if (parent) {
                originalContent = parent.getAttribute('data-content') || '';
            }

            // 如果没有，尝试从 annotation 标签中获取原始 LaTeX（KaTeX 渲染时会添加）
            if (!originalContent) {
                const annotation = katexElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            if (originalContent) {
                // 判断是行内还是块级公式
                const isDisplay = katexElement.classList.contains('katex-display');
                const textNode = isDisplay
                    ? document.createTextNode(`\n$$\n${originalContent}\n$$\n`)
                    : document.createTextNode(`$${originalContent}$`);

                // 如果父元素有特殊标记（如 language-math），替换父元素，否则替换 katex 元素本身
                if (
                    parent &&
                    (parent.classList.contains('language-math') ||
                        parent.hasAttribute('data-subtype'))
                ) {
                    parent.parentNode?.replaceChild(textNode, parent);
                } else {
                    katexElement.parentNode?.replaceChild(textNode, katexElement);
                }
            }
        });
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
                        await platformUtils.writeText(text);
                        pushMsg(i18n('aiSidebar.success.copySuccess'));
                    } catch (err) {
                        console.error('Copy multi-model response failed:', err);
                        pushErrMsg(i18n('aiSidebar.errors.copyFailed'));
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
                                await platformUtils.writeText(md);
                                pushMsg(i18n('aiSidebar.success.copySuccess'));
                            } else {
                                // 降级为纯文本
                                await platformUtils.writeText(selectionText);
                                pushMsg(i18n('aiSidebar.success.copySuccess'));
                            }
                        } else if (action === 'copy_plain') {
                            await platformUtils.writeText(selectionText);
                            pushMsg(i18n('aiSidebar.success.copySuccess'));
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
                                pushMsg(i18n('aiSidebar.success.copySuccess'));
                            } else {
                                // 回退到纯文本
                                await platformUtils.writeText(selectionText);
                                pushMsg(i18n('aiSidebar.success.copySuccess'));
                            }
                        }
                    } catch (err) {
                        console.error('Copy selection failed:', err);
                        pushErrMsg(i18n('aiSidebar.errors.copyFailed'));
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
                                    await platformUtils.writeText(md);
                                } else {
                                    await platformUtils.writeText(text);
                                }
                                pushMsg(i18n('aiSidebar.success.copySuccess'));
                            } else if (action === 'copy_plain') {
                                await platformUtils.writeText(text);
                                pushMsg(i18n('aiSidebar.success.copySuccess'));
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
                                    await platformUtils.writeText(text);
                                }
                                pushMsg(i18n('aiSidebar.success.copySuccess'));
                            }
                        } catch (err) {
                            console.error('Copy multi-model content failed:', err);
                            pushErrMsg(i18n('aiSidebar.errors.copyFailed'));
                        }
                    } else {
                        pushErrMsg(i18n('aiSidebar.errors.noSelection'));
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
            pushMsg(i18n('aiSidebar.success.documentExists'));
            return;
        }

        try {
            // agent模式或启用工具的问答模式下，文档只存储块ID
            if (chatMode === 'agent' || (chatMode === 'ask' && userToolCount > 0)) {
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
            pushErrMsg(i18n('aiSidebar.errors.addDocumentFailed'));
        }
    }

    // 一键添加当前文档到上下文
    async function addCurrentDocToContext() {
        const currentProtyle = getActiveEditor(false)?.protyle;
        const blockId = currentProtyle?.block?.id;
        if (!blockId) {
            pushErrMsg(i18n('aiSidebar.errors.noActiveDocument'));
            return;
        }
        const blocks = await sql(
            `SELECT * FROM blocks WHERE id = '${blockId}' OR root_id = '${blockId}'`
        );
        const docBlock = blocks?.find(b => b.type === 'd');
        if (!docBlock) {
            const rootId = blocks?.[0]?.root_id;
            if (rootId) {
                const rootBlocks = await sql(
                    `SELECT * FROM blocks WHERE id = '${rootId}' AND type = 'd'`
                );
                if (rootBlocks?.[0]) {
                    await addDocumentToContext(
                        rootBlocks[0].id,
                        rootBlocks[0].content || rootBlocks[0].fcontent || rootBlocks[0].id
                    );
                    return;
                }
            }
            pushErrMsg(i18n('aiSidebar.errors.noActiveDocument'));
            return;
        }
        await addDocumentToContext(
            docBlock.id,
            docBlock.content || docBlock.fcontent || docBlock.id
        );
    }

    // 基于已有上下文文档直接发送总结请求
    async function summarizeContextDoc() {
        if (contextDocuments.length === 0) return;
        currentInput = i18n('menu.summarizePrompt');
        await tick();
        sendMessage();
    }

    // 处理文档总结事件（从右键菜单触发）
    async function handleSummarizeDoc(event: CustomEvent) {
        const { docId } = event.detail;
        if (!docId) return;
        try {
            const blocks = await sql(`SELECT * FROM blocks WHERE id = '${docId}' AND type = 'd'`);
            const docBlock = blocks?.[0];
            if (!docBlock) return;
            const docTitle = docBlock.content || docBlock.fcontent || docId;
            // 添加文档到上下文
            await addDocumentToContext(docId, docTitle);
            // 设置输入并自动发送
            await tick();
            currentInput = i18n('menu.summarizePrompt');
            await tick();
            sendMessage();
        } catch (error) {
            console.error('Summarize doc error:', error);
            pushErrMsg(i18n('aiSidebar.errors.addDocumentFailed'));
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

            const safeTargetBlockId = targetBlockId.replace(/'/g, "''");
            const blocks = await sql(`
                SELECT b.id, b.type, b.content, b.root_id, d.content AS root_doc_content
                FROM blocks b
                LEFT JOIN blocks d ON d.id = b.root_id AND d.type = 'd'
                WHERE b.id = '${safeTargetBlockId}'
                LIMIT 1
            `);
            if (blocks && blocks.length > 0) {
                const block = blocks[0];
                let docId = targetBlockId;
                let docTitle = i18n('common.untitled');

                // 如果是文档块，直接添加
                if (block.type === 'd') {
                    docTitle = block.content || i18n('common.untitled');
                    await addDocumentToContext(docId, docTitle);
                } else {
                    // 普通块：文档标题已在联查中拿到
                    docTitle = block.root_doc_content || i18n('common.untitled');
                    // 添加该块的内容
                    await addBlockToContext(targetBlockId, docTitle, false);
                }
            }
        } catch (error) {
            console.error('Add block error:', error);
            pushErrMsg(i18n('aiSidebar.errors.addBlockFailed'));
        }
    }

    // 添加块到上下文（而不是整个文档）
    async function addBlockToContext(blockId: string, blockTitle: string, isDocOverride?: boolean) {
        // 检查是否已存在
        if (contextDocuments.find(doc => doc.id === blockId)) {
            pushMsg(i18n('aiSidebar.success.blockExists'));
            return;
        }

        try {
            // 优先复用调用方传入的块类型，避免重复查询
            let isDoc = isDocOverride === true;
            if (isDocOverride === undefined) {
                const blockInfo = await getBlockByID(blockId);
                isDoc = blockInfo?.type === 'd'; // 'd' 表示文档块
            }

            // agent模式或启用工具的问答模式：获取kramdown格式（用于AI），但使用Markdown生成显示标题
            if (chatMode === 'agent' || (chatMode === 'ask' && userToolCount > 0)) {
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
                                : contentPreview || blockTitle || (isDoc ? '文档内容' : '块内容');
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

                            // 使用统一的图片附件添加逻辑（包含保存到资源目录）
                            await addImageAttachment(file);

                            pushMsg(i18n('aiSidebar.success.imageAutoUploaded'));
                            return; // 图片已作为附件添加，不需要再添加为上下文文档
                        } else {
                            console.warn('无法加载图片，将作为普通块处理');
                        }
                    } catch (error) {
                        console.error('自动上传图片失败:', error);
                        pushErrMsg(i18n('aiSidebar.errors.autoUploadImageFailed'));
                        // 失败时继续作为普通块处理
                    }
                }

                // 不是纯图片块或上传失败，按照原有逻辑处理
                // 从块内容中提取前20个字作为显示标题
                const contentPreview = data.content.replace(/\n/g, ' ').trim();
                const displayTitle =
                    contentPreview.length > 20
                        ? contentPreview.substring(0, 20) + '...'
                        : contentPreview || blockTitle || (isDoc ? '文档内容' : '块内容');

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
            pushErrMsg(i18n('aiSidebar.errors.addBlockContentFailed'));
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
            pushErrMsg(i18n('aiSidebar.errors.openDocumentFailed'));
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

        // 处理标准文件拖放
        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
            await addFilesInBatches(Array.from(files));
            return;
        }

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

            // 检查是否是 webview 网页标签页
            // payload 中没有 type 字段，需要通过 customModelType 判断
            const customModelType = payload?.children?.customModelType;
            const tabTitle = payload?.title;
            const webviewUrl = payload?.children?.customModelData?.app?.url;

            // 判断是否是 webview 网页标签页：customModelType 包含 copilot-webapp
            const isWebViewTab = customModelType && customModelType.includes(WEBAPP_TAB_TYPE);
            console.log(isWebViewTab, webviewUrl);
            console.log(payload);
            if (isWebViewTab && webviewUrl) {
                // 是 webview 网页，直接使用 WebView 模式获取内容（因为已经是 webview 打开的）
                pushMsg(`正在获取网页内容: ${tabTitle || webviewUrl}`);

                try {
                    const webviewResult = await fetchWithWebView(webviewUrl);

                    if (webviewResult.success && webviewResult.markdown) {
                        // 从 URL 中提取文件名
                        const urlObj = new URL(webviewUrl);
                        const fileName = `${urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.md`;

                        // 保存为 SiYuan 资源
                        const assetPath = await saveAsset(
                            new Blob([webviewResult.markdown], { type: 'text/markdown' }),
                            fileName
                        );

                        // 添加到附件列表，标记为网页类型（与添加网页链接弹窗一致）
                        currentAttachments = [
                            ...currentAttachments,
                            {
                                type: 'file',
                                name: webviewUrl,
                                data: webviewResult.markdown,
                                path: assetPath,
                                mimeType: 'text/markdown',
                                isWebPage: true, // 标记为网页附件
                                url: webviewUrl, // 保存原始URL
                            },
                        ];

                        pushMsg(`✓ 成功添加网页: ${webviewResult.title || tabTitle || webviewUrl}`);
                    } else {
                        pushErrMsg(`✗ 获取失败: ${webviewUrl} - ${webviewResult.error}`);
                    }
                } catch (error) {
                    console.error('获取网页内容失败:', error);
                    pushErrMsg(
                        `✗ 获取网页失败: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            } else {
                // 普通文档标签页
                const rootId = payload?.children?.rootId;
                if (rootId) {
                    await addItemByBlockId(rootId, false);
                }
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
            // 会话迁移已在 index.ts 的 loadSettings 中统一处理
        } catch (error) {
            console.error('Load sessions error:', error);
            sessions = [];
        }
    }

    async function saveSessions() {
        try {
            // 只保存 metadata 到 chat-sessions.json
            const metadata = sessions.map(s => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { messages, ...rest } = s;
                return {
                    ...rest,
                    messageCount:
                        s.messageCount ||
                        (s.messages ? s.messages.filter(m => m.role !== 'system').length : 0),
                };
            });
            await plugin.saveData('chat-sessions.json', { sessions: metadata });
        } catch (error) {
            console.error('Save sessions error:', error);
            pushErrMsg(i18n('aiSidebar.errors.saveSessionFailed'));
        }
    }

    function generateSessionTitle(): string {
        const userMessages = messages.filter(m => m.role === 'user');
        if (userMessages.length > 0) {
            const firstMessage = getMessageText(userMessages[0].content);
            return firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
        }
        return i18n('aiSidebar.session.new');
    }

    // 保存会话的锁，防止并发保存导致竞态条件
    let isSavingSession = false;
    let pendingSaveSilent: boolean | null = null;

    async function saveCurrentSession(silent: boolean = false) {
        if (messages.filter(m => m.role !== 'system').length === 0) {
            if (!silent) {
                pushErrMsg(i18n('aiSidebar.errors.emptySession'));
            }
            return;
        }

        // 如果正在保存，标记待处理的保存请求
        if (isSavingSession) {
            pendingSaveSilent = silent;
            return;
        }

        isSavingSession = true;

        try {
            const now = Date.now();

            // 【修复】在保存前重新加载最新的会话列表，避免多页签覆盖问题
            await loadSessions();

            if (currentSessionId) {
                // 更新现有会话
                const session = sessions.find(s => s.id === currentSessionId);
                if (session) {
                    session.updatedAt = now;
                    session.messageCount = messages.filter(m => m.role !== 'system').length;

                    // 1. 保存 metadata 列表
                    await saveSessions();

                    // 2. 将消息中的 Blob URL 转换为 path 以便永久存储
                    const messagesToSave = messages.map(msg => ({
                        ...msg,
                        attachments: msg.attachments?.map(att => ({
                            ...att,
                            data: att.path ? '' : att.data, // 如果有 path，清空 data
                        })),
                        generatedImages: msg.generatedImages?.map(img => ({
                            ...img,
                            data: '', // 不再这里存 base64
                        })),
                    }));

                    // 3. 保存完整内容到独立文件
                    const sessionPath = `/data/storage/petal/siyuan-plugin-copilot/sessions/${currentSessionId}.json`;
                    const sessionContent = JSON.stringify({ messages: messagesToSave }, null, 2);
                    const sessionBlob = new Blob([sessionContent], { type: 'application/json' });
                    await putFile(sessionPath, false, sessionBlob);
                } else {
                    // 如果会话不存在，创建为新会话
                    const userContent = messages.find(m => m.role === 'user')?.content || '';
                    const newSession: ChatSession = {
                        id: currentSessionId,
                        title:
                            typeof userContent === 'string'
                                ? userContent.substring(0, 30)
                                : generateSessionTitle(),
                        messageCount: messages.filter(m => m.role !== 'system').length,
                        createdAt: now,
                        updatedAt: now,
                    };
                    sessions = [newSession, ...sessions];
                    await saveSessions();

                    // 保存完整内容
                    const messagesToSave = messages.map(msg => ({
                        ...msg,
                        attachments: msg.attachments?.map(att => ({
                            ...att,
                            data: att.path ? '' : att.data,
                        })),
                        generatedImages: msg.generatedImages?.map(img => ({
                            ...img,
                            data: '',
                        })),
                    }));
                    const sessionPath = `/data/storage/petal/siyuan-plugin-copilot/sessions/${currentSessionId}.json`;
                    const sessionContent = JSON.stringify({ messages: messagesToSave }, null, 2);
                    const sessionBlob = new Blob([sessionContent], { type: 'application/json' });
                    await putFile(sessionPath, false, sessionBlob);
                }
            } else {
                // 创建新会话
                const userContent = messages.find(m => m.role === 'user')?.content || '';
                const newSession: ChatSession = {
                    id: `session_${now}`,
                    title:
                        typeof userContent === 'string'
                            ? userContent.substring(0, 30)
                            : generateSessionTitle(),
                    messageCount: messages.filter(m => m.role !== 'system').length,
                    createdAt: now,
                    updatedAt: now,
                };
                sessions = [newSession, ...sessions];
                currentSessionId = newSession.id;
                await saveSessions();

                // 保存完整内容
                const messagesToSave = messages.map(msg => ({
                    ...msg,
                    attachments: msg.attachments?.map(att => ({
                        ...att,
                        data: att.path ? '' : att.data,
                    })),
                    generatedImages: msg.generatedImages?.map(img => ({
                        ...img,
                        data: '',
                    })),
                }));
                const sessionPath = `/data/storage/petal/siyuan-plugin-copilot/sessions/${newSession.id}.json`;
                const sessionContent = JSON.stringify({ messages: messagesToSave }, null, 2);
                const sessionBlob = new Blob([sessionContent], { type: 'application/json' });
                await putFile(sessionPath, false, sessionBlob);
            }
            hasUnsavedChanges = false;

            if (!silent) {
                pushMsg(i18n('aiSidebar.success.saveSessionSuccess'));
            }
        } finally {
            isSavingSession = false;
            // 如果有待处理的保存请求，执行它
            if (pendingSaveSilent !== null) {
                const silentToUse = pendingSaveSilent;
                pendingSaveSilent = null;
                await saveCurrentSession(silentToUse);
            }
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
                const updatedMultiModelResponses = multiModelResponses.map((response, i) => ({
                    ...response,
                    isSelected: i === firstSuccessIndex,
                    modelName:
                        i === firstSuccessIndex ? ' ✅' + response.modelName : response.modelName,
                }));

                const lastMessage = messages[messages.length - 1];
                if (
                    lastMessage &&
                    lastMessage.role === 'assistant' &&
                    lastMessage.multiModelResponses
                ) {
                    lastMessage.content = selectedResponse.content || '';
                    lastMessage.thinking = selectedResponse.thinking || '';
                    lastMessage.multiModelResponses = updatedMultiModelResponses;
                    messages = [...messages];
                } else {
                    const assistantMessage: Message = {
                        role: 'assistant',
                        content: selectedResponse.content || '',
                        thinking: selectedResponse.thinking,
                        multiModelResponses: updatedMultiModelResponses,
                    };
                    messages = [...messages, assistantMessage];
                }
                hasUnsavedChanges = true;
            }
        }

        if (hasUnsavedChanges) {
            confirm(
                i18n('aiSidebar.confirm.switchSession.title'),
                i18n('aiSidebar.confirm.switchSession.message'),
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
        const sessionMetadata = sessions.find(s => s.id === sessionId);
        if (sessionMetadata) {
            try {
                // 加载完整内容 (使用 getFileBlob 因为 saveData 路径不一致，或者由于前缀问题)
                // 或者继续使用 loadData 但它是相对的。
                // 如果我们用 putFile 存了，我们也应该用对应的 read 方式。
                const path = `/data/storage/petal/siyuan-plugin-copilot/sessions/${sessionId}.json`;
                const blob = await getFileBlob(path);
                if (!blob) throw new Error('File not found');
                const text = await blob.text();
                const sessionData = JSON.parse(text);
                const loadedMessages = sessionData?.messages || [];
                let sessionModified = false; // 标记会话是否被修改（需要重新保存）

                // 还原图片数据 (从 path 还原为 blob url) 和文本附件数据
                // 同时处理旧的 base64 格式图片，自动保存到 assets
                for (const msg of loadedMessages) {
                    // 处理 content 中的 Markdown 格式 base64 图片
                    if (typeof msg.content === 'string' && msg.content.includes('data:image')) {
                        const base64ImageRegex =
                            /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
                        let match;
                        const imagesToProcess: Array<{
                            fullMatch: string;
                            altText: string;
                            dataUrl: string;
                        }> = [];

                        // 收集所有需要处理的图片
                        while ((match = base64ImageRegex.exec(msg.content)) !== null) {
                            imagesToProcess.push({
                                fullMatch: match[0],
                                altText: match[1] || 'image',
                                dataUrl: match[2],
                            });
                        }

                        // 处理每个图片
                        if (imagesToProcess.length > 0) {
                            let newContent = msg.content;

                            for (const imageInfo of imagesToProcess) {
                                try {
                                    // 解析 data URL
                                    const matches = imageInfo.dataUrl.match(
                                        /^data:([^;]+);base64,(.+)$/
                                    );
                                    if (!matches) continue;

                                    const mimeType = matches[1];
                                    const base64Data = matches[2];

                                    // 保存到 assets
                                    const blob = base64ToBlob(base64Data, mimeType);
                                    const ext = mimeType.split('/')[1] || 'png';
                                    const assetPath = await saveAsset(
                                        blob,
                                        `image-${Date.now()}.${ext}`
                                    );

                                    // 替换为 assets 路径，保持 Markdown 格式
                                    newContent = newContent.replace(
                                        imageInfo.fullMatch,
                                        `![${imageInfo.altText}](${assetPath})`
                                    );

                                    sessionModified = true;
                                    console.log(
                                        `Migrated content base64 image to assets: ${assetPath}`
                                    );
                                } catch (error) {
                                    console.error('Failed to migrate content base64 image:', error);
                                }
                            }

                            // 更新消息内容
                            if (sessionModified) {
                                msg.content = newContent;
                            }
                        }
                    }

                    if (msg.attachments) {
                        for (const att of msg.attachments) {
                            if (att.type === 'image') {
                                if (att.path) {
                                    // 从路径加载图片
                                    att.data = (await loadAsset(att.path)) || '';
                                } else if (
                                    att.data &&
                                    (att.data.startsWith('data:image') || att.data.length > 1000)
                                ) {
                                    // 旧格式：有 base64 数据但没有 path，自动迁移到 assets
                                    try {
                                        let base64Data = att.data;
                                        let mimeType = att.mimeType || 'image/png';

                                        // 如果是 data URL，提取 mime type 和数据
                                        if (base64Data.startsWith('data:')) {
                                            const matches = base64Data.match(
                                                /^data:([^;]+);base64,(.+)$/
                                            );
                                            if (matches) {
                                                mimeType = matches[1];
                                                base64Data = matches[2];
                                            }
                                        }

                                        const blob = base64ToBlob(base64Data, mimeType);
                                        const ext = mimeType.split('/')[1] || 'png';
                                        const name = att.name || `image-${Date.now()}.${ext}`;
                                        const assetPath = await saveAsset(blob, name);

                                        // 更新附件信息
                                        att.path = assetPath;
                                        att.data = URL.createObjectURL(blob); // 设置为 blob URL
                                        att.mimeType = mimeType;

                                        sessionModified = true;
                                        console.log(
                                            `Migrated attachment base64 image to assets: ${assetPath}`
                                        );
                                    } catch (error) {
                                        console.error(
                                            'Failed to migrate attachment base64 image:',
                                            error
                                        );
                                    }
                                }
                            } else if (att.path) {
                                // 还原文本附件内容
                                att.data = (await readAssetAsText(att.path)) || '';
                            }
                        }
                    }

                    if (msg.generatedImages) {
                        for (const img of msg.generatedImages) {
                            if (img.path) {
                                // 从路径加载图片
                                img.previewUrl = (await loadAsset(img.path)) || '';
                            } else if (img.data && img.data.length > 0) {
                                // 旧格式：有 base64 数据但没有 path，自动迁移到 assets
                                try {
                                    const blob = base64ToBlob(
                                        img.data,
                                        img.mimeType || 'image/png'
                                    );
                                    const name = createGeneratedImageFileName(
                                        img.mimeType || 'image/png'
                                    );
                                    const assetPath = await saveAsset(blob, name);

                                    // 更新图片信息
                                    img.path = assetPath;
                                    img.data = ''; // 清空 base64 数据
                                    img.previewUrl = URL.createObjectURL(blob);

                                    // 同时更新 attachments（如果存在）
                                    if (msg.attachments) {
                                        const attIndex = msg.attachments.findIndex(
                                            a => a.type === 'image' && !a.path
                                        );
                                        if (attIndex !== -1) {
                                            msg.attachments[attIndex].path = assetPath;
                                            msg.attachments[attIndex].data =
                                                URL.createObjectURL(blob);
                                        }
                                    }

                                    sessionModified = true;
                                    console.log(`Migrated generated image to assets: ${assetPath}`);
                                } catch (error) {
                                    console.error('Failed to migrate generated image:', error);
                                }
                            }
                        }
                    }
                }

                messages = [...loadedMessages];

                // 【修复】检查多模型响应是否缺少选择，自动设置第一个非错误模型为选中
                for (const msg of messages) {
                    if (
                        msg.role === 'assistant' &&
                        msg.multiModelResponses &&
                        msg.multiModelResponses.length > 0
                    ) {
                        const hasSelected = msg.multiModelResponses.some(r => r.isSelected);
                        if (!hasSelected) {
                            // 找到第一个没有错误的响应
                            const firstSuccessIndex = msg.multiModelResponses.findIndex(
                                r => !r.error && r.content
                            );
                            if (firstSuccessIndex !== -1) {
                                // 设置第一个成功的模型为选中
                                msg.multiModelResponses.forEach((response, i) => {
                                    response.isSelected = i === firstSuccessIndex;
                                    if (i === firstSuccessIndex) {
                                        // 更新主 content 为选中的内容
                                        msg.content = response.content || '';
                                        msg.thinking = response.thinking || '';
                                        // 添加 ✅ 标记（如果还没有）
                                        if (!response.modelName.startsWith('✅')) {
                                            response.modelName = '✅' + response.modelName;
                                        }
                                    }
                                });
                                sessionModified = true;
                                console.log(
                                    `Auto-selected first successful model (index ${firstSuccessIndex}) for message`
                                );
                            }
                        }
                    }
                }

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

                // 如果会话被修改（迁移了 base64 图片或自动选择了模型），自动保存
                if (sessionModified) {
                    console.log('Session was modified during load, saving...');
                    await saveCurrentSession(true); // 静默保存
                }

                // 清除多模型状态
                multiModelResponses = [];
                isWaitingForAnswerSelection = false;
                selectedAnswerIndex = null;
                selectedTabIndex = 0;

                // 切换到历史会话时默认显示最开头（最早消息）而不是底部
                await scrollToTop();
            } catch (e) {
                console.error('Failed to load session content:', e);
                pushErrMsg('加载会话失败');
            }
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
                const selectedResponse = multiModelResponses[firstSuccessIndex];
                const updatedMultiModelResponses = multiModelResponses.map((response, i) => ({
                    ...response,
                    isSelected: i === firstSuccessIndex, // 标记第一个成功的为默认选择
                    modelName:
                        i === firstSuccessIndex ? ' ✅' + response.modelName : response.modelName,
                }));

                const lastMessage = messages[messages.length - 1];
                if (
                    lastMessage &&
                    lastMessage.role === 'assistant' &&
                    lastMessage.multiModelResponses
                ) {
                    lastMessage.content = selectedResponse.content || '';
                    lastMessage.thinking = selectedResponse.thinking || '';
                    lastMessage.multiModelResponses = updatedMultiModelResponses;
                    messages = [...messages];
                } else {
                    // 创建assistant消息，保存所有多模型响应
                    const assistantMessage: Message = {
                        role: 'assistant',
                        content: '', // 不显示单独的内容
                        multiModelResponses: updatedMultiModelResponses,
                    };
                    messages = [...messages, assistantMessage];
                }
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
            i18n('aiSidebar.confirm.deleteSession.title'),
            i18n('aiSidebar.confirm.deleteSession.message'),
            async () => {
                // 【修复】删除前重新加载最新的会话列表，避免多页签覆盖问题
                await loadSessions();
                sessions = sessions.filter(s => s.id !== sessionId);
                await saveSessions();

                // 删除独立会话文件 (SiYuan removeFile 路径相对于 workspace root)
                try {
                    await removeFile(
                        `/data/storage/petal/siyuan-plugin-copilot/sessions/${sessionId}.json`
                    );
                } catch (e) {
                    // 忽略错误
                }

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

                // 批量删除独立会话文件
                for (const id of sessionIds) {
                    try {
                        await removeFile(
                            `/data/storage/petal/siyuan-plugin-copilot/sessions/${id}.json`
                        );
                    } catch (e) {
                        // 忽略错误
                    }
                }

                // 如果当前会话被删除，创建新会话
                if (sessionIds.includes(currentSessionId)) {
                    doNewSession();
                }

                pushMsg(`成功删除 ${count} 个会话`);
            }
        );
    }

    // 加载指定会话的可搜索文本（用户与AI的全部对话内容），用于会话管理面板的搜索
    async function loadSessionSearchableText(sessionId: string): Promise<string> {
        try {
            const path = `/data/storage/petal/siyuan-plugin-copilot/sessions/${sessionId}.json`;
            const blob = await getFileBlob(path);
            if (!blob) return '';
            const text = await blob.text();
            const sessionData = JSON.parse(text);
            const sessionMessages: Message[] = sessionData?.messages || [];
            const parts: string[] = [];
            for (const msg of sessionMessages) {
                if (!msg || msg.role === 'system') continue;
                if (typeof msg.content === 'string') {
                    parts.push(msg.content);
                } else if (Array.isArray(msg.content)) {
                    for (const part of msg.content as any[]) {
                        if (part && part.type === 'text' && typeof part.text === 'string') {
                            parts.push(part.text);
                        }
                    }
                }
                if (typeof msg.thinking === 'string' && msg.thinking) {
                    parts.push(msg.thinking);
                }
            }
            return parts.join('\n');
        } catch (error) {
            console.error('Load session searchable text error:', sessionId, error);
            return '';
        }
    }

    // 处理保存会话到笔记
    async function handleSaveSessionToNote(sessionId: string) {
        try {
            // 加载会话消息
            const path = `/data/storage/petal/siyuan-plugin-copilot/sessions/${sessionId}.json`;
            const blob = await getFileBlob(path);
            if (!blob) {
                pushErrMsg('会话文件不存在');
                return;
            }
            const text = await blob.text();
            const sessionData = JSON.parse(text);
            const sessionMessages = sessionData?.messages || [];

            if (sessionMessages.length === 0) {
                pushErrMsg(i18n('aiSidebar.errors.emptySession'));
                return;
            }

            // 临时保存当前消息
            const originalMessages = messages;
            const originalSessionId = currentSessionId;

            // 临时设置会话消息
            messages = sessionMessages;
            currentSessionId = sessionId;

            // 打开保存对话框（传入 null 表示保存整个会话）
            await openSaveToNoteDialog(null);

            // 恢复原来的消息和会话ID
            messages = originalMessages;
            currentSessionId = originalSessionId;
        } catch (error) {
            console.error('Save session to note error:', error);
            pushErrMsg('加载会话失败: ' + error.message);
        }
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
            pushErrMsg(i18n('aiSidebar.errors.emptySession'));
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

            pushMsg(i18n('aiSidebar.success.saveToNoteSuccess'));
            closeSaveToNoteDialog();

            // 如果选择了保存后打开笔记，则打开文档
            if (openAfterSave && docId) {
                try {
                    await openBlock(docId);
                } catch (error) {
                    console.error('Open document error:', error);
                    pushErrMsg(i18n('aiSidebar.errors.openDocumentFailed'));
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
            window.dispatchEvent(
                new CustomEvent(PROMPTS_SYNC_EVENT, {
                    detail: { sourceId: promptSyncSourceId, updatedAt: Date.now() },
                })
            );
        } catch (error) {
            console.error('Save prompts error:', error);
            pushErrMsg(i18n('aiSidebar.errors.savePromptFailed'));
        }
    }

    async function togglePromptSelector() {
        const shouldOpen = !isPromptSelectorOpen;
        if (shouldOpen) {
            await loadPrompts();
        }
        isPromptSelectorOpen = shouldOpen;
    }

    async function handlePromptsUpdated(event: Event) {
        const detail = (event as CustomEvent<{ sourceId?: string }>).detail;
        if (detail?.sourceId === promptSyncSourceId) {
            return;
        }
        await loadPrompts();
    }

    function handlePromptDragStart(event: DragEvent, promptId: string) {
        draggingPromptId = promptId;
        promptDropTargetId = null;
        promptDropAtEnd = false;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', promptId);
        }
    }

    function handlePromptItemDragOver(event: DragEvent, promptId: string) {
        if (!draggingPromptId || draggingPromptId === promptId) {
            return;
        }
        event.preventDefault();
        promptDropTargetId = promptId;
        promptDropAtEnd = false;
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    }

    function handlePromptListDragOver(event: DragEvent) {
        if (!draggingPromptId) {
            return;
        }
        event.preventDefault();
        promptDropTargetId = null;
        promptDropAtEnd = true;
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    }

    async function reorderPromptBeforeTarget(targetPromptId: string) {
        if (!draggingPromptId || draggingPromptId === targetPromptId) {
            return;
        }
        const sourceIndex = prompts.findIndex(p => p.id === draggingPromptId);
        const targetIndex = prompts.findIndex(p => p.id === targetPromptId);
        if (sourceIndex < 0 || targetIndex < 0) {
            return;
        }

        const reordered = [...prompts];
        const [movedPrompt] = reordered.splice(sourceIndex, 1);
        if (!movedPrompt) {
            return;
        }
        const insertIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
        reordered.splice(insertIndex, 0, movedPrompt);

        prompts = reordered;
        suppressPromptClickOnce = true;
        await savePrompts();
    }

    async function movePromptToEnd() {
        if (!draggingPromptId) {
            return;
        }
        const sourceIndex = prompts.findIndex(p => p.id === draggingPromptId);
        if (sourceIndex < 0 || sourceIndex === prompts.length - 1) {
            return;
        }

        const reordered = [...prompts];
        const [movedPrompt] = reordered.splice(sourceIndex, 1);
        if (!movedPrompt) {
            return;
        }
        reordered.push(movedPrompt);

        prompts = reordered;
        suppressPromptClickOnce = true;
        await savePrompts();
    }

    async function handlePromptItemDrop(event: DragEvent, targetPromptId: string) {
        event.preventDefault();
        await reorderPromptBeforeTarget(targetPromptId);
        promptDropTargetId = null;
        promptDropAtEnd = false;
    }

    async function handlePromptListDrop(event: DragEvent) {
        event.preventDefault();
        await movePromptToEnd();
        promptDropTargetId = null;
        promptDropAtEnd = false;
    }

    function handlePromptDragEnd() {
        draggingPromptId = null;
        promptDropTargetId = null;
        promptDropAtEnd = false;
        setTimeout(() => {
            suppressPromptClickOnce = false;
        }, 0);
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
            pushErrMsg(i18n('aiSidebar.errors.emptyPromptContent'));
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
            prompts = [...prompts, newPrompt];
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

    // 删除提示词
    async function deletePrompt(promptId: string) {
        confirm(
            i18n('aiSidebar.confirm.deletePrompt.title'),
            i18n('aiSidebar.confirm.deletePrompt.message'),
            async () => {
                prompts = prompts.filter(p => p.id !== promptId);
                await savePrompts();
            }
        );
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
            // 加载所有工具的 autoApprove 配置（包括未选中的工具）
            if (data?.toolAutoApproveSettings && typeof data.toolAutoApproveSettings === 'object') {
                toolAutoApproveSettings = data.toolAutoApproveSettings;
            } else {
                toolAutoApproveSettings = {};
            }
            if (data?.selectedToolsAsk && Array.isArray(data.selectedToolsAsk)) {
                selectedToolsAsk = data.selectedToolsAsk;
            } else {
                selectedToolsAsk = [];
            }
            if (
                data?.toolAutoApproveSettingsAsk &&
                typeof data.toolAutoApproveSettingsAsk === 'object'
            ) {
                toolAutoApproveSettingsAsk = data.toolAutoApproveSettingsAsk;
            } else {
                toolAutoApproveSettingsAsk = {};
            }
            // 初始化快照，避免初次加载触发自动保存
            lastSavedToolsConfigSnapshot = JSON.stringify({
                selectedTools: selectedTools || [],
                toolAutoApproveSettings: toolAutoApproveSettings || {},
                selectedToolsAsk: selectedToolsAsk || [],
                toolAutoApproveSettingsAsk: toolAutoApproveSettingsAsk || {},
            });
        } catch (error) {
            console.error('[ToolConfig] Load error:', error);
            selectedTools = [];
            toolAutoApproveSettings = {};
            selectedToolsAsk = [];
            toolAutoApproveSettingsAsk = {};
            lastSavedToolsConfigSnapshot = JSON.stringify({
                selectedTools: [],
                toolAutoApproveSettings: {},
                selectedToolsAsk: [],
                toolAutoApproveSettingsAsk: {},
            });
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

        const currentConfig = {
            selectedTools: selectedTools || [],
            toolAutoApproveSettings: toolAutoApproveSettings || {},
            selectedToolsAsk: selectedToolsAsk || [],
            toolAutoApproveSettingsAsk: toolAutoApproveSettingsAsk || {},
        };
        const currentSnapshot = JSON.stringify(currentConfig);
        // 配置未变化时不落盘，避免安装后自动生成配置文件
        if (currentSnapshot === lastSavedToolsConfigSnapshot) {
            return;
        }

        try {
            await plugin.saveData('agent-tools-config.json', currentConfig);
            lastSavedToolsConfigSnapshot = currentSnapshot;
        } catch (error) {
            console.error('[ToolConfig] Save error:', error);
        }
    }

    // 监听工具选择变化，自动保存
    $: {
        // 只在配置加载完成后，且确实有变化时才保存
        if (isToolConfigLoaded && (selectedTools || selectedToolsAsk)) {
            // 使用 tick 确保在下一个事件循环保存，避免频繁保存
            tick().then(() => {
                saveToolsConfig();
            });
        }
    }

    // 监听 autoApprove 设置变化，自动保存
    $: {
        // 只在配置加载完成后，且确实有变化时才保存
        if (isToolConfigLoaded && toolAutoApproveSettings) {
            // 使用 tick 确保在下一个事件循环保存，避免频繁保存
            tick().then(() => {
                saveToolsConfig();
            });
        }
    }

    // 获取工具的显示名称
    function getToolDisplayName(toolName: string): string {
        const key = `tools.${toolName}.name`;
        const name = i18n(key);
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
        if (suppressPromptClickOnce) {
            suppressPromptClickOnce = false;
            return;
        }
        currentInput = prompt.content +'\n'+ currentInput;
        isPromptSelectorOpen = false;
        tick().then(() => {
            autoResizeTextarea();
            if (textareaElement) {
                textareaElement.focus();
                const cursorPos = prompt.content.length;
                textareaElement.setSelectionRange(cursorPos, cursorPos);
            }
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

        // 关闭小程序菜单
        if (showWebAppMenu && !target.closest('.ai-sidebar__webapp-menu-container')) {
            showWebAppMenu = false;
            document.removeEventListener('click', closeWebAppMenuOnOutsideClick);
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

        // 关闭图片查看器
        if (isImageViewerOpen && !target.closest('.image-viewer')) {
            // 确保不是点击了触发开启图片的元素
            if (
                !target.closest('.ai-message__content img') &&
                !target.closest('.ai-message__thinking-content img') &&
                !target.closest('.ai-message__attachment-image')
            ) {
                closeImageViewer();
            }
        }
    }

    function normalizeOperationContentForDiff(content: string) {
        return content.replace(/\{:\s*id="[^"]+"\s*\}/g, '').trim();
    }

    type ToolChangeContext = {
        operationType: 'update' | 'insert' | 'delete' | 'rename';
        docId: string;
        docTitle: string;
        oldDocTitle: string;
        affectedBlockId: string;
        renameTitleTo?: string;
    };

    function escapeSqlString(value: string) {
        return value.replace(/'/g, "''");
    }

    async function getDocDisplayTitle(docId: string): Promise<string> {
        try {
            const hpath = await getHPathByID(docId);
            if (typeof hpath === 'string' && hpath.trim() && hpath !== docId) {
                return hpath;
            }
        } catch (error) {
            console.warn('获取文档路径失败:', error);
        }

        try {
            const docBlock = await getBlockByID(docId);
            if (docBlock?.content) {
                return docBlock.content;
            }
        } catch (error) {
            console.warn('通过 getBlockByID 获取文档标题失败:', error);
        }

        try {
            const safeDocId = escapeSqlString(docId);
            const rows = await sql(`SELECT content FROM blocks WHERE id = '${safeDocId}' LIMIT 1`);
            const title = rows?.[0]?.content;
            if (typeof title === 'string' && title.trim()) {
                return title;
            }
        } catch (error) {
            console.warn('通过 SQL 获取文档标题失败:', error);
        }

        return `文档 ${docId}`;
    }

    async function getDocNameById(docId: string): Promise<string> {
        try {
            const docBlock = await getBlockByID(docId);
            if (docBlock?.content && docBlock.content.trim()) {
                return docBlock.content.trim();
            }
        } catch (error) {
            console.warn('通过 getBlockByID 获取文档标题失败:', error);
        }

        try {
            const safeDocId = escapeSqlString(docId);
            const rows = await sql(`SELECT content FROM blocks WHERE id = '${safeDocId}' LIMIT 1`);
            const title = rows?.[0]?.content;
            if (typeof title === 'string' && title.trim()) {
                return title.trim();
            }
        } catch (error) {
            console.warn('通过 SQL 获取文档标题失败:', error);
        }

        return '';
    }

    async function resolveToolChangeContext(toolCall: ToolCall): Promise<ToolChangeContext | null> {
        const toolName = toolCall.function.name;
        if (
            toolName !== 'siyuan_update_block' &&
            toolName !== 'siyuan_insert_block' &&
            toolName !== 'siyuan_delete_block' &&
            toolName !== 'siyuan_rename_document'
        ) {
            return null;
        }

        try {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            let operationType: ToolChangeContext['operationType'];
            let targetBlockId = '';

            if (toolName === 'siyuan_update_block') {
                operationType = 'update';
                targetBlockId = args.id || '';
            } else if (toolName === 'siyuan_insert_block') {
                operationType = 'insert';
                targetBlockId =
                    args.nextID || args.previousID || args.parentID || args.appendParentID || '';
            } else if (toolName === 'siyuan_rename_document') {
                operationType = 'rename';
                targetBlockId = args.id || '';
            } else {
                operationType = 'delete';
                targetBlockId = args.id || '';
            }

            if (!targetBlockId) {
                return null;
            }

            let blockInfo = await getBlockByID(targetBlockId);
            if (!blockInfo) {
                try {
                    const safeBlockId = escapeSqlString(targetBlockId);
                    const rows = await sql(
                        `SELECT id, root_id, type FROM blocks WHERE id = '${safeBlockId}' LIMIT 1`
                    );
                    blockInfo = rows?.[0] || null;
                } catch (error) {
                    console.warn('通过 SQL 获取块信息失败:', error);
                }
            }
            const docId =
                blockInfo?.type === 'd' ? blockInfo.id : blockInfo?.root_id || targetBlockId;

            const docTitle = await getDocDisplayTitle(docId);
            const currentDocName = (await getDocNameById(docId)) || docTitle;

            return {
                operationType,
                docId,
                docTitle,
                affectedBlockId: targetBlockId,
                renameTitleTo:
                    toolName === 'siyuan_rename_document'
                        ? String(args.title || '').trim()
                        : undefined,
                oldDocTitle: currentDocName,
            };
        } catch (error) {
            console.warn('解析工具调用参数失败，无法生成汇总差异记录:', error);
            return null;
        }
    }

    async function ensureDocDiffSnapshotBefore(
        messageIndex: number,
        changeContext: ToolChangeContext
    ) {
        if (messageIndex < 0) {
            return;
        }

        let messageDiffMap = pendingDocDiffsByMessage.get(messageIndex);
        if (!messageDiffMap) {
            messageDiffMap = new Map<string, PendingDocDiff>();
            pendingDocDiffsByMessage.set(messageIndex, messageDiffMap);
        }

        let pendingDiff = messageDiffMap.get(changeContext.docId);
        if (!pendingDiff) {
            const oldMdData = await exportMdContent(changeContext.docId, false, false, 2, 0, false);
            const oldContent = oldMdData?.content || '';

            pendingDiff = {
                docId: changeContext.docId,
                docTitle: changeContext.docTitle,
                oldDocTitle: changeContext.oldDocTitle || changeContext.docTitle,
                newDocTitle: changeContext.oldDocTitle || changeContext.docTitle,
                oldContent,
                newContent: oldContent,
                affectedBlockIds: new Set<string>(),
            };
            messageDiffMap.set(changeContext.docId, pendingDiff);
        }

        if (changeContext.renameTitleTo) {
            pendingDiff.newDocTitle = changeContext.renameTitleTo;
            pendingDiff.docTitle = changeContext.renameTitleTo;
        }
        pendingDiff.affectedBlockIds.add(changeContext.affectedBlockId);
    }

    async function refreshDocDiffSnapshotAfter(
        messageIndex: number,
        changeContext: ToolChangeContext
    ) {
        const messageDiffMap = pendingDocDiffsByMessage.get(messageIndex);
        const pendingDiff = messageDiffMap?.get(changeContext.docId);
        if (!pendingDiff) {
            return;
        }

        const newMdData = await exportMdContent(changeContext.docId, false, false, 2, 0, false);
        pendingDiff.newContent = newMdData?.content || '';
        if (!changeContext.renameTitleTo) {
            pendingDiff.newDocTitle = await getDocNameById(changeContext.docId);
            pendingDiff.docTitle = pendingDiff.newDocTitle || pendingDiff.docTitle;
        } else {
            pendingDiff.newDocTitle = changeContext.renameTitleTo;
            pendingDiff.docTitle = changeContext.renameTitleTo;
        }
        pendingDiff.affectedBlockIds.add(changeContext.affectedBlockId);
    }

    function commitPendingDocDiffsToMessage(messageIndex: number) {
        const messageDiffMap = pendingDocDiffsByMessage.get(messageIndex);
        if (!messageDiffMap || messageDiffMap.size === 0) {
            pendingDocDiffsByMessage.delete(messageIndex);
            return;
        }

        const message = messages[messageIndex];
        if (!message || message.role !== 'assistant') {
            pendingDocDiffsByMessage.delete(messageIndex);
            return;
        }

        const summaryDiffs: EditOperation[] = [];
        for (const pendingDiff of messageDiffMap.values()) {
            const contentChanged = pendingDiff.oldContent !== pendingDiff.newContent;
            const titleChanged = pendingDiff.oldDocTitle !== pendingDiff.newDocTitle;
            if (!contentChanged && !titleChanged) {
                continue;
            }

            summaryDiffs.push({
                operationType: 'update',
                blockId: pendingDiff.docId,
                docId: pendingDiff.docId,
                docTitle: pendingDiff.docTitle,
                oldDocTitle: pendingDiff.oldDocTitle,
                newDocTitle: pendingDiff.newDocTitle,
                affectedBlockIds: Array.from(pendingDiff.affectedBlockIds),
                oldContent: pendingDiff.oldContent,
                oldContentForDisplay: pendingDiff.oldContent,
                newContent: pendingDiff.newContent,
                newContentForDisplay: normalizeOperationContentForDiff(pendingDiff.newContent),
                status: 'applied',
            });
        }

        if (summaryDiffs.length === 0) {
            pendingDocDiffsByMessage.delete(messageIndex);
            return;
        }

        message.editOperations = [...(message.editOperations || []), ...summaryDiffs];
        messages = [...messages];
        hasUnsavedChanges = true;
        pendingDocDiffsByMessage.delete(messageIndex);
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
            let oldMdContent = operation.oldContentForDisplay || operation.oldContent || '';
            let newMdContent =
                operation.newContentForDisplay ||
                operation.newContent.replace(/\{:\s*id="[^"]+"\s*\}/g, '').trim();

            // 文档重命名差异：在对比内容头部注入标题信息，确保即使正文不变也可见
            if (
                operation.oldDocTitle &&
                operation.newDocTitle &&
                operation.oldDocTitle !== operation.newDocTitle
            ) {
                const oldTitleLine = `# 文档标题: ${operation.oldDocTitle}\n\n`;
                const newTitleLine = `# 文档标题: ${operation.newDocTitle}\n\n`;
                oldMdContent = oldTitleLine + oldMdContent;
                newMdContent = newTitleLine + newMdContent;
            }

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
                oldContent: oldMdContent,
                newContent: newMdContent,
            };
        }

        isDiffDialogOpen = true;
    }

    // 关闭差异对话框
    function closeDiffDialog() {
        isDiffDialogOpen = false;
        currentDiffOperation = null;
    }

    function escapeDiffHtml(text: string) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderMarkdownForSplitDiff(markdown: string) {
        const content = markdown || '';
        try {
            const lute = (window as any).Lute.New();
            if (lute && typeof lute.Md2HTML === 'function') {
                return lute.Md2HTML(content);
            }
        } catch (error) {
            console.warn('使用 Lute 渲染差异内容失败:', error);
        }
        return `<pre>${escapeDiffHtml(content)}</pre>`;
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
                // 记录用户对该模型答案的手动编辑，便于切换时保留改动
                if (!message._editedSelections) message._editedSelections = {};
                message._editedSelections[selectedIndex] = newContent;
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

    // 在历史消息的多模型响应中选择某个模型的答案（支持切换并保留手动编辑）
    function selectHistoryMultiModelAnswer(absMessageIndex: number, responseIndex: number) {
        const msg = messages[absMessageIndex];
        if (!msg || !msg.multiModelResponses || msg.multiModelResponses.length === 0) return;

        const prevSelected = msg.multiModelResponses.findIndex(r => r.isSelected);
        if (prevSelected === responseIndex) return;

        // 保存当前显示内容到编辑缓存（如果有）
        msg._editedSelections = msg._editedSelections || {};
        if (prevSelected !== -1) {
            msg._editedSelections[prevSelected] = msg.content;
        }

        // 更新选中标记并优化名称显示
        msg.multiModelResponses = msg.multiModelResponses.map((r, i) => {
            const cleanName = (r.modelName || '').toString().replace(/^ ✅/, '');
            return {
                ...r,
                isSelected: i === responseIndex,
                modelName: i === responseIndex ? ' ✅' + cleanName : cleanName,
            };
        });

        // 如果之前对目标答案有手动编辑，则恢复编辑内容，否则使用模型原始内容
        const edited = msg._editedSelections[responseIndex];
        msg.content = edited ?? msg.multiModelResponses[responseIndex].content;

        messages = [...messages];
        hasUnsavedChanges = true;
        // 保存会话状态
        saveCurrentSession(true);
    }

    // 删除消息
    function deleteMessage(index: number) {
        confirm(
            i18n('aiSidebar.confirm.deleteMessage.title'),
            i18n('aiSidebar.confirm.deleteMessage.message'),
            () => {
                messages = messages.filter((_, i) => i !== index);
                hasUnsavedChanges = true;
            }
        );
    }

    // 重新生成AI回复
    async function regenerateMessage(index: number) {
        const providerConfig = getCurrentProviderConfig();
        const modelConfig = getCurrentModelConfig();

        if (isLoading) {
            pushErrMsg(i18n('aiSidebar.errors.generating'));
            return;
        }

        // 【修复】立即设置加载状态，防止并发点击
        isLoading = true;

        const targetMessage = messages[index];
        if (!targetMessage) {
            pushErrMsg(i18n('aiSidebar.errors.noMessage'));
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

            // 重新添加该用户消息
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
            pushErrMsg(i18n('aiSidebar.errors.noUserMessage'));
            return;
        }

        // 处理多模型重新生成的逻辑
        // 情况1：之前使用了多模型，且用户当前启用了多模型，优先使用当前用户设置的模型列表
        // 情况2：用户当前启用了多模型，使用当前选择的多模型
        // 情况3：用户关闭了多模型，使用单模型
        if (chatMode === 'ask') {
            // 检查是否应该使用多模型
            let shouldUseMultiModel = false;
            let modelsToUse: Array<{ provider: string; modelId: string }> = [];

            // 只有当用户当前启用了多模型时，才考虑使用多模型
            if (enableMultiModel && selectedMultiModels.length > 0) {
                // 优先使用当前用户设置的模型列表
                const validCurrentModels = selectedMultiModels.filter(model => {
                    const config = getProviderAndModelConfig(model.provider, model.modelId);
                    return config !== null;
                });

                if (validCurrentModels.length > 0) {
                    // 使用当前有效的模型
                    shouldUseMultiModel = true;
                    modelsToUse = validCurrentModels;
                } else {
                    // 当前设置的模型都无效，检查是否之前有使用多模型
                    if (useMultiModel && previousMultiModels.length > 0) {
                        const validPreviousModels = previousMultiModels.filter(model => {
                            const config = getProviderAndModelConfig(model.provider, model.modelId);
                            return config !== null;
                        });

                        if (validPreviousModels.length > 0) {
                            pushMsg('当前选择的多模型无效，将使用之前的模型重新生成');
                            shouldUseMultiModel = true;
                            modelsToUse = validPreviousModels;
                        }
                    }
                }
            }
            // 情况3：用户关闭了多模型，不使用多模型（继续执行后续单模型逻辑）

            // 如果应该使用多模型，则调用多模型发送
            if (shouldUseMultiModel && modelsToUse.length > 0) {
                // 临时保存当前的多模型选择
                const originalMultiModels = [...selectedMultiModels];
                const originalEnableMultiModel = enableMultiModel;

                // 设置为要使用的模型
                selectedMultiModels = modelsToUse;
                enableMultiModel = true;

                // 调用多模型发送
                try {
                    await sendMultiModelMessage();
                } finally {
                    // 恢复原来的设置
                    selectedMultiModels = originalMultiModels;
                    enableMultiModel = originalEnableMultiModel;
                }

                return; // 多模型发送完成，直接返回
            }
        }

        // 重新发送请求
        // isLoading 已经在函数开始时设置为 true
        isAborted = false; // 重置中断标志
        streamingMessage = '';
        streamingThinking = '';
        thinkingBeforeToolCalls = ''; // 重置工具调用前的思考内容
        isThinkingPhase = false;
        autoScroll = true; // 重新生成时启用自动滚动

        if (!providerConfig || !modelConfig) {
            pushErrMsg(i18n('aiSidebar.errors.noProvider'));
            isLoading = false;
            return;
        }

        await scrollToBottom(true);

        if (chatMode === 'draw') {
            await regenerateDrawModeMessage(lastUserMessage, providerConfig, modelConfig);
            return;
        }

        // 获取最后一条用户消息关联的上下文文档，并获取最新内容
        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        const userContextDocs = lastUserMessage.contextDocuments || [];
        for (const doc of userContextDocs) {
            try {
                let content: string;

                // 问答模式：获取Markdown格式
                const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                if (data && data.content) {
                    content = data.content;
                } else {
                    // 降级使用缓存内容
                    content = doc.content;
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

        // DeepSeek 思考模式：开启新一轮对话前清理历史消息中的 reasoning_content，保留工具调用链
        if (
            (chatMode === 'agent' || chatMode === 'ask') &&
            userToolCount > 0 &&
            currentProvider === 'deepseek'
        ) {
            messages = messages.map(msg => {
                if (msg.role === 'assistant' && msg.reasoning_content) {
                    const { reasoning_content, ...rest } = msg as any;
                    return rest as Message;
                }
                return msg;
            });
        }

        const isDeepseekThinkingAgent =
            (chatMode === 'agent' || chatMode === 'ask') &&
            userToolCount > 0 &&
            modelConfig &&
            modelConfig.capabilities?.thinking &&
            (modelConfig.thinkingEnabled || false);

        // 准备发送给AI的消息（包含系统提示词和上下文文档）
        // 深拷贝消息数组，避免修改原始消息
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

                // 检测是否是 DeepSeek 推理模型
                const isDeepSeekReasonerModel3 = modelConfig
                    ? /deepseek-(reasoner|r1)/i.test(modelConfig.id)
                    : false;

                // 只有在启用 thinking 模式或者是 DeepSeek 推理模型时才保留 reasoning_content
                // Kimi 等模型在未启用 thinking 时看到 reasoning_content 会报错
                const shouldKeepReasoning3 = isDeepseekThinkingAgent || isDeepSeekReasonerModel3;
                if (shouldKeepReasoning3 && msg.reasoning_content !== undefined) {
                    baseMsg.reasoning_content = msg.reasoning_content;
                }

                // 在启用 thinking 模式或是 DeepSeek 推理模型且有 tool_calls 时，确保 reasoning_content 字段存在
                if (shouldKeepReasoning3 && msg.tool_calls && msg.tool_calls.length > 0) {
                    if (baseMsg.reasoning_content === undefined) {
                        baseMsg.reasoning_content = '';
                    }
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

                    // 构建上下文文本
                    const contextText = msg.contextDocuments
                        .map(doc => {
                            const label =
                                doc.type === 'doc'
                                    ? '文档'
                                    : doc.type === 'webpage'
                                      ? '网页'
                                      : '块';
                            // agent模式或启用工具的问答模式：文档块只传递ID，不传递内容
                            if (
                                (chatMode === 'agent' || chatMode === 'ask') &&
                                userToolCount > 0 &&
                                doc.type === 'doc'
                            ) {
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                            }
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

                // 查找上一条assistant消息是否有生成的图片（用于图片编辑）
                let previousGeneratedImages: any[] = [];
                const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
                if (lastAssistantMsg) {
                    // 检查generatedImages或attachments中的图片
                    if (
                        lastAssistantMsg.generatedImages &&
                        lastAssistantMsg.generatedImages.length > 0
                    ) {
                        // 从路径加载图片并转换为 blob URL
                        previousGeneratedImages = await Promise.all(
                            lastAssistantMsg.generatedImages.map(async img => {
                                let imageUrl = '';
                                if (img.path) {
                                    // 从路径加载图片
                                    imageUrl = (await loadAsset(img.path)) || '';
                                } else if (img.data) {
                                    // 兼容旧数据（base64格式）
                                    imageUrl = `data:${img.mimeType || 'image/png'};base64,${img.data}`;
                                }
                                return {
                                    type: 'image_url' as const,
                                    image_url: { url: imageUrl },
                                };
                            })
                        );
                    } else if (
                        lastAssistantMsg.attachments &&
                        lastAssistantMsg.attachments.length > 0
                    ) {
                        // 从附件中获取图片
                        const imageAttachments = lastAssistantMsg.attachments.filter(
                            att => att.type === 'image'
                        );
                        previousGeneratedImages = await Promise.all(
                            imageAttachments.map(async att => {
                                let imageUrl = att.data;
                                // 如果附件有路径且当前data不可用，从路径重新加载
                                if (att.path && (!imageUrl || !imageUrl.startsWith('blob:'))) {
                                    imageUrl = (await loadAsset(att.path)) || att.data;
                                }
                                return {
                                    type: 'image_url' as const,
                                    image_url: { url: imageUrl },
                                };
                            })
                        );
                    } else if (typeof lastAssistantMsg.content === 'string') {
                        // 从Markdown内容中提取图片 ![alt](url)
                        const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
                        const content = lastAssistantMsg.content;
                        let match;
                        while ((match = imageRegex.exec(content)) !== null) {
                            const url = match[1];
                            // 处理 assets 路径的图片
                            if (
                                url.startsWith('/data/storage/petal/siyuan-plugin-copilot/assets/')
                            ) {
                                try {
                                    const blobUrl = await loadAsset(url);
                                    if (blobUrl) {
                                        previousGeneratedImages.push({
                                            type: 'image_url' as const,
                                            image_url: { url: blobUrl },
                                        });
                                    }
                                } catch (error) {
                                    console.error('Failed to load asset image:', error);
                                }
                            } else if (url.startsWith('http://') || url.startsWith('https://')) {
                                // HTTP/HTTPS URL 直接使用
                                previousGeneratedImages.push({
                                    type: 'image_url' as const,
                                    image_url: { url: url },
                                });
                            }
                        }
                    }
                }

                // 如果有图片附件或上一条有生成的图片，使用多模态格式
                if (hasImages || previousGeneratedImages.length > 0) {
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
                                const label =
                                    doc.type === 'doc'
                                        ? '文档'
                                        : doc.type === 'webpage'
                                          ? '网页'
                                          : '块';
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                            })
                            .join('\n\n---\n\n');
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    contentParts.push({ type: 'text', text: textContent });

                    // 添加用户上传的图片
                    lastUserMessage.attachments?.forEach(att => {
                        if (att.type === 'image') {
                            contentParts.push({
                                type: 'image_url',
                                image_url: { url: att.data },
                            });
                        }
                    });

                    // 添加上一次生成的图片（用于图片编辑）
                    previousGeneratedImages.forEach(img => {
                        contentParts.push(img);
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
                                const label =
                                    doc.type === 'doc'
                                        ? '文档'
                                        : doc.type === 'webpage'
                                          ? '网页'
                                          : '块';
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                            })
                            .join('\n\n---\n\n');
                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    lastMessage.content = enhancedContent;
                }
            }
        }

        // 使用临时系统提示词（如果设置了）- 优先使用临时系统提示词作为基础
        let baseSystemPrompt = settings.aiSystemPrompt || '';
        if (tempModelSettings.systemPrompt.trim()) {
            baseSystemPrompt = tempModelSettings.systemPrompt;
        }

        // Agent/Ask 模式带有工具时，添加工具使用强制规则
        let hasToolInstruction = false;
        if ((chatMode === 'agent' || chatMode === 'ask') && userToolCount > 0) {
            if (baseSystemPrompt.trim()) {
                baseSystemPrompt += '\n\n' + AGENT_TOOL_USAGE_INSTRUCTION;
            } else {
                baseSystemPrompt = AGENT_TOOL_USAGE_INSTRUCTION;
            }
            hasToolInstruction = true;
        }

        // 添加最终的系统提示词
        if (baseSystemPrompt.trim() || hasToolInstruction) {
            messagesToSend.unshift({ role: 'system', content: baseSystemPrompt });
        }

        // 创建新的 AbortController
        abortController = new AbortController();

        if (!providerConfig || !modelConfig) {
            pushErrMsg(i18n('aiSidebar.errors.noProvider'));
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

            // 准备工具列表
            let toolsForAgent: any[] | undefined = undefined;
            if ((chatMode === 'agent' || chatMode === 'ask') && userToolCount > 0) {
                // 根据选中的工具名称筛选出对应的工具定义
                const currentSelectedTools = chatMode === 'ask' ? selectedToolsAsk : selectedTools;
                const selectedToolDefs = AVAILABLE_TOOLS.filter(tool =>
                    currentSelectedTools.some(t => t.name === tool.function.name)
                );
                const filteredToolDefs = selectedToolDefs.filter(
                    tool => tool.function.name !== 'get_siyuan_skills'
                );
                const descTool =
                    chatMode === 'ask'
                        ? createGetSiyuanSkillsTool(
                              filteredToolDefs.map(tool => tool.function.name)
                          )
                        : AVAILABLE_TOOLS.find(t => t.function.name === 'get_siyuan_skills');
                toolsForAgent = descTool ? [descTool, ...filteredToolDefs] : filteredToolDefs;
            }

            // 用于保存生成的图片
            let generatedImages: any[] = [];

            // Agent 模式或问答模式启用工具使用循环调用
            if (
                (chatMode === 'agent' || chatMode === 'ask') &&
                toolsForAgent &&
                toolsForAgent.length > 0
            ) {
                let shouldContinue = true;
                // 记录第一次工具调用后创建的assistant消息索引
                let firstToolCallMessageIndex: number | null = null;
                // 记录当前是第几轮工具调用
                let currentToolCallRound = 0;

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
                            useForwardProxy: providerConfig.useForwardProxy || false,
                            model: modelConfig.id,
                            messages: messagesToSend,
                            temperature: tempModelSettings.temperatureEnabled
                                ? tempModelSettings.temperature
                                : modelConfig.temperature,
                            maxTokens:
                                modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                            stream: true,
                            signal: abortController.signal,
                            enableThinking,
                            reasoningEffort: modelConfig.thinkingEffort || 'low',
                            tools: toolsForAgent,
                            customBody,
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
                                receivedToolCalls = true;

                                // 获取当前工具调用的起始索引
                                const toolCallStartIndex =
                                    firstToolCallMessageIndex !== null
                                        ? messages[firstToolCallMessageIndex].tool_calls?.length ||
                                          0
                                        : 0;

                                // 计算当前轮次的折叠索引
                                const baseIndex =
                                    firstToolCallMessageIndex !== null
                                        ? firstToolCallMessageIndex * 100 + currentToolCallRound
                                        : messages.length * 100;

                                // 如果是第一次工具调用，创建新的assistant消息
                                if (firstToolCallMessageIndex === null) {
                                    const assistantMessage: Message = {
                                        role: 'assistant',
                                        content: streamingMessage || '',
                                        tool_calls: toolCalls,
                                        toolCallThinkings: [
                                            {
                                                toolCallIndex: 0,
                                                thinkingBefore: streamingThinking || '',
                                                contentBefore: streamingMessage || '',
                                            },
                                        ],
                                    };

                                    // 只有在启用 thinking 模式时才添加 reasoning_content
                                    // Kimi 等模型在未启用 thinking 时看到 reasoning_content 会报错
                                    if (isDeepseekThinkingAgent) {
                                        assistantMessage.reasoning_content =
                                            streamingThinking || '';
                                    }

                                    messages = [...messages, assistantMessage];
                                    firstToolCallMessageIndex = messages.length - 1;
                                } else {
                                    // 如果不是第一次，更新现有消息的tool_calls（合并工具调用）
                                    const existingMessage = messages[firstToolCallMessageIndex];

                                    // 先保存上一轮工具调用后的思考内容（如果有）
                                    if (
                                        currentToolCallRound > 0 &&
                                        existingMessage.toolCallThinkings
                                    ) {
                                        const prevRound =
                                            existingMessage.toolCallThinkings[
                                                currentToolCallRound - 1
                                            ];
                                        if (prevRound && !prevRound.thinkingAfter) {
                                            prevRound.thinkingAfter = streamingThinking || '';
                                        }
                                        // 折叠上一轮工具调用后的思考
                                        const prevAfterIndex = baseIndex - 1 + '_after';
                                        thinkingCollapsed[prevAfterIndex] = true;
                                    }

                                    existingMessage.tool_calls = [
                                        ...(existingMessage.tool_calls || []),
                                        ...toolCalls,
                                    ];

                                    // 添加新一轮工具调用的思考记录
                                    if (!existingMessage.toolCallThinkings) {
                                        existingMessage.toolCallThinkings = [];
                                    }
                                    existingMessage.toolCallThinkings.push({
                                        toolCallIndex: toolCallStartIndex,
                                        thinkingBefore: streamingThinking || '',
                                        contentBefore: streamingMessage || '',
                                    });

                                    // 只有在启用 thinking 模式时才更新 reasoning_content
                                    if (isDeepseekThinkingAgent) {
                                        existingMessage.reasoning_content = streamingThinking || '';
                                    }

                                    messages = [...messages];
                                }

                                // 自动折叠当前思考过程
                                thinkingCollapsed[baseIndex] = true;
                                thinkingCollapsed = { ...thinkingCollapsed };

                                currentToolCallRound++;
                                streamingMessage = '';
                                // 清空 streamingThinking，准备接收工具调用后的思考内容
                                streamingThinking = '';

                                // 处理每个工具调用
                                for (const toolCall of toolCalls) {
                                    const currentSelectedToolsInLoop =
                                        chatMode === 'ask' ? selectedToolsAsk : selectedTools;
                                    const toolConfig = currentSelectedToolsInLoop.find(
                                        t => t.name === toolCall.function.name
                                    );
                                    // get_siyuan_skills 是系统工具，默认自动批准
                                    const isSystemTool =
                                        toolCall.function.name === 'get_siyuan_skills';
                                    const autoApprove =
                                        isSystemTool || toolConfig?.autoApprove || false;
                                    const toolChangeContext =
                                        await resolveToolChangeContext(toolCall);
                                    if (firstToolCallMessageIndex !== null && toolChangeContext) {
                                        await ensureDocDiffSnapshotBefore(
                                            firstToolCallMessageIndex,
                                            toolChangeContext
                                        );
                                    }

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
                                            if (
                                                firstToolCallMessageIndex !== null &&
                                                toolChangeContext
                                            ) {
                                                await refreshDocDiffSnapshotAfter(
                                                    firstToolCallMessageIndex,
                                                    toolChangeContext
                                                );
                                            }
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
                                                if (
                                                    firstToolCallMessageIndex !== null &&
                                                    toolChangeContext
                                                ) {
                                                    await refreshDocDiffSnapshotAfter(
                                                        firstToolCallMessageIndex,
                                                        toolChangeContext
                                                    );
                                                }
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
                                messagesToSend = messages
                                    .filter(msg => msg.role !== 'system') // 过滤掉旧的系统消息
                                    .map(msg => {
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

                                        // 检测是否是 DeepSeek 推理模型
                                        const isDeepSeekReasonerModel4 = modelConfig
                                            ? /deepseek-(reasoner|r1)/i.test(modelConfig.id)
                                            : false;

                                        // 只有在启用 thinking 模式或者是 DeepSeek 推理模型时才保留 reasoning_content
                                        // Kimi 等模型在未启用 thinking 时看到 reasoning_content 会报错
                                        const shouldKeepReasoning4 =
                                            isDeepseekThinkingAgent || isDeepSeekReasonerModel4;
                                        if (
                                            shouldKeepReasoning4 &&
                                            msg.reasoning_content !== undefined
                                        ) {
                                            baseMsg.reasoning_content = msg.reasoning_content;
                                        }

                                        // 在启用 thinking 模式或是 DeepSeek 推理模型且有 tool_calls 时，确保 reasoning_content 字段存在
                                        if (
                                            shouldKeepReasoning4 &&
                                            msg.tool_calls &&
                                            msg.tool_calls.length > 0
                                        ) {
                                            if (baseMsg.reasoning_content === undefined) {
                                                baseMsg.reasoning_content = '';
                                            }
                                        }

                                        // 对于用户消息，如果有上下文文档，需要重新注入上下文内容
                                        // 因为 msg.content 只存储了原始输入，不包含上下文
                                        if (
                                            msg.role === 'user' &&
                                            msg.contextDocuments &&
                                            msg.contextDocuments.length > 0
                                        ) {
                                            const contextText = msg.contextDocuments
                                                .map(doc => {
                                                    const label =
                                                        doc.type === 'doc'
                                                            ? '文档'
                                                            : doc.type === 'webpage'
                                                              ? '网页'
                                                              : '块';
                                                    if (doc.type === 'doc') {
                                                        return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                                    } else {
                                                        return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                                                    }
                                                })
                                                .join('\n\n---\n\n');
                                            baseMsg.content += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                                        }

                                        return baseMsg;
                                    });

                                // 添加系统提示词到消息列表开头（工具使用说明已在一开始的 messagesToSend 构建中决定好了，这里直接追加）
                                if (baseSystemPrompt.trim() || hasToolInstruction) {
                                    messagesToSend.unshift({
                                        role: 'system',
                                        content: baseSystemPrompt,
                                    });
                                }

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
                                    if (firstToolCallMessageIndex !== null) {
                                        pendingDocDiffsByMessage.delete(firstToolCallMessageIndex);
                                    }
                                    toolExecutionComplete?.();
                                    return;
                                }

                                // 如果没有收到工具调用，说明对话结束
                                if (!receivedToolCalls) {
                                    shouldContinue = false;

                                    const convertedText = convertLatexToMarkdown(fullText);

                                    // 处理content中的base64图片，保存为assets文件
                                    const processedContent =
                                        await saveBase64ImagesInContent(convertedText);

                                    // 如果之前有工具调用，将最终回复存储到 finalReply 字段
                                    if (
                                        firstToolCallMessageIndex !== null &&
                                        processedContent.trim()
                                    ) {
                                        const existingMessage = messages[firstToolCallMessageIndex];
                                        // 将AI的最终回复存储到 finalReply 字段
                                        existingMessage.finalReply = processedContent;

                                        // 只有在启用 thinking 模式时才更新 reasoning_content
                                        if (isDeepseekThinkingAgent) {
                                            // 构建完整的 reasoning_content，包含所有轮次的思考
                                            let fullReasoning = '';
                                            if (existingMessage.toolCallThinkings) {
                                                for (
                                                    let i = 0;
                                                    i < existingMessage.toolCallThinkings.length;
                                                    i++
                                                ) {
                                                    const round =
                                                        existingMessage.toolCallThinkings[i];
                                                    if (i > 0) fullReasoning += '\n\n';
                                                    fullReasoning += `[第${i + 1}轮思考]\n${round.thinkingBefore}`;
                                                }
                                            }
                                            existingMessage.reasoning_content = fullReasoning;
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
                                    if (firstToolCallMessageIndex !== null) {
                                        commitPendingDocDiffsToMessage(firstToolCallMessageIndex);
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
                                if (firstToolCallMessageIndex !== null) {
                                    pendingDocDiffsByMessage.delete(firstToolCallMessageIndex);
                                }
                                if (error.message !== 'Request aborted') {
                                    const errorMessage: Message = {
                                        role: 'assistant',
                                        content: `❌ **${i18n('aiSidebar.errors.requestFailed')}**\n\n${error.message}`,
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
                // 检查是否启用图片生成
                const enableImageGeneration = modelConfig.capabilities?.imageGeneration || false;

                await chat(
                    currentProvider,
                    {
                        apiKey: providerConfig.apiKey,
                        useForwardProxy: providerConfig.useForwardProxy || false,
                        model: modelConfig.id,
                        messages: messagesToSend,
                        temperature: tempModelSettings.temperatureEnabled
                            ? tempModelSettings.temperature
                            : modelConfig.temperature,
                        maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                        stream: true,
                        signal: abortController.signal,
                        customBody,
                        enableThinking,
                        reasoningEffort: modelConfig.thinkingEffort || 'low',
                        enableImageGeneration,
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
                        onImageGenerated: async (images: any[]) => {
                            // 立即保存生成的图片到 SiYuan 资源文件夹并转换为 blob URL
                            generatedImages = await Promise.all(
                                images.map(async (img, idx) => {
                                    const blob = base64ToBlob(
                                        img.data,
                                        img.mimeType || 'image/png'
                                    );
                                    const name = createGeneratedImageFileName(
                                        img.mimeType || 'image/png',
                                        idx
                                    );
                                    const assetPath = await saveAsset(blob, name);
                                    return {
                                        ...img,
                                        name,
                                        path: assetPath,
                                        // 给前端显示用的 blob url
                                        previewUrl: URL.createObjectURL(blob),
                                    };
                                })
                            );
                        },
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

                            // 处理content中的base64图片，保存为assets文件
                            const processedContent = await saveBase64ImagesInContent(convertedText);

                            const assistantMessage: Message = {
                                role: 'assistant',
                                content: processedContent,
                            };

                            if (enableThinking && streamingThinking) {
                                assistantMessage.thinking = streamingThinking;
                            }

                            // 如果有生成的图片，保存到消息中
                            if (generatedImages.length > 0) {
                                // 保存图片信息（不包含base64数据，只保存路径）
                                assistantMessage.generatedImages = generatedImages.map(img => ({
                                    mimeType: img.mimeType,
                                    data: '', // 不保存base64数据，节省空间
                                    path: img.path,
                                }));

                                // 添加为附件以便显示（使用blob URL）
                                assistantMessage.attachments = generatedImages.map((img, idx) => ({
                                    type: 'image' as const,
                                    name:
                                        img.name ||
                                        createGeneratedImageFileName(
                                            img.mimeType || 'image/png',
                                            idx
                                        ),
                                    data: img.previewUrl, // 使用 blob URL 显示
                                    path: img.path, // 保存路径用于持久化
                                    mimeType: img.mimeType || 'image/png',
                                }));
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
                                    content: `❌ **${i18n('aiSidebar.errors.requestFailed')}**\n\n${error.message}`,
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
                    content: `❌ **${i18n('aiSidebar.errors.requestFailed')}**\n\n${(error as Error).message}`,
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
            <button
                class="b3-button b3-button--text"
                on:click={openTranslateDialog}
                title={i18n('aiSidebar.translate.openDialog') || '翻译'}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconTranslate"></use></svg>
            </button>
            <div class="ai-sidebar__webapp-menu-container">
                <button
                    class="b3-button b3-button--text"
                    bind:this={webAppMenuButton}
                    on:click={toggleWebAppMenu}
                    title={i18n('aiSidebar.webapp.title') || '小程序'}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconCopilotWebApp"></use></svg>
                </button>
            </div>
            {#if hasUnsavedChanges}
                <span class="ai-sidebar__unsaved" title={i18n('aiSidebar.unsavedChanges')}>●</span>
            {/if}
        </h3>

        {#if showWebAppMenu}
            <div
                bind:this={webAppMenuDropdown}
                class="ai-sidebar__webapp-menu"
                style="top: {webAppDropdownTop}px; left: {webAppDropdownLeft}px;"
            >
                <button class="b3-menu__item" on:click={openWebAppManager}>
                    <svg class="b3-menu__icon">
                        <use xlink:href="#iconSettings"></use>
                    </svg>
                    <span class="b3-menu__label">管理小程序</span>
                </button>
                {#if webApps.length > 0}
                    <div class="b3-menu__separator"></div>
                    {#each webApps as app (app.id)}
                        <button class="b3-menu__item" on:click={() => openWebAppDirect(app)}>
                            <div
                                class="b3-menu__icon"
                                style="display: flex; align-items: center; justify-content: center;"
                            >
                                {#if app.icon}
                                    <img
                                        src={getWebAppIconUrl(app.icon)}
                                        alt=""
                                        style="width: 16px; height: 16px; object-fit: cover;"
                                    />
                                {:else}
                                    <svg><use xlink:href="#iconGlobe"></use></svg>
                                {/if}
                            </div>
                            <span class="b3-menu__label">{app.name}</span>
                        </button>
                    {/each}
                {/if}
            </div>
        {/if}

        <div class="ai-sidebar__actions">
            <button
                class="b3-button b3-button--text"
                on:click={newSession}
                title={i18n('aiSidebar.session.new')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
            </button>
            <SessionManager
                bind:sessions
                bind:currentSessionId
                bind:isOpen={isSessionManagerOpen}
                loadSessionText={loadSessionSearchableText}
                on:refresh={loadSessions}
                on:load={e => loadSession(e.detail.sessionId)}
                on:delete={e => deleteSession(e.detail.sessionId)}
                on:batchDelete={e => batchDeleteSessions(e.detail.sessionIds)}
                on:new={newSession}
                on:update={e => handleSessionUpdate(e.detail.sessions)}
                on:saveToNote={e => handleSaveSessionToNote(e.detail.sessionId)}
            />
            <button
                class="b3-button b3-button--text"
                on:click={copyAsMarkdown}
                title={i18n('aiSidebar.actions.copyAllChat')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
            </button>
            <button
                class="b3-button b3-button--text"
                on:click={() => openSaveToNoteDialog()}
                title={i18n('aiSidebar.actions.saveToNote')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconDownload"></use></svg>
            </button>
            <button
                class="b3-button b3-button--text"
                on:click={clearChat}
                title={i18n('aiSidebar.actions.clear')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
            </button>
            <div class="ai-sidebar__open-window-menu-container" style="position: relative;">
                <button
                    class="b3-button b3-button--text"
                    bind:this={openWindowMenuButton}
                    on:click={toggleOpenWindowMenu}
                    title={i18n('aiSidebar.actions.openWindow') || '在新窗口打开'}
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
                title={i18n('aiSidebar.actions.settings')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
            </button>
        </div>
    </div>

    <div class="ai-sidebar__messages" bind:this={messagesContainer} on:scroll={handleScroll}>
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
                        <!-- 多轮工具调用思考内容渲染 -->
                        {#if message.role === 'assistant' && message.toolCallThinkings && message.toolCallThinkings.length > 0 && !(message.multiModelResponses && message.multiModelResponses.length > 0)}
                            <!-- 按轮次显示思考和工具调用 -->
                            {#each message.toolCallThinkings as round, roundIndex}
                                {@const baseIndex = (messageIndex + msgIndex) * 100 + roundIndex}

                                <!-- 该轮工具调用前的AI回复内容（非思考部分） -->
                                {@const actualContentBefore = round.contentBefore || (roundIndex === 0 ? message.content : '')}
                                {#if actualContentBefore && actualContentBefore.toString().trim()}
                                    {@const contentBeforeDisplay = getDisplayContent(actualContentBefore)}
                                    <div
                                        class="ai-message__content b3-typography"
                                        style={messageFontSize ? `font-size: ${messageFontSize}px;` : ''}
                                    >
                                        {@html contentBeforeDisplay}
                                    </div>
                                {/if}

                                <!-- 该轮工具调用前的思考 -->
                                {#if round.thinkingBefore}
                                    <div class="ai-message__thinking">
                                        <div
                                            class="ai-message__thinking-header"
                                            on:click={() => {
                                                thinkingCollapsed[baseIndex] =
                                                    !thinkingCollapsed[baseIndex];
                                            }}
                                        >
                                            <svg
                                                class="ai-message__thinking-icon"
                                                class:collapsed={thinkingCollapsed[baseIndex]}
                                            >
                                                <use xlink:href="#iconRight"></use>
                                            </svg>
                                            <span class="ai-message__thinking-title">
                                                💭 思考过程
                                            </span>
                                        </div>
                                        {#if !thinkingCollapsed[baseIndex]}
                                            {@const thinkDisplay = getDisplayContent(
                                                round.thinkingBefore
                                            )}
                                            <div class="ai-message__thinking-content b3-typography">
                                                {@html thinkDisplay}
                                            </div>
                                        {/if}
                                    </div>
                                {/if}

                                <!-- 该轮对应的工具调用 -->
                                {#if message.tool_calls && message.tool_calls.length > 0}
                                    {@const nextRound = message.toolCallThinkings[roundIndex + 1]}
                                    {@const endIndex = nextRound
                                        ? nextRound.toolCallIndex
                                        : message.tool_calls.length}
                                    {@const roundToolCalls = message.tool_calls.slice(
                                        round.toolCallIndex,
                                        endIndex
                                    )}

                                    {#if roundToolCalls.length > 0}
                                        <div class="ai-message__tool-calls">
                                            <div class="ai-message__tool-calls-title">
                                                🔧 {i18n('tools.calling')} ({roundToolCalls.length})
                                            </div>
                                            {#each roundToolCalls as toolCall}
                                                {@const toolResult = group.messages
                                                    .slice(msgIndex + 1)
                                                    .find(
                                                        m =>
                                                            m.role === 'tool' &&
                                                            m.tool_call_id === toolCall.id
                                                    )}
                                                {@const toolName = toolCall.function.name}
                                                {@const toolDisplayName =
                                                    getToolDisplayName(toolName)}
                                                {@const isCompleted = !!toolResult}
                                                {@const toolCallCollapsed =
                                                    !toolCallsExpanded[toolCall.id]}

                                                <div class="ai-message__tool-call">
                                                    <div
                                                        class="ai-message__tool-call-header"
                                                        on:click={() => {
                                                            toolCallsExpanded[toolCall.id] =
                                                                !toolCallsExpanded[toolCall.id];
                                                            toolCallsExpanded = {
                                                                ...toolCallsExpanded,
                                                            };
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
                                                                <span
                                                                    class="ai-message__tool-call-status"
                                                                >
                                                                    ✅
                                                                </span>
                                                            {:else}
                                                                <span
                                                                    class="ai-message__tool-call-status"
                                                                >
                                                                    ⏳
                                                                </span>
                                                            {/if}
                                                        </div>
                                                    </div>

                                                    {#if !toolCallCollapsed}
                                                        {@const paramsKey = `${toolCall.id}_params`}
                                                        {@const paramsExpanded =
                                                            toolCallResultsExpanded[paramsKey] !==
                                                            false}
                                                        {@const resultKey = `${toolCall.id}_result`}
                                                        {@const resultExpanded =
                                                            toolCallResultsExpanded[resultKey] !==
                                                            false}
                                                        <div class="ai-message__tool-call-details">
                                                            <!-- 工具参数 -->
                                                            <div
                                                                class="ai-message__tool-call-params"
                                                            >
                                                                <div
                                                                    class="ai-message__tool-call-section-header"
                                                                    on:click={() => {
                                                                        toolCallResultsExpanded[
                                                                            paramsKey
                                                                        ] = !paramsExpanded;
                                                                        toolCallResultsExpanded = {
                                                                            ...toolCallResultsExpanded,
                                                                        };
                                                                    }}
                                                                >
                                                                    <svg
                                                                        class="ai-message__tool-call-icon"
                                                                        class:collapsed={!paramsExpanded}
                                                                    >
                                                                        <use
                                                                            xlink:href="#iconRight"
                                                                        ></use>
                                                                    </svg>
                                                                    <strong>
                                                                        {i18n(
                                                                            'tools.selector.parameters'
                                                                        )}
                                                                    </strong>
                                                                </div>
                                                                {#if paramsExpanded}
                                                                    <pre
                                                                        class="ai-message__tool-call-code">{toolCall
                                                                            .function
                                                                            .arguments}</pre>
                                                                {/if}
                                                            </div>

                                                            <!-- 工具结果 -->
                                                            {#if toolResult}
                                                                <div
                                                                    class="ai-message__tool-call-result"
                                                                >
                                                                    <div
                                                                        class="ai-message__tool-call-section-header"
                                                                        on:click={() => {
                                                                            toolCallResultsExpanded[
                                                                                resultKey
                                                                            ] = !resultExpanded;
                                                                            toolCallResultsExpanded =
                                                                                {
                                                                                    ...toolCallResultsExpanded,
                                                                                };
                                                                        }}
                                                                    >
                                                                        <svg
                                                                            class="ai-message__tool-call-icon"
                                                                            class:collapsed={!resultExpanded}
                                                                        >
                                                                            <use
                                                                                xlink:href="#iconRight"
                                                                            ></use>
                                                                        </svg>
                                                                        <strong>
                                                                            {i18n('tools.result')}
                                                                        </strong>
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
                                {/if}
                            {/each}
                        {:else}
                            <!-- 兼容旧数据：显示工具调用前的思考过程 -->
                            {#if message.role === 'assistant' && (message.thinkingBeforeToolCalls || (message.thinking && !message.tool_calls)) && !(message.multiModelResponses && message.multiModelResponses.length > 0)}
                                {@const thinkingIndex = messageIndex + msgIndex}
                                {@const thinkingContent =
                                    message.thinkingBeforeToolCalls || message.thinking}
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
                                        {@const thinkDisplay = getDisplayContent(thinkingContent)}
                                        <div class="ai-message__thinking-content b3-typography">
                                            {@html thinkDisplay}
                                        </div>
                                    {/if}
                                </div>
                            {/if}

                            <!-- 显示消息内容（只有在有实际内容时才显示，且没有多模型响应时才显示） -->
                            {#if message.content && message.content
                                    .toString()
                                    .trim() && !(message.role === 'assistant' && message.multiModelResponses && message.multiModelResponses.length > 0)}
                                {@const displayContent = getDisplayContent(message.content)}
                                <div
                                    class="ai-message__content b3-typography"
                                    style={messageFontSize
                                        ? `font-size: ${messageFontSize}px;`
                                        : ''}
                                >
                                    {@html displayContent}
                                </div>
                            {/if}

                            <!-- 兼容旧数据：显示工具调用 -->
                            {#if message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0 && !message.toolCallThinkings && !(message.multiModelResponses && message.multiModelResponses.length > 0)}
                                <div class="ai-message__tool-calls">
                                    <div class="ai-message__tool-calls-title">
                                        🔧 {i18n('tools.calling')} ({message.tool_calls.length})
                                    </div>
                                    {#each message.tool_calls as toolCall}
                                        {@const toolResult = group.messages
                                            .slice(msgIndex + 1)
                                            .find(
                                                m =>
                                                    m.role === 'tool' &&
                                                    m.tool_call_id === toolCall.id
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
                                                                {i18n('tools.selector.parameters')}
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
                                                                    toolCallResultsExpanded[
                                                                        resultKey
                                                                    ] = !resultExpanded;
                                                                    toolCallResultsExpanded = {
                                                                        ...toolCallResultsExpanded,
                                                                    };
                                                                }}
                                                            >
                                                                <svg
                                                                    class="ai-message__tool-call-icon"
                                                                    class:collapsed={!resultExpanded}
                                                                >
                                                                    <use
                                                                        xlink:href="#iconRight"
                                                                    ></use>
                                                                </svg>
                                                                <strong>
                                                                    {i18n('tools.result')}
                                                                </strong>
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

                            <!-- 兼容旧数据：显示工具调用后的思考过程 -->
                            {#if message.role === 'assistant' && message.thinkingAfterToolCalls && !(message.multiModelResponses && message.multiModelResponses.length > 0)}
                                {@const thinkingAfterIndex = messageIndex + msgIndex + '_after'}
                                <div
                                    class="ai-message__thinking ai-message__thinking--after-toolcalls"
                                >
                                    <div
                                        class="ai-message__thinking-header"
                                        on:click={() => {
                                            thinkingCollapsed[thinkingAfterIndex] =
                                                !thinkingCollapsed[thinkingAfterIndex];
                                        }}
                                    >
                                        <svg
                                            class="ai-message__thinking-icon"
                                            class:collapsed={thinkingCollapsed[thinkingAfterIndex]}
                                        >
                                            <use xlink:href="#iconRight"></use>
                                        </svg>
                                        <span class="ai-message__thinking-title">
                                            💭 思考过程（续）
                                        </span>
                                    </div>
                                    {#if !thinkingCollapsed[thinkingAfterIndex]}
                                        {@const thinkAfterDisplay = getDisplayContent(
                                            message.thinkingAfterToolCalls
                                        )}
                                        <div class="ai-message__thinking-content b3-typography">
                                            {@html thinkAfterDisplay}
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        {/if}

                        <!-- 显示多模型响应（历史消息） - 仅在用户已选择答案后显示 -->
                        {#if message.role === 'assistant' && message.multiModelResponses && message.multiModelResponses.length > 0 && message.multiModelResponses.some(r => r.isSelected)}
                            {@const layoutKey = `history_layout_${messageIndex}_${msgIndex}`}
                            {@const currentLayout =
                                thinkingCollapsed[layoutKey] || multiModelViewMode}
                            <div class="ai-message__multi-model-responses">
                                <div class="ai-message__multi-model-header">
                                    <div class="ai-message__multi-model-header-top">
                                        <h4>🤖 多模型响应</h4>
                                        <div class="ai-message__multi-model-layout-selector">
                                            <button
                                                class="b3-button b3-button--text b3-button--small"
                                                class:b3-button--primary={currentLayout === 'card'}
                                                on:click={() => {
                                                    thinkingCollapsed[layoutKey] = 'card';
                                                    thinkingCollapsed = { ...thinkingCollapsed };
                                                }}
                                                title={i18n('multiModel.layout.card')}
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconSplitLR"></use>
                                                </svg>
                                                {i18n('multiModel.layout.card')}
                                            </button>
                                            <button
                                                class="b3-button b3-button--text b3-button--small"
                                                class:b3-button--primary={currentLayout === 'tab'}
                                                on:click={() => {
                                                    thinkingCollapsed[layoutKey] = 'tab';
                                                    thinkingCollapsed = { ...thinkingCollapsed };
                                                }}
                                                title={i18n('multiModel.layout.tab')}
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconSplitTB"></use>
                                                </svg>
                                                {i18n('multiModel.layout.tab')}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {#if currentLayout === 'card'}
                                    <!-- 卡片视图 -->
                                    <div class="ai-sidebar__multi-model-cards">
                                        {#each message.multiModelResponses as response, index}
                                            <div
                                                class="ai-sidebar__multi-model-card"
                                                class:ai-sidebar__multi-model-card--selected={response.isSelected}
                                            >
                                                <div class="ai-sidebar__multi-model-card-header">
                                                    <div class="ai-sidebar__multi-model-card-title">
                                                        <span
                                                            class="ai-sidebar__multi-model-card-model-name"
                                                        >
                                                            {response.modelName}
                                                        </span>
                                                        {#if response.error}
                                                            <span
                                                                class="ai-sidebar__multi-model-card-status ai-sidebar__multi-model-card-status--error"
                                                            >
                                                                ❌ {i18n('multiModel.error')}
                                                            </span>
                                                        {/if}
                                                    </div>
                                                    <div
                                                        class="ai-sidebar__multi-model-card-actions"
                                                    >
                                                        {#if !response.error && response.content}
                                                            <button
                                                                class="b3-button b3-button--text"
                                                                on:click={() =>
                                                                    regenerateHistoryModelResponse(
                                                                        messageIndex + msgIndex,
                                                                        index
                                                                    )}
                                                                title={i18n(
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
                                                                title={i18n(
                                                                    'aiSidebar.actions.copyMessage'
                                                                )}
                                                            >
                                                                <svg class="b3-button__icon">
                                                                    <use
                                                                        xlink:href="#iconCopy"
                                                                    ></use>
                                                                </svg>
                                                            </button>
                                                            <button
                                                                class="b3-button b3-button--primary ai-sidebar__multi-model-select-btn"
                                                                class:ai-sidebar__multi-model-select-btn--selected={response.isSelected}
                                                                on:click={() =>
                                                                    selectHistoryMultiModelAnswer(
                                                                        messageIndex + msgIndex,
                                                                        index
                                                                    )}
                                                            >
                                                                {response.isSelected
                                                                    ? i18n(
                                                                          'multiModel.answerSelected'
                                                                      )
                                                                    : i18n(
                                                                          'multiModel.selectAnswer'
                                                                      )}
                                                            </button>
                                                        {/if}
                                                    </div>
                                                </div>

                                                <div class="ai-sidebar__multi-model-card-scroll">
                                                    <!-- 思考过程 -->
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
                                                                    💭 {i18n(
                                                                        'aiSidebar.messages.thinking'
                                                                    )}
                                                                </span>
                                                            </div>
                                                            {#if !isCollapsed}
                                                                {@const thinkingDisplay =
                                                                    getDisplayContent(
                                                                        response.thinking
                                                                    )}
                                                                <div
                                                                    class="ai-message__thinking-content b3-typography"
                                                                >
                                                                    {@html thinkingDisplay}
                                                                </div>
                                                            {/if}
                                                        </div>
                                                    {/if}
                                                    <!-- 按轮次显示工具调用 -->
                                                    {#if response.toolCalls && response.toolCalls.length > 0}
                                                        {@const groupedToolCalls =
                                                            response.toolCalls.reduce(
                                                                (acc, tc, i) => {
                                                                    const key =
                                                                        tc.thinkingBefore || '';
                                                                    if (
                                                                        acc.length === 0 ||
                                                                        acc[acc.length - 1]
                                                                            .thinking !== key
                                                                    ) {
                                                                        acc.push({
                                                                            thinking: key,
                                                                            toolCalls: [tc],
                                                                        });
                                                                    } else {
                                                                        acc[
                                                                            acc.length - 1
                                                                        ].toolCalls.push(tc);
                                                                    }
                                                                    return acc;
                                                                },
                                                                []
                                                            )}

                                                        {#each groupedToolCalls as group, groupIndex}
                                                            <!-- 该轮工具调用前的思考 -->
                                                            {#if group.thinking}
                                                                <div class="ai-message__thinking">
                                                                    <div
                                                                        class="ai-message__thinking-header"
                                                                        on:click={() => {
                                                                            const key = `hist-mm-${messageIndex}-${msgIndex}-${index}-group-${groupIndex}`;
                                                                            thinkingCollapsed[key] =
                                                                                !thinkingCollapsed[
                                                                                    key
                                                                                ];
                                                                            thinkingCollapsed = {
                                                                                ...thinkingCollapsed,
                                                                            };
                                                                        }}
                                                                    >
                                                                        <svg
                                                                            class="ai-message__thinking-icon"
                                                                            class:collapsed={thinkingCollapsed[
                                                                                `hist-mm-${messageIndex}-${msgIndex}-${index}-group-${groupIndex}`
                                                                            ]}
                                                                        >
                                                                            <use
                                                                                xlink:href="#iconRight"
                                                                            ></use>
                                                                        </svg>
                                                                        <span
                                                                            class="ai-message__thinking-title"
                                                                        >
                                                                            💭 {i18n(
                                                                                'aiSidebar.messages.thinking'
                                                                            )}
                                                                        </span>
                                                                    </div>
                                                                    {#if !thinkingCollapsed[`hist-mm-${messageIndex}-${msgIndex}-${index}-group-${groupIndex}`]}
                                                                        {@const groupThinkDisplay =
                                                                            getDisplayContent(
                                                                                group.thinking
                                                                            )}
                                                                        <div
                                                                            class="ai-message__thinking-content b3-typography"
                                                                        >
                                                                            {@html groupThinkDisplay}
                                                                        </div>
                                                                    {/if}
                                                                </div>
                                                            {/if}

                                                            <!-- 该轮工具调用 -->
                                                            <div
                                                                class="ai-message__tool-calls"
                                                                style="margin-top: 8px;"
                                                            >
                                                                <div
                                                                    class="ai-message__tool-calls-title"
                                                                >
                                                                    🔧 {i18n('tools.calling')} ({group
                                                                        .toolCalls.length})
                                                                </div>
                                                                {#each group.toolCalls as toolCall}
                                                                    {@const toolDisplayName =
                                                                        getToolDisplayName(
                                                                            toolCall.function.name
                                                                        )}
                                                                    {@const isCompleted =
                                                                        toolCall.status ===
                                                                        'completed'}
                                                                    {@const isCollapsed =
                                                                        !toolCallsExpanded[
                                                                            toolCall.id
                                                                        ]}

                                                                    <div
                                                                        class="ai-message__tool-call"
                                                                    >
                                                                        <div
                                                                            class="ai-message__tool-call-header"
                                                                            on:click={() => {
                                                                                toolCallsExpanded[
                                                                                    toolCall.id
                                                                                ] =
                                                                                    !toolCallsExpanded[
                                                                                        toolCall.id
                                                                                    ];
                                                                                toolCallsExpanded =
                                                                                    {
                                                                                        ...toolCallsExpanded,
                                                                                    };
                                                                            }}
                                                                        >
                                                                            <div
                                                                                class="ai-message__tool-call-name"
                                                                            >
                                                                                <svg
                                                                                    class="ai-message__tool-call-icon"
                                                                                    class:collapsed={isCollapsed}
                                                                                >
                                                                                    <use
                                                                                        xlink:href="#iconRight"
                                                                                    ></use>
                                                                                </svg>
                                                                                <span>
                                                                                    {toolDisplayName}
                                                                                </span>
                                                                                {#if isCompleted}
                                                                                    <span
                                                                                        class="ai-message__tool-call-status"
                                                                                    >
                                                                                        ✅
                                                                                    </span>
                                                                                {:else}
                                                                                    <span
                                                                                        class="ai-message__tool-call-status"
                                                                                    >
                                                                                        ⏳
                                                                                    </span>
                                                                                {/if}
                                                                            </div>
                                                                        </div>

                                                                        {#if !isCollapsed}
                                                                            <div
                                                                                class="ai-message__tool-call-details"
                                                                            >
                                                                                <div
                                                                                    class="ai-message__tool-call-params"
                                                                                >
                                                                                    <div
                                                                                        class="ai-message__tool-call-section-header"
                                                                                    >
                                                                                        {i18n(
                                                                                            'aiSidebar.messages.params'
                                                                                        )}
                                                                                    </div>
                                                                                    <div
                                                                                        class="ai-message__tool-call-code-wrapper"
                                                                                    >
                                                                                        <pre
                                                                                            class="ai-message__tool-call-code"><code>{toolCall
                                                                                                    .function
                                                                                                    .arguments}</code></pre>
                                                                                    </div>
                                                                                </div>
                                                                                {#if toolCall.result}
                                                                                    <div
                                                                                        class="ai-message__tool-call-result"
                                                                                    >
                                                                                        <div
                                                                                            class="ai-message__tool-call-section-header"
                                                                                        >
                                                                                            {i18n(
                                                                                                'aiSidebar.messages.result'
                                                                                            )}
                                                                                        </div>
                                                                                        <div
                                                                                            class="ai-message__tool-call-code-wrapper"
                                                                                        >
                                                                                            <pre
                                                                                                class="ai-message__tool-call-code"><code>{toolCall.result}</code></pre>
                                                                                        </div>
                                                                                    </div>
                                                                                {/if}
                                                                            </div>
                                                                        {/if}
                                                                    </div>
                                                                {/each}
                                                            </div>
                                                        {/each}

                                                        <!-- 最终思考（如果有） -->
                                                        {#if response.thinking && !response.toolCalls.some(tc => tc.thinkingBefore === response.thinking)}
                                                            <div
                                                                class="ai-message__thinking"
                                                                style="margin-top: 8px;"
                                                            >
                                                                <div
                                                                    class="ai-message__thinking-header"
                                                                    on:click={() => {
                                                                        message.multiModelResponses[
                                                                            index
                                                                        ].thinkingCollapsed =
                                                                            !response.thinkingCollapsed;
                                                                        messages = [...messages];
                                                                    }}
                                                                >
                                                                    <svg
                                                                        class="ai-message__thinking-icon"
                                                                        class:collapsed={response.thinkingCollapsed}
                                                                    >
                                                                        <use
                                                                            xlink:href="#iconRight"
                                                                        ></use>
                                                                    </svg>
                                                                    <span
                                                                        class="ai-message__thinking-title"
                                                                    >
                                                                        💭 {i18n(
                                                                            'aiSidebar.messages.thinking'
                                                                        )}
                                                                    </span>
                                                                </div>
                                                                {#if !response.thinkingCollapsed}
                                                                    {@const finalThinkDisplay =
                                                                        getDisplayContent(
                                                                            response.thinking
                                                                        )}
                                                                    <div
                                                                        class="ai-message__thinking-content b3-typography"
                                                                    >
                                                                        {@html finalThinkDisplay}
                                                                    </div>
                                                                {/if}
                                                            </div>
                                                        {/if}
                                                    {:else if response.thinking}
                                                        <!-- 没有工具调用时，只显示思考 -->
                                                        <div class="ai-message__thinking">
                                                            <div
                                                                class="ai-message__thinking-header"
                                                                on:click={() => {
                                                                    message.multiModelResponses[
                                                                        index
                                                                    ].thinkingCollapsed =
                                                                        !response.thinkingCollapsed;
                                                                    messages = [...messages];
                                                                }}
                                                            >
                                                                <svg
                                                                    class="ai-message__thinking-icon"
                                                                    class:collapsed={response.thinkingCollapsed}
                                                                >
                                                                    <use
                                                                        xlink:href="#iconRight"
                                                                    ></use>
                                                                </svg>
                                                                <span
                                                                    class="ai-message__thinking-title"
                                                                >
                                                                    💭 {i18n(
                                                                        'aiSidebar.messages.thinking'
                                                                    )}
                                                                </span>
                                                            </div>
                                                            {#if !response.thinkingCollapsed}
                                                                {@const thinkingDisplay =
                                                                    getDisplayContent(
                                                                        response.thinking
                                                                    )}
                                                                <div
                                                                    class="ai-message__thinking-content b3-typography"
                                                                >
                                                                    {@html thinkingDisplay}
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
                                                            handleContextMenu(
                                                                e,
                                                                messageIndex + msgIndex,
                                                                'assistant'
                                                            )}
                                                    >
                                                        {#if response.error}
                                                            <div
                                                                class="ai-sidebar__multi-model-card-error"
                                                            >
                                                                {response.error}
                                                            </div>
                                                        {:else if response.content}
                                                            {@const contentDisplay =
                                                                getDisplayContent(response.content)}
                                                            {@html contentDisplay}
                                                        {/if}
                                                    </div>
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                {:else}
                                    <!-- 页签视图 -->
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
                                                        thinkingCollapsed = {
                                                            ...thinkingCollapsed,
                                                        };
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
                                                                                messageIndex +
                                                                                    msgIndex,
                                                                                index
                                                                            )}
                                                                        title={i18n(
                                                                            'aiSidebar.actions.regenerate'
                                                                        )}
                                                                    >
                                                                        <svg
                                                                            class="b3-button__icon"
                                                                        >
                                                                            <use
                                                                                xlink:href="#iconRefresh"
                                                                            ></use>
                                                                        </svg>
                                                                    </button>
                                                                    <button
                                                                        class="b3-button b3-button--text ai-sidebar__multi-model-copy-btn"
                                                                        on:click={() =>
                                                                            copyMessage(
                                                                                response.content ||
                                                                                    ''
                                                                            )}
                                                                        title={i18n(
                                                                            'aiSidebar.actions.copyMessage'
                                                                        )}
                                                                    >
                                                                        <svg
                                                                            class="b3-button__icon"
                                                                        >
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
                                                                    {@const thinkingDisplay =
                                                                        getDisplayContent(
                                                                            response.thinking
                                                                        )}
                                                                    <div
                                                                        class="ai-message__thinking-content b3-typography"
                                                                    >
                                                                        {@html thinkingDisplay}
                                                                    </div>
                                                                {/if}
                                                            </div>
                                                        {/if}

                                                        <!-- 按轮次显示工具调用 -->
                                                        {#if response.toolCalls && response.toolCalls.length > 0}
                                                            {@const groupedToolCalls =
                                                                response.toolCalls.reduce(
                                                                    (acc, tc, i) => {
                                                                        const key =
                                                                            tc.thinkingBefore || '';
                                                                        if (
                                                                            acc.length === 0 ||
                                                                            acc[acc.length - 1]
                                                                                .thinking !== key
                                                                        ) {
                                                                            acc.push({
                                                                                thinking: key,
                                                                                toolCalls: [tc],
                                                                            });
                                                                        } else {
                                                                            acc[
                                                                                acc.length - 1
                                                                            ].toolCalls.push(tc);
                                                                        }
                                                                        return acc;
                                                                    },
                                                                    []
                                                                )}

                                                            {#each groupedToolCalls as group, groupIndex}
                                                                <!-- 该轮工具调用前的思考 -->
                                                                {#if group.thinking}
                                                                    <div
                                                                        class="ai-message__thinking"
                                                                    >
                                                                        <div
                                                                            class="ai-message__thinking-header"
                                                                            on:click={() => {
                                                                                const key = `hist-tab-${messageIndex}-${msgIndex}-${index}-group-${groupIndex}`;
                                                                                thinkingCollapsed[
                                                                                    key
                                                                                ] =
                                                                                    !thinkingCollapsed[
                                                                                        key
                                                                                    ];
                                                                                thinkingCollapsed =
                                                                                    {
                                                                                        ...thinkingCollapsed,
                                                                                    };
                                                                            }}
                                                                        >
                                                                            <svg
                                                                                class="ai-message__thinking-icon"
                                                                                class:collapsed={thinkingCollapsed[
                                                                                    `hist-tab-${messageIndex}-${msgIndex}-${index}-group-${groupIndex}`
                                                                                ]}
                                                                            >
                                                                                <use
                                                                                    xlink:href="#iconRight"
                                                                                ></use>
                                                                            </svg>
                                                                            <span
                                                                                class="ai-message__thinking-title"
                                                                            >
                                                                                💭 {i18n(
                                                                                    'aiSidebar.messages.thinking'
                                                                                )}
                                                                            </span>
                                                                        </div>
                                                                        {#if !thinkingCollapsed[`hist-tab-${messageIndex}-${msgIndex}-${index}-group-${groupIndex}`]}
                                                                            {@const groupThinkDisplay =
                                                                                getDisplayContent(
                                                                                    group.thinking
                                                                                )}
                                                                            <div
                                                                                class="ai-message__thinking-content b3-typography"
                                                                            >
                                                                                {@html groupThinkDisplay}
                                                                            </div>
                                                                        {/if}
                                                                    </div>
                                                                {/if}

                                                                <!-- 该轮工具调用 -->
                                                                <div
                                                                    class="ai-message__tool-calls"
                                                                    style="margin-top: 8px;"
                                                                >
                                                                    <div
                                                                        class="ai-message__tool-calls-title"
                                                                    >
                                                                        🔧 {i18n('tools.calling')} ({group
                                                                            .toolCalls.length})
                                                                    </div>
                                                                    {#each group.toolCalls as toolCall}
                                                                        {@const toolDisplayName =
                                                                            getToolDisplayName(
                                                                                toolCall.function
                                                                                    .name
                                                                            )}
                                                                        {@const isCompleted =
                                                                            toolCall.status ===
                                                                            'completed'}
                                                                        {@const isCollapsed =
                                                                            !toolCallsExpanded[
                                                                                toolCall.id
                                                                            ]}

                                                                        <div
                                                                            class="ai-message__tool-call"
                                                                        >
                                                                            <div
                                                                                class="ai-message__tool-call-header"
                                                                                on:click={() => {
                                                                                    toolCallsExpanded[
                                                                                        toolCall.id
                                                                                    ] =
                                                                                        !toolCallsExpanded[
                                                                                            toolCall
                                                                                                .id
                                                                                        ];
                                                                                    toolCallsExpanded =
                                                                                        {
                                                                                            ...toolCallsExpanded,
                                                                                        };
                                                                                }}
                                                                            >
                                                                                <div
                                                                                    class="ai-message__tool-call-name"
                                                                                >
                                                                                    <svg
                                                                                        class="ai-message__tool-call-icon"
                                                                                        class:collapsed={isCollapsed}
                                                                                    >
                                                                                        <use
                                                                                            xlink:href="#iconRight"
                                                                                        ></use>
                                                                                    </svg>
                                                                                    <span>
                                                                                        {toolDisplayName}
                                                                                    </span>
                                                                                    {#if isCompleted}
                                                                                        <span
                                                                                            class="ai-message__tool-call-status"
                                                                                        >
                                                                                            ✅
                                                                                        </span>
                                                                                    {:else}
                                                                                        <span
                                                                                            class="ai-message__tool-call-status"
                                                                                        >
                                                                                            ⏳
                                                                                        </span>
                                                                                    {/if}
                                                                                </div>
                                                                            </div>

                                                                            {#if !isCollapsed}
                                                                                <div
                                                                                    class="ai-message__tool-call-details"
                                                                                >
                                                                                    <div
                                                                                        class="ai-message__tool-call-params"
                                                                                    >
                                                                                        <div
                                                                                            class="ai-message__tool-call-section-header"
                                                                                        >
                                                                                            {i18n(
                                                                                                'aiSidebar.messages.params'
                                                                                            )}
                                                                                        </div>
                                                                                        <div
                                                                                            class="ai-message__tool-call-code-wrapper"
                                                                                        >
                                                                                            <pre
                                                                                                class="ai-message__tool-call-code"><code>{toolCall
                                                                                                        .function
                                                                                                        .arguments}</code></pre>
                                                                                        </div>
                                                                                    </div>
                                                                                    {#if toolCall.result}
                                                                                        <div
                                                                                            class="ai-message__tool-call-result"
                                                                                        >
                                                                                            <div
                                                                                                class="ai-message__tool-call-section-header"
                                                                                            >
                                                                                                {i18n(
                                                                                                    'aiSidebar.messages.result'
                                                                                                )}
                                                                                            </div>
                                                                                            <div
                                                                                                class="ai-message__tool-call-code-wrapper"
                                                                                            >
                                                                                                <pre
                                                                                                    class="ai-message__tool-call-code"><code>{toolCall.result}</code></pre>
                                                                                            </div>
                                                                                        </div>
                                                                                    {/if}
                                                                                </div>
                                                                            {/if}
                                                                        </div>
                                                                    {/each}
                                                                </div>
                                                            {/each}

                                                            <!-- 最终思考（如果有） -->
                                                            {#if response.thinking && !response.toolCalls.some(tc => tc.thinkingBefore === response.thinking)}
                                                                <div
                                                                    class="ai-message__thinking"
                                                                    style="margin-top: 8px;"
                                                                >
                                                                    <div
                                                                        class="ai-message__thinking-header"
                                                                        on:click={() => {
                                                                            message.multiModelResponses[
                                                                                index
                                                                            ].thinkingCollapsed =
                                                                                !response.thinkingCollapsed;
                                                                            messages = [
                                                                                ...messages,
                                                                            ];
                                                                        }}
                                                                    >
                                                                        <svg
                                                                            class="ai-message__thinking-icon"
                                                                            class:collapsed={response.thinkingCollapsed}
                                                                        >
                                                                            <use
                                                                                xlink:href="#iconRight"
                                                                            ></use>
                                                                        </svg>
                                                                        <span
                                                                            class="ai-message__thinking-title"
                                                                        >
                                                                            💭 {i18n(
                                                                                'aiSidebar.messages.thinking'
                                                                            )}
                                                                        </span>
                                                                    </div>
                                                                    {#if !response.thinkingCollapsed}
                                                                        {@const finalThinkDisplay =
                                                                            getDisplayContent(
                                                                                response.thinking
                                                                            )}
                                                                        <div
                                                                            class="ai-message__thinking-content b3-typography"
                                                                        >
                                                                            {@html finalThinkDisplay}
                                                                        </div>
                                                                    {/if}
                                                                </div>
                                                            {/if}
                                                        {:else if response.thinking}
                                                            <!-- 没有工具调用时，只显示思考 -->
                                                            <div class="ai-message__thinking">
                                                                <div
                                                                    class="ai-message__thinking-header"
                                                                    on:click={() => {
                                                                        message.multiModelResponses[
                                                                            index
                                                                        ].thinkingCollapsed =
                                                                            !response.thinkingCollapsed;
                                                                        messages = [...messages];
                                                                    }}
                                                                >
                                                                    <svg
                                                                        class="ai-message__thinking-icon"
                                                                        class:collapsed={response.thinkingCollapsed}
                                                                    >
                                                                        <use
                                                                            xlink:href="#iconRight"
                                                                        ></use>
                                                                    </svg>
                                                                    <span
                                                                        class="ai-message__thinking-title"
                                                                    >
                                                                        💭 {i18n(
                                                                            'aiSidebar.messages.thinking'
                                                                        )}
                                                                    </span>
                                                                </div>
                                                                {#if !response.thinkingCollapsed}
                                                                    {@const thinkingDisplay =
                                                                        getDisplayContent(
                                                                            response.thinking
                                                                        )}
                                                                    <div
                                                                        class="ai-message__thinking-content b3-typography"
                                                                    >
                                                                        {@html thinkingDisplay}
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
                                                                {@const contentDisplay =
                                                                    getDisplayContent(
                                                                        response.content
                                                                    )}
                                                                {@html contentDisplay}
                                                            {/if}
                                                        </div>
                                                    </div>
                                                {/if}
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        {/if}

                        <!-- 显示上下文文档和附件 -->
                        {#if (message.contextDocuments && message.contextDocuments.length > 0) || (message.attachments && message.attachments.length > 0)}
                            {@const contextCount =
                                (message.contextDocuments?.length || 0) +
                                (message.attachments?.length || 0)}
                            <div class="ai-message__context-docs">
                                <div class="ai-message__context-docs-title">
                                    {#if message.role === 'assistant'}
                                        🖼️ 图片与附件 ({contextCount})
                                    {:else}
                                        📎 {i18n('aiSidebar.context.content')} ({contextCount})
                                    {/if}
                                </div>
                                {#if shouldShowDrawImageChoice(message)}
                                    <div
                                        class="ai-message__draw-image-selection-hint"
                                        class:ai-message__draw-image-selection-hint--done={!isDrawImageSelectionRequired(
                                            message
                                        )}
                                    >
                                        {#if isDrawImageSelectionRequired(message)}
                                            请选择一张满意图片用于继续编辑
                                        {:else}
                                            已选择第 {(getDrawSelectedImageIndex(message) ?? 0) + 1}
                                            张图片用于继续编辑
                                        {/if}
                                    </div>
                                {/if}

                                <!-- 显示附件 -->
                                {#if message.attachments && message.attachments.length > 0}
                                    <div class="ai-message__context-docs-list">
                                        {#each message.attachments as attachment, attachmentIndex}
                                            <div
                                                class="ai-message__attachment"
                                                class:ai-message__attachment--draw-selected={isDrawAttachmentSelected(
                                                    message,
                                                    attachmentIndex
                                                )}
                                            >
                                                {#if attachment.type === 'image'}
                                                    {@const imageIndex = getImageAttachmentIndex(
                                                        message,
                                                        attachmentIndex
                                                    )}
                                                    <img
                                                        src={attachment.data}
                                                        alt={attachment.name}
                                                        class="ai-message__attachment-image"
                                                        on:click={() =>
                                                            openImageViewer(
                                                                attachment.data,
                                                                attachment.name
                                                            )}
                                                        title="点击查看大图"
                                                    />
                                                    {#if shouldShowDrawImageChoice(message)}
                                                        <button
                                                            class="b3-button ai-message__draw-image-choice"
                                                            class:b3-button--primary={isDrawAttachmentSelected(
                                                                message,
                                                                attachmentIndex
                                                            )}
                                                            class:b3-button--text={!isDrawAttachmentSelected(
                                                                message,
                                                                attachmentIndex
                                                            )}
                                                            on:click={() =>
                                                                selectDrawGeneratedImage(
                                                                    messageIndex + msgIndex,
                                                                    imageIndex
                                                                )}
                                                            disabled={isLoading}
                                                            title="选择这张图片用于继续编辑"
                                                        >
                                                            {#if isDrawAttachmentSelected(
                                                                message,
                                                                attachmentIndex
                                                            )}
                                                                已选择
                                                            {:else}
                                                                选择这张
                                                            {/if}
                                                        </button>
                                                    {/if}
                                                    <button
                                                        class="b3-button b3-button--text ai-message__attachment-copy"
                                                        on:click={() => {
                                                            platformUtils.writeText(
                                                                attachment.data
                                                            );
                                                            pushMsg('已复制图片URL');
                                                        }}
                                                        title="复制图片URL"
                                                    >
                                                        <svg class="b3-button__icon">
                                                            <use xlink:href="#iconCopy"></use>
                                                        </svg>
                                                    </button>
                                                    <span class="ai-message__attachment-name">
                                                        {attachment.name}
                                                    </span>
                                                {:else}
                                                    <div class="ai-message__attachment-file">
                                                        {#if attachment.isWebPage}
                                                            <span
                                                                class="ai-message__attachment-icon-emoji"
                                                            >
                                                                🔗
                                                            </span>
                                                        {:else}
                                                            <svg
                                                                class="ai-message__attachment-icon"
                                                            >
                                                                <use xlink:href="#iconFile"></use>
                                                            </svg>
                                                        {/if}
                                                        <span class="ai-message__attachment-name">
                                                            {attachment.name}
                                                        </span>
                                                        <button
                                                            class="b3-button b3-button--text ai-message__attachment-copy"
                                                            on:click={() => {
                                                                platformUtils.writeText(
                                                                    attachment.data
                                                                );
                                                                pushMsg(
                                                                    attachment.isWebPage
                                                                        ? '已复制网页Markdown内容'
                                                                        : '已复制文件内容'
                                                                );
                                                            }}
                                                            title={attachment.isWebPage
                                                                ? '复制网页Markdown'
                                                                : '复制文件内容'}
                                                        >
                                                            <svg class="b3-button__icon">
                                                                <use xlink:href="#iconCopy"></use>
                                                            </svg>
                                                        </button>
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
                                                    on:click|stopPropagation={() =>
                                                        copyMessage(doc.content || '')}
                                                    title={i18n('aiSidebar.actions.copyMessage')}
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

                        <!-- 显示工具调用后的最终回复 -->
                        {#if message.role === 'assistant' && message.finalReply}
                            {@const finalReplyDisplay = getDisplayContent(message.finalReply)}
                            <div
                                class="ai-message__content ai-message__final-reply b3-typography"
                                style={messageFontSize ? `font-size: ${messageFontSize}px;` : ''}
                            >
                                {@html finalReplyDisplay}
                            </div>
                        {/if}

                        <!-- 显示编辑操作 -->
                        {#if message.role === 'assistant' && message.editOperations && message.editOperations.length > 0}
                            <div class="ai-message__edit-operations">
                                <div class="ai-message__edit-operations-title">
                                    📝 文档总差异 ({message.editOperations.length})
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
                                                📄 {operation.docTitle ||
                                                    operation.docId ||
                                                    operation.blockId}
                                            </span>
                                            <span class="ai-message__edit-operation-status">
                                                {#if operation.status === 'applied'}
                                                    ✓ {i18n('aiSidebar.actions.applied')}
                                                {:else if operation.status === 'rejected'}
                                                    ✗ {i18n('aiSidebar.actions.rejected')}
                                                {:else}
                                                    ⏳ {i18n('aiSidebar.edit.changes')}
                                                {/if}
                                            </span>
                                        </div>
                                        {#if operation.affectedBlockIds && operation.affectedBlockIds.length > 0}
                                            <div class="ai-message__edit-operation-block-ids">
                                                块ID: {operation.affectedBlockIds.join(', ')}
                                            </div>
                                        {/if}
                                        {#if operation.oldDocTitle && operation.newDocTitle && operation.oldDocTitle !== operation.newDocTitle}
                                            <div class="ai-message__edit-operation-block-ids">
                                                标题: {operation.oldDocTitle} → {operation.newDocTitle}
                                            </div>
                                        {/if}
                                        <div class="ai-message__edit-operation-actions">
                                            <!-- 查看差异按钮：所有状态都可以查看 -->
                                            <button
                                                class="b3-button b3-button--text"
                                                on:click={() => viewDiff(operation)}
                                                title={i18n('aiSidebar.actions.viewDiff')}
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconEye"></use>
                                                </svg>
                                                {i18n('aiSidebar.actions.viewDiff')}
                                            </button>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    {/if}
                {/each}

                <!-- 消息操作按钮（组级别，只显示一次） -->
                <!-- 如果存在多模型响应且未选择答案，或者AI正在回答中，则不显示操作按钮 -->
                {#if !isLoading && (!firstMessage.multiModelResponses || (firstMessage.multiModelResponses && firstMessage.multiModelResponses.some(r => r.isSelected)))}
                    <div class="ai-message__actions">
                        <button
                            class="b3-button b3-button--text ai-message__action"
                            on:click={() => copyMessage(getActualMessageContent(firstMessage))}
                            title={i18n('aiSidebar.actions.copyMessage')}
                        >
                            <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        </button>
                        <button
                            class="b3-button b3-button--text ai-message__action"
                            on:click={() => openSaveToNoteDialog(messageIndex)}
                            title={i18n('aiSidebar.actions.saveToNote')}
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconDownload"></use>
                            </svg>
                        </button>
                        <button
                            class="b3-button b3-button--text ai-message__action"
                            on:click={() => startEditMessage(messageIndex)}
                            title={i18n('aiSidebar.actions.editMessage')}
                        >
                            <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                        </button>
                        <button
                            class="b3-button b3-button--text ai-message__action"
                            on:click={() => deleteMessage(messageIndex)}
                            title={i18n('aiSidebar.actions.deleteMessage')}
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconTrashcan"></use>
                            </svg>
                        </button>
                        <button
                            class="b3-button b3-button--text ai-message__action"
                            on:click={() => regenerateMessage(messageIndex)}
                            title={group.type === 'user'
                                ? i18n('aiSidebar.actions.resend')
                                : i18n('aiSidebar.actions.regenerate')}
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconRefresh"></use>
                            </svg>
                        </button>
                    </div>
                {/if}
            </div>
        {/each}

        {#if isLoading && !(enableMultiModel && chatMode === 'ask' && selectedMultiModels.length > 0)}
            <div
                class="ai-message ai-message--assistant ai-message--streaming"
                on:contextmenu={e => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
            >
                <div class="ai-message__header">
                    <span class="ai-message__role">🤖 AI</span>
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
                            {@const streamThinkingDisplay = getDisplayContent(streamingThinking)}
                            <div class="ai-message__thinking-content b3-typography">
                                {@html streamThinkingDisplay}
                            </div>
                        {:else}
                            {@const streamThinkingDisplay2 = getDisplayContent(streamingThinking)}
                            <div
                                class="ai-message__thinking-content ai-message__thinking-content--streaming b3-typography"
                            >
                                {@html streamThinkingDisplay2}
                            </div>
                        {/if}
                    </div>
                {/if}

                {#if streamingMessage}
                    <div
                        class="ai-message__content b3-typography"
                        style={messageFontSize ? `font-size: ${messageFontSize}px;` : ''}
                    >
                        {#if chatMode === 'draw'}
                            <span>{streamingMessage}</span>
                            <span class="jumping-dots ai-message__draw-loading-indicator" aria-hidden="true">
                                <span class="dot"></span>
                                <span class="dot"></span>
                                <span class="dot"></span>
                            </span>
                        {:else}
                            {@const streamMsgDisplay = getDisplayContent(streamingMessage)}
                            {@html streamMsgDisplay}
                        {/if}
                    </div>
                {:else if !streamingThinking}
                    <div class="ai-message__content b3-typography">
                        <div class="ai-message__waiting-placeholder">
                            <span class="jumping-dots">
                                <span class="dot"></span>
                                <span class="dot"></span>
                                <span class="dot"></span>
                            </span>
                        </div>
                    </div>
                {/if}
            </div>
        {/if}

        <!-- 多模型响应 -->
        {#if multiModelResponses.length > 0}
            <div class="ai-sidebar__multi-model-responses">
                <div class="ai-sidebar__multi-model-header">
                    <div class="ai-sidebar__multi-model-header-top">
                        <h3>{i18n('multiModel.responses')}</h3>
                        <div class="ai-sidebar__multi-model-layout-selector">
                            <button
                                class="b3-button b3-button--text b3-button--small"
                                class:b3-button--primary={multiModelLayout === 'card'}
                                on:click={() => (multiModelLayout = 'card')}
                                title={i18n('multiModel.layout.card')}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconSplitLR"></use>
                                </svg>
                                {i18n('multiModel.layout.card')}
                            </button>
                            <button
                                class="b3-button b3-button--text b3-button--small"
                                class:b3-button--primary={multiModelLayout === 'tab'}
                                on:click={() => (multiModelLayout = 'tab')}
                                title={i18n('multiModel.layout.tab')}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconSplitTB"></use>
                                </svg>
                                {i18n('multiModel.layout.tab')}
                            </button>
                        </div>
                    </div>
                    {#if isWaitingForAnswerSelection}
                        <div class="ai-sidebar__multi-model-hint">
                            {i18n('multiModel.waitingSelection')}
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
                                                ⏳ {i18n('multiModel.loading')}
                                            </span>
                                        {:else if response.error}
                                            <span
                                                class="ai-sidebar__multi-model-card-status ai-sidebar__multi-model-card-status--error"
                                            >
                                                ❌ {i18n('multiModel.error')}
                                            </span>
                                        {/if}
                                    </div>
                                    <div class="ai-sidebar__multi-model-card-actions">
                                        {#if !response.isLoading && !response.error}
                                            <button
                                                class="b3-button b3-button--text ai-sidebar__multi-model-copy-btn"
                                                on:click={() => copyMessage(response.content || '')}
                                                title={i18n('aiSidebar.actions.copyMessage')}
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
                                                title={i18n('aiSidebar.actions.regenerate')}
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconRefresh"></use>
                                                </svg>
                                            </button>
                                            <button
                                                class="b3-button b3-button--primary ai-sidebar__multi-model-select-btn"
                                                class:ai-sidebar__multi-model-select-btn--selected={selectedAnswerIndex ===
                                                    index}
                                                on:click={() => selectMultiModelAnswer(index)}
                                            >
                                                {selectedAnswerIndex === index
                                                    ? i18n('multiModel.answerSelected')
                                                    : i18n('multiModel.selectAnswer')}
                                            </button>
                                        {/if}
                                    </div>
                                </div>

                                <div class="ai-sidebar__multi-model-card-scroll">
                                    <!-- 按轮次显示思考、工具调用和回复 -->
                                    {#if response.toolCalls && response.toolCalls.length > 0}
                                        {@const groupedToolCalls = response.toolCalls.reduce(
                                            (acc, tc, i) => {
                                                const key = tc.thinkingBefore || '';
                                                if (
                                                    acc.length === 0 ||
                                                    acc[acc.length - 1].thinking !== key
                                                ) {
                                                    acc.push({ thinking: key, toolCalls: [tc] });
                                                } else {
                                                    acc[acc.length - 1].toolCalls.push(tc);
                                                }
                                                return acc;
                                            },
                                            []
                                        )}

                                        {#each groupedToolCalls as group, groupIndex}
                                            <!-- 该轮工具调用前的思考 -->
                                            {#if group.thinking}
                                                <div class="ai-message__thinking">
                                                    <div
                                                        class="ai-message__thinking-header"
                                                        on:click={() => {
                                                            const key = `mm-${index}-group-${groupIndex}`;
                                                            thinkingCollapsed[key] =
                                                                !thinkingCollapsed[key];
                                                            thinkingCollapsed = {
                                                                ...thinkingCollapsed,
                                                            };
                                                        }}
                                                    >
                                                        <svg
                                                            class="ai-message__thinking-icon"
                                                            class:collapsed={thinkingCollapsed[
                                                                `mm-${index}-group-${groupIndex}`
                                                            ]}
                                                        >
                                                            <use xlink:href="#iconRight"></use>
                                                        </svg>
                                                        <span class="ai-message__thinking-title">
                                                            💭 {i18n('aiSidebar.messages.thinking')}
                                                        </span>
                                                    </div>
                                                    {#if !thinkingCollapsed[`mm-${index}-group-${groupIndex}`]}
                                                        {@const streamCardThink = getDisplayContent(
                                                            group.thinking
                                                        )}
                                                        <div
                                                            class="ai-message__thinking-content b3-typography"
                                                        >
                                                            {@html streamCardThink}
                                                        </div>
                                                    {/if}
                                                </div>
                                            {/if}

                                            <!-- 该轮工具调用 -->
                                            <div
                                                class="ai-message__tool-calls"
                                                style="margin-top: 8px;"
                                            >
                                                <div class="ai-message__tool-calls-title">
                                                    🔧 {i18n('tools.calling')} ({group.toolCalls
                                                        .length})
                                                </div>
                                                {#each group.toolCalls as toolCall}
                                                    {@const toolDisplayName = getToolDisplayName(
                                                        toolCall.function.name
                                                    )}
                                                    {@const isCompleted =
                                                        toolCall.status === 'completed'}
                                                    {@const isCollapsed =
                                                        !toolCallsExpanded[toolCall.id]}

                                                    <div class="ai-message__tool-call">
                                                        <div
                                                            class="ai-message__tool-call-header"
                                                            on:click={() => {
                                                                toolCallsExpanded[toolCall.id] =
                                                                    !toolCallsExpanded[toolCall.id];
                                                                toolCallsExpanded = {
                                                                    ...toolCallsExpanded,
                                                                };
                                                            }}
                                                        >
                                                            <div class="ai-message__tool-call-name">
                                                                <svg
                                                                    class="ai-message__tool-call-icon"
                                                                    class:collapsed={isCollapsed}
                                                                >
                                                                    <use
                                                                        xlink:href="#iconRight"
                                                                    ></use>
                                                                </svg>
                                                                <span>{toolDisplayName}</span>
                                                                {#if isCompleted}
                                                                    <span
                                                                        class="ai-message__tool-call-status"
                                                                    >
                                                                        ✅
                                                                    </span>
                                                                {:else}
                                                                    <span
                                                                        class="ai-message__tool-call-status"
                                                                    >
                                                                        ⏳
                                                                    </span>
                                                                {/if}
                                                            </div>
                                                        </div>

                                                        {#if !isCollapsed}
                                                            <div
                                                                class="ai-message__tool-call-details"
                                                            >
                                                                <div
                                                                    class="ai-message__tool-call-params"
                                                                >
                                                                    <div
                                                                        class="ai-message__tool-call-section-header"
                                                                    >
                                                                        {i18n(
                                                                            'aiSidebar.messages.params'
                                                                        )}
                                                                    </div>
                                                                    <div
                                                                        class="ai-message__tool-call-code-wrapper"
                                                                    >
                                                                        <pre
                                                                            class="ai-message__tool-call-code"><code>{toolCall
                                                                                    .function
                                                                                    .arguments}</code></pre>
                                                                    </div>
                                                                </div>
                                                                {#if toolCall.result}
                                                                    <div
                                                                        class="ai-message__tool-call-result"
                                                                    >
                                                                        <div
                                                                            class="ai-message__tool-call-section-header"
                                                                        >
                                                                            {i18n(
                                                                                'aiSidebar.messages.result'
                                                                            )}
                                                                        </div>
                                                                        <div
                                                                            class="ai-message__tool-call-code-wrapper"
                                                                        >
                                                                            <pre
                                                                                class="ai-message__tool-call-code"><code>{toolCall.result}</code></pre>
                                                                        </div>
                                                                    </div>
                                                                {/if}
                                                            </div>
                                                        {/if}
                                                    </div>
                                                {/each}
                                            </div>
                                        {/each}

                                        <!-- 最终思考（如果有） -->
                                        {#if response.thinking && !response.toolCalls.some(tc => tc.thinkingBefore === response.thinking)}
                                            <div
                                                class="ai-message__thinking"
                                                style="margin-top: 8px;"
                                            >
                                                <div
                                                    class="ai-message__thinking-header"
                                                    on:click={() => {
                                                        multiModelResponses[
                                                            index
                                                        ].thinkingCollapsed =
                                                            !multiModelResponses[index]
                                                                .thinkingCollapsed;
                                                        multiModelResponses = [
                                                            ...multiModelResponses,
                                                        ];
                                                    }}
                                                >
                                                    <svg
                                                        class="ai-message__thinking-icon"
                                                        class:collapsed={response.thinkingCollapsed}
                                                    >
                                                        <use xlink:href="#iconRight"></use>
                                                    </svg>
                                                    <span class="ai-message__thinking-title">
                                                        💭 {i18n('aiSidebar.messages.thinking')}
                                                    </span>
                                                </div>
                                                {#if !response.thinkingCollapsed}
                                                    {@const streamCardThink = getDisplayContent(
                                                        response.thinking
                                                    )}
                                                    <div
                                                        class="ai-message__thinking-content b3-typography"
                                                    >
                                                        {@html streamCardThink}
                                                    </div>
                                                {/if}
                                            </div>
                                        {/if}
                                    {:else if response.thinking}
                                        <!-- 没有工具调用时，只显示思考 -->
                                        <div class="ai-message__thinking">
                                            <div
                                                class="ai-message__thinking-header"
                                                on:click={() => {
                                                    multiModelResponses[index].thinkingCollapsed =
                                                        !multiModelResponses[index]
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
                                                    💭 {i18n('aiSidebar.messages.thinking')}
                                                </span>
                                            </div>
                                            {#if !response.thinkingCollapsed}
                                                {@const streamCardThink = getDisplayContent(
                                                    response.thinking
                                                )}
                                                <div
                                                    class="ai-message__thinking-content b3-typography"
                                                >
                                                    {@html streamCardThink}
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
                                            {@const streamCardContent = getDisplayContent(
                                                response.content
                                            )}
                                            {@html streamCardContent}
                                        {:else if response.isLoading}
                                            <div class="ai-sidebar__multi-model-card-loading">
                                                <span class="jumping-dots">
                                                    <span class="dot"></span>
                                                    <span class="dot"></span>
                                                    <span class="dot"></span>
                                                </span>
                                            </div>
                                        {/if}
                                    </div>
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
                                            <span class="jumping-dots jumping-dots--small">
                                                <span class="dot"></span>
                                                <span class="dot"></span>
                                                <span class="dot"></span>
                                            </span>
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
                                                    <span class="jumping-dots jumping-dots--small">
                                                        <span class="dot"></span>
                                                        <span class="dot"></span>
                                                        <span class="dot"></span>
                                                    </span>
                                                </span>
                                            {:else if response.error}
                                                <span
                                                    class="ai-sidebar__multi-model-tab-panel-status ai-sidebar__multi-model-tab-panel-status--error"
                                                >
                                                    ❌ {i18n('multiModel.error')}
                                                </span>
                                            {/if}
                                        </div>
                                        <div class="ai-sidebar__multi-model-tab-panel-actions">
                                            {#if !response.isLoading && !response.error}
                                                <button
                                                    class="b3-button b3-button--text ai-sidebar__multi-model-copy-btn"
                                                    on:click={() =>
                                                        copyMessage(response.content || '')}
                                                    title={i18n('aiSidebar.actions.copyMessage')}
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
                                                    title={i18n('aiSidebar.actions.regenerate')}
                                                >
                                                    <svg class="b3-button__icon">
                                                        <use xlink:href="#iconRefresh"></use>
                                                    </svg>
                                                </button>
                                                <button
                                                    class="b3-button b3-button--primary ai-sidebar__multi-model-select-btn"
                                                    class:ai-sidebar__multi-model-select-btn--selected={selectedAnswerIndex ===
                                                        selectedTabIndex}
                                                    on:click={() =>
                                                        selectMultiModelAnswer(selectedTabIndex)}
                                                >
                                                    {selectedAnswerIndex === selectedTabIndex
                                                        ? i18n('multiModel.answerSelected')
                                                        : i18n('multiModel.selectAnswer')}
                                                </button>
                                            {/if}
                                        </div>
                                    </div>

                                    <!-- 按轮次显示思考、工具调用和回复 -->
                                    {#if response.toolCalls && response.toolCalls.length > 0}
                                        {@const groupedToolCalls = response.toolCalls.reduce(
                                            (acc, tc, i) => {
                                                const key = tc.thinkingBefore || '';
                                                if (
                                                    acc.length === 0 ||
                                                    acc[acc.length - 1].thinking !== key
                                                ) {
                                                    acc.push({ thinking: key, toolCalls: [tc] });
                                                } else {
                                                    acc[acc.length - 1].toolCalls.push(tc);
                                                }
                                                return acc;
                                            },
                                            []
                                        )}

                                        {#each groupedToolCalls as group, groupIndex}
                                            <!-- 该轮工具调用前的思考 -->
                                            {#if group.thinking}
                                                <div class="ai-message__thinking">
                                                    <div
                                                        class="ai-message__thinking-header"
                                                        on:click={() => {
                                                            const key = `mm-tab-${selectedTabIndex}-group-${groupIndex}`;
                                                            thinkingCollapsed[key] =
                                                                !thinkingCollapsed[key];
                                                            thinkingCollapsed = {
                                                                ...thinkingCollapsed,
                                                            };
                                                        }}
                                                    >
                                                        <svg
                                                            class="ai-message__thinking-icon"
                                                            class:collapsed={thinkingCollapsed[
                                                                `mm-tab-${selectedTabIndex}-group-${groupIndex}`
                                                            ]}
                                                        >
                                                            <use xlink:href="#iconRight"></use>
                                                        </svg>
                                                        <span class="ai-message__thinking-title">
                                                            💭 思考过程
                                                        </span>
                                                    </div>
                                                    {#if !thinkingCollapsed[`mm-tab-${selectedTabIndex}-group-${groupIndex}`]}
                                                        {@const streamTabThink = getDisplayContent(
                                                            group.thinking
                                                        )}
                                                        <div
                                                            class="ai-message__thinking-content b3-typography"
                                                        >
                                                            {@html streamTabThink}
                                                        </div>
                                                    {/if}
                                                </div>
                                            {/if}

                                            <!-- 该轮工具调用 -->
                                            <div
                                                class="ai-message__tool-calls"
                                                style="margin-top: 8px;"
                                            >
                                                <div class="ai-message__tool-calls-title">
                                                    🔧 {i18n('tools.calling')} ({group.toolCalls
                                                        .length})
                                                </div>
                                                {#each group.toolCalls as toolCall}
                                                    {@const toolDisplayName = getToolDisplayName(
                                                        toolCall.function.name
                                                    )}
                                                    {@const isCompleted =
                                                        toolCall.status === 'completed'}
                                                    {@const isCollapsed =
                                                        !toolCallsExpanded[toolCall.id]}

                                                    <div class="ai-message__tool-call">
                                                        <div
                                                            class="ai-message__tool-call-header"
                                                            on:click={() => {
                                                                toolCallsExpanded[toolCall.id] =
                                                                    !toolCallsExpanded[toolCall.id];
                                                                toolCallsExpanded = {
                                                                    ...toolCallsExpanded,
                                                                };
                                                            }}
                                                        >
                                                            <div class="ai-message__tool-call-name">
                                                                <svg
                                                                    class="ai-message__tool-call-icon"
                                                                    class:collapsed={isCollapsed}
                                                                >
                                                                    <use
                                                                        xlink:href="#iconRight"
                                                                    ></use>
                                                                </svg>
                                                                <span>{toolDisplayName}</span>
                                                                {#if isCompleted}
                                                                    <span
                                                                        class="ai-message__tool-call-status"
                                                                    >
                                                                        ✅
                                                                    </span>
                                                                {:else}
                                                                    <span
                                                                        class="ai-message__tool-call-status"
                                                                    >
                                                                        ⏳
                                                                    </span>
                                                                {/if}
                                                            </div>
                                                        </div>

                                                        {#if !isCollapsed}
                                                            <div
                                                                class="ai-message__tool-call-details"
                                                            >
                                                                <div
                                                                    class="ai-message__tool-call-params"
                                                                >
                                                                    <div
                                                                        class="ai-message__tool-call-section-header"
                                                                    >
                                                                        {i18n(
                                                                            'aiSidebar.messages.params'
                                                                        )}
                                                                    </div>
                                                                    <div
                                                                        class="ai-message__tool-call-code-wrapper"
                                                                    >
                                                                        <pre
                                                                            class="ai-message__tool-call-code"><code>{toolCall
                                                                                    .function
                                                                                    .arguments}</code></pre>
                                                                    </div>
                                                                </div>
                                                                {#if toolCall.result}
                                                                    <div
                                                                        class="ai-message__tool-call-result"
                                                                    >
                                                                        <div
                                                                            class="ai-message__tool-call-section-header"
                                                                        >
                                                                            {i18n(
                                                                                'aiSidebar.messages.result'
                                                                            )}
                                                                        </div>
                                                                        <div
                                                                            class="ai-message__tool-call-code-wrapper"
                                                                        >
                                                                            <pre
                                                                                class="ai-message__tool-call-code"><code>{toolCall.result}</code></pre>
                                                                        </div>
                                                                    </div>
                                                                {/if}
                                                            </div>
                                                        {/if}
                                                    </div>
                                                {/each}
                                            </div>
                                        {/each}

                                        <!-- 最终思考（如果有） -->
                                        {#if response.thinking && !response.toolCalls.some(tc => tc.thinkingBefore === response.thinking)}
                                            <div
                                                class="ai-message__thinking"
                                                style="margin-top: 8px;"
                                            >
                                                <div
                                                    class="ai-message__thinking-header"
                                                    on:click={() => {
                                                        multiModelResponses[
                                                            selectedTabIndex
                                                        ].thinkingCollapsed =
                                                            !multiModelResponses[selectedTabIndex]
                                                                .thinkingCollapsed;
                                                        multiModelResponses = [
                                                            ...multiModelResponses,
                                                        ];
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
                                                    {@const streamTabThink = getDisplayContent(
                                                        response.thinking
                                                    )}
                                                    <div
                                                        class="ai-message__thinking-content b3-typography"
                                                    >
                                                        {@html streamTabThink}
                                                    </div>
                                                {/if}
                                            </div>
                                        {/if}
                                    {:else if response.thinking}
                                        <!-- 没有工具调用时，只显示思考 -->
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
                                                {@const streamTabThink = getDisplayContent(
                                                    response.thinking
                                                )}
                                                <div
                                                    class="ai-message__thinking-content b3-typography"
                                                >
                                                    {@html streamTabThink}
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
                                            {@const streamTabContent = getDisplayContent(
                                                response.content
                                            )}
                                            {@html streamTabContent}
                                        {:else if response.isLoading}
                                            <div class="ai-sidebar__multi-model-tab-panel-loading">
                                                {i18n('multiModel.loading')}
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
                <p>{i18n('aiSidebar.empty.greeting')}</p>
            </div>
        {/if}
    </div>

    <!-- 上下文文档和附件列表 -->
    {#if contextDocuments.length > 0 || currentAttachments.length > 0}
        <div
            class="ai-sidebar__context-docs"
            class:ai-sidebar__context-docs--drag-over={isDragOver && contextDocuments.length > 0}
            on:dragover={handleDragOver}
            on:dragleave={handleDragLeave}
            on:drop={handleDrop}
        >
            <div class="ai-sidebar__context-docs-title">📎 {i18n('aiSidebar.context.content')}</div>
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
                            on:click|stopPropagation={() => copyMessage(doc.content || '')}
                            title={i18n('aiSidebar.actions.copyMessage')}
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
                            <button
                                class="b3-button b3-button--text ai-sidebar__context-doc-copy"
                                on:click|stopPropagation={() => {
                                    platformUtils.writeText(attachment.data);
                                    pushMsg('已复制图片URL');
                                }}
                                title="复制图片URL"
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconCopy"></use>
                                </svg>
                            </button>
                        {:else if attachment.isWebPage}
                            <span class="ai-sidebar__context-attachment-icon-emoji">🔗</span>
                            <span class="ai-sidebar__context-doc-name" title={attachment.name}>
                                {attachment.name}
                            </span>
                            <button
                                class="b3-button b3-button--text ai-sidebar__context-doc-copy"
                                on:click|stopPropagation={() => {
                                    platformUtils.writeText(attachment.data);
                                    pushMsg('已复制网页Markdown内容');
                                }}
                                title="复制网页Markdown"
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconCopy"></use>
                                </svg>
                            </button>
                        {:else}
                            <svg class="ai-sidebar__context-attachment-icon">
                                <use xlink:href="#iconFile"></use>
                            </svg>
                            <span class="ai-sidebar__context-doc-name" title={attachment.name}>
                                📄 {attachment.name}
                            </span>
                            <button
                                class="b3-button b3-button--text ai-sidebar__context-doc-copy"
                                on:click|stopPropagation={() => {
                                    platformUtils.writeText(attachment.data);
                                    pushMsg('已复制文件内容');
                                }}
                                title="复制文件内容"
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconCopy"></use>
                                </svg>
                            </button>
                        {/if}
                    </div>
                {/each}
            </div>
        </div>
    {/if}
    <div
        class="ai-sidebar__input-container"
        class:ai-sidebar__input-container--drag-over={isDragOver && contextDocuments.length === 0}
        bind:this={inputContainer}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
        on:drop={handleDrop}
    >
        <!-- 模式选择 -->
        <div class="ai-sidebar__mode-selector">
            <label for="chat-mode-select" class="ai-sidebar__mode-label">
                {i18n('aiSidebar.mode.label')}:
            </label>
            <select
                id="chat-mode-select"
                class="b3-select ai-sidebar__mode-select"
                bind:value={chatMode}
            >
                <option value="ask">{i18n('aiSidebar.mode.ask')}</option>
                <option value="agent">{i18n('aiSidebar.mode.agent')}</option>
                <option value="draw">{i18n('aiSidebar.mode.draw') || '画图模式'}</option>
            </select>

            <!-- Agent/Ask 模式工具选择按钮 -->
            {#if chatMode === 'agent' || chatMode === 'ask'}
                <button
                    class="b3-button b3-button--text ai-sidebar__tool-selector-btn"
                    on:click={() => (isToolSelectorOpen = !isToolSelectorOpen)}
                    title={i18n('aiSidebar.agent.selectTools')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                    <span>{i18n('aiSidebar.agent.tools')} ({userToolCount})</span>
                </button>
            {/if}

            <!-- 模型选择器（问答模式：支持单选/多选切换；其他模式：仅单选） -->
            {#if chatMode === 'ask'}
                <div class="ai-sidebar__multi-model-selector-wrapper">
                    {#if !enableMultiModel && (showThinkingToggle || showWebSearchToggle)}
                        <div class="ai-sidebar__thinking-toggle-container">
                            {#if showWebSearchToggle}
                                <button
                                    class="ai-sidebar__thinking-toggle b3-button b3-button--text"
                                    class:ai-sidebar__thinking-toggle--active={isWebSearchModeEnabled}
                                    on:click={toggleWebSearchMode}
                                    title={isWebSearchModeEnabled
                                        ? i18n('webSearch.enabled')
                                        : i18n('webSearch.disabled')}
                                    disabled={!currentProvider || !currentModelId}
                                >
                                    🌐
                                </button>
                            {/if}
                            {#if showThinkingToggle}
                                <button
                                    class="ai-sidebar__thinking-toggle b3-button b3-button--text"
                                    class:ai-sidebar__thinking-toggle--active={isThinkingModeEnabled}
                                    on:click={toggleThinkingMode}
                                    title={isThinkingModeEnabled
                                        ? i18n('thinking.enabled')
                                        : i18n('thinking.disabled')}
                                    disabled={!currentProvider || !currentModelId}
                                >
                                    {i18n('thinking.toggle')}
                                </button>
                            {/if}
                            {#if showThinkingEffortSelector}
                                <select
                                    class="ai-sidebar__thinking-effort-select b3-select"
                                    value={currentThinkingEffort}
                                    on:change={handleThinkingEffortChange}
                                    title={i18n('thinking.effort.title')}
                                >
                                    {#if isCurrentModelGemini}
                                        <option value="auto">{i18n('thinking.effort.auto')}</option>
                                    {/if}
                                    <option value="low">{i18n('thinking.effort.low')}</option>
                                    {#if !isCurrentModelGemini3}
                                        <option value="medium">
                                            {i18n('thinking.effort.medium')}
                                        </option>
                                    {/if}
                                    <option value="high">{i18n('thinking.effort.high')}</option>
                                </select>
                            {/if}
                        </div>
                    {/if}
                    <MultiModelSelector
                        providers={providersForModelSelector}
                        {currentProvider}
                        {currentModelId}
                        {chatMode}
                        bind:selectedModels={selectedMultiModels}
                        bind:enableMultiModel
                        on:select={handleModelSelect}
                        on:change={handleMultiModelChange}
                        on:toggleEnable={handleToggleMultiModel}
                        on:toggleThinking={handleToggleModelThinking}
                    />
                </div>
            {:else}
                <div class="ai-sidebar__model-selector-container">
                    {#if chatMode !== 'draw' && (showThinkingToggle || showWebSearchToggle)}
                        <div class="ai-sidebar__thinking-toggle-container">
                            {#if showWebSearchToggle}
                                <button
                                    class="ai-sidebar__thinking-toggle b3-button b3-button--text"
                                    class:ai-sidebar__thinking-toggle--active={isWebSearchModeEnabled}
                                    on:click={toggleWebSearchMode}
                                    title={isWebSearchModeEnabled
                                        ? i18n('webSearch.enabled')
                                        : i18n('webSearch.disabled')}
                                    disabled={!currentProvider || !currentModelId}
                                >
                                    🌐
                                </button>
                            {/if}
                            {#if showThinkingToggle}
                                <button
                                    class="ai-sidebar__thinking-toggle b3-button b3-button--text"
                                    class:ai-sidebar__thinking-toggle--active={isThinkingModeEnabled}
                                    on:click={toggleThinkingMode}
                                    title={isThinkingModeEnabled
                                        ? i18n('thinking.enabled')
                                        : i18n('thinking.disabled')}
                                    disabled={!currentProvider || !currentModelId}
                                >
                                    {i18n('thinking.toggle')}
                                </button>
                            {/if}
                            {#if showThinkingEffortSelector}
                                <select
                                    class="ai-sidebar__thinking-effort-select b3-select"
                                    value={currentThinkingEffort}
                                    on:change={handleThinkingEffortChange}
                                    title={i18n('thinking.effort.title')}
                                >
                                    {#if isCurrentModelGemini}
                                        <option value="auto">{i18n('thinking.effort.auto')}</option>
                                    {/if}
                                    <option value="low">{i18n('thinking.effort.low')}</option>
                                    {#if !isCurrentModelGemini3}
                                        <option value="medium">
                                            {i18n('thinking.effort.medium')}
                                        </option>
                                    {/if}
                                    <option value="high">{i18n('thinking.effort.high')}</option>
                                </select>
                            {/if}
                        </div>
                    {/if}
                    <MultiModelSelector
                        providers={providersForModelSelector}
                        {currentProvider}
                        {currentModelId}
                        {chatMode}
                        selectedModels={[]}
                        enableMultiModel={false}
                        on:select={handleModelSelect}
                    />
                </div>
            {/if}
        </div>
        {#if chatMode === 'draw'}
            <div class="ai-sidebar__draw-options">
                <label class="ai-sidebar__draw-option">
                    <span>尺寸</span>
                    <select class="b3-select" bind:value={drawImageSize}>
                        {#each drawImageSizeOptions as option}
                            <option value={option.value}>{option.label}</option>
                        {/each}
                    </select>
                </label>
                <label class="ai-sidebar__draw-option ai-sidebar__draw-option--number">
                    <span>数量</span>
                    <input
                        class="b3-text-field"
                        type="number"
                        min="1"
                        max="10"
                        bind:value={drawImageCount}
                        on:change={normalizeDrawImageCount}
                    />
                </label>
                <label class="ai-sidebar__draw-option">
                    <span>质量</span>
                    <select class="b3-select" bind:value={drawImageQuality}>
                        {#each DRAW_IMAGE_QUALITY_OPTIONS as option}
                            <option value={option.value}>{option.label}</option>
                        {/each}
                    </select>
                </label>
            </div>
        {/if}
        <div class="ai-sidebar__input-row">
            <div class="ai-sidebar__input-wrapper">
                <textarea
                    bind:this={textareaElement}
                    bind:value={currentInput}
                    on:keydown={handleKeydown}
                    on:paste={handlePaste}
                    placeholder={i18n('aiSidebar.input.placeholder')}
                    class="ai-sidebar__input"
                    rows="1"
                    spellcheck="false"
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
            accept={chatMode === 'draw' ? 'image/*' : 'image/*,.txt,.md,.json,.xml,.csv,text/*'}
            multiple
            style="display: none;"
        />
        <div class="ai-sidebar__bottom-row">
            <button
                class="b3-button b3-button--text ai-sidebar__upload-btn"
                on:click={triggerFileUpload}
                disabled={isUploadingFile || isLoading}
                title={i18n('aiSidebar.actions.upload')}
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
                class="b3-button b3-button--text ai-sidebar__weblink-btn"
                on:click={openWebLinkDialog}
                disabled={isFetchingWebContent || isLoading}
                title={i18n('aiSidebar.actions.addWebLink')}
            >
                {#if isFetchingWebContent}
                    <svg class="b3-button__icon ai-sidebar__loading-icon">
                        <use xlink:href="#iconRefresh"></use>
                    </svg>
                {:else}
                    <svg class="b3-button__icon"><use xlink:href="#iconLink"></use></svg>
                {/if}
            </button>
            <button
                class="b3-button b3-button--text ai-sidebar__add-current-doc-btn"
                on:click={addCurrentDocToContext}
                title={i18n('aiSidebar.actions.addCurrentDoc')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconFile"></use></svg>
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
                title={i18n('aiSidebar.actions.search')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconSearch"></use></svg>
            </button>
            <div class="ai-sidebar__prompt-actions">
                <button
                    class="b3-button b3-button--text"
                    on:click={togglePromptSelector}
                    title={i18n('aiSidebar.prompt.title')}
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
        </div>

        <!-- 提示词选择器下拉菜单 -->
        {#if isPromptSelectorOpen}
            <div class="ai-sidebar__prompt-selector">
                <div
                    class="ai-sidebar__prompt-list"
                    class:ai-sidebar__prompt-list--drag-over-end={promptDropAtEnd}
                    on:dragover|preventDefault={handlePromptListDragOver}
                    on:drop|preventDefault={handlePromptListDrop}
                >
                    <!-- 新建提示词按钮 -->
                    <button
                        class="ai-sidebar__prompt-item ai-sidebar__prompt-item--new"
                        on:click={openPromptManager}
                    >
                        <svg class="ai-sidebar__prompt-item-icon">
                            <use xlink:href="#iconAdd"></use>
                        </svg>
                        <span class="ai-sidebar__prompt-item-title">
                            {i18n('aiSidebar.prompt.new')}
                        </span>
                    </button>

                    {#if prompts.length > 0}
                        <div class="ai-sidebar__prompt-divider-small"></div>
                        {#each prompts as prompt (prompt.id)}
                            <button
                                class="ai-sidebar__prompt-item"
                                class:ai-sidebar__prompt-item--dragging={draggingPromptId === prompt.id}
                                class:ai-sidebar__prompt-item--drop-target={promptDropTargetId === prompt.id}
                                draggable="true"
                                on:click={() => usePrompt(prompt)}
                                on:dragstart={(event) => handlePromptDragStart(event, prompt.id)}
                                on:dragover|preventDefault|stopPropagation={(event) =>
                                    handlePromptItemDragOver(event, prompt.id)}
                                on:drop|preventDefault|stopPropagation={(event) =>
                                    handlePromptItemDrop(event, prompt.id)}
                                on:dragend={handlePromptDragEnd}
                                title={prompt.content}
                            >
                                <span class="ai-sidebar__prompt-item-title">{prompt.title}</span>
                                <div class="ai-sidebar__prompt-item-actions">
                                    <button
                                        class="ai-sidebar__prompt-item-edit"
                                        on:click|stopPropagation={() => editPrompt(prompt)}
                                        title={i18n('aiSidebar.prompt.edit')}
                                    >
                                        <svg class="b3-button__icon">
                                            <use xlink:href="#iconEdit"></use>
                                        </svg>
                                    </button>
                                    <button
                                        class="ai-sidebar__prompt-item-delete"
                                        on:click|stopPropagation={() => deletePrompt(prompt.id)}
                                        title={i18n('aiSidebar.prompt.delete')}
                                    >
                                        <svg class="b3-button__icon">
                                            <use xlink:href="#iconTrashcan"></use>
                                        </svg>
                                    </button>
                                </div>
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
                        {editingPrompt
                            ? i18n('aiSidebar.prompt.edit')
                            : i18n('aiSidebar.prompt.create')}
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
                                placeholder={i18n('aiSidebar.prompt.titlePlaceholder')}
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

    <!-- 网页链接对话框 -->
    {#if isWebLinkDialogOpen}
        <div class="ai-sidebar__prompt-dialog">
            <div class="ai-sidebar__prompt-dialog-overlay" on:click={closeWebLinkDialog}></div>
            <div class="ai-sidebar__prompt-dialog-content">
                <div class="ai-sidebar__prompt-dialog-header">
                    <h4>添加网页链接</h4>
                    <button class="b3-button b3-button--text" on:click={closeWebLinkDialog}>
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                <div class="ai-sidebar__prompt-dialog-body">
                    <div class="ai-sidebar__prompt-form">
                        <div class="ai-sidebar__prompt-form-field">
                            <label class="ai-sidebar__prompt-form-label">
                                网页链接（每行一个）
                            </label>
                            <textarea
                                bind:value={webLinkInput}
                                placeholder="输入一个或多个网页链接，每行一个&#10;示例：&#10;https://example.com&#10;https://example.org/page"
                                class="b3-text-field ai-sidebar__prompt-textarea"
                                rows="10"
                                disabled={isFetchingWebContent}
                            ></textarea>
                            <div
                                style="margin-top: 8px; font-size: 12px; color: var(--b3-theme-on-surface-light);"
                            >
                                💡 提示：
                                <ul style="margin: 4px 0; padding-left: 20px;">
                                    <li>由于浏览器安全限制，某些网站可能无法直接访问</li>
                                </ul>
                            </div>
                        </div>
                        <div class="ai-sidebar__prompt-form-actions">
                            <button
                                class="b3-button b3-button--cancel"
                                on:click={closeWebLinkDialog}
                                disabled={isFetchingWebContent}
                            >
                                取消
                            </button>
                            <button
                                class="b3-button b3-button--primary"
                                on:click={fetchWebPages}
                                disabled={isFetchingWebContent || !webLinkInput.trim()}
                            >
                                {isFetchingWebContent ? '获取中...' : '获取网页内容'}
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
                    <h4>{i18n('aiSidebar.search.title')}</h4>
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
                            placeholder={i18n('aiSidebar.search.placeholder')}
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
                                        {result.content || i18n('common.untitled')}
                                        {#if !searchKeyword.trim()}
                                            <span class="ai-sidebar__search-current-doc-badge">
                                                {i18n('aiSidebar.search.currentDoc')}
                                            </span>
                                        {/if}
                                    </div>
                                    <button
                                        class="b3-button b3-button--text"
                                        on:click={() =>
                                            addDocumentToContext(
                                                result.id,
                                                result.content || i18n('common.untitled')
                                            )}
                                    >
                                        {i18n('aiSidebar.search.add')}
                                    </button>
                                </div>
                            {/each}
                        {:else if !isSearching && searchKeyword}
                            <div class="ai-sidebar__search-empty">
                                {i18n('aiSidebar.search.noResults')}
                            </div>
                        {:else if !isSearching && !searchKeyword}
                            <div class="ai-sidebar__search-empty">
                                {i18n('aiSidebar.search.noCurrentDoc')}
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
                    <h3>{i18n('aiSidebar.actions.editMessage')}</h3>
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
                        {i18n('aiSidebar.actions.cancel')}
                    </button>
                    <button class="b3-button b3-button--text" on:click={saveEditMessage}>
                        {i18n('aiSidebar.actions.save')}
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
                            {i18n('aiSidebar.edit.insertBlock')} - {i18n(
                                'aiSidebar.actions.viewDiff'
                            )}
                        {:else}
                            {i18n('aiSidebar.actions.viewDiff')}
                        {/if}
                    </h3>
                    {#if currentDiffOperation.operationType !== 'insert'}
                        <div class="ai-sidebar__diff-mode-selector">
                            <button
                                class="b3-button b3-button--text"
                                class:b3-button--primary={diffViewMode === 'diff'}
                                on:click={() => (diffViewMode = 'diff')}
                            >
                                {i18n('aiSidebar.diff.modeUnified')}
                            </button>
                            <button
                                class="b3-button b3-button--text"
                                class:b3-button--primary={diffViewMode === 'split'}
                                on:click={() => (diffViewMode = 'split')}
                            >
                                {i18n('aiSidebar.diff.modeSplit')}
                            </button>
                        </div>
                    {/if}
                    <button class="b3-button b3-button--cancel" on:click={closeDiffDialog}>
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                <div class="ai-sidebar__diff-dialog-body">
                    <div class="ai-sidebar__diff-info">
                        {#if currentDiffOperation.docTitle}
                            <strong>文档:</strong>
                            {currentDiffOperation.docTitle}
                            <br />
                        {/if}
                        {#if currentDiffOperation.affectedBlockIds && currentDiffOperation.affectedBlockIds.length > 0}
                            <strong>块ID:</strong>
                            {currentDiffOperation.affectedBlockIds.join(', ')}
                            <br />
                        {/if}
                        {#if currentDiffOperation.oldDocTitle && currentDiffOperation.newDocTitle && currentDiffOperation.oldDocTitle !== currentDiffOperation.newDocTitle}
                            <strong>标题:</strong>
                            {currentDiffOperation.oldDocTitle} → {currentDiffOperation.newDocTitle}
                            <br />
                        {/if}
                        {#if currentDiffOperation.docId}
                            <strong>文档ID:</strong>
                            {currentDiffOperation.docId}
                        {:else if currentDiffOperation.operationType === 'insert'}
                            <strong>{i18n('aiSidebar.edit.insertBlock')}:</strong>
                            {currentDiffOperation.position === 'before'
                                ? i18n('aiSidebar.edit.before')
                                : i18n('aiSidebar.edit.after')}
                            {currentDiffOperation.blockId}
                        {:else}
                            <strong>{i18n('aiSidebar.edit.blockId')}:</strong>
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
                                <span>{i18n('aiSidebar.edit.insertContent')}</span>
                                <button
                                    class="b3-button b3-button--text b3-button--small"
                                    on:click={() => {
                                        platformUtils.writeText(currentDiffOperation.newContent);
                                        pushMsg(i18n('aiSidebar.success.copySuccess'));
                                    }}
                                    title={i18n('aiSidebar.actions.copyNewContent')}
                                >
                                    <svg class="b3-button__icon">
                                        <use xlink:href="#iconCopy"></use>
                                    </svg>
                                    {i18n('aiSidebar.actions.copy')}
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
                                        platformUtils.writeText(currentDiffOperation.oldContent);
                                        pushMsg(i18n('aiSidebar.success.copySuccess'));
                                    }}
                                    title={i18n('aiSidebar.actions.copyOldContent')}
                                >
                                    <svg class="b3-button__icon">
                                        <use xlink:href="#iconCopy"></use>
                                    </svg>
                                    {i18n('aiSidebar.actions.copyBefore')}
                                </button>
                                <button
                                    class="b3-button b3-button--text b3-button--small"
                                    on:click={() => {
                                        platformUtils.writeText(currentDiffOperation.newContent);
                                        pushMsg(i18n('aiSidebar.success.copySuccess'));
                                    }}
                                    title={i18n('aiSidebar.actions.copyNewContent')}
                                >
                                    <svg class="b3-button__icon">
                                        <use xlink:href="#iconCopy"></use>
                                    </svg>
                                    {i18n('aiSidebar.actions.copyAfter')}
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
                                        <span>{i18n('aiSidebar.edit.before')}</span>
                                        <button
                                            class="b3-button b3-button--text b3-button--small"
                                            on:click={() => {
                                                platformUtils.writeText(
                                                    currentDiffOperation.oldContent
                                                );
                                                pushMsg(i18n('aiSidebar.success.copySuccess'));
                                            }}
                                            title={i18n('aiSidebar.actions.copyOldContent')}
                                        >
                                            <svg class="b3-button__icon">
                                                <use xlink:href="#iconCopy"></use>
                                            </svg>
                                        </button>
                                    </div>
                                    <div class="ai-sidebar__diff-split-content b3-typography">
                                        {@html renderMarkdownForSplitDiff(
                                            currentDiffOperation.oldContent
                                        )}
                                    </div>
                                </div>
                                <div class="ai-sidebar__diff-split-column">
                                    <div class="ai-sidebar__diff-split-header">
                                        <span>{i18n('aiSidebar.edit.after')}</span>
                                        <button
                                            class="b3-button b3-button--text b3-button--small"
                                            on:click={() => {
                                                platformUtils.writeText(
                                                    currentDiffOperation.newContent
                                                );
                                                pushMsg(i18n('aiSidebar.success.copySuccess'));
                                            }}
                                            title={i18n('aiSidebar.actions.copyNewContent')}
                                        >
                                            <svg class="b3-button__icon">
                                                <use xlink:href="#iconCopy"></use>
                                            </svg>
                                        </button>
                                    </div>
                                    <div class="ai-sidebar__diff-split-content b3-typography">
                                        {@html renderMarkdownForSplitDiff(
                                            currentDiffOperation.newContent
                                        )}
                                    </div>
                                </div>
                            </div>
                        {/if}
                    {:else}
                        <div class="ai-sidebar__diff-loading">
                            {i18n('common.loading')}
                        </div>
                    {/if}
                </div>
                <div class="ai-sidebar__diff-dialog-footer">
                    <button class="b3-button b3-button--cancel" on:click={closeDiffDialog}>
                        {i18n('common.close')}
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
                        <span>{i18n('aiSidebar.actions.copyMessage')}</span>
                    </button>
                {/if}

                <button
                    class="ai-sidebar__context-menu-item"
                    on:click={() => handleContextMenuAction('edit')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                    <span>{i18n('aiSidebar.actions.editMessage')}</span>
                </button>
                <button
                    class="ai-sidebar__context-menu-item"
                    on:click={() => handleContextMenuAction('delete')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                    <span>{i18n('aiSidebar.actions.deleteMessage')}</span>
                </button>
                <div class="ai-sidebar__context-menu-divider"></div>
                <button
                    class="ai-sidebar__context-menu-item"
                    on:click={() => handleContextMenuAction('save')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconDownload"></use></svg>
                    <span>{i18n('aiSidebar.actions.saveToNote')}</span>
                </button>
                <button
                    class="ai-sidebar__context-menu-item"
                    on:click={() => handleContextMenuAction('regenerate')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                    <span>
                        {contextMenuMessageType === 'user'
                            ? i18n('aiSidebar.actions.resend')
                            : i18n('aiSidebar.actions.regenerate')}
                    </span>
                </button>
            {/if}
        </div>
    {/if}

    <!-- 工具选择器对话框 -->
    {#if isToolSelectorOpen}
        {#if chatMode === 'ask'}
            <ToolSelector
                bind:selectedTools={selectedToolsAsk}
                bind:toolAutoApproveSettings={toolAutoApproveSettingsAsk}
                categories={QA_TOOL_CATEGORIES}
                on:close={() => (isToolSelectorOpen = false)}
            />
        {:else}
            <ToolSelector
                bind:selectedTools
                bind:toolAutoApproveSettings
                categories={TOOL_CATEGORIES}
                on:close={() => (isToolSelectorOpen = false)}
            />
        {/if}
    {/if}

    <!-- 保存到笔记对话框 -->
    {#if isSaveToNoteDialogOpen}
        <div class="save-to-note-dialog__overlay" on:click={closeSaveToNoteDialog}></div>
        <div class="save-to-note-dialog">
            <div class="save-to-note-dialog__header">
                <h3>{i18n('aiSidebar.session.saveToNote.title')}</h3>
                <button
                    class="b3-button b3-button--text"
                    on:click={closeSaveToNoteDialog}
                    title={i18n('common.close')}
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
                        title={i18n('aiSidebar.session.saveToNote.useCurrentDoc')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconFile"></use></svg>
                        <span>{i18n('aiSidebar.session.saveToNote.useCurrentDoc')}</span>
                    </button>
                </div>
            {/if}

            <div class="save-to-note-dialog__content">
                <div class="save-to-note-dialog__field">
                    <label>{i18n('aiSidebar.session.saveToNote.documentName')}</label>
                    <input
                        type="text"
                        class="b3-text-field"
                        bind:value={saveDocumentName}
                        placeholder={i18n('aiSidebar.session.saveToNote.documentNamePlaceholder')}
                    />
                </div>

                <div class="save-to-note-dialog__field">
                    <label>{i18n('aiSidebar.session.saveToNote.notebook')}</label>
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
                            <option value="">{i18n('common.loading')}</option>
                        {/if}
                    </select>
                </div>

                <div class="save-to-note-dialog__field">
                    <label>{i18n('aiSidebar.session.saveToNote.path')}</label>
                    <div class="save-to-note-dialog__path-input-wrapper">
                        <input
                            type="text"
                            class="b3-text-field"
                            bind:value={savePathSearchKeyword}
                            on:focus={() => (showSavePathDropdown = true)}
                            on:blur={() => {
                                setTimeout(() => (showSavePathDropdown = false), 200);
                            }}
                            placeholder={i18n('aiSidebar.session.saveToNote.pathPlaceholder')}
                        />
                        <!-- 路径搜索结果下拉框 -->
                        {#if showSavePathDropdown && (savePathSearchResults.length > 0 || isSavePathSearching)}
                            <div class="save-to-note-dialog__path-dropdown">
                                {#if isSavePathSearching}
                                    <div class="save-to-note-dialog__path-loading">
                                        {i18n('aiSidebar.session.saveToNote.searching')}
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
                    <span>{i18n('aiSidebar.session.saveToNote.openAfterSave')}</span>
                </label>
                <div class="save-to-note-dialog__footer-buttons">
                    <button class="b3-button b3-button--cancel" on:click={closeSaveToNoteDialog}>
                        {i18n('aiSidebar.session.saveToNote.cancel')}
                    </button>
                    <button class="b3-button b3-button--primary" on:click={confirmSaveToNote}>
                        {i18n('aiSidebar.session.saveToNote.confirm')}
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
                <h3>{i18n('tools.waitingApproval')}</h3>
                <button
                    class="b3-button b3-button--text"
                    on:click={rejectToolCall}
                    title={i18n('common.close')}
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
                        {i18n('tools.selector.parameters')}:
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
                    {i18n('tools.reject')}
                </button>
                <button class="b3-button b3-button--primary" on:click={approveToolCall}>
                    <svg class="b3-button__icon"><use xlink:href="#iconCheck"></use></svg>
                    {i18n('tools.approve')}
                </button>
            </div>
        </div>
    {/if}

    <!-- 图片查看器 -->
    {#if isImageViewerOpen}
        <div class="image-viewer" class:image-viewer--fullscreen={isImageViewerFullscreen}>
            <div class="image-viewer__header">
                <h3 class="image-viewer__title">{currentImageName || '图片预览'}</h3>
                <div class="image-viewer__actions">
                    <button
                        class="b3-button b3-button--text"
                        on:click={() => copyImageAsPng(currentImageSrc)}
                        title="复制图片"
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>复制</span>
                    </button>
                    <button
                        class="b3-button b3-button--text"
                        on:click={() =>
                            downloadImage(currentImageSrc, currentImageName || 'image.png')}
                        title="下载图片"
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconDownload"></use></svg>
                        <span>下载</span>
                    </button>
                    <button
                        class="b3-button b3-button--text"
                        on:click={toggleImageViewerFullscreen}
                        title={isImageViewerFullscreen ? '退出全屏' : '全屏查看'}
                    >
                        <svg class="b3-button__icon">
                            <use
                                xlink:href={isImageViewerFullscreen
                                    ? '#iconFullscreenExit'
                                    : '#iconFullscreen'}
                            ></use>
                        </svg>
                        <span>{isImageViewerFullscreen ? '退出全屏' : '全屏'}</span>
                    </button>
                    <button
                        class="b3-button b3-button--text"
                        on:click={closeImageViewer}
                        title="关闭"
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
            </div>
            <div class="image-viewer__content">
                <img src={currentImageSrc} alt={currentImageName} class="image-viewer__image" />
            </div>
        </div>
    {/if}

    <!-- 翻译对话框 -->
    <TranslateDialog
        isOpen={isTranslateDialogOpen}
        {plugin}
        {providers}
        {settings}
        on:close={() => (isTranslateDialogOpen = false)}
    />

    <!-- 小程序管理器 -->
    <WebAppManager
        bind:isOpen={isWebAppManagerOpen}
        {plugin}
        bind:webApps
        on:save={saveWebApps}
        on:open={openWebApp}
    />
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
        flex-wrap: wrap; /* 允许换行显示 */
        gap: 8px; /* 添加间距 */
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

    // 小程序菜单样式
    .ai-sidebar__webapp-menu-container {
        position: relative;
        display: inline-block;
    }

    .ai-sidebar__webapp-menu {
        position: fixed;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        box-shadow: var(--b3-dialog-shadow);
        min-width: 180px;
        max-width: 250px;
        max-height: 600px;
        overflow-y: auto;
        z-index: 10;
    }

    .ai-sidebar__webapp-menu .b3-menu__item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0px 12px;
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
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }

    .ai-sidebar__webapp-menu .b3-menu__separator {
        height: 1px;
        background: var(--b3-border-color);
        margin: 4px 0;
    }

    .ai-sidebar__context-docs {
        flex-shrink: 0;
    }

    .ai-sidebar__context-docs--drag-over {
        background: var(--b3-theme-primary-lightest);
        border: 2px dashed var(--b3-theme-primary);
    }

    .ai-sidebar__input-container--drag-over {
        background: var(--b3-theme-primary-lightest);
        border: 2px dashed var(--b3-theme-primary) !important;
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
        max-height: 250px;
        overflow: auto;
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
        position: relative;

        &:hover {
            background: var(--b3-theme-surface);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            transform: translateY(-1px);

            .ai-sidebar__context-doc-copy {
                opacity: 1;
            }
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
        position: absolute;
        top: 2px;
        right: 2px;
        padding: 4px;
        border: none;
        background: var(--b3-theme-surface);
        cursor: pointer;
        color: var(--b3-theme-on-surface);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.15s ease;
        opacity: 0;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);

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

    .ai-sidebar__context-attachment-icon-emoji {
        font-size: 18px;
        flex-shrink: 0;
        line-height: 1;
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

    // 三个点跳动动画
    .jumping-dots {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        height: 16px;
    }

    .jumping-dots .dot {
        width: 6px;
        height: 6px;
        background-color: var(--b3-theme-primary);
        border-radius: 50%;
        animation: jumping-dot 1.4s ease-in-out infinite both;
    }

    .jumping-dots .dot:nth-child(1) {
        animation-delay: -0.32s;
    }

    .jumping-dots .dot:nth-child(2) {
        animation-delay: -0.16s;
    }

    .jumping-dots .dot:nth-child(3) {
        animation-delay: 0s;
    }

    // 小型跳动点（用于标签页等紧凑空间）
    .jumping-dots--small {
        height: 12px;
        gap: 2px;
    }

    .jumping-dots--small .dot {
        width: 4px;
        height: 4px;
    }

    @keyframes jumping-dot {
        0%,
        80%,
        100% {
            transform: scale(0.6);
            opacity: 0.4;
        }
        40% {
            transform: scale(1);
            opacity: 1;
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

    .ai-message__waiting-placeholder {
        display: flex;
        align-items: center;
        height: 24px;
        padding: 2px 0;
    }

    .ai-message__draw-loading-indicator {
        margin-left: 6px;
        vertical-align: middle;
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
        flex-wrap: wrap;
        min-width: 0;
    }

    .ai-sidebar__mode-label {
        font-size: 13px;
        color: var(--b3-theme-on-surface);
        font-weight: 500;
        flex-shrink: 0;
    }

    .ai-sidebar__mode-select {
        flex: 0 0 auto;
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
        flex-shrink: 0;

        &:hover {
            background: var(--b3-theme-primary-lightest);
        }

        .b3-button__icon {
            width: 14px;
            height: 14px;
        }
    }

    .ai-sidebar__multi-model-selector-wrapper {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        justify-content: flex-end;
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
        flex-wrap: wrap;
    }

    .ai-sidebar__upload-btn,
    .ai-sidebar__weblink-btn,
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

    .ai-sidebar__draw-options {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 4px 0;
    }

    .ai-sidebar__draw-option {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--b3-theme-on-surface);

        span {
            white-space: nowrap;
        }

        select {
            max-width: 220px;
            font-size: 12px;
        }
    }

    .ai-sidebar__draw-option--number input {
        width: 54px;
        height: 26px;
        padding: 2px 6px;
        font-size: 12px;
    }

    .ai-sidebar__model-selector-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        /* 保证在 flex 布局中可以缩小，避免在窄宽度下溢出 */
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
        position: relative;

        &:hover .ai-message__attachment-copy {
            opacity: 1;
        }

        // 图片附件的复制按钮位置（在图片右上角）
        > .ai-message__attachment-copy {
            position: absolute;
            top: 6px;
            right: 6px;
            z-index: 1;
        }
    }

    .ai-message__attachment--draw-selected {
        .ai-message__attachment-image {
            border-color: var(--b3-theme-primary);
            box-shadow: 0 0 0 2px var(--b3-theme-primary-light);
        }
    }

    .ai-message__attachment-image {
        width: 100%;
        max-height: 150px;
        object-fit: cover;
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
    }

    .ai-message__draw-image-selection-hint {
        margin-bottom: 8px;
        padding: 6px 8px;
        border-radius: 4px;
        background: var(--b3-theme-warning-light);
        color: var(--b3-theme-on-background);
        font-size: 12px;
    }

    .ai-message__draw-image-selection-hint--done {
        background: var(--b3-theme-primary-lightest);
        color: var(--b3-theme-primary);
    }

    .ai-message__draw-image-choice {
        width: 100%;
        justify-content: center;
        font-size: 12px;
        padding: 3px 6px;
    }

    .ai-message__attachment-file {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        position: relative;

        &:hover .ai-message__attachment-copy {
            opacity: 1;
        }
    }

    .ai-message__attachment-icon {
        width: 20px;
        height: 20px;
        color: var(--b3-theme-on-surface-light);
        flex-shrink: 0;
    }

    .ai-message__attachment-icon-emoji {
        font-size: 20px;
        flex-shrink: 0;
        line-height: 1;
    }

    .ai-message__attachment-copy {
        position: absolute;
        top: 4px;
        right: 4px;
        padding: 4px;
        background: var(--b3-theme-background);
        border-radius: 4px;
        opacity: 0;
        transition: all 0.2s;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);

        &:hover {
            background: var(--b3-theme-surface);
        }
    }

    .ai-message__attachment-name {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
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
        z-index: 10;
    }

    .ai-sidebar__prompt-list {
        padding: 4px;
    }

    .ai-sidebar__prompt-list--drag-over-end {
        border-bottom: 2px solid var(--b3-theme-primary);
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
        cursor: grab;
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

    .ai-sidebar__prompt-item--dragging {
        opacity: 0.5;
        cursor: grabbing;
    }

    .ai-sidebar__prompt-item--drop-target {
        box-shadow: inset 0 2px 0 var(--b3-theme-primary);
    }

    .ai-sidebar__prompt-item--new {
        font-weight: 600;
        color: var(--b3-theme-primary);
        cursor: pointer;

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

    .ai-sidebar__prompt-item-actions {
        display: flex;
        gap: 0;
        flex-shrink: 0;
        opacity: 0;
        transition: opacity 0.2s;

        .ai-sidebar__prompt-item:hover & {
            opacity: 1;
        }
    }

    .ai-sidebar__prompt-item-delete {
        padding: 4px;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 4px;
        transition:
            background-color 0.2s,
            color 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;

        &:hover {
            background: var(--b3-theme-error-lightest);
            color: var(--b3-theme-error);
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

    .ai-message__edit-operation-block-ids {
        margin-bottom: 8px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        word-break: break-all;
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

        // 按钮同时使用了 b3-button--text，需要显式覆盖激活态样式
        .b3-button.b3-button--primary {
            background: var(--b3-theme-primary);
            color: var(--b3-theme-on-primary);
            border-color: var(--b3-theme-primary);
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
        font-size: 13px;
        line-height: 1.6;
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
        max-height: 70vh;
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
        position: sticky;
        top: 0;
        background: var(--b3-theme-background);
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

    .ai-sidebar__multi-model-select-btn--selected {
        background-color: var(--b3-theme-success) !important;
        border-color: var(--b3-theme-success) !important;
    }

    .ai-sidebar__multi-model-card-scroll {
        flex: 1;
        min-height: 0;
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

    .ai-sidebar__multi-model-card-content {
        flex: 0 0 auto;
        min-height: fit-content;
        overflow: visible;
        user-select: text; // 允许文本选择
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
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--b3-theme-surface);

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

    .ai-message__multi-model-header-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
    }

    .ai-message__multi-model-layout-selector {
        display: flex;
        gap: 4px;
        align-items: center;
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
        position: sticky;
        top: 0;
        background: var(--b3-theme-surface);

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

    // 图片查看器样式
    .image-viewer {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        z-index: 1001;
        max-width: 90vw;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: all 0.2s ease;

        &--fullscreen {
            max-width: 100vw;
            max-height: 100vh;
            width: 100vw;
            height: 100vh;
            border-radius: 0;

            .image-viewer__content {
                max-height: none;
                flex: 1;
                min-height: 0;
            }

            .image-viewer__image {
                max-height: 100%;
                max-width: 100%;
                height: 100%;
                width: 100%;
                border-radius: 0;
            }
        }
    }

    .image-viewer__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
    }

    .image-viewer__title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 300px;
    }

    .image-viewer__actions {
        display: flex;
        gap: 8px;
        align-items: center;

        .b3-button {
            display: flex;
            align-items: center;
            gap: 4px;

            span {
                font-size: 12px;
            }
        }
    }

    .image-viewer__content {
        padding: 16px;
        overflow: auto;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 200px;
        max-height: calc(90vh - 80px);
    }

    .image-viewer__image {
        max-width: 100%;
        max-height: calc(90vh - 112px);
        object-fit: contain;
        border-radius: 4px;
    }

    // 让消息中的图片可点击
    .ai-message__attachment-image,
    :global(.ai-message__content img),
    :global(.ai-message__thinking-content img) {
        cursor: zoom-in;
        transition: opacity 0.2s;

        &:hover {
            opacity: 0.9;
        }
    }
</style>
