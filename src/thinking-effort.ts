/**
 * 模型思考努力程度（ThinkingEffort）统一管理模块
 *
 * 负责维护各模型家族（OpenAI/GPT、Gemini、Claude、DeepSeek、Kimi、MiniMax 等）
 * 的思考程度配置，包括：
 * - 支持的 effort 档位
 * - 各档位到对应平台 API 参数的映射
 * - 模型识别与预算计算
 *
 * 所有档位统一使用英文标识，不再区分中英文展示。
 */

/**
 * 思考努力程度档位
 *
 * 主要档位（GPT-5.6 等模型使用）：low / medium / high / xhigh / max / ultra
 * 额外保留：
 * - none    : 完全关闭思考（OpenAI 部分模型支持）
 * - minimal : 最小思考（OpenAI 部分模型 / Gemini 3 Flash 支持）
 * - auto    : 由模型动态决定（主要用于 Gemini 2.5 的 thinking_budget = -1）
 */
export type ThinkingEffort =
    | 'none'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max'
    | 'ultra'
    | 'auto';

/** 所有支持的 effort 档位（按强度从低到高排列，auto 为特殊动态值） */
export const THINKING_EFFORT_LEVELS: ThinkingEffort[] = [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
    'auto',
];

/** 用于强度排序的非动态档位 */
const ORDERED_EFFORT_LEVELS: Exclude<ThinkingEffort, 'auto'>[] = [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
];

/** UI 与日志统一使用的英文标签 */
export const THINKING_EFFORT_LABELS: Record<ThinkingEffort, string> = {
    none: 'none',
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
    ultra: 'ultra',
    auto: 'auto',
};

/** 用于计算 Claude thinking budget 的 token 限制配置 */
interface TokenLimitConfig {
    min: number;
    max: number;
}

const CLAUDE_TOKEN_LIMITS: Record<string, TokenLimitConfig> = {
    'claude-3-7-sonnet': { min: 1024, max: 32768 },
    'claude-3-5-sonnet': { min: 1024, max: 16384 },
    'claude-sonnet-4': { min: 1024, max: 32768 },
    'claude-opus-4': { min: 1024, max: 32768 },
    'claude-sonnet-4-6': { min: 1024, max: 32768 },
    'claude-opus-4-8': { min: 1024, max: 32768 },
    'claude-fable-5': { min: 1024, max: 32768 },
    default: { min: 1024, max: 32768 },
};

/** effort 到预算比例的映射（用于旧版 Claude budget_tokens 计算） */
export const EFFORT_RATIO: Record<Exclude<ThinkingEffort, 'auto'>, number> = {
    none: 0,
    minimal: 0.1,
    low: 0.2,
    medium: 0.5,
    high: 0.8,
    xhigh: 0.9,
    max: 1.0,
    ultra: 1.0,
};

// ==================== 模型识别 ====================

/**
 * 获取模型ID的基础名称（小写，去除提供商前缀）
 */
export function getLowerBaseModelName(modelId: string, separator: string = '/'): string {
    const parts = modelId.split(separator);
    return parts[parts.length - 1].toLowerCase();
}

/** Gemini 支持思考模式的模型正则表达式
 * 匹配: gemini-2.5-*, gemini-3-*, gemini-flash-latest, gemini-pro-latest 等
 */
export const GEMINI_THINKING_MODEL_REGEX =
    /gemini-(?:2\.5.*(?:-latest)?|3(?:\.\d+)?-(?:flash|pro)(?:-preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\w-]+)*$/i;

/** Claude 模型正则表达式（所有以 claude 开头的模型） */
export const CLAUDE_THINKING_MODEL_REGEX = /^claude/i;

/** 检测模型是否是支持思考模式的 Claude 模型 */
export function isSupportedThinkingClaudeModel(modelId: string): boolean {
    const baseModelId = getLowerBaseModelName(modelId, '/');
    return CLAUDE_THINKING_MODEL_REGEX.test(baseModelId);
}

/** 检测模型是否是 Claude 模型（用于判断是否使用 Claude 原生 API） */
export function isClaudeModel(modelId: string): boolean {
    const baseModelId = getLowerBaseModelName(modelId, '/');
    return CLAUDE_THINKING_MODEL_REGEX.test(baseModelId);
}

