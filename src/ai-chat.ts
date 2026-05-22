/**
 * AI Chat API 调用模块
 * 支持多个AI平台的API调用和流式输出
 * 支持图片生成功能
 */

import { forwardProxyFetch } from './api';
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
        thought_signature?: string; // Gemini 思维链签名，Agent 模式必须回传
    };
}

export interface MessageAttachment {
    type: 'image' | 'file';
    name: string;
    data: string; // base64 或 URL
    mimeType?: string;
    path?: string; // 插件内存储的资源路径
    isWebPage?: boolean; // 标记是否为网页附件
    url?: string; // 原始URL（网页附件时使用）
}

export interface MessageContent {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
        url: string;
    };
}

export interface EditOperation {
    operationType?: 'update' | 'insert'; // 操作类型：update=更新块，insert=插入块，默认为update
    blockId: string; // update时为要更新的块ID，insert时为参考块ID
    docId?: string; // 汇总差异时对应文档ID
    docTitle?: string; // 汇总差异时对应文档名/路径
    oldDocTitle?: string; // 文档旧标题（重命名差异）
    newDocTitle?: string; // 文档新标题（重命名差异）
    affectedBlockIds?: string[]; // 本次回答中该文档涉及的块ID列表
    newContent: string;
    oldContent?: string; // kramdown格式的旧内容，用于实际应用编辑
    oldContentForDisplay?: string; // Markdown格式的旧内容，用于显示差异
    newContentForDisplay?: string; // Markdown格式的新内容，用于显示差异
    status: 'pending' | 'applied' | 'rejected';
    // insert操作的额外参数
    position?: 'before' | 'after'; // 插入位置：before=在blockId之前，after=在blockId之后
}

export interface ContextDocument {
    id: string;
    title: string;
    content: string;
    type?: 'doc' | 'block'; // 标识是文档还是块
}

export interface Message {
    role: "user" | "assistant" | "system" | "tool";
    content: string | MessageContent[];
    attachments?: MessageAttachment[];
    contextDocuments?: ContextDocument[]; // 关联的上下文文档
    thinking?: string; // 思考过程内容（兼容旧数据）
    thinkingBeforeToolCalls?: string; // 工具调用前的思考过程（兼容旧数据）
    thinkingAfterToolCalls?: string; // 工具调用后的思考过程（兼容旧数据）
    reasoning_content?: string; // DeepSeek 思考模式下的思维链内容
    editOperations?: EditOperation[]; // 编辑操作
    tool_calls?: ToolCall[]; // Tool Calls
    tool_call_id?: string; // Tool 结果的 call_id
    name?: string; // Tool 的名称
    finalReply?: string; // Agent模式：工具调用后的最终回复
    toolCallThinkings?: Array<{
        toolCallIndex: number; // 对应的工具调用起始索引
        thinkingBefore: string; // 该轮工具调用前的思考
        contentBefore?: string; // 该轮工具调用前的AI回复内容（非思考部分）
        thinkingAfter?: string; // 该轮工具调用后的思考（如果有的话）
    }>;
    multiModelResponses?: Array<{
        provider: string;
        modelId: string;
        modelName: string;
        content: string;
        thinking?: string;
        isLoading: boolean;
        error?: string;
        isSelected?: boolean; // 是否被选择
        thinkingCollapsed?: boolean; // 思考内容是否折叠
        thinkingEnabled?: boolean; // 用户是否开启思考模式
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
    }>; // 多模型响应
    generatedImages?: GeneratedImageData[]; // 生成的图片数据（用于多轮生图）
    drawImageSelectionRequired?: boolean; // 画图模式多图结果是否需要用户选择
    drawSelectedImageIndex?: number; // 画图模式多图结果中用户选中的图片索引
}

// 生成的图片数据接口（用于Gemini多轮生图）
export interface GeneratedImageData {
    name?: string;
    mimeType: string;
    data: string; // base64 数据
    url?: string; // 可选的URL
    path?: string; // 插件内存储的资源路径
}

// 思考努力程度类型
export type ThinkingEffort = 'low' | 'medium' | 'high' | 'auto';

export interface ChatOptions {
    apiKey: string;
    model: string;
    messages: Message[];
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    onChunk?: (chunk: string) => void;
    onComplete?: (fullText: string) => void;
    onError?: (error: Error) => void;
    signal?: AbortSignal; // 用于中断请求
    enableThinking?: boolean; // 是否启用思考模式
    thinkingBudget?: number; // 思考预算（token数），-1表示动态
    reasoningEffort?: ThinkingEffort; // 思考努力程度（适用于 Gemini/Claude 等模型）
    onThinkingChunk?: (chunk: string) => void; // 思考过程回调
    onThinkingComplete?: (thinking: string) => void; // 思考完成回调
    tools?: any[]; // Agent模式的工具列表
    onToolCall?: (toolCall: ToolCall) => void; // Tool Call 回调
    onToolCallComplete?: (toolCalls: ToolCall[]) => void; // Tool Calls 完成回调
    customBody?: any; // 自定义请求体参数
    enableImageGeneration?: boolean; // 是否启用图片生成
    onImageGenerated?: (images: GeneratedImageData[]) => void; // 图片生成回调
    useForwardProxy?: boolean; // 是否使用思源笔记后端代理绕过 CORS
}

export interface ModelInfo {
    id: string;
    name: string;
    provider: string;
}

export type AIProvider = 'gemini' | 'deepseek' | 'openai' | 'moonshot' | 'volcano' | 'Achuan' | 'minimax' | 'custom';
export type ChatInterfaceType = 'openai-completion' | 'gemini' | 'anthropic';

export function getDefaultChatInterface(provider: string): ChatInterfaceType {
    return provider === 'gemini' ? 'gemini' : 'openai-completion';
}

interface AdvancedProviderConfig {
    customModelsUrl?: string;
    customChatUrl?: string;
    chatInterface?: ChatInterfaceType;
}

const MINIMAX_FALLBACK_MODEL_IDS = [
    'MiniMax-M2.7',
    'MiniMax-M2.7-highspeed',
    'MiniMax-M2.5',
    'MiniMax-M2.5-highspeed',
    'MiniMax-M2.1',
    'MiniMax-M2.1-highspeed',
    'MiniMax-M2',
];

