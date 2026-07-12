import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const I18N_DIR = path.join(ROOT, 'i18n');
const SRC_DIR = path.join(ROOT, 'src');

/**
 * 将路径段转换为 PascalCase
 * 规则：按一个或多个下划线拆词，首字母大写后拼接
 */
function toPascalCase(segment: string): string {
    return segment
        .split(/_+/)
        .filter(Boolean)
        .map(part => part[0].toUpperCase() + part.slice(1))
        .join('');
}

/**
 * 把路径数组转成平铺驼峰键
 * 第一个段保持原样，后续段转 PascalCase
 */
function toFlatKey(parts: string[]): string {
    if (parts.length === 0) return '';
    return parts[0] + parts.slice(1).map(toPascalCase).join('');
}

/**
 * 递归扁平化嵌套 JSON
 */
function flatten(obj: any, prefix: string[] = []): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
        const newPrefix = [...prefix, key];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(result, flatten(value, newPrefix));
        } else {
            result[toFlatKey(newPrefix)] = value as string;
        }
    }
    return result;
}

/**
 * 按深度设置嵌套对象值
 */
function setNested(obj: any, path: string[], value: any) {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[path[path.length - 1]] = value;
}

/**
 * 如果嵌套路径不存在则设置默认值，缺失的中间对象会自动创建
 */
function setNestedIfMissing(obj: any, path: string[], value: any) {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    const lastKey = path[path.length - 1];
    if (!(lastKey in current)) {
        current[lastKey] = value;
    }
}

/**
 * 修复 en_US 与 zh_CN 的已知键不一致
 */
function patchEnUS(en: any) {
    // platform.builtIn.v3Description -> AchuanDescription
    if (en.platform?.builtIn?.v3Description) {
        en.platform.builtIn.AchuanDescription = en.platform.builtIn.v3Description;
        delete en.platform.builtIn.v3Description;
    }

    // common.back
    en.common ??= {};
    en.common.back = 'Back';

    // settings.reset.confirm -> confirmMessage
    if (en.settings?.reset) {
        if (en.settings.reset.confirm && !en.settings.reset.confirmMessage) {
            en.settings.reset.confirmMessage = en.settings.reset.confirm;
        }
        delete en.settings.reset.confirm;
    }
}

/**
 * 补齐源码使用但两份 JSON 都缺失的键
 */
function addMissingKeysToBoth(zh: any, en: any) {
    const addBoth = (path: string[], zhValue: string, enValue: string) => {
        setNestedIfMissing(zh, path, zhValue);
        setNestedIfMissing(en, path, enValue);
    };

    addBoth(['aiSidebar', 'info', 'noValidModel'], '无效的模型', 'No valid model configured');
    addBoth(['aiSidebar', 'errors', 'noSelection'], '请选择一项', 'Please select an item');
    addBoth(['settings', 'webAppCollectionDock', 'noApps'], '暂无小程序', 'No web apps yet');
    addBoth(['aiSidebar', 'translate', 'deleteSuccess'], '删除成功', 'Translation history deleted');
    addBoth(['aiSidebar', 'translate', 'deleteError'], '删除失败', 'Failed to delete translation history');
    addBoth(['common', 'copy'], '复制', 'Copy');
    addBoth(['platform', 'reorderSuccess'], '平台顺序已更新', 'Platform order updated');
}

/**
 * 确保两份 JSON 的键集合完全一致，缺失值用另一语言占位
 */
function syncKeys(zh: Record<string, string>, en: Record<string, string>) {
    const missingInEn = Object.keys(zh).filter(k => !(k in en));
    const missingInZh = Object.keys(en).filter(k => !(k in zh));

    for (const k of missingInEn) {
        en[k] = `[EN] ${zh[k]}`;
    }
    for (const k of missingInZh) {
        zh[k] = `[待译] ${en[k]}`;
    }

    return { missingInEn, missingInZh };
}

/**
 * 排序并格式化输出 JSON
 */
function formatJson(obj: Record<string, any>): string {
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(obj).sort()) {
        sorted[key] = obj[key];
    }
    return JSON.stringify(sorted, null, 4) + '\n';
}

/**
 * 替换源码中的静态 i18n 键
 */