/** 检测模型是否是通过 OpenAI 兼容 API 调用的 Gemini 模型 */
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

/** 检测模型是否是 Gemini 3 系列模型 */
export function isGemini3Model(modelId: string): boolean {
    const baseModelId = getLowerBaseModelName(modelId, '/');
    return baseModelId.includes('gemini-3');
}

/** 检测模型是否是 DeepSeek 推理模型 */
export function isDeepSeekReasonerModel(modelId: string): boolean {
    return /deepseek-(reasoner|r1)/i.test(modelId);
}

/** 检测模型是否是 DeepSeek V4 模型（支持 reasoning_effort） */
export function isDeepSeekV4Model(modelId: string): boolean {
    return /deepseek-v4/i.test(modelId);
}

/** 检测模型是否是 DeepSeek 模型（包含 V4 等） */
export function isDeepSeekModel(modelId: string): boolean {
    return /deepseek/i.test(modelId);
}

/** 检测模型是否是 Kimi / Moonshot 模型 */
export function isKimiModel(modelId: string): boolean {
    return /kimi/i.test(modelId) || /moonshot/i.test(modelId);
}

/** 检测模型是否是支持思考模式的 MiniMax M2/M3 系列模型 */
export function isMinimaxThinkingModel(modelId: string): boolean {
    const baseModelId = getLowerBaseModelName(modelId, '/');
    return /minimax-m(?:2|3)(?:\.\d+)?/i.test(baseModelId);
}

/** 检测模型是否是 GPT-5.6 系列模型（gpt-5.6 / gpt-5.6-mini / gpt-5.6-nano 等前缀匹配） */
export function isGPT56Model(modelId: string): boolean {
    const baseModelId = getLowerBaseModelName(modelId, '/');
    return /^gpt-5\.6/i.test(baseModelId);
}

/** 检测模型是否是 OpenAI / GPT 模型（含第三方代理的 gpt 模型） */
export function isOpenAIModel(modelId: string): boolean {
    return /gpt-/i.test(modelId) || /openai/i.test(modelId);
}

/** 检测模型是否是较新的 Claude 模型（支持原生 effort 参数而非 budget_tokens） */
export function isNewClaudeEffortModel(modelId: string): boolean {
    const baseModelId = getLowerBaseModelName(modelId, '/');
    return /claude-(?:sonnet|opus|fable)-(?:4-6|4-7|4-8|5)/i.test(baseModelId);
}

// ==================== 档位归一化 ====================

/**
 * 将 effort 归一化为指定档位列表中最接近的值。
 * 若 effort 本身已被支持则直接返回；否则按强度顺序取最近一档。
 */
export function normalizeThinkingEffort(
    effort: ThinkingEffort,
    supported: ThinkingEffort[]
): ThinkingEffort {
    if (supported.includes(effort)) {
        return effort;
    }
    if (effort === 'auto') {
        return supported.find(l => l !== 'auto') ?? 'low';
    }
    const targetIndex = ORDERED_EFFORT_LEVELS.indexOf(effort);
    if (targetIndex === -1) {
        return supported[0] ?? 'low';
    }

    let nearest: ThinkingEffort = supported.find(l => l !== 'auto') ?? 'low';
    let minDistance = Infinity;
    for (const level of supported) {
        if (level === 'auto') continue;
        const idx = ORDERED_EFFORT_LEVELS.indexOf(level);
        if (idx === -1) continue;
        const distance = Math.abs(idx - targetIndex);
        if (distance < minDistance) {
            minDistance = distance;
            nearest = level;
        }
    }
    return nearest;
}

// ==================== 各平台支持的 effort 档位 ====================

/**
 * 获取指定模型支持的思考 effort 档位。
 * 返回值已按强度排序，并包含 auto（如该平台支持动态思考）。
 */