function isMiniMaxApiUrl(url?: string): boolean {
    return /(?:^https?:\/\/)?api\.minimaxi\.com(?:[/:?#]|$)/i.test((url || '').trim());
}

function getMiniMaxFallbackModels(providerName: string): ModelInfo[] {
    return MINIMAX_FALLBACK_MODEL_IDS.map(modelId => ({
        id: modelId,
        name: modelId,
        provider: providerName,
    }));
}

// 思考努力程度到比例的映射（用于计算 token 预算）
export const EFFORT_RATIO: Record<ThinkingEffort, number> = {
    low: 0.2,
    medium: 0.5,
    high: 0.8,
    auto: 0.5  // auto 使用中等比例
};

// Claude 模型的 token 限制配置
interface TokenLimitConfig {
    min: number;
    max: number;
}

const CLAUDE_TOKEN_LIMITS: Record<string, TokenLimitConfig> = {
    'claude-3-7-sonnet': { min: 1024, max: 32768 },
    'claude-3-5-sonnet': { min: 1024, max: 16384 },
    'claude-sonnet-4': { min: 1024, max: 32768 },
    'claude-opus-4': { min: 1024, max: 32768 },
    // 默认值
    'default': { min: 1024, max: 32768 }
};

// Gemini 支持思考模式的模型正则表达式
// 匹配: gemini-2.5-*, gemini-3-*, gemini-flash-latest, gemini-pro-latest 等
export const GEMINI_THINKING_MODEL_REGEX =
    /gemini-(?:2\.5.*(?:-latest)?|3(?:\.\d+)?-(?:flash|pro)(?:-preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\w-]+)*$/i;

// Claude 模型正则表达式（所有以 claude 开头的模型都认为支持思考模式）
export const CLAUDE_THINKING_MODEL_REGEX = /^claude/i;

/**
 * 获取模型ID的基础名称（小写，去除提供商前缀）
 */
function getLowerBaseModelName(modelId: string, separator: string = '/'): string {
    const parts = modelId.split(separator);
    return parts[parts.length - 1].toLowerCase();
}

/**
 * 查找 Claude 模型的 token 限制配置
 */
function findClaudeTokenLimit(modelId: string): TokenLimitConfig {
    const baseModelId = getLowerBaseModelName(modelId, '/');

    // 按优先级匹配
    for (const [key, config] of Object.entries(CLAUDE_TOKEN_LIMITS)) {
        if (key !== 'default' && baseModelId.includes(key)) {
            return config;
        }
    }

    return CLAUDE_TOKEN_LIMITS['default'];
}

/**
 * 检测模型是否是支持思考模式的 Claude 模型
 */
export function isSupportedThinkingClaudeModel(modelId: string): boolean {
    const baseModelId = getLowerBaseModelName(modelId, '/');
    return CLAUDE_THINKING_MODEL_REGEX.test(baseModelId);
}

/**
 * 检测模型是否是 Claude 模型（用于判断是否使用 Claude 原生 API）
 */
export function isClaudeModel(modelId: string): boolean {
    const baseModelId = getLowerBaseModelName(modelId, '/');
    return CLAUDE_THINKING_MODEL_REGEX.test(baseModelId);
}

/**
 * 检测模型是否是支持思考模式的 Gemini 模型
 */
export function isSupportedThinkingGeminiModel(modelId: string): boolean {
    const baseModelId = getLowerBaseModelName(modelId, '/');
    if (GEMINI_THINKING_MODEL_REGEX.test(baseModelId)) {
        // 排除图片和语音模型
        if (baseModelId.includes('image') || baseModelId.includes('tts')) {
            return false;
        }
        return true;
    }
    return false;
}

/**
 * 检测模型是否是 Gemini 3 系列模型（支持 reasoning_effort 参数）
 */
export function isGemini3Model(modelId: string): boolean {
    const baseModelId = getLowerBaseModelName(modelId, '/');
    return baseModelId.includes('gemini-3');
}

/**
 * 检测模型是否是支持思考模式的 MiniMax M2 系列模型
 */
export function isMinimaxThinkingModel(modelId: string): boolean {
    const baseModelId = getLowerBaseModelName(modelId, '/');
    return /minimax-m2(?:\.\d+)?/i.test(baseModelId);
}



/**
 * 计算 Claude 模型的思考预算 token 数
 */
export function calculateClaudeThinkingBudget(
    modelId: string,
    reasoningEffort: ThinkingEffort,
    maxTokens?: number
): number {
    const DEFAULT_MAX_TOKENS = 8192;
    const tokenLimit = findClaudeTokenLimit(modelId);
    const effortRatio = EFFORT_RATIO[reasoningEffort];

    // 计算基础预算
    let budgetTokens = Math.floor(
        (tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min
    );

    // 根据 maxTokens 限制调整
    budgetTokens = Math.floor(
        Math.max(1024, Math.min(budgetTokens, (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio))
    );

    return budgetTokens;
}

interface ProviderConfig {
    name: string;
    baseUrl: string;
    modelsEndpoint: string;
    chatEndpoint: string;
    apiKeyHeader: string;
    websiteUrl?: string; // 平台官网链接
}

// 预定义的AI平台配置
const PROVIDER_CONFIGS: Record<AIProvider, ProviderConfig> = {
    gemini: {
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelsEndpoint: '/v1beta/models',
        chatEndpoint: '/v1beta/models/{model}:streamGenerateContent',
        apiKeyHeader: 'x-goog-api-key',
        websiteUrl: 'https://aistudio.google.com/apikey'
    },
    deepseek: {
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        modelsEndpoint: '/v1/models',
        chatEndpoint: '/v1/chat/completions',
        apiKeyHeader: 'Authorization',
        websiteUrl: 'https://platform.deepseek.com/'
    },
    openai: {
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com',
        modelsEndpoint: '/v1/models',
        chatEndpoint: '/v1/chat/completions',
        apiKeyHeader: 'Authorization',
        websiteUrl: 'https://platform.openai.com/'
    },
    moonshot: {
        name: 'Moonshot',
        baseUrl: 'https://api.moonshot.cn',
        modelsEndpoint: '/v1/models',
        chatEndpoint: '/v1/chat/completions',
        apiKeyHeader: 'Authorization',
        websiteUrl: 'https://platform.moonshot.cn/'
    },
    volcano: {
        name: '火山引擎',
        baseUrl: 'https://ark.cn-beijing.volces.com',
        modelsEndpoint: '/api/v3/models',
        chatEndpoint: '/api/v3/chat/completions',
        apiKeyHeader: 'Authorization',
        websiteUrl: 'https://console.volcengine.com/ark'
    },
    Achuan: {
        name: 'Achuan',
        baseUrl: 'https://gpt.achuan-2.top',
        modelsEndpoint: '/v1/models',
        chatEndpoint: '/v1/chat/completions',
        apiKeyHeader: 'Authorization',
        websiteUrl: 'https://gpt.achuan-2.top/register?aff=ZndO'
    },
    minimax: {
        name: 'MiniMax',
        baseUrl: 'https://api.minimaxi.com',
        modelsEndpoint: '/v1/models',
        chatEndpoint: '/v1/chat/completions',
        apiKeyHeader: 'Authorization',
        websiteUrl: 'https://platform.minimaxi.com/'
    },
    custom: {
        name: 'Custom',
        baseUrl: '',
        modelsEndpoint: '/v1/models',
        chatEndpoint: '/v1/chat/completions',
        apiKeyHeader: 'Authorization'
    }
};

/**
 * 获取平台配置信息
 */
export function getProviderConfig(provider: AIProvider): ProviderConfig {
    return PROVIDER_CONFIGS[provider];
}

/**
 * 根据自定义API URL和默认端点，获取基础URL和实际端点
 * @param customApiUrl 用户输入的自定义API URL
 * @param defaultEndpoint 默认的端点 (e.g., '/v1/models', '/v1/chat/completions')
 * @returns {baseUrl: string, endpoint: string}
 * 
 * 规则说明：
 * 1. 已以 /chat/completions（或 /completions）结尾：视为完整对话端点
 *    - 请求对话：直接使用该地址
 *    - 请求模型：自动回退到同层 /models
 *    例如：https://api.siliconflow.cn/v1/chat/completions/ + /v1/models -> https://api.siliconflow.cn/v1/models
 * 2. 以 '/' 结尾：去掉 /v1 前缀，保留后续路径
 *    例如：https://text.pollinations.ai/openai/ + /v1/models -> https://text.pollinations.ai/openai/models
 * 3. 以 '#' 结尾：强制使用输入地址，完全不拼接端点路径
 *    例如：https://text.pollinations.ai/openai# + /v1/models -> https://text.pollinations.ai/openai
 * 4. 其他情况：使用完整的默认端点
 *    例如：https://api.openai.com + /v1/models -> https://api.openai.com/v1/models
 */
function getBaseUrlAndEndpoint(
    customApiUrl: string,
    defaultEndpoint: string
): { baseUrl: string; endpoint: string } {
    const trimmedUrl = (customApiUrl || '').trim();
    const normalizedUrl = trimmedUrl.replace(/\/+$/, '');

    // 规则3：以 '#' 结尾，强制使用输入地址，不拼接任何端点
    if (trimmedUrl.endsWith('#')) {
        const baseUrl = trimmedUrl.slice(0, -1); // 移除 '#'
        return { baseUrl, endpoint: '' }; // endpoint 为空，直接使用 baseUrl
    }

    // 规则1：已是 completions 端点，聊天直接用原地址，模型自动回退到同层 /models
    const completionMatch = normalizedUrl.match(/^(.*?)(\/chat\/completions|\/completions)$/i);
    if (completionMatch) {
        const base = completionMatch[1];
        const lowerDefaultEndpoint = defaultEndpoint.toLowerCase();

        if (lowerDefaultEndpoint.includes('/models')) {
            return { baseUrl: `${base}/models`, endpoint: '' };
        }

        if (lowerDefaultEndpoint.includes('/completions')) {
            return { baseUrl: normalizedUrl, endpoint: '' };
        }
    }

    // 规则2：以 '/' 结尾，去掉 /v1 前缀，保留后续路径
    if (trimmedUrl.endsWith('/')) {
        const baseUrl = trimmedUrl.slice(0, -1); // 移除 '/'
        const endpoint = defaultEndpoint.startsWith('/v1')
            ? defaultEndpoint.substring(3) // 去掉 /v1，例如 /v1/models -> /models
            : defaultEndpoint;
        return { baseUrl, endpoint };
    }

    // 规则4：默认情况，使用完整的默认端点
    return { baseUrl: trimmedUrl.replace(/\/$/, ''), endpoint: defaultEndpoint };
}

function getBaseUrlForChatInterface(url: string, chatInterface: ChatInterfaceType): string {
    const normalizedUrl = (url || '').trim().replace(/\/+$/, '');

    if (chatInterface === 'gemini') {
        return normalizedUrl.replace(/\/v\d+(?:beta)?\/models\/.*$/i, '');
    }

    if (chatInterface === 'anthropic') {
        return normalizedUrl.replace(/\/v1\/messages(?:\/.*)?$/i, '');
    }

    return normalizedUrl
        .replace(/\/v1\/chat\/completions(?:\/.*)?$/i, '')
        .replace(/\/chat\/completions(?:\/.*)?$/i, '');
}

interface ThinkTagParseState {
    carry: string;
    inThinkTag: boolean;
}

interface ThinkTaggedSegment {
    type: 'content' | 'thinking';
    text: string;
}

/**
 * 增量解析 MiniMax M2.7 返回在 content 中的 <think>...</think> 片段
 */
function parseThinkTaggedContent(
    text: string,
    state: ThinkTagParseState,
    flush: boolean = false
): ThinkTaggedSegment[] {
    const openTag = '<think>';
    const closeTag = '</think>';
    const segments: ThinkTaggedSegment[] = [];
    let input = `${state.carry}${text}`;

    state.carry = '';

    const pushSegment = (type: 'content' | 'thinking', chunk: string) => {
        if (chunk) {
            segments.push({ type, text: chunk });
        }
    };

    while (input.length > 0) {
        const lowerInput = input.toLowerCase();

        if (state.inThinkTag) {
            const endIndex = lowerInput.indexOf(closeTag);
            if (endIndex === -1) {
                if (flush) {
                    pushSegment('thinking', input);
                } else {
                    const safeLength = Math.max(0, input.length - (closeTag.length - 1));
                    pushSegment('thinking', input.slice(0, safeLength));
                    state.carry = input.slice(safeLength);
                }
                break;
            }

            pushSegment('thinking', input.slice(0, endIndex));
            input = input.slice(endIndex + closeTag.length);
            state.inThinkTag = false;
        } else {
            const startIndex = lowerInput.indexOf(openTag);
            if (startIndex === -1) {
                if (flush) {
                    pushSegment('content', input);
                } else {
                    const safeLength = Math.max(0, input.length - (openTag.length - 1));
                    pushSegment('content', input.slice(0, safeLength));
                    state.carry = input.slice(safeLength);
                }
                break;
            }

            pushSegment('content', input.slice(0, startIndex));
            input = input.slice(startIndex + openTag.length);
            state.inThinkTag = true;
        }
    }

    return segments;
}

/**
 * 获取模型列表
 */
export async function fetchModels(
    provider: string,
    apiKey: string,
    customApiUrl?: string,
    advancedConfig?: AdvancedProviderConfig,
    useForwardProxy?: boolean,
    chatInterface?: ChatInterfaceType // 根据不同的平台接口，走不同的 API Key 认证方式
): Promise<ModelInfo[]> {
    const isBuiltIn = ['gemini', 'deepseek', 'openai', 'moonshot', 'volcano', 'Achuan', 'minimax'].includes(provider);
    const config = isBuiltIn ? PROVIDER_CONFIGS[provider as AIProvider] : PROVIDER_CONFIGS.custom;
    const fallbackProviderName = isBuiltIn ? config.name : provider;

    let url: string;

    // 优先使用高级自定义的模型列表 URL
    if (advancedConfig?.customModelsUrl) {
        url = advancedConfig.customModelsUrl;
    } else if (customApiUrl) {
        const { baseUrl, endpoint } = getBaseUrlAndEndpoint(customApiUrl, config.modelsEndpoint);
        url = `${baseUrl}${endpoint}`;
    } else {
        if (!isBuiltIn) {
            throw new Error('Custom provider requires API URL');
        }
        url = `${config.baseUrl}${config.modelsEndpoint}`;
    }

    const shouldUseMiniMaxFallback =
        isMiniMaxApiUrl(advancedConfig?.customModelsUrl) ||
        isMiniMaxApiUrl(customApiUrl) ||
        isMiniMaxApiUrl(url);

    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        // 处理不同平台的认证方式
        if (chatInterface === 'anthropic') {
        // Anthropic 使用 x-api-key 和 anthropic-version 作为 header，比 Authorization 方式更加规范，且可以适配 Kimi Code API
            headers['x-api-key'] = apiKey; 
            headers['anthropic-version'] = '2023-06-01';
        } else if (provider === 'gemini' || chatInterface === 'gemini') {
            headers[config.apiKeyHeader] = apiKey;
        } else {
            headers['Authorization'] = `Bearer ${apiKey}`; // OpenAI 接口
        }

        let response: Response;
        if (useForwardProxy) {
            console.log('[fetchModels] forwardProxy headers:', headers, 'chatInterface:', chatInterface);
            const result = await forwardProxyFetch(url, {
                method: 'GET',
                headers,
                timeout: 30000
            });
            response = new Response(await result.text(), {
                status: result.status,
                headers: result.headers
            });
        } else {
            response = await fetch(url, {
                method: 'GET',
                headers
            });
        }

        if (!response.ok) {
            if (shouldUseMiniMaxFallback) {
                return getMiniMaxFallbackModels(fallbackProviderName);
            }

            // 尝试读取错误响应体中的详细错误信息
            let errorMessage = `Failed to fetch models: ${response.status} ${response.statusText}`;
            try {
                const errorData = await response.json();
                // 尝试提取常见的错误消息字段
                const detailMsg = errorData.error?.message || errorData.message || errorData.error || JSON.stringify(errorData);
                errorMessage += `\n\n${detailMsg}`;
            } catch (e) {
                // 如果无法解析 JSON，尝试读取文本
                try {
                    const errorText = await response.text();
                    if (errorText) {
                        errorMessage += `\n\n${errorText}`;
                    }
                } catch (textError) {
                    // 忽略文本读取错误
                }
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();

        // 处理不同平台的响应格式
        if (provider === 'gemini') {
            const geminiModels = (data.models || []).map((model: any) => ({
                id: model.name.replace('models/', ''),
                name: model.displayName || model.name,
                provider: config.name
            }));
            return geminiModels.length > 0 || !shouldUseMiniMaxFallback
                ? geminiModels
                : getMiniMaxFallbackModels(fallbackProviderName);
        } else {
            // 尝试多种可能的响应格式以支持自定义API
            let modelsArray: any[] = [];
            if (Array.isArray(data)) {
                modelsArray = data;
            } else if (data.data && Array.isArray(data.data)) {
                modelsArray = data.data;
            } else if (data.models && Array.isArray(data.models)) {
                modelsArray = data.models;
            } else {
                // 如果都不是，尝试将data作为单个model或空数组
                modelsArray = [];
            }

            const normalizedModels = modelsArray.map((model: any) => {
                // 处理不同格式的model对象
                if (typeof model === 'string') {
                    return {
                        id: model,
                        name: model,
                        provider: config.name
                    };
                } else {
                    return {
                        id: model.id || model.name || model,
                        name: model.name || model.id || model,
                        provider: config.name
                    };
                }
            });
            return normalizedModels.length > 0 || !shouldUseMiniMaxFallback
                ? normalizedModels
                : getMiniMaxFallbackModels(fallbackProviderName);
        }
    } catch (error) {
        if (shouldUseMiniMaxFallback) {
            return getMiniMaxFallbackModels(fallbackProviderName);
        }

        console.error('Error fetching models:', error);
        throw error;
    }
}

/**
 * 发送聊天请求 (OpenAI 格式)
 */
async function chatOpenAIFormat(
    url: string,
    apiKey: string,
    options: ChatOptions
): Promise<void> {


    // 转换消息格式以支持多模态和工具调用
    const formattedMessages = await Promise.all(options.messages.map(async msg => {
        const formatted: any = {
            role: msg.role,
            content: msg.content
        };

        // 如果是多模态内容，处理 blob URL
        if (Array.isArray(msg.content)) {
            const newContent = await Promise.all(msg.content.map(async part => {
                if (part.type === 'image_url' && part.image_url && part.image_url.url.startsWith('blob:')) {
                    const base64 = await imageUrlToBase64(part.image_url.url);
                    // 注意：OpenAI 需要完整的 data:uri
                    return {
                        ...part,
                        image_url: {
                            url: `data:image/jpeg;base64,${base64}`
                        }
                    };
                }
                return part;
            }));
            formatted.content = newContent;
        }

        // 检测是否是 DeepSeek 推理模型（deepseek-reasoner 或 deepseek-r1）
        const isDeepSeekReasoner = /deepseek-(reasoner|r1)/i.test(options.model);

        // 深度思考模式下需要回传的思维链内容（如 DeepSeek reasoning_content）
        // 如果历史消息中存在 reasoning_content，无论当前是否启用 thinking 模式，都应该回传给 API
        // 否则某些严格校验的模型（如 DeepSeek, Kimi 等）在关闭 thinking 模式继续对话时会报 400 错误
        if ((msg as any).reasoning_content !== undefined) {
            formatted.reasoning_content = (msg as any).reasoning_content;
        } else if (msg.thinkingBeforeToolCalls) {
            formatted.reasoning_content = msg.thinkingBeforeToolCalls;
        } else if (msg.toolCallThinkings && msg.toolCallThinkings.length > 0 && msg.toolCallThinkings[0].thinkingBefore) {
            formatted.reasoning_content = msg.toolCallThinkings[0].thinkingBefore;
        } else if (msg.thinking) {
            formatted.reasoning_content = msg.thinking;
        }

        // 确保包含 tool_calls 的 assistant 消息有 reasoning_content（部分模型强制要求）
        const isReasoningRequiredModel = /deepseek/i.test(options.model) || /kimi/i.test(options.model) || /moonshot/i.test(options.model);
        const needReasoningContent = options.enableThinking || isReasoningRequiredModel;
        if (needReasoningContent && msg.tool_calls && msg.tool_calls.length > 0) {
            if (!formatted.reasoning_content) {
                // 部分模型（如 Kimi 2.6）如果接收到空字符串可能会判定为 missing（omitempty导致）
                // 所以我们回传一个空格代替完全为空
                formatted.reasoning_content = ' ';
            }
        }

        // 添加工具调用信息
        if (msg.tool_calls) {
            const isGeminiLike = /gemini/i.test(options.model) || isSupportedThinkingGeminiModel(options.model);
            formatted.tool_calls = msg.tool_calls.map((tc, index) => {
                const functionCopied = { ...tc.function };
                
                // Google api requires thought_signature ONLY on the first parallel tool call
                if (isGeminiLike && index === 0 && !functionCopied.thought_signature) {
                    // 补充因历史错误或代理丢失造成的 thought_signature 缺失，避免 400/429 报错
                    // 使用绕过验证的魔法值 skip_thought_signature_validator
                    functionCopied.thought_signature = "skip_thought_signature_validator";
                } else if (isGeminiLike && index > 0 && functionCopied.thought_signature) {
                    // 并行调用的后续工具不能有签名，如果有则移除
                    delete functionCopied.thought_signature;
                }
                
                const tcPayload: any = { ...tc, function: functionCopied };
                if (functionCopied.thought_signature) {
                    tcPayload.extra_content = { google: { thought_signature: functionCopied.thought_signature } };
                }
                return tcPayload;
            });
        }

        // 添加工具返回信息
        if (msg.role === 'tool') {
            formatted.tool_call_id = msg.tool_call_id;
            formatted.name = msg.name;
        }

        return formatted;
    }));

    const requestBody: any = {
        model: options.model,
        messages: formattedMessages,
        temperature: options.temperature || 1,
        max_tokens: options.maxTokens,
        stream: options.stream !== false,
        ...options.customBody // 合并自定义参数
    };

    // 添加工具定义（Agent模式）
    if (options.tools && options.tools.length > 0) {
        requestBody.tools = options.tools;
        requestBody.tool_choice = 'auto'; // 让模型自动决定是否调用工具
    }

    // OpenAI proxy 渠道转发 Gemini 的图片 modalities 设置
    if (/(image|imagen)/i.test(options.model) && options.model.toLowerCase().includes('gemini')) {
        if (!requestBody.extra_body) requestBody.extra_body = {};
        if (!requestBody.extra_body.google) requestBody.extra_body.google = {};
        requestBody.extra_body.google.responseModalities = ["TEXT", "IMAGE"]; // 默认图文并茂
        
        // 删除无用的外层参数
        if (requestBody.generationConfig) {
            delete requestBody.generationConfig;
        }
    }

    // 检测是否是 Kimi 模型（通过模型ID判断）
    const isKimi = /kimi/i.test(options.model);

    // Kimi 特殊处理：官方不允许设置 temperature
    if (isKimi) {
        delete requestBody.temperature;
    }

    // 检测是否是 Minimax 模型
    const isMinimaxThinking = isMinimaxThinkingModel(options.model);

    // MiniMax 文档中的 OpenAI SDK `extra_body={"reasoning_split": true}`
    // 会被 SDK 展平为顶层请求参数。这里我们直接 fetch JSON，因此需要手动放到顶层。
    if (isMinimaxThinking) {
        requestBody.reasoning_split = true;
        if (requestBody.extra_body?.reasoning_split !== undefined) {
            delete requestBody.extra_body.reasoning_split;
        }
    }

    // 处理思考模式：界面控制优先
    // 如果界面未启用思考模式，删除自定义参数中可能存在的思考模式设置
    if (!options.enableThinking) {
        // 删除可能来自自定义参数的思考模式字段
        delete requestBody.thinking;
        delete requestBody.reasoning_effort;
        delete requestBody.enable_thinking;
        if (requestBody.extra_body?.google?.thinking_config) {
            delete requestBody.extra_body.google.thinking_config;
        }

        // Kimi 特殊处理：未启用 thinking 时需要显式设置为 disabled
        // 否则默认为 enabled，会导致 API 报错
        if (isKimi) {
            requestBody.thinking = { type: 'disabled' };
        }
    } else {
        // 如果启用思考模式，添加相关参数
        // 注意：这里在自定义参数之后设置，确保界面控制的思考模式优先级最高
        const reasoningEffort = options.reasoningEffort || 'low';
        
        // 通用 thinking 开关：开启思考模式时默认显式启用
        // 某些 OpenAI 兼容接口要求该字段存在
        requestBody.thinking = { type: 'enabled' };

        // 检查是否是 Claude 模型（通过 OpenAI 兼容 API）
        if (isSupportedThinkingClaudeModel(options.model)) {
            // Claude 模型使用 thinking 参数
            // https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
            const budgetTokens = calculateClaudeThinkingBudget(
                options.model,
                reasoningEffort,
                options.maxTokens
            );
            requestBody.thinking = {
                type: 'enabled',
                budget_tokens: budgetTokens
            };
        }
        // Kimi 启用 thinking 时需要设置 thinking: {type: "enabled"}
        else if (isKimi) {
            requestBody.thinking = { type: 'enabled' };
        }
        // 检查是否是通过 OpenAI 兼容 API 调用的 Gemini 模型
        else if (isSupportedThinkingGeminiModel(options.model)) {
            // Gemini 3 系列使用 reasoning_effort 参数
            // https://ai.google.dev/gemini-api/docs/gemini-3?thinking=high#openai_compatibility
            if (isGemini3Model(options.model)) {
                // Gemini 3 只支持 low 和 high，将 medium 和 auto 映射到 low
                let mappedEffort: 'low' | 'high' = 'low';
                if (reasoningEffort === 'high') {
                    mappedEffort = 'high';
                }
                requestBody.reasoning_effort = mappedEffort;
            } else {
                // Gemini 2.5 等使用 google.thinking_config
                // 根据 reasoningEffort 计算 thinkingBudget
                let thinkingBudget: number;
                if (reasoningEffort === 'auto') {
                    thinkingBudget = -1; // -1 表示动态思考
                } else {
                    // 根据努力程度设置预算（以 token 为单位）
                    const budgetMap: Record<ThinkingEffort, number> = {
                        low: 4096,
                        medium: 16384,
                        high: 32768,
                        auto: -1
                    };
                    thinkingBudget = options.thinkingBudget ?? budgetMap[reasoningEffort];
                }
                requestBody.extra_body = {
                    ...requestBody.extra_body,
                    google: {
                        thinking_config: {
                            thinking_budget: thinkingBudget,
                            include_thoughts: true
                        }
                    }
                };
            }
        }
        // 通用的 stream_options（适用于 DeepSeek 等）
        requestBody.stream_options = {
            include_usage: true
        };
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    // ===== forwardProxy 模式：强制非流式，通过思源后端绕过 CORS =====
    if (options.useForwardProxy) {
        requestBody.stream = false;
        delete requestBody.stream_options;

        try {
            const result = await forwardProxyFetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                timeout: 120000
            });

            if (!result.ok) {
                let errorMessage = `API request failed: ${result.status}`;
                try {
                    const errorData = await result.json();
                    const detailMsg = errorData.error?.message || errorData.message || errorData.error || JSON.stringify(errorData);
                    errorMessage += `\n\n${detailMsg}`;
                } catch (e) {
                    try {
                        const errorText = await result.text();
                        if (errorText) errorMessage += `\n\n${errorText}`;
                    } catch (_) {}
                }
                throw new Error(errorMessage);
            }

            const data = await result.json();
            const content = data.choices?.[0]?.message?.content || '';
            const shouldParseThinkTags =
                options.enableThinking && isMinimaxThinkingModel(options.model);

            if (shouldParseThinkTags && typeof content === 'string') {
                const segments = parseThinkTaggedContent(
                    content,
                    { carry: '', inThinkTag: false },
                    true
                );
                let visibleContent = '';
                let thinkingContent = '';

                for (const segment of segments) {
                    if (segment.type === 'thinking') {
                        thinkingContent += segment.text;
                    } else {
                        visibleContent += segment.text;
                    }
                }

                if (thinkingContent) {
                    options.onThinkingChunk?.(thinkingContent);
                    options.onThinkingComplete?.(thinkingContent);
                }

                if (visibleContent) {
                    options.onChunk?.(visibleContent);
                }

                options.onComplete?.(visibleContent);
            } else {
                options.onChunk?.(content);
                options.onComplete?.(content);
            }
        } catch (error) {
            console.error('Chat error:', error);
            options.onError?.(error as Error);
            throw error;
        }
        return;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: options.signal // 传递 AbortSignal
        });

        if (!response.ok) {
            // 尝试读取错误响应体中的详细错误信息
            let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
            try {
                const errorData = await response.json();
                // 尝试提取常见的错误消息字段
                const detailMsg = errorData.error?.message || errorData.message || errorData.error || JSON.stringify(errorData);
                errorMessage += `\n\n${detailMsg}`;
            } catch (e) {
                // 如果无法解析 JSON，尝试读取文本
                try {
                    const errorText = await response.text();
                    if (errorText) {
                        errorMessage += `\n\n${errorText}`;
                    }
                } catch (textError) {
                    // 忽略文本读取错误
                }
            }
            throw new Error(errorMessage);
        }

        if (options.stream !== false && response.body) {
            await handleStreamResponse(response.body, options);
        } else {
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';
            const shouldParseThinkTags =
                options.enableThinking && isMinimaxThinkingModel(options.model);

            if (shouldParseThinkTags && typeof content === 'string') {
                const segments = parseThinkTaggedContent(
                    content,
                    { carry: '', inThinkTag: false },
                    true
                );
                let visibleContent = '';
                let thinkingContent = '';

                for (const segment of segments) {
                    if (segment.type === 'thinking') {
                        thinkingContent += segment.text;
                    } else {
                        visibleContent += segment.text;
                    }
                }

                if (thinkingContent) {
                    options.onThinkingChunk?.(thinkingContent);
                    options.onThinkingComplete?.(thinkingContent);
                }

                if (visibleContent) {
                    options.onChunk?.(visibleContent);
                }

                options.onComplete?.(visibleContent);
            } else {
                options.onChunk?.(content);
                options.onComplete?.(content);
            }
        }
    } catch (error) {
        // 检查是否是用户主动中断
        if ((error as Error).name === 'AbortError') {
            console.log('Request was aborted by user');
            options.onError?.(new Error('Request aborted'));
        } else {
            console.error('Chat error:', error);
            options.onError?.(error as Error);
        }
        throw error;
    }
}

/**
 * 转换消息格式 (Gemini 格式)
 */
async function prepareGeminiContents(messages: Message[], isImageModel: boolean = false): Promise<any[]> {
    const contents: any[] = [];
    const msgs = messages.filter(msg => msg.role !== 'system');
    
    for (const msg of msgs) {
        let role = msg.role === 'assistant' ? 'model' : 'user';
        if (msg.role === 'tool') {
            contents.push({
                role: 'tool',
                parts: [{
                    functionResponse: {
                        name: msg.name || '',
                        response: { content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }
                    }
                }]
            });
            continue;
        }

        const parts: any[] = [];
        const imagesToMoveToModel: any[] = [];

        if (typeof msg.content === 'string') {
            if (msg.content) parts.push({ text: msg.content });
        } else {
            for (const part of msg.content) {
                if (part.type === 'text' && part.text) {
                    parts.push({ text: part.text });
                } else if (part.type === 'image_url' && part.image_url) {
                    let base64Data = '';
                    if (part.image_url.url.startsWith('data:')) {
                        base64Data = part.image_url.url.replace(/^data:image\/\w+;base64,/, '');
                    } else {
                        base64Data = await imageUrlToBase64(part.image_url.url);
                    }
                    const mimeType = part.image_url.url.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';
                    
                    const imgPart = {
                        inline_data: {
                            mime_type: mimeType,
                            data: base64Data,
                        },
                    };

                    // 如果是在处理生图模型的追问生成，由于前端会把生图结果当做附件放在接下来的 user 问题里，
                    // Gemini 生成图片接口不接受 user 发送图片作为输入，所以我们在组装时将它们移动合并到上一次的 model 语境下。
                    if (isImageModel && role === 'user' && contents.length > 0 && contents[contents.length - 1].role === 'model') {
                        imagesToMoveToModel.push(imgPart);
                    } else {
                        parts.push(imgPart);
                    }
                }
            }
        }

        if (msg.tool_calls) {
            for (const toolCall of msg.tool_calls) {
                const thoughtSig = toolCall.function.thought_signature || '';
                parts.push({ functionCall: {
                    name: toolCall.function.name,
                    args: JSON.parse(toolCall.function.arguments || '{}'),
                    thought_signature: thoughtSig
                }});
            }
        }

        if (msg.role === 'assistant' && msg.generatedImages && msg.generatedImages.length > 0) {
            msg.generatedImages.forEach(img => {
                parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
            });
        }

        // Gemini 接口不允许 part 或 contents 数组为空对象结构，否则报错 "part must not be empty"
        if (parts.length === 0) {
            parts.push({ text: " " });
        }

        if (imagesToMoveToModel.length > 0 && role === 'user') {
            contents[contents.length - 1].parts.push(...imagesToMoveToModel);
        }

        contents.push({ role, parts });
    }
    
    return contents;
}

/**
 * 发送聊天请求 (Gemini 格式)
 */
async function chatGeminiFormat(
    baseUrl: string,
    apiKey: string,
    model: string,
    options: ChatOptions
): Promise<void> {
    const streamUrl = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
    const nonStreamUrl = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const url = options.useForwardProxy ? nonStreamUrl : streamUrl;

    // 转换消息格式
    const contents = await prepareGeminiContents(options.messages);


    const systemInstruction = options.messages.find(msg => msg.role === 'system');

    // 检查是否需要启用图片生成（通过customBody或enableImageGeneration）
    const enableImageGen = options.enableImageGeneration ||
        options.customBody?.generationConfig?.responseModalities?.includes('IMAGE');

    const requestBody: any = {
        contents,
        generationConfig: {
            temperature: options.temperature || 1,
            maxOutputTokens: options.maxTokens
        },
        ...options.customBody // 合并自定义参数
    };

    // 如果启用了图片生成，确保responseModalities包含IMAGE
    if (enableImageGen) {
        if (!requestBody.generationConfig) {
            requestBody.generationConfig = {};
        }
        if (!requestBody.generationConfig.responseModalities) {
            requestBody.generationConfig.responseModalities = ['TEXT', 'IMAGE'];
        }
    }

    // 处理思考模式：界面控制优先
    // 如果界面未启用思考模式，删除自定义参数中可能存在的思考模式设置
    if (!options.enableThinking) {
        if (requestBody.generationConfig?.thinkingConfig) {
            delete requestBody.generationConfig.thinkingConfig;
        }
    } else {
        // 如果启用思考模式，添加 thinkingConfig 参数
        // 这会覆盖自定义参数中的设置
        requestBody.generationConfig.thinkingConfig = {
            includeThoughts: true // 包含思考过程
        };
        // Gemini API 要求设置 includeThoughts 时不能同时设置某些参数或需要特殊预算
        // 这里默认不设置 thinkingBudget，让模型自动决定
    }

    // 添加工具定义 (Gemini 原生格式)
    if (options.tools && options.tools.length > 0) {
        requestBody.tools = [{
            function_declarations: options.tools.map((tool: any) => ({
                name: tool.function?.name || tool.name,
                description: tool.function?.description || tool.description,
                parameters: tool.function?.parameters || tool.parameters
            }))
        }];
    }

    if (systemInstruction) {
        requestBody.systemInstruction = {
            parts: [{ text: systemInstruction.content }]
        };
    }

    // ===== forwardProxy 模式：通过思源后端绕过 CORS =====
    if (options.useForwardProxy) {
        try {
            const result = await forwardProxyFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                timeout: 120000
            });

            if (!result.ok) {
                let errorMessage = `Gemini API request failed: ${result.status}`;
                try {
                    const errorData = await result.json();
                    const detailMsg = errorData.error?.message || errorData.message || errorData.error || JSON.stringify(errorData);
                    errorMessage += `\n\n${detailMsg}`;
                } catch (e) {
                    try {
                        const errorText = await result.text();
                        if (errorText) errorMessage += `\n\n${errorText}`;
                    } catch (_) {}
                }
                throw new Error(errorMessage);
            }

            const data = await result.json();
            let fullText = '';
            let thinkingText = '';
            let isThinkingPhase = false;
            const toolCalls: ToolCall[] = [];
            const generatedImages: GeneratedImageData[] = [];

            if (data.candidates?.[0]?.content?.parts) {
                for (const part of data.candidates[0].content.parts) {
                    const inlineData = part.inline_data || part.inlineData;
                    if (inlineData) {
                        generatedImages.push({
                            mimeType: inlineData.mime_type || inlineData.mimeType || 'image/png',
                            data: inlineData.data
                        });
                        continue;
                    }

                    if (!part.text) continue;

                    if (options.enableThinking && part.thought === true) {
                        isThinkingPhase = true;
                        thinkingText += part.text;
                        options.onThinkingChunk?.(part.text);
                    } else {
                        if (isThinkingPhase && options.onThinkingComplete) {
                            options.onThinkingComplete(thinkingText);
                            isThinkingPhase = false;
                        }
                        fullText += part.text;
                        options.onChunk?.(part.text);
                    }

                    if (part.functionCall) {
                        toolCalls.push({
                            id: `call_${Math.random().toString(36).substring(2, 9)}`,
                            type: 'function',
                            function: {
                                name: part.functionCall.name,
                                arguments: typeof part.functionCall.args === 'string'
                                    ? part.functionCall.args
                                    : JSON.stringify(part.functionCall.args || {}),
                                thought_signature: part.functionCall.thought_signature || ''
                            }
                        });
                    }
                }
            }

            if (isThinkingPhase && options.onThinkingComplete) {
                options.onThinkingComplete(thinkingText);
            }

            if (generatedImages.length > 0 && options.onImageGenerated) {
                await options.onImageGenerated(generatedImages);
            }

            if (toolCalls.length > 0 && options.onToolCallComplete) {
                options.onToolCallComplete(toolCalls);
            }

            await options.onComplete?.(fullText);
        } catch (error) {
            console.error('Gemini chat error:', error);
            options.onError?.(error as Error);
            throw error;
        }
        return;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: options.signal // 传递 AbortSignal
        });

        if (!response.ok) {
            // 尝试读取错误响应体中的详细错误信息
            let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
            try {
                const errorData = await response.json();
                // 尝试提取常见的错误消息字段
                const detailMsg = errorData.error?.message || errorData.message || errorData.error || JSON.stringify(errorData);
                errorMessage += `\n\n${detailMsg}`;
            } catch (e) {
                // 如果无法解析 JSON，尝试读取文本
                try {
                    const errorText = await response.text();
                    if (errorText) {
                        errorMessage += `\n\n${errorText}`;
                    }
                } catch (textError) {
                    // 忽略文本读取错误
                }
            }
            throw new Error(errorMessage);
        }

        if (response.body) {
            await handleGeminiStreamResponse(response.body, options);
        }
    } catch (error) {
        // 检查是否是用户主动中断
        if ((error as Error).name === 'AbortError') {
            console.log('Gemini request was aborted by user');
            options.onError?.(new Error('Request aborted'));
        } else {
            console.error('Gemini chat error:', error);
            options.onError?.(error as Error);
        }
        throw error;
    }
}