async function replaceKeysInSources(keyMap: Record<string, string>) {
    const files: string[] = [];
    await collectFiles(SRC_DIR, files);

    const funcNames = ['i18n', 'hasTranslation', 'tf', 'tp'];
    const regex = new RegExp(`\\b(${funcNames.join('|')})\\s*\\(\\s*(["'])(.*?)\\2`, 'g');

    const skipped: { file: string; line: number; match: string }[] = [];
    const unmatched: { file: string; line: number; key: string }[] = [];

    for (const file of files) {
        const content = await readFile(file, 'utf-8');
        let changed = false;

        const newContent = content.replace(regex, (match, funcName, quote, key, offset) => {
            const line = content.slice(0, offset).split('\n').length;

            // 跳过含 ${ 的模板字符串（已由其他分支处理，但这里只是保险）
            if (match.includes('${')) {
                skipped.push({ file, line, match });
                return match;
            }

            if (key in keyMap) {
                changed = true;
                return `${funcName}(${quote}${keyMap[key]}${quote}`;
            } else {
                // 点分路径中仍可能包含 ${...}，例如 i18n(`tools.${name}.name`) 不会被此正则捕获，
                // 但如果出现其他未识别键则记录
                if (key.includes('.') && !keyMap[key]) {
                    unmatched.push({ file, line, key });
                }
                return match;
            }
        });

        if (changed) {
            await writeFile(file, newContent, 'utf-8');
        }
    }

    return { skipped, unmatched };
}

async function collectFiles(dir: string, out: string[]) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await collectFiles(fullPath, out);
        } else if (entry.isFile() && /\.(ts|svelte)$/.test(entry.name)) {
            out.push(fullPath);
        }
    }
}

async function main() {
    const zhRaw = JSON.parse(await readFile(path.join(I18N_DIR, 'zh_CN.json'), 'utf-8'));
    const enRaw = JSON.parse(await readFile(path.join(I18N_DIR, 'en_US.json'), 'utf-8'));

    // 1. 应用补丁
    patchEnUS(enRaw);
    addMissingKeysToBoth(zhRaw, enRaw);

    // 2. 扁平化
    const zhFlat = flatten(zhRaw);
    const enFlat = flatten(enRaw);

    // 3. 键对齐
    const { missingInEn, missingInZh } = syncKeys(zhFlat, enFlat);

    // 4. 生成旧键 -> 新键映射（用于源码替换）
    const oldToNew: Record<string, string> = {};

    function buildMap(obj: any, prefix: string[] = []) {
        for (const [key, value] of Object.entries(obj)) {
            const newPrefix = [...prefix, key];
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                buildMap(value, newPrefix);
            } else {
                const oldKey = newPrefix.join('.');
                const newKey = toFlatKey(newPrefix);
                oldToNew[oldKey] = newKey;
            }
        }
    }
    buildMap(zhRaw);

    // 5. 写回 JSON
    await writeFile(path.join(I18N_DIR, 'zh_CN.json'), formatJson(zhFlat), 'utf-8');
    await writeFile(path.join(I18N_DIR, 'en_US.json'), formatJson(enFlat), 'utf-8');

    // 6. 替换源码静态键
    const { skipped, unmatched } = await replaceKeysInSources(oldToNew);

    // 7. 输出报告
    console.log('\n=== i18n 扁平化完成 ===');
    console.log(`zh_CN 键数: ${Object.keys(zhFlat).length}`);
    console.log(`en_US 键数: ${Object.keys(enFlat).length}`);

    if (missingInEn.length > 0) {
        console.log(`\n[注意] en_US 缺失并由 zh_CN 填充的键（${missingInEn.length} 个）:`);
        missingInEn.forEach(k => console.log(`  - ${k}`));
    }
    if (missingInZh.length > 0) {
        console.log(`\n[注意] zh_CN 缺失并由 en_US 填充的键（${missingInZh.length} 个）:`);
        missingInZh.forEach(k => console.log(`  - ${k}`));
    }

    if (skipped.length > 0) {
        console.log(`\n[需手动处理] 跳过的模板字符串动态键（${skipped.length} 处）:`);
        skipped.forEach(s => console.log(`  ${s.file}:${s.line} ${s.match}`));
    }

    if (unmatched.length > 0) {
        console.log(`\n[需检查] 源码中未匹配的旧键（${unmatched.length} 处）:`);
        unmatched.forEach(u => console.log(`  ${u.file}:${u.line} ${u.key}`));
    }

    console.log('\n提示：请运行 pnpm run build 并在思源中加载插件验证。');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
