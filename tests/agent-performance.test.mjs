import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const contextModule = { exports: {} };
vm.runInNewContext(compile(read('../src/utils/agentContext.ts')), contextModule);
const { appendToolRound, createToolRound } = contextModule.exports;
const call = (id, name = 'block') => ({ id, type: 'function', function: {
    name, arguments: '{"action":"get","id":"test"}', thought_signature: 'gemini-signature',
} });
const result = (id, content) => ({ role: 'tool', tool_call_id: id, content });

test('tool rounds preserve the prepared prompt, attachments and limited history', () => {
    const prepared = [
        { role: 'system', content: 'System + Skills + tool policy + SOUL' },
        { role: 'user', content: [{ type: 'text', text: 'current input + context' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }] },
    ];
    const before = structuredClone(prepared);
    const round = createToolRound([call('a'), call('b')], 'look up', 'reasoning', true);
    const next = appendToolRound(prepared, round, [result('b', 'B'), result('a', 'A')]);
    assert.deepEqual(prepared, before);
    assert.equal(next.length, 5);
    assert.equal(next[0], prepared[0]);
    assert.equal(next[1], prepared[1]);
    assert.equal(next[3].tool_call_id, 'a');
    assert.equal(next[4].tool_call_id, 'b');
    assert.equal(next[3].name, 'block');
    assert.throws(() => appendToolRound(prepared, round, [result('a', 'A')]), /Missing result.*b/);
});

test('successive rounds remain distinct and preserve Responses/Gemini reasoning', () => {
    const calls = [call('a')];
    const output = [{ type: 'reasoning', encrypted_content: 'encrypted' },
        { type: 'function_call', call_id: 'a', name: 'block', arguments: '{}' }];
    const first = createToolRound(calls, 'first', 'thinking A', true, output);
    calls.push(call('b'));
    assert.equal(first.tool_calls.length, 1);
    assert.equal(first.tool_calls[0].function.thought_signature, 'gemini-signature');
    assert.equal(first.openaiResponseTurns[0], output);
    let next = appendToolRound([], first, [result('a', 'A')]);
    const second = createToolRound([call('b')], 'second', 'thinking B', false);
    next = appendToolRound(next, second, [result('b', 'B')]);
    assert.equal(next[0].reasoning_content, 'thinking A');
    assert.equal(next[2].reasoning_content, undefined);
    assert.equal(next[0].tool_calls.length, 1);
    assert.equal(next[2].tool_calls[0].id, 'b');
    assert.equal(next[2].openaiResponseTurns, undefined);
});

const toolSource = read('../src/tools/index.ts');
const toolAst = ts.createSourceFile('tools.ts', toolSource, ts.ScriptTarget.Latest, true);
function sourceFunction(name) {
    const node = toolAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, `Missing ${name}`);
    return node.getText(toolAst);
}
function loadSkillsFixture() {
    const poolModule = { exports: {} };
    vm.runInNewContext(compile(read('../src/libs/promise-pool.ts')), poolModule);
    const root = '/data/storage/ai/agent/skills';
    let folders = Array.from({ length: 18 }, (_, index) => `skill-${index}`);
    let active = 0;
    let peak = 0;
    let scans = 0;
    let broken = '';
    const errors = [];
    const sandbox = {
        exports: {}, CUSTOM_SKILLS_DIR: root,
        PromiseLimitPool: poolModule.exports.default,
        console: { error: (...args) => errors.push(args) },
        async putFile() {},
        async readDir(path) {
            if (path.includes('/petal/')) return [];
            if (path === root) { scans++; return folders.map(name => ({ name, isDir: true })); }
            active++;
            peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 2));
            active--;
            if (path.endsWith(`/${broken}`)) throw new Error('sync conflict');
            return [{ name: 'SKILL.md' }];
        },
        async getFileBlob(path) { return { text: async () => path }; },
        parseYamlFrontmatter: text => ({ yaml: { name: text, description: 'workflow' } }),
        extractSiyuanSkillBlockIds: text => text.includes('skill-0/') ? ['block-id'] : [],
    };
    vm.runInNewContext(compile('let skillsLoading;\n' +
        ['loadAllSkills', 'scanAllSkills', 'readSkillSummary'].map(sourceFunction).join('\n')), sandbox);
    return { load: sandbox.exports.loadAllSkills, errors,
        setFolders: value => { folders = value; }, breakFolder: value => { broken = value; },
        stats: () => ({ scans, peak, active }) };
}

test('concurrent skill scans share work, keep order and refresh after completion', async () => {
    const fixture = loadSkillsFixture();
    const first = fixture.load();
    const second = fixture.load();
    assert.equal(first, second);
    const skills = await first;
    assert.equal(skills.length, 18);
    assert.equal(skills[0].source, 'siyuan-blocks');
    assert.equal(skills[1].source, 'markdown');
    assert.deepEqual(Array.from(skills, skill => skill.id),
        Array.from({ length: 18 }, (_, index) => `skill-${index}`));
    assert.deepEqual(fixture.stats(), { scans: 1, peak: 6, active: 0 });
    fixture.setFolders(['newly-synced-skill']);
    const refreshed = await fixture.load();
    assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0].id, 'newly-synced-skill');
    assert.equal(fixture.stats().scans, 2);
});

test('one skill read failure does not discard other results or block future scans', async () => {
    const fixture = loadSkillsFixture();
    fixture.breakFolder('skill-2');
    const skills = await fixture.load();
    assert.equal(skills.length, 17);
    assert.ok(fixture.errors.length > 0);
    fixture.breakFolder('');
    assert.equal((await fixture.load()).length, 18);
});

test('MCP definitions retain native execution constraints instead of UI summaries', async () => {
    const tools = [];
    const schema = { type: 'object', properties: { action: { enum: ['get', 'update'] } } };
    const sandbox = {
        exports: {}, console, AVAILABLE_TOOLS: tools,
        listSiyuanMcpTools: async () => [
            { name: 'block', description: 'Native constraint: preserve IDs.', inputSchema: schema },
            { name: 'document', description: '' },
        ],
        SIYUAN_MCP_BLOCKED_TOOL_NAMES: new Set(),
        TOOL_FULL_DESCRIPTIONS: {}, TOOL_DISPLAY_NAMES: {},
        TOOL_CATEGORIES: { siyuan: {} }, QA_TOOL_CATEGORIES: { siyuan: {} },
        i18nKey: (...parts) => parts.join('.'), i18n: () => 'Localized UI summary',
        createGetSiyuanSkillsTool: () => ({ type: 'function', function: { name: 'get_siyuan_skills' } }),
    };
    vm.runInNewContext(compile(sourceFunction('initializeMcpTools')), sandbox);
    await sandbox.exports.initializeMcpTools();
    assert.equal(tools.find(tool => tool.function.name === 'block').function.description,
        'Native constraint: preserve IDs.');
    assert.equal(tools.find(tool => tool.function.name === 'block').function.parameters, schema);
    assert.equal(tools.find(tool => tool.function.name === 'document').function.description,
        'Localized UI summary');
});