/**
 * 将图片 URL（包括 blob URL）转换为 base64 数据（不带前缀）
 */
async function imageUrlToBase64(url: string): Promise<string> {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                resolve(result.replace(/^data:image\/\w+;base64,/, ''));
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error('Failed to convert image to base64:', url, e);
        return '';
    }
}

/**
 * 处理 OpenAI 格式的流式响应
 */
async function handleStreamResponse(
    body: ReadableStream<Uint8Array>,
    options: ChatOptions
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let thinkingText = '';
    let buffer = '';
    let isThinkingPhase = false;
    let toolCalls: ToolCall[] = [];
    const generatedImages: GeneratedImageData[] = [];
    const shouldParseThinkTags =
        options.enableThinking && isMinimaxThinkingModel(options.model);
    const thinkTagState: ThinkTagParseState = {
        carry: '',
        inThinkTag: false
    };

    const handleThinkingChunk = (chunk: string) => {
        isThinkingPhase = true;
        thinkingText += chunk;
        options.onThinkingChunk?.(chunk);
    };

    const handleContentChunk = (chunk: string) => {
        if (isThinkingPhase && options.onThinkingComplete) {
            options.onThinkingComplete(thinkingText);
            isThinkingPhase = false;
        }
        fullText += chunk;
        options.onChunk?.(chunk);
    };

    const handleRegularContent = (content: string, flushThinkTags: boolean = false) => {
        if (!content && !flushThinkTags) return;

        if (shouldParseThinkTags) {
            const segments = parseThinkTaggedContent(content, thinkTagState, flushThinkTags);
            for (const segment of segments) {
                if (segment.type === 'thinking') {
                    handleThinkingChunk(segment.text);
                } else {
                    handleContentChunk(segment.text);
                }
            }
            return;
        }

        if (content) {
            handleContentChunk(content);
        }
    };

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                if (trimmed.startsWith('data:')) {
                    const payload = trimmed.slice(5).trimStart();
                    if (!payload || payload === '[DONE]') continue;

                    try {
                        const json = JSON.parse(payload);
                        const delta = json.choices?.[0]?.delta;

                        // 检查是否有图片数据 (某些 API 可能在流式响应中返回图片)
                        // 支持多种可能的图片数据格式
                        if (delta?.images || delta?.image || json.images || json.image) {
                            const imageData = delta?.images || delta?.image || json.images || json.image;
                            const imageArray = Array.isArray(imageData) ? imageData : [imageData];

                            for (const img of imageArray) {
                                if (img.b64_json || img.data) {
                                    generatedImages.push({
                                        mimeType: img.mime_type || img.mimeType || 'image/png',
                                        data: img.b64_json || img.data
                                    });
                                } else if (img.url) {
                                    // 如果只有 URL，需要下载图片并转换为 base64
                                    // 这里暂时跳过，因为需要异步处理
                                }
                            }
                        }

                        // 检查是否有思考内容
                        // DeepSeek 使用 reasoning_content
                        // Gemini OpenAI 兼容模式使用 reasoning（或 thought/thinking）
                        // Minimax 使用 reasoning_details（数组，每个元素有 text 字段）
                        let reasoningContent = delta?.reasoning_content
                            || delta?.reasoning
                            || delta?.thought
                            || delta?.thinking;
                        
                        // 处理 Minimax 的 reasoning_details 格式
                        if (!reasoningContent && delta?.reasoning_details && Array.isArray(delta.reasoning_details)) {
                            reasoningContent = delta.reasoning_details
                                .map((detail: any) => detail.text || '')
                                .join('');
                        }
                        
                        if (options.enableThinking && reasoningContent) {
                            isThinkingPhase = true;
                            thinkingText += reasoningContent;
                            options.onThinkingChunk?.(reasoningContent);
                        }

                        // 检查是否有工具调用
                        if (delta?.tool_calls) {
                            for (const toolCallDelta of delta.tool_calls) {
                                const index = toolCallDelta.index;
                                
                                // 检查此 index 是否属于一个新工具调用
                                // 1. 此 index 还没有对应的调用
                                // 2. 或者 delta 提供了新的 ID（且与当前此 index 记录的 ID 不同）
                                const currentCall = toolCalls.find(tc => (tc as any)._index === index && (!toolCallDelta.id || tc.id === toolCallDelta.id));
                                
                                if (!currentCall || (toolCallDelta.id && toolCallDelta.id !== currentCall.id)) {
                                    const thoughtSig = toolCallDelta.function?.thought_signature || toolCallDelta.function?.thoughtSignature || (toolCallDelta as any).extra_content?.google?.thought_signature || '';
                                    const newCall: ToolCall = {
                                        id: toolCallDelta.id || `call_${Math.random().toString(36).substring(2, 9)}`,
                                        type: 'function',
                                        function: {
                                            name: toolCallDelta.function?.name || '',
                                            arguments: toolCallDelta.function?.arguments || '',
                                            thought_signature: thoughtSig
                                        }
                                    };
                                    (newCall as any)._index = index;
                                    toolCalls.push(newCall);
                                } else {
                                    // 更新现有的调用内容
                                    if (toolCallDelta.id) {
                                        currentCall.id = toolCallDelta.id;
                                    }
                                    if (toolCallDelta.function?.name) {
                                        currentCall.function.name = toolCallDelta.function.name;
                                    }
                                    if (toolCallDelta.function?.arguments) {
                                        currentCall.function.arguments += toolCallDelta.function.arguments;
                                    }
                                    const incSig = toolCallDelta.function?.thought_signature || toolCallDelta.function?.thoughtSignature || (toolCallDelta as any).extra_content?.google?.thought_signature;
                                    if (incSig !== undefined) {
                                        currentCall.function.thought_signature = (currentCall.function.thought_signature || '') + incSig;
                                    }
                                }
                            }
                        }

                        // 普通内容
                        const content = delta?.content;
                        if (content) {
                            handleRegularContent(content);
                        }
                    } catch (e) {
                        console.error('Failed to parse SSE data:', e);
                    }
                }
            }
        }

        if (shouldParseThinkTags && thinkTagState.carry) {
            handleRegularContent('', true);
        }

        // 如果结束时还在思考阶段，调用思考完成回调
        if (isThinkingPhase && options.onThinkingComplete) {
            options.onThinkingComplete(thinkingText);
        }

        // 处理完整的工具调用
        if (toolCalls.length > 0 && options.onToolCallComplete) {
            // 移除临时使用的 _index 属性
            const cleanToolCalls = toolCalls.map(tc => {
                const { _index, ...rest } = tc as any;
                return rest as ToolCall;
            });
            options.onToolCallComplete(cleanToolCalls);
        }

        // 如果有生成的图片，调用回调（等待完成，避免与 onComplete 并发竞态）
        if (generatedImages.length > 0 && options.onImageGenerated) {
            await options.onImageGenerated(generatedImages);
        }

        await options.onComplete?.(fullText);
    } catch (error) {
        // 检查是否是用户主动中断
        if ((error as Error).name === 'AbortError') {
            console.log('Stream reading was aborted');
            // 如果已经有部分内容，仍然调用 onComplete
            if (fullText) {
                await options.onComplete?.(fullText);
            }
            if (thinkingText && options.onThinkingComplete) {
                options.onThinkingComplete(thinkingText);
            }
        } else {
            console.error('Stream reading error:', error);
            options.onError?.(error as Error);
        }
        throw error;
    } finally {
        reader.releaseLock();
    }
}