export function getSupportedThinkingEffortLevels(modelId: string): ThinkingEffort[] {
    const baseModelId = getLowerBaseModelName(modelId, '/');

    if (isClaudeModel(modelId)) {
        // Claude 4.6+ 原生支持 effort；旧版使用 budget_tokens，档位更多用于 UI 映射
        return ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
    }

    if (isGemini3Model(modelId)) {
        // Gemini 3 Pro preview 早期仅 LOW/HIGH；Flash / 3.1 Pro 支持 MEDIUM。
        // 为兼容最严格的 Pro preview，UI 仅暴露 low/high，映射函数仍可处理 medium。
        return ['low', 'high'];
    }

    if (isSupportedThinkingGeminiModel(modelId)) {
        // Gemini 2.5 使用 thinking_budget，支持动态 auto
        return ['auto', 'low', 'medium', 'high'];
    }

    if (isDeepSeekV4Model(modelId)) {
        // DeepSeek V4 官方 reasoning_effort 仅支持 high / max
        return ['high', 'max'];
    }

    if (isDeepSeekModel(modelId)) {
        // 旧版 DeepSeek（reasoner / r1 等）仅支持 thinking 开关
        return ['low'];
    }

    if (isKimiModel(modelId)) {
        // Kimi 仅支持 thinking 开关，不支持 effort 档位
        return ['low'];
    }

    if (isMinimaxThinkingModel(modelId)) {
        // MiniMax 通过 reasoning_split 或 thinking 开关控制，不支持 effort 档位
        return ['low'];
    }

    if (isGPT56Model(modelId)) {
        // GPT-5.6 系列（gpt-5.6 / gpt-5.6-mini / gpt-5.6-nano）支持完整档位
        return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
    }

    if (isOpenAIModel(modelId) || /o\d/i.test(baseModelId)) {
        // 其他 OpenAI / GPT / o-series 最高到 xhigh
        return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    }

    // 默认兜底
    return ['low', 'medium', 'high'];
}

/**
 * 获取模型的默认 effort 档位。
 */
export function getDefaultThinkingEffort(modelId: string): ThinkingEffort {
    if (isGemini3Model(modelId)) {
        return 'low';
    }
    if (isSupportedThinkingGeminiModel(modelId)) {
        return 'auto';
    }
    if (isDeepSeekV4Model(modelId)) {
        return 'high';
    }
    if (isOpenAIModel(modelId)) {
        return 'medium';
    }
    return 'low';
}

// ==================== Claude budget 计算 ====================

/**
 * 查找 Claude 模型的 token 限制配置
 */
function findClaudeTokenLimit(modelId: string): TokenLimitConfig {
    const baseModelId = getLowerBaseModelName(modelId, '/');

    for (const [key, config] of Object.entries(CLAUDE_TOKEN_LIMITS)) {
        if (key !== 'default' && baseModelId.includes(key)) {
            return config;
        }
    }

    return CLAUDE_TOKEN_LIMITS['default'];
}

/**
 * 计算 Claude 模型的思考预算 token 数（旧版 budget_tokens 模式）
 */
