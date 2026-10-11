import zhCN from '../../i18n/zh_CN.json';
import enUS from '../../i18n/en_US.json';

type TranslationParams = Record<string, string | number>;
interface I18nPlugin {
    i18n?: Record<string, unknown>;
}
type LanguageWindow = Window & { siyuan?: { config?: { lang?: string } } };

let pluginInstance: I18nPlugin | null = null;

// 设置插件实例的引用
export function setPluginInstance(plugin: I18nPlugin | null) {
    pluginInstance = plugin;
}

/**
 * 获取当前语言
 */
export function getCurrentLanguage(): string {
    const language = typeof window === 'undefined' ? undefined : (window as LanguageWindow).siyuan?.config?.lang;
    const normalized = (language || 'zh-CN').replace(/_/g, '-');
    // 兼容思源旧版语言名称，同时为 Intl 日期格式化提供有效的语言标签。
    return normalized === 'zh-CHT' ? 'zh-TW' : normalized;
}

function getTranslation(key: string): string | undefined {
    const hostText = pluginInstance?.i18n?.[key];
    if (typeof hostText === 'string') return hostText;
    const bundled: Record<string, string> = getCurrentLanguage().toLowerCase().startsWith('zh') ? zhCN : enUS;
    return Object.prototype.hasOwnProperty.call(bundled, key) ? bundled[key] : undefined;
}

/**
 * 将路径段转换为 PascalCase（按一个或多个下划线拆词，首字母大写后拼接）
 */
function toPascalCase(segment: string): string {
    return segment
        .split(/_+/)
        .filter(Boolean)
        .map(part => part[0].toUpperCase() + part.slice(1))
        .join('');
}

/**
 * 构造平铺驼峰 i18n 键
 * 第一个段保持原样，后续段按 toPascalCase 转换
 */
export function i18nKey(first: string, ...rest: string[]): string {
    return [first, ...rest.map(toPascalCase)].join('');
}

/**
 * 翻译函数
 */
export function i18n(key: string, params?: TranslationParams): string {
    const text = getTranslation(key) ?? key;
    if (!params) return text;
    // 回调替换会原样保留参数中的 $&、$' 等字符，也不会二次替换参数里的占位符。
    return text.replace(/\$\{([^}]+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}

/**
 * 检查是否存在翻译键
 */
export function hasTranslation(key: string): boolean {
    return getTranslation(key) !== undefined;
}

/**
 * 格式化带参数的翻译文本
 */
export function tf(key: string, ...args: unknown[]): string {
    const text = i18n(key);

    if (args.length === 0) {
        return text;
    }

    // 支持位置参数替换 {0}, {1}, {2} 等
    return text.replace(/\{(\d+)\}/g, (match, index) => {
        const argIndex = parseInt(index);
        return argIndex < args.length ? String(args[argIndex]) : match;
    });
}

/**
 * 多元化翻译（根据数量选择不同的翻译）
 */
export function tp(key: string, count: number, params?: TranslationParams): string {
    let pluralKey = key;

    // 根据数量选择不同的键
    if (count === 0) {
        pluralKey = `${key}_zero`;
    } else if (count === 1) {
        pluralKey = `${key}_one`;
    } else {
        pluralKey = `${key}_other`;
    }

    // 如果复数形式不存在，回退到原始键
    if (!hasTranslation(pluralKey)) {
        pluralKey = key;
    }

    // 添加count参数
    const finalParams = { count: count.toString(), ...params };

    return i18n(pluralKey, finalParams);
}