/**
 * 处理 Gemini 格式的流式响应
 */
async function handleGeminiStreamResponse(
    body: ReadableStream<Uint8Array>,
    options: ChatOptions
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let thinkingText = '';
    let buffer = '';
    let isThinkingPhase = false;
    let toolCalls: ToolCall[] = [];
    const generatedImages: GeneratedImageData[] = [];

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;

                const payload = trimmed.slice(5).trimStart();
                if (!payload || payload === '[DONE]') continue;

                try {
                    const json = JSON.parse(payload);
                    const parts = json.candidates?.[0]?.content?.parts;

                    if (parts && Array.isArray(parts)) {
                        for (const part of parts) {
                            // 处理生成的图片（兼容 inline_data / inlineData）
                            const inlineData = part.inline_data || part.inlineData;
                            if (inlineData) {
                                const imageData: GeneratedImageData = {
                                    mimeType: inlineData.mime_type || inlineData.mimeType || 'image/png',
                                    data: inlineData.data
                                };
                                generatedImages.push(imageData);
                                continue;
                            }

                            if (!part.text) continue;

                            // part.thought 是布尔值，表示这个 part 是否是思考内容
                            if (options.enableThinking && part.thought === true) {
                                // 这是思考内容
                                isThinkingPhase = true;
                                thinkingText += part.text;
                                options.onThinkingChunk?.(part.text);
                            } else if (part.text) {
                                // 这是正常回复内容
                                // 如果之前在思考阶段，现在开始输出正文，说明思考结束
                                if (isThinkingPhase && options.onThinkingComplete) {
                                    options.onThinkingComplete(thinkingText);
                                    isThinkingPhase = false;
                                }
                                fullText += part.text;
                                options.onChunk?.(part.text);
                            }

                            // 处理工具调用
                            if (part.functionCall) {
                                const thoughtSig = part.functionCall.thought_signature || part.functionCall.thoughtSignature || '';
                                toolCalls.push({
                                    id: `call_${Math.random().toString(36).substring(2, 9)}`,
                                    type: 'function',
                                    function: {
                                        name: part.functionCall.name,
                                        arguments: typeof part.functionCall.args === 'string'
                                            ? part.functionCall.args
                                            : JSON.stringify(part.functionCall.args || {}),
                                        thought_signature: thoughtSig
                                    }
                                });
                            }
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse Gemini SSE data:', e);
                }
            }
        }

        // 如果结束时还在思考阶段，调用思考完成回调
        if (isThinkingPhase && options.onThinkingComplete) {
            options.onThinkingComplete(thinkingText);
        }

        // 如果有生成的图片，调用回调（等待完成，避免与 onComplete 并发竞态）
        if (generatedImages.length > 0 && options.onImageGenerated) {
            await options.onImageGenerated(generatedImages);
        }

        // 处理完整的工具调用
        if (toolCalls.length > 0 && options.onToolCallComplete) {
            options.onToolCallComplete(toolCalls);
        }

        await options.onComplete?.(fullText);
    } catch (error) {
        // 检查是否是用户主动中断
        if ((error as Error).name === 'AbortError') {
            console.log('Gemini stream reading was aborted');
            // 如果已经有部分内容，仍然调用 onComplete
            if (fullText) {
                await options.onComplete?.(fullText);
            }
            if (thinkingText && options.onThinkingComplete) {
                options.onThinkingComplete(thinkingText);
            }
        } else {
            console.error('Gemini stream reading error:', error);
            options.onError?.(error as Error);
        }
        throw error;
    } finally {
        reader.releaseLock();
    }
}

