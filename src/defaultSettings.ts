import { t } from "./utils/i18n";
import type { ThinkingEffort } from "./ai-chat";

export interface ModelConfig {
    id: string;
    name: string;
    temperature: number;
    maxTokens: number;
    customBody?: string; // 自定义请求体参数 (JSON string)
    capabilities?: {
        thinking?: boolean; // 是否支持思考模式
        vision?: boolean;   // 是否支持视觉
    };
    thinkingEnabled?: boolean; // 用户是否开启思考模式（仅当支持思考时有效）
    thinkingEffort?: ThinkingEffort; // 思考努力程度（low/medium/high/auto）
};

export interface ProviderConfig {
    apiKey: string;
    customApiUrl: string;
    models: ModelConfig[];
    advancedConfig?: {
        customModelsUrl?: string; // 自定义模型列表 URL
        customChatUrl?: string;   // 自定义对话 URL
    };
}

export interface CustomProviderConfig extends ProviderConfig {
    id: string;
    name: string;
}

export const getDefaultSettings = () => ({
    textinput: t('settings.textinput.value'),
    slider: 0.5,
    checkbox: false,
    textarea: t('settings.textarea.value'),
    select: 'option1',

    // AI 设置 - 新的多平台多模型结构
    aiProviders: {
        gemini: {
            apiKey: '',
            customApiUrl: '',
            models: []
        },
        deepseek: {
            apiKey: '',
            customApiUrl: '',
            models: []
        },
        openai: {
            apiKey: '',
            customApiUrl: '',
            models: []
        },
        moonshot: {
            apiKey: '',
            customApiUrl: '',
            models: []
        },
        volcano: {
            apiKey: '',
            customApiUrl: '',
            models: []
        },
        v3: {
            apiKey: '',
            customApiUrl: '',
            models: []
        },
        customProviders: [] as CustomProviderConfig[]
    } as Record<string, any>,
    platformOrder: [] as string[],            // 平台排序（所有平台的ID数组）
    selectedProviderId: 'openai' as string,  // 设置面板中选中的平台
    currentProvider: 'openai' as string,      // 对话中当前使用的平台
    currentModelId: '' as string,
    aiSystemPrompt: 'You are a helpful AI assistant.',

    // 操作设置
    sendMessageShortcut: 'ctrl+enter' as 'ctrl+enter' | 'enter', // 发送消息的快捷键

    // 显示设置
    messageFontSize: 14 as number, // 消息字体大小
    modeSelectorType: 'select' as 'buttons' | 'select', // 模式选择器类型：buttons=横向按钮, select=下拉菜单

    // 多模型设置
    selectedMultiModels: [] as Array<{ provider: string; modelId: string }>, // 选中的多模型列表

    // 模型预设设置
    modelPresets: [] as Array<{
        id: string;
        name: string;
        contextCount: number;
        temperature: number;
        systemPrompt: string;
        createdAt: number;
    }>,
    selectedModelPresetId: '' as string,

    // 笔记导出设置
    exportNotebook: '' as string,  // 导出笔记本ID
    exportDefaultPath: '' as string,  // 全局保存文档位置（支持sprig语法）
    exportLastPath: '' as string,  // 上次保存的路径
    exportLastNotebook: '' as string,  // 上次保存的笔记本ID

    // 会话自动重命名设置
    autoRenameSession: false as boolean,  // 是否启用会话自动重命名
    autoRenameProvider: '' as string,  // 自动重命名使用的平台
    autoRenameModelId: '' as string,  // 自动重命名使用的模型ID
    autoRenamePrompt: '请根据以下用户消息生成一个简洁的会话标题（不超过20个字，不要使用引号，标题前添加一个合适的emoji）：\n\n{message}' as string,  // 自动重命名提示词模板

    // 保留旧设置以便兼容升级
    aiProvider: 'openai',
    aiApiKey: '',
    aiModel: '',
    aiCustomApiUrl: '',
    aiTemperature: 0.7,
    aiMaxTokens: 2000,
});
