import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse } from 'svelte/compiler';

const root = fileURLToPath(new URL('..', import.meta.url));
const chinese = /[\u3400-\u9fff]/u;

export function sourceFiles(directory = path.join(root, 'src')) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const filename = path.join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(filename) : /\.(ts|svelte)$/.test(filename) ? [filename] : [];
    });
}

/** Collect script literals and Svelte markup without matching comments or CSS. */
export function inspectSource(filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const literals = [];
    const keys = [];
    const collectScript = (script, offset = 0) => {
        const ast = ts.createSourceFile(filename, script, ts.ScriptTarget.Latest, true);
        const visit = node => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
                && ['i18n', 'tf', 'tp', 'hasTranslation'].includes(node.expression.text)
                && ts.isStringLiteral(node.arguments[0])) {
                keys.push(node.arguments[0].text);
            }
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
                const text = ts.isTemplateExpression(node) ? node.getText(ast) : node.text;
                if (chinese.test(text)) {
                    const parent = node.parent.getText(ast);
                    if (!/^console\./.test(parent)) {
                        literals.push({ start: offset + node.getStart(ast), end: offset + node.end, text, kind: 'expression' });
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(ast);
    };
    if (filename.endsWith('.ts')) {
        collectScript(source);
    } else {
        // Blank TypeScript scripts while preserving the markup's character offsets.
        const markup = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, script => {
            const start = script.indexOf('>') + 1;
            const content = script.slice(start, script.lastIndexOf('</script>'));
            collectScript(content, source.indexOf(script) + start);
            return script.replace(/[^\r\n]/g, ' ');
        }).replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, style => style.replace(/[^\r\n]/g, ' '));
        const ast = parse(markup);
        const visit = (node, parent) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'Text' && chinese.test(node.data)) {
                literals.push({ start: node.start, end: node.end, text: node.data.trim(), kind: parent?.type === 'Attribute' ? 'attribute' : 'text' });
            }
            if (node.type === 'Literal' && typeof node.value === 'string' && chinese.test(node.value)) {
                literals.push({ start: node.start, end: node.end, text: node.value, kind: 'expression' });
            }
            if (node.type === 'TemplateLiteral' && chinese.test(source.slice(node.start, node.end))) {
                literals.push({ start: node.start, end: node.end, text: source.slice(node.start, node.end), kind: 'expression' });
            }
            if (node.type === 'CallExpression' && ['i18n', 'tf', 'tp', 'hasTranslation'].includes(node.callee?.name)
                && typeof node.arguments[0]?.value === 'string') keys.push(node.arguments[0].value);
            for (const [key, value] of Object.entries(node)) {
                if (['parent', 'loc', 'css', 'instance', 'module'].includes(key)) continue;
                if (Array.isArray(value)) value.forEach(child => visit(child, node));
                else if (value && typeof value === 'object') visit(value, node);
            }
        };
        visit(ast.html);
    }
    return { source, literals, keys };
}

function placeholders(text) {
    return [...new Set(text.match(/\$\{[^}]+\}|\{\d+\}/g) || [])].sort().join(',');
}

function readDictionary(locale, errors) {
    const filename = path.join(root, `i18n/${locale}.json`);
    const source = fs.readFileSync(filename, 'utf8');
    const ast = ts.parseJsonText(filename, source);
    const seen = new Set();
    for (const property of ast.statements[0]?.expression?.properties || []) {
        const key = property.name?.text;
        if (seen.has(key)) errors.push(`${locale}: Duplicate translation key: ${key}`);
        seen.add(key);
    }
    return JSON.parse(source);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, 'scripts/check-i18n.mjs')) {
    const errors = [];
    const zh = readDictionary('zh_CN', errors);
    const en = readDictionary('en_US', errors);
    for (const key of new Set([...Object.keys(zh), ...Object.keys(en)])) {
        if (typeof zh[key] !== 'string' || typeof en[key] !== 'string') errors.push(`Missing translation: ${key}`);
        else if (placeholders(zh[key]) !== placeholders(en[key])) errors.push(`Placeholder mismatch: ${key}`);
    }
    for (const filename of sourceFiles()) {
        const { source, literals, keys } = inspectSource(filename);
        for (const key of keys) if (!(key in zh)) errors.push(`${path.relative(root, filename)}: Unknown translation key: ${key}`);
        if (process.argv.includes('--audit')) {
            for (const literal of literals) {
                const line = source.slice(0, literal.start).split('\n').length;
                console.log(`${path.relative(root, filename)}:${line} [${literal.kind}] ${literal.text.replace(/\n/g, '\\n')}`);
            }
        }
    }
    errors.forEach(error => console.error(error));
    console.log(`Checked ${Object.keys(zh).length} bilingual keys; ${errors.length} errors.`);
    process.exitCode = errors.length ? 1 : 0;
}