/**
 * 发送聊天请求 (Claude 原生 API 格式)
 */
async function chatClaudeFormat(
    baseUrl: string,
    apiKey: string,
    options: ChatOptions
): Promise<void> {
    const url = `${baseUrl}/v1/messages`;

    // 提取 system 消息
    const systemMessages = options.messages.filter(msg => msg.role === 'system');
    const systemPrompt = systemMessages.map(msg =>
        typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text).join('\n')
    ).join('\n');

    // 转换消息格式（只保留 user 和 assistant，tool 消息需要特殊处理）
    const formattedMessages: any[] = [];
    
    for (const msg of options.messages) {
        if (msg.role === 'system') continue;
        
        // 处理 tool 角色的消息（转换为 Claude 的 tool_result 格式）
        if (msg.role === 'tool') {
            // 将 tool 消息作为 user 消息的 tool_result 内容块
            const toolResultContent = {
                type: 'tool_result',
                tool_use_id: msg.tool_call_id,
                content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            };
            
            // 检查最后一条消息是否已经是 user 消息且包含 tool_results
            const lastMsg = formattedMessages[formattedMessages.length - 1];
            if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
                // 添加到现有 user 消息的 content 数组中
                lastMsg.content.push(toolResultContent);
            } else {
                // 创建新的 user 消息
                formattedMessages.push({
                    role: 'user',
                    content: [toolResultContent]
                });
            }
            continue;
        }
        
        const formatted: any = {
            role: msg.role,
        };

        // 处理多模态内容和 tool_calls
        if (typeof msg.content === 'string') {
            // 如果有 tool_calls，需要将 content 转换为数组格式
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                const content: any[] = [];
                
                // Claude API 要求：若历史消息包含 thinking 内容，必须以 content block 格式回传，
                // 否则模型在继续对话时可能丢失上下文或行为异常。
                // OpenAI 格式使用 reasoning_content 字段回传，Claude 格式则使用 {type: 'thinking'} block。
                if (msg.thinking) {
                    content.push({ type: 'thinking', thinking: msg.thinking });
                }
                
                // 添加文本内容（如果有）
                if (msg.content) {
                    content.push({ type: 'text', text: msg.content });
                }
                
                // 添加 tool_use 块
                for (const toolCall of msg.tool_calls) {
                    content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: JSON.parse(toolCall.function.arguments || '{}')
                    });
                }
                
                formatted.content = content;
            } else {
                formatted.content = msg.content;
            }
        } else {
            // Claude 使用不同的格式
            const content: any[] = [];
            for (const part of msg.content) {
                if (part.type === 'text' && part.text) {
                    content.push({ type: 'text', text: part.text });
                } else if (part.type === 'image_url' && part.image_url) {
                    // Claude 使用 base64 格式
                    let base64Data = '';
                    let mediaType = 'image/jpeg';

                    if (part.image_url.url.startsWith('data:')) {
                        const match = part.image_url.url.match(/^data:(image\/\w+);base64,(.+)$/);
                        if (match) {
                            mediaType = match[1];
                            base64Data = match[2];
                        }
                    } else if (part.image_url.url.startsWith('blob:')) {
                        base64Data = await imageUrlToBase64(part.image_url.url);
                    }

                    if (base64Data) {
                        content.push({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType,
                                data: base64Data
                            }
                        });
                    }
                }
            }
            
            // 添加 tool_use 块（如果有）
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const toolCall of msg.tool_calls) {
                    content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: JSON.parse(toolCall.function.arguments || '{}')
                    });
                }
            }
            
            formatted.content = content;
        }

        formattedMessages.push(formatted);
    }

    const requestBody: any = {
        model: options.model,
        messages: formattedMessages,
        max_tokens: options.maxTokens || 8192,
        temperature: options.temperature || 1,
        stream: options.stream !== false,
        ...options.customBody // 合并自定义参数
    };

    // 添加 system 消息
    if (systemPrompt) {
        requestBody.system = systemPrompt;
    }

    // 添加工具定义（Claude 原生格式）
    if (options.tools && options.tools.length > 0) {
        // 将 OpenAI 格式的 tools 转换为 Claude 格式
        // OpenAI: tools[].function.name/description/parameters
        // Claude: tools[].name/description/input_schema
        requestBody.tools = options.tools.map((tool: any) => ({
            name: tool.function?.name || tool.name,
            description: tool.function?.description || tool.description,
            input_schema: tool.function?.parameters || tool.input_schema || { type: 'object', properties: {} }
        }));
    }

    // 处理思考模式
    if (options.enableThinking) {
        const reasoningEffort = options.reasoningEffort || 'low';
        const budgetTokens = calculateClaudeThinkingBudget(
            options.model,
            reasoningEffort,
            options.maxTokens
        );
        requestBody.thinking = {
            type: 'enabled',
            budget_tokens: budgetTokens
        };
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
    };

    // ===== forwardProxy 模式：强制非流式，通过思源后端绕过 CORS =====
    // Claude 的流式响应使用 SSE 格式，但思源 forwardProxy 不支持 streaming，
    // 因此强制 stream: false，复用非流式响应处理逻辑。
    if (options.useForwardProxy) {
        requestBody.stream = false;

        try {
            const result = await forwardProxyFetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                timeout: 120000
            });

            // 错误处理：优先提取 JSON 中的 error.message，降级为纯文本
            if (!result.ok) {
                let errorMessage = `Claude API request failed: ${result.status}`;
                try {
                    const errorData = await result.json();
                    const detailMsg = errorData.error?.message || errorData.message || JSON.stringify(errorData);
                    errorMessage += `\n\n${detailMsg}`;
                } catch (e) {
                    try {
                        const errorText = await result.text();
                        if (errorText) errorMessage += `\n\n${errorText}`;
                    } catch (_) {}
                }
                throw new Error(errorMessage);
            }

            const data = await result.json();
            let content = '';
            let thinking = '';
            const toolCalls: ToolCall[] = [];

            // Claude 非流式响应格式：data.content 是 block 数组，
            // 每个 block 有 type 字段（thinking / text / tool_use），
            // 与 OpenAI 的 choices[0].message.content 格式完全不同，需要遍历解析。
            if (data.content && Array.isArray(data.content)) {
                for (const block of data.content) {
                    if (block.type === 'thinking' && block.thinking) {
                        thinking += block.thinking;
                    } else if (block.type === 'text' && block.text) {
                        content += block.text;
                    } else if (block.type === 'tool_use') {
                        // 将 Claude 的 tool_use block 转换为插件内部的 ToolCall 格式
                        toolCalls.push({
                            id: block.id,
                            type: 'function',
                            function: {
                                name: block.name,
                                arguments: JSON.stringify(block.input || {})
                            }
                        });
                    }
                }
            }

            // 触发回调：按内容类型分别通知前端
            // thinking 内容 → onThinkingComplete（一次性显示思考过程）
            if (thinking) {
                options.onThinkingComplete?.(thinking);
            }

            // 文本内容 → onChunk（显示到聊天界面）
            if (content) {
                options.onChunk?.(content);
            }

            // 工具调用 → onToolCall / onToolCallComplete（Agent 模式）
            for (const toolCall of toolCalls) {
                options.onToolCall?.(toolCall);
            }
            if (toolCalls.length > 0 && options.onToolCallComplete) {
                options.onToolCallComplete(toolCalls);
            }

            // 完成回调：通知前端本轮对话结束
            options.onComplete?.(content);
        } catch (error) {
            console.error('Claude chat error:', error);
            options.onError?.(error as Error);
            throw error;
        }
        return;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: options.signal
        });

        if (!response.ok) {
            let errorMessage = `Claude API request failed: ${response.status} ${response.statusText}`;
            try {
                const errorData = await response.json();
                const detailMsg = errorData.error?.message || errorData.message || JSON.stringify(errorData);
                errorMessage += `\n\n${detailMsg}`;
            } catch (e) {
                try {
                    const errorText = await response.text();
                    if (errorText) {
                        errorMessage += `\n\n${errorText}`;
                    }
                } catch (textError) {
                    // 忽略文本读取错误
                }
            }
            throw new Error(errorMessage);
        }

        if (options.stream !== false && response.body) {
            await handleClaudeStreamResponse(response.body, options);
        } else {
            const data = await response.json();
            // 处理 Claude 响应中的 content 数组
            let content = '';
            let thinking = '';
            const toolCalls: ToolCall[] = [];
            
            if (data.content && Array.isArray(data.content)) {
                for (const block of data.content) {
                    if (block.type === 'thinking' && block.thinking) {
                        thinking += block.thinking;
                    } else if (block.type === 'text' && block.text) {
                        content += block.text;
                    } else if (block.type === 'tool_use') {
                        // 处理 tool_use
                        toolCalls.push({
                            id: block.id,
                            type: 'function',
                            function: {
                                name: block.name,
                                arguments: JSON.stringify(block.input || {})
                            }
                        });
                    }
                }
            }
            
            // 发送 thinking 内容
            if (thinking) {
                options.onThinkingComplete?.(thinking);
            }
            
            // 发送文本内容
            if (content) {
                options.onChunk?.(content);
            }
            
            // 发送 tool calls
            for (const toolCall of toolCalls) {
                options.onToolCall?.(toolCall);
            }
            if (toolCalls.length > 0 && options.onToolCallComplete) {
                options.onToolCallComplete(toolCalls);
            }
            
            options.onComplete?.(content);
        }
    } catch (error) {
        if ((error as Error).name === 'AbortError') {
            console.log('Claude request was aborted by user');
            options.onError?.(new Error('Request aborted'));
        } else {
            console.error('Claude chat error:', error);
            options.onError?.(error as Error);
        }
        throw error;
    }
}

