let pluginInstance: any = null;

// 设置插件实例的引用
export function setPluginInstance(plugin: any) {
    pluginInstance = plugin;
}

/**
 * 获取当前语言
 */
export function getCurrentLanguage(): string {
    if (pluginInstance && pluginInstance.i18n) {
        // 从插件实例获取当前语言
        return pluginInstance.i18n.getCurrentLanguage?.() || 'zh-CN';
    }

    // 尝试从全局获取
    try {
        const { i18n } = require("siyuan");
        return i18n.getCurrentLanguage?.() || 'zh-CN';
    } catch (error) {
        console.warn('无法获取当前语言:', error);
        return 'zh-CN';
    }
}

/**
 * 翻译函数
 */
export function i18n(key: string, params?: { [key: string]: string }): string {
    // 首先尝试从插件实例获取i18n数据
    let i18nData = null;

    if (pluginInstance && pluginInstance.i18n) {
        i18nData = pluginInstance.i18n;
    }

    // 如果插件实例不可用，尝试从全局获取
    if (!i18nData) {
        try {
            const { i18n } = require("siyuan");
            i18nData = i18n;
        } catch (error) {
            console.warn('无法获取i18n对象:', error);
        }
    }

    // 如果仍然没有i18n数据，使用key作为后备
    if (!i18nData || typeof i18nData !== 'object') {
        console.warn('i18n数据不可用，使用key作为后备:', key);
        return key;
    }

    // 支持嵌套键访问（如 settings.template.description）
    let text = i18nData;
    const keyParts = key.split('.');

    for (const part of keyParts) {
        if (text && typeof text === 'object' && part in text) {
            text = text[part];
        } else {
            text = undefined;
            break;
        }
    }

    // 如果没有找到对应的翻译文本，使用key作为后备
    if (typeof text !== 'string') {
        // console.warn('未找到i18n键:', key);
        text = key;
    }

    // 处理参数替换
    if (params && typeof text === 'string') {
        Object.keys(params).forEach(param => {
            text = text.replace(new RegExp(`\\$\\{${param}\\}`, 'g'), params[param]);
        });
    }

    return text;
}

/**
 * 检查是否存在翻译键
 */
export function hasTranslation(key: string): boolean {
    let i18nData = null;

    if (pluginInstance && pluginInstance.i18n) {
        i18nData = pluginInstance.i18n;
    }

    if (!i18nData) {
        try {
            const { i18n } = require("siyuan");
            i18nData = i18n;
        } catch (error) {
            return false;
        }
    }

    if (!i18nData) {
        return false;
    }

    // 支持嵌套键检查
    let current = i18nData;
    const keyParts = key.split('.');

    for (const part of keyParts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        } else {
            return false;
        }
    }

    return typeof current === 'string';
}

/**
 * 格式化带参数的翻译文本
 */
export function tf(key: string, ...args: any[]): string {
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
export function tp(key: string, count: number, params?: { [key: string]: string }): string {
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