export function calculateClaudeThinkingBudget(
    modelId: string,
    reasoningEffort: ThinkingEffort,
    maxTokens?: number
): number {
    const DEFAULT_MAX_TOKENS = 8192;
    const tokenLimit = findClaudeTokenLimit(modelId);

    // auto 按 medium 处理
    const effectiveEffort: Exclude<ThinkingEffort, 'auto'> =
        reasoningEffort === 'auto' ? 'medium' : reasoningEffort;
    const effortRatio = EFFORT_RATIO[effectiveEffort];

    let budgetTokens = Math.floor(
        (tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min
    );

    budgetTokens = Math.floor(
        Math.max(1024, Math.min(budgetTokens, (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio))
    );

    return budgetTokens;
}

/**
 * 将通用 effort 映射到 Claude 原生 effort 参数（新版模型）
 */
function mapClaudeNativeEffort(effort: ThinkingEffort): string {
    const supported = ['low', 'medium', 'high', 'max', 'xhigh'];
    const normalized = normalizeThinkingEffort(
        effort,
        supported as ThinkingEffort[]
    ) as Exclude<ThinkingEffort, 'auto'>;

    // ultra 在 Claude 上映射为 max
    if (normalized === 'ultra') return 'max';
    // none/minimal 映射为 low（ thinking 已开启时最低档）
    if (normalized === 'none' || normalized === 'minimal') return 'low';
    return normalized;
}

// ==================== Gemini 映射 ====================

/**
 * Gemini 2.5 的 thinking_budget 映射（token 数）
 */
const GEMINI_25_BUDGET_MAP: Record<Exclude<ThinkingEffort, 'auto'>, number> = {
    none: 0,
    minimal: 1024,
    low: 4096,
    medium: 16384,
    high: 32768,
    xhigh: 32768,
    max: 32768,
    ultra: 32768,
};

/**
 * 将通用 effort 映射到 Gemini 3 OpenAI 兼容接口的 reasoning_effort。
 * Gemini 3 Pro 早期仅接受 low/high；Flash / 3.1 Pro 接受 low/medium/high。
 */
function mapGemini3OpenAIEffort(effort: ThinkingEffort): 'low' | 'medium' | 'high' {
    const normalized = normalizeThinkingEffort(effort, ['low', 'medium', 'high']);
    return normalized as 'low' | 'medium' | 'high';
}

/**
 * 将通用 effort 映射到 Gemini 3 原生 thinkingConfig.thinkingLevel。
 */
function mapGemini3NativeEffort(effort: ThinkingEffort): string {
    const map: Record<string, string> = {
        none: 'LOW',
        minimal: 'LOW',
        low: 'LOW',
        medium: 'MEDIUM',
        high: 'HIGH',
        xhigh: 'HIGH',
        max: 'HIGH',
        ultra: 'HIGH',
        auto: 'HIGH',
    };
    return map[effort] ?? 'LOW';
}

/**
 * 计算 Gemini 2.5 的 thinking_budget。
 * auto 返回 -1 表示动态思考；显式传入的 thinkingBudget 优先级最高。
 */
export function calculateGemini25ThinkingBudget(
    effort: ThinkingEffort,
    thinkingBudget?: number
): number {
    if (thinkingBudget !== undefined && thinkingBudget !== null) {
        return thinkingBudget;
    }
    if (effort === 'auto') {
        return -1;
    }
    return GEMINI_25_BUDGET_MAP[effort] ?? GEMINI_25_BUDGET_MAP['low'];
}

// ==================== OpenAI / GPT 映射 ====================

/**
 * GPT-5.6 系列支持的 reasoning_effort 值。
 * 包含用户反馈的 max / ultra 档位。
 */
export const GPT56_SUPPORTED_EFFORTS: ThinkingEffort[] = [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
];

/**
 * 其他 OpenAI / GPT / o-series 支持的 reasoning_effort 值。
 * 官方文档最高到 xhigh。
 */
export const GENERIC_OPENAI_SUPPORTED_EFFORTS: ThinkingEffort[] = [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
];

function mapOpenAIEffort(effort: ThinkingEffort, modelId: string): string {
    const supported = isGPT56Model(modelId)
        ? GPT56_SUPPORTED_EFFORTS
        : GENERIC_OPENAI_SUPPORTED_EFFORTS;
    const normalized = normalizeThinkingEffort(effort, supported);
    return normalized === 'auto' ? 'medium' : normalized;
}

// ==================== DeepSeek 映射 ====================

/**
 * DeepSeek V4 官方 reasoning_effort 仅支持 high / max。
 * 低档位向 high 合并，xhigh/ultra 向 max 合并。
 */
function mapDeepSeekEffort(effort: ThinkingEffort): 'high' | 'max' {
    const normalized = normalizeThinkingEffort(effort, ['low', 'medium', 'high', 'xhigh', 'max']);
    if (normalized === 'max' || normalized === 'ultra') {
        return 'max';
    }
    if (normalized === 'high' || normalized === 'xhigh') {
        return 'high';
    }
    return 'high';
}

// ==================== 请求体构建 ====================

export interface BuildThinkingParamsOptions {
    maxTokens?: number;
    thinkingBudget?: number; // 仅 Gemini 2.5 使用
}

/**
 * 为 OpenAI 兼容接口构建思考相关请求参数。
 * 适用于 chatOpenAIFormat，覆盖 Claude-via-OpenAI、Gemini-via-OpenAI、
 * DeepSeek、Kimi、MiniMax、OpenAI/GPT 等。
 */
export function buildOpenAIThinkingParams(
    modelId: string,
    effort: ThinkingEffort,
    options: BuildThinkingParamsOptions = {}
): { body?: Record<string, any>; extraBody?: Record<string, any> } {
    // Kimi：仅支持 thinking 开关，发送 reasoning_effort 会导致冲突
    if (isKimiModel(modelId)) {
        return { body: { thinking: { type: 'enabled' } } };
    }

    // MiniMax：使用 reasoning_split 分离思考内容；同时显式启用 thinking
    if (isMinimaxThinkingModel(modelId)) {
        return { body: { thinking: { type: 'enabled' }, reasoning_split: true } };
    }

    // Claude via OpenAI 兼容接口
    if (isClaudeModel(modelId)) {
        const budgetTokens = calculateClaudeThinkingBudget(
            modelId,
            effort,
            options.maxTokens
        );
        return { body: { thinking: { type: 'enabled', budget_tokens: budgetTokens } } };
    }

    // Gemini via OpenAI 兼容接口
    if (isSupportedThinkingGeminiModel(modelId)) {
        if (isGemini3Model(modelId)) {
            return { body: { reasoning_effort: mapGemini3OpenAIEffort(effort) } };
        }
        const budget = calculateGemini25ThinkingBudget(effort, options.thinkingBudget);
        return {
            extraBody: {
                google: {
                    thinking_config: {
                        thinking_budget: budget,
                        include_thoughts: true,
                    },
                },
            },
        };
    }

    // DeepSeek V4：官方支持 reasoning_effort（high / max）
    if (isDeepSeekV4Model(modelId)) {
        return { body: { reasoning_effort: mapDeepSeekEffort(effort) } };
    }

    // 旧版 DeepSeek（reasoner / r1 等）：仅支持 thinking 开关
    if (isDeepSeekModel(modelId)) {
        return { body: { thinking: { type: 'enabled' } } };
    }

    // OpenAI / GPT / o-series：使用 reasoning_effort
    const baseModelId = getLowerBaseModelName(modelId, '/');
    if (isOpenAIModel(modelId) || /^o\d/i.test(baseModelId)) {
        return { body: { reasoning_effort: mapOpenAIEffort(effort, modelId) } };
    }

    // 其他 OpenAI 兼容接口默认使用 thinking 开关
    return { body: { thinking: { type: 'enabled' } } };
}

/**
 * 为 Claude 原生 Messages API 构建思考相关请求参数。
 */
export function buildClaudeThinkingParams(
    modelId: string,
    effort: ThinkingEffort,
    options: BuildThinkingParamsOptions = {}
): { thinking?: { type: 'enabled'; budget_tokens: number }; effort?: string } {
    if (isNewClaudeEffortModel(modelId)) {
        return { effort: mapClaudeNativeEffort(effort) };
    }

    const budgetTokens = calculateClaudeThinkingBudget(
        modelId,
        effort,
        options.maxTokens
    );
    return { thinking: { type: 'enabled', budget_tokens: budgetTokens } };
}

/**
 * 为 Gemini 原生 GenerateContent API 构建 thinkingConfig。
 */
export function buildGeminiThinkingParams(
    modelId: string,
    effort: ThinkingEffort,
    options: BuildThinkingParamsOptions = {}
): { thinkingConfig?: { thinkingLevel?: string; thinkingBudget?: number; includeThoughts?: boolean } } {
    if (isGemini3Model(modelId)) {
        return {
            thinkingConfig: {
                thinkingLevel: mapGemini3NativeEffort(effort),
                includeThoughts: true,
            },
        };
    }

    const budget = calculateGemini25ThinkingBudget(effort, options.thinkingBudget);
    return {
        thinkingConfig: {
            thinkingBudget: budget,
            includeThoughts: true,
        },
    };
}

// ==================== 关闭思考时的清理 ====================

/** OpenAI 兼容请求中需要删除的思考相关字段 */
export const OPENAI_THINKING_FIELDS = [
    'thinking',
    'reasoning_effort',
    'enable_thinking',
    'reasoning_split',
];

/** 清理 OpenAI 兼容请求体中的思考相关字段 */
export function clearOpenAIThinkingParams(requestBody: Record<string, any>): void {
    for (const field of OPENAI_THINKING_FIELDS) {
        delete requestBody[field];
    }
    if (requestBody.extra_body?.google?.thinking_config) {
        delete requestBody.extra_body.google.thinking_config;
    }
}