/**
 * 处理 Claude 格式的流式响应
 */
async function handleClaudeStreamResponse(
    body: ReadableStream<Uint8Array>,
    options: ChatOptions
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let thinkingText = '';
    let buffer = '';
    let isThinkingPhase = false;
    let toolCalls: ToolCall[] = [];
    let currentToolCall: Partial<ToolCall> | null = null;
    let currentToolInput = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Claude SSE 格式: event: xxx 或 data: xxx
                if (trimmed.startsWith('event:')) {
                    // 事件类型，可以忽略或用于状态管理
                    continue;
                }

                if (trimmed.startsWith('data:')) {
                    const payload = trimmed.slice(5).trimStart();
                    if (!payload) continue;

                    try {
                        const json = JSON.parse(payload);

                        // Claude 的流式响应格式
                        if (json.type === 'content_block_delta') {
                            const delta = json.delta;

                            if (delta?.type === 'text_delta' && delta.text) {
                                fullText += delta.text;
                                options.onChunk?.(delta.text);
                            }

                            // 思考内容（如果支持）
                            if (delta?.type === 'thinking_delta' && delta.thinking) {
                                isThinkingPhase = true;
                                thinkingText += delta.thinking;
                                options.onThinkingChunk?.(delta.thinking);
                            }

                            // Tool use input JSON 片段
                            if (delta?.type === 'input_json_delta' && delta.partial_json !== undefined) {
                                currentToolInput += delta.partial_json;
                            }
                        } else if (json.type === 'content_block_start') {
                            // 内容块开始
                            const contentBlock = json.content_block;
                            if (contentBlock?.type === 'thinking') {
                                isThinkingPhase = true;
                            } else if (contentBlock?.type === 'tool_use') {
                                // Tool use 开始
                                currentToolCall = {
                                    id: contentBlock.id,
                                    type: 'function',
                                    function: {
                                        name: contentBlock.name,
                                        arguments: ''
                                    }
                                };
                                currentToolInput = '';
                            }
                        } else if (json.type === 'content_block_stop') {
                            // 内容块结束
                            if (isThinkingPhase && options.onThinkingComplete) {
                                options.onThinkingComplete(thinkingText);
                                isThinkingPhase = false;
                            }
                            // Tool use 结束
                            if (currentToolCall && currentToolCall.id && currentToolCall.function?.name) {
                                currentToolCall.function.arguments = currentToolInput;
                                toolCalls.push(currentToolCall as ToolCall);
                                options.onToolCall?.(currentToolCall as ToolCall);
                                currentToolCall = null;
                                currentToolInput = '';
                            }
                        }
                    } catch (e) {
                        console.error('Failed to parse Claude SSE data:', e);
                    }
                }
            }
        }

        // 如果结束时还在思考阶段，调用思考完成回调
        if (isThinkingPhase && options.onThinkingComplete) {
            options.onThinkingComplete(thinkingText);
        }

        // 如果有 tool calls，调用完成回调
        if (toolCalls.length > 0 && options.onToolCallComplete) {
            options.onToolCallComplete(toolCalls);
        }

        options.onComplete?.(fullText);
    } catch (error) {
        if ((error as Error).name === 'AbortError') {
            console.log('Claude stream reading was aborted');
            if (fullText) {
                options.onComplete?.(fullText);
            }
            if (thinkingText && options.onThinkingComplete) {
                options.onThinkingComplete(thinkingText);
            }
        } else {
            console.error('Claude stream reading error:', error);
            options.onError?.(error as Error);
        }
        throw error;
    } finally {
        reader.releaseLock();
    }
}

/**
 * 发送聊天请求
 */
export async function chat(
    provider: string,
    options: ChatOptions,
    customApiUrl?: string,
    advancedConfig?: AdvancedProviderConfig
): Promise<void> {
    const isBuiltIn = ['gemini', 'deepseek', 'openai', 'moonshot', 'volcano', 'Achuan', 'minimax'].includes(provider);
    const config = isBuiltIn ? PROVIDER_CONFIGS[provider as AIProvider] : PROVIDER_CONFIGS.custom;
    const chatInterface = advancedConfig?.chatInterface || getDefaultChatInterface(provider);

    let url: string;
    let baseUrlForGemini: string; // Gemini format needs a base url
    let baseUrlForClaude: string; // Claude format needs a base url

    // 优先使用高级自定义的对话 URL
    if (advancedConfig?.customChatUrl) {
        url = advancedConfig.customChatUrl;
        baseUrlForGemini = getBaseUrlForChatInterface(advancedConfig.customChatUrl, 'gemini');
        baseUrlForClaude = getBaseUrlForChatInterface(advancedConfig.customChatUrl, 'anthropic');
    } else if (customApiUrl) {
        const { baseUrl, endpoint } = getBaseUrlAndEndpoint(customApiUrl, config.chatEndpoint);
        url = `${baseUrl}${endpoint}`;
        baseUrlForGemini = getBaseUrlForChatInterface(customApiUrl, 'gemini');
        baseUrlForClaude = getBaseUrlForChatInterface(customApiUrl, 'anthropic');
    } else {
        if (!isBuiltIn && provider !== 'custom') {
            throw new Error('Custom provider requires API URL');
        }
        url = `${config.baseUrl}${config.chatEndpoint}`;
        baseUrlForGemini = config.baseUrl;
        baseUrlForClaude = config.baseUrl;
    }

    // 检测是否是 Gemini 图片生成模型
    const isGeminiImageModel = chatInterface === 'gemini' &&
        options.model.toLowerCase().includes('gemini') &&
        (options.model.includes('image-preview') || options.model.includes('image') || options.model.includes('imagen'));

    if (chatInterface === 'anthropic') {
        await chatClaudeFormat(baseUrlForClaude, options.apiKey, options);
    } else if (isGeminiImageModel) {
        // 强制使用 Gemini 原生图片生成接口（支持多轮）
        let customModalities = ["TEXT", "IMAGE"]; // 默认图文并茂

        const imageUrl = `${baseUrlForGemini}/v1beta/models/${options.model}:generateContent?key=${options.apiKey}`;
        
        let contents = [];
        try {
            contents = await prepareGeminiContents(options.messages, true);
        } catch (e) {
            console.error("Failed to prepare gemini contents", e);
            const lastUserMessage = options.messages.filter(m => m.role === 'user').pop();
            const prompt = lastUserMessage ? (typeof lastUserMessage.content === 'string' ? lastUserMessage.content : lastUserMessage.content.find(c => c.type === 'text')?.text || 'Draw an image') : 'Draw an image';
            contents = [{ role: "user", parts: [{ text: prompt }] }];
        }

        const requestBody = {
            contents,
            generationConfig: {
                responseModalities: customModalities
            }
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        try {
            const response = await fetch(imageUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: options.signal
            });

            if (!response.ok) {
                throw new Error(`Gemini Image API failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const generatedImages: GeneratedImageData[] = [];
            let generatedText = '';

            if (data.candidates && data.candidates[0]?.content?.parts) {
                for (const part of data.candidates[0].content.parts) {
                    if (part.text) {
                        generatedText += part.text;
                        options.onChunk?.(part.text);
                    }
                    const inlineData = part.inline_data || part.inlineData;
                    if (inlineData) {
                        generatedImages.push({
                            mimeType: inlineData.mime_type || inlineData.mimeType || 'image/jpeg',
                            data: inlineData.data
                        });
                    }
                }
            }

            if (generatedImages.length > 0 && options.onImageGenerated) {
                await options.onImageGenerated(generatedImages);
            }
            
            // 发送完成信号，如果有文本则使用生出的文本，否则使用默认提示
            await options.onComplete?.(generatedText || (customModalities.includes('TEXT') ? '' : '✨ Image generated successfully.'));
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                options.onError?.(new Error('Request aborted'));
            } else {
                options.onError?.(error as Error);
            }
            throw error;
        }
    } else if (chatInterface === 'gemini') {
        await chatGeminiFormat(baseUrlForGemini, options.apiKey, options.model, options);
    } else {
        await chatOpenAIFormat(url, options.apiKey, options);
    }
}

/**
 * 估算token数量（简单估算，1个中文字符约等于1.5个token，1个英文单词约1个token）
 */
export function estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    const otherChars = text.length - chineseChars - text.match(/[a-zA-Z\s]/g)?.length || 0;

    return Math.ceil(chineseChars * 1.5 + englishWords + otherChars * 0.5);
}

/**
 * 计算消息列表的总token数
 */
export function calculateTotalTokens(messages: Message[]): number {
    return messages.reduce((total, msg) => {
        if (typeof msg.content === 'string') {
            return total + estimateTokens(msg.content);
        } else {
            // 处理多模态内容
            return total + msg.content.reduce((sum, part) => {
                if (part.type === 'text' && part.text) {
                    return sum + estimateTokens(part.text);
                } else if (part.type === 'image_url') {
                    // 图片大约消耗85个token (根据OpenAI文档的低分辨率估算)
                    return sum + 85;
                }
                return sum;
            }, 0);
        }
    }, 0);
}

// ==================== 图片生成接口 ====================

export interface ImageGenerationOptions {
    apiKey: string;
    model: string;
    prompt: string;
    negativePrompt?: string;
    size?: string; // 例如: "1024x1024", "512x512"
    quality?: 'standard' | 'hd';
    style?: 'vivid' | 'natural';
    n?: number; // 生成图片数量，默认1
    signal?: AbortSignal;
}

export interface GeneratedImage {
    url?: string;
    b64_json?: string;
    revised_prompt?: string; // 实际使用的提示词
}

export interface ImageGenerationResult {
    images: GeneratedImage[];
    total: number;
}

/**
 * 图片生成 API 接口
 * 使用 /v1/image/generations 或原生接口
 */
export async function generateImage(
    provider: string,
    options: ImageGenerationOptions,
    customApiUrl?: string,
    useForwardProxy?: boolean
): Promise<ImageGenerationResult> {
    const isBuiltIn = ['gemini', 'deepseek', 'openai', 'moonshot', 'volcano', 'Achuan', 'minimax'].includes(provider);
    const config = isBuiltIn ? PROVIDER_CONFIGS[provider as AIProvider] : PROVIDER_CONFIGS.custom;

    const isGeminiPreview = provider === 'gemini' && (options.model.includes('image-preview') || options.model.includes('image'));

    // 构建图片生成 API 的 URL
    let baseUrl: string;
    if (customApiUrl) {
        const { baseUrl: url } = getBaseUrlAndEndpoint(
            customApiUrl, 
            isGeminiPreview ? `/v1beta/models/${options.model}:generateContent` : '/v1/image/generations'
        );
        baseUrl = url;
    } else {
        if (!isBuiltIn) {
            throw new Error('Custom provider requires API URL');
        }
        baseUrl = config.baseUrl;
    }

    let url: string;
    let requestBody: any;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.apiKey}`
    };

    if (isGeminiPreview) {
        url = `${baseUrl}/v1beta/models/${options.model}:generateContent?key=${options.apiKey}`;
        requestBody = {
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: options.prompt }
                    ]
                }
            ],
            generationConfig: {
                responseModalities: ["IMAGE"]
            }
        };

        // 处理图像配置
        if (options.size) {
            requestBody.generationConfig.imageConfig = {};
            if (options.size.includes('512') || options.size === '0.5K') {
                requestBody.generationConfig.imageConfig.imageSize = '512';
            } else if (options.size === '2K' || options.size === '4K') {
                requestBody.generationConfig.imageConfig.imageSize = options.size;
            } else if (options.size.includes('1024')) {
                requestBody.generationConfig.imageConfig.imageSize = '1K';
            }
            // aspectRatio 可以通过其它自定义字段扩展
        }
    } else {
        url = `${baseUrl}/v1/image/generations`;
        requestBody = {
            model: options.model,
            prompt: options.prompt,
            n: options.n || 1,
            size: options.size || '1024x1024',
        };

        if (options.quality) {
            requestBody.quality = options.quality;
        }
        if (options.style) {
            requestBody.style = options.style;
        }
        if (options.negativePrompt) {
            requestBody.negative_prompt = options.negativePrompt;
        }

        headers['Authorization'] = `Bearer ${options.apiKey}`;
    }

    try {
        let response: Response;
        if (useForwardProxy) {
            const result = await forwardProxyFetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                timeout: 120000
            });
            response = new Response(await result.text(), {
                status: result.status,
                headers: result.headers
            });
        } else {
            response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: options.signal
            });
        }

        if (!response.ok) {
            let errorMessage = `Image generation failed: ${response.status} ${response.statusText}`;
            try {
                const errorData = await response.json();
                const detailMsg = errorData.error?.message || errorData.message || errorData.error || JSON.stringify(errorData);
                errorMessage += `\n\n${detailMsg}`;
            } catch (e) {
                try {
                    const errorText = await response.text();
                    if (errorText) {
                        errorMessage += `\n\n${errorText}`;
                    }
                } catch (textError) {
                    // 忽略文本读取错误
                }
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        let images: GeneratedImage[] = [];

        if (isGeminiPreview) {
            // 解析 Gemini 原生接口返回的图片
            if (data.candidates && data.candidates[0]?.content?.parts) {
                const parts = data.candidates[0].content.parts;
                for (const part of parts) {
                    const inlineData = part.inline_data || part.inlineData;
                    if (inlineData) {
                        images.push({
                            b64_json: inlineData.data,
                            revised_prompt: options.prompt
                        });
                    }
                }
            }
        } else {
            // 解析 OpenAI 格式
            if (data.data && Array.isArray(data.data)) {
                images = data.data.map((item: any) => ({
                    url: item.url,
                    b64_json: item.b64_json,
                    revised_prompt: item.revised_prompt
                }));
            } else if (Array.isArray(data)) {
                images = data.map((item: any) => ({
                    url: item.url,
                    b64_json: item.b64_json,
                    revised_prompt: item.revised_prompt
                }));
            } else if (data.url || data.b64_json) {
                images = [{
                    url: data.url,
                    b64_json: data.b64_json,
                    revised_prompt: data.revised_prompt
                }];
            }
        }

        return {
            images,
            total: images.length
        };
    } catch (error) {
        if ((error as Error).name === 'AbortError') {
            console.log('Image generation was aborted by user');
            throw new Error('Image generation aborted');
        } else {
            console.error('Image generation error:', error);
            throw error;
        }
    }
}

/**
 * 检查模型是否支持图片生成
 */
export function isImageGenerationSupported(_provider: string, modelId: string): boolean {
    // 常见的生图模型
    const supportedModels = [
        'dall-e',
        'dall-e-2',
        'dall-e-3',
        'midjourney',
        'stable-diffusion',
        'flux',
        'ideogram',
        'recraft',
        'kling',
        'cogview',
        'wanx',
        'image-generation',
        'image-preview',
        'flash-image',
        'pro-image',
        'imagen'
    ];

    const lowerModelId = modelId.toLowerCase();
    return supportedModels.some(m => lowerModelId.includes(m));
}
