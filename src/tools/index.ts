/**
 * Agent 模式工具定义
 * 实现各种工具的调用接口
 */

import {
    sql,
    updateBlock,
    exportMdContent,
    getBlockByID,
    getBlockDOM,
    refreshSql,
    appendBlock,
    insertBlock,
    getNotebookConf,
    listDocsByPath,
    deleteBlock,
    putFile,
    readDir,
    getFileBlob,
} from '../api';
import { getActiveEditor } from 'siyuan';
import { parseWebPageToMarkdown, fetchWithWebView } from '../utils/webParser';
import { settingsStore } from '../stores/settings';
import { get } from 'svelte/store';
import type { QuestionItem, QuestionCardAnswers } from '../ai-chat';
import { i18n } from '../utils/i18n';

/**
 * 获取当前激活的编辑器 Protyle 实例
 */
function getProtyle() {
    return getActiveEditor(false)?.protyle;
}

// ==================== 工具分类 ====================

/**
 * 工具分类配置
 * 用于在 UI 中按类别组织展示工具
 */
export const TOOL_CATEGORIES: Record<string, { tools: string[] }> = {
    siyuan: {
        tools: [],
    },
    plugin_task_note_management: {
        tools: [],
    },
    plugin: {
        tools: [],
    },
    other: {
        tools: [
            'read_skill',
            'create_skill',
            'soul',
            'run_js',
            'run_python',
            'run_command',
        ],
    },
};

/**
 * 问答模式工具分类配置
 */
export const QA_TOOL_CATEGORIES: Record<string, { tools: string[] }> = {
    siyuan: {
        tools: [],
    },
    plugin: {
        tools: [],
    },
    plugin_task_note_management: {
        tools: [],
    },
    other: {
        tools: [
            'soul',
            'run_js',
            'run_command',
            'read_skill',
            'create_skill',
        ],
    },
};

/**
 * 默认屏蔽的思源 MCP 工具名称
 * 这些工具不会出现在可用工具列表和工具选择器中
 */
const SIYUAN_MCP_BLOCKED_TOOL_NAMES = new Set([
    'skill',
]);

// ==================== 工具类型定义 ====================

export interface Tool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, ToolParameter>;
            required: string[];
        };
    };
}

/**
 * 工具详细描述接口
 */
export interface ToolDetails {
    name: string;
    shortDescription: string;
    fullDescription: string;
}

export interface ToolParameter {
    type: string;
    description: string;
    enum?: string[];
    items?: ToolParameter;
    default?: any;
    properties?: Record<string, ToolParameter>;
    required?: string[];
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolResult {
    role: 'tool';
    tool_call_id: string;
    name: string;
    content: string;
}

// ==================== 工具执行回调 ====================

/**
 * 工具执行期间需要与 UI 交互的回调
 */
export interface ToolExecutionCallbacks {
    /** 当 ask_user_question 工具被调用时，由 UI 阻塞并返回用户答案 */
    onAskQuestion?: (data: {
        questions: QuestionItem[];
        submitButtonText?: string;
    }) => Promise<QuestionCardAnswers>;
}

// ==================== 工具定义 ====================

/**
 * 工具的完整详细描述映射
 * 键为工具名称，值为工具的完整描述（包含使用说明、示例、注意事项等）
 */
export const TOOL_FULL_DESCRIPTIONS: Record<string, string> = {};

const BUILTIN_TOOL_SKILLS_DIR = '/data/plugins/siyuan-plugin-copilot/skills';
const BUILTIN_TOOL_SKILL_MODULES = import.meta.glob('./skills/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

function registerBuiltinToolSkillDescriptions() {
    for (const [filePath, content] of Object.entries(BUILTIN_TOOL_SKILL_MODULES)) {
        const fileName = filePath.split('/').pop() || '';
        const toolName = fileName.replace(/\.md$/i, '');
        if (toolName) {
            TOOL_FULL_DESCRIPTIONS[toolName] = content.trim();
        }
    }
}

registerBuiltinToolSkillDescriptions();

function getBuiltinToolSkillDescription(toolName: string): string {
    return TOOL_FULL_DESCRIPTIONS[toolName] || `工具 "${toolName}" 的说明文档缺失。`;
}

function isSafeBuiltinToolSkillName(toolName: string): boolean {
    return /^[a-zA-Z0-9_]+$/.test(toolName);
}

async function readBuiltinToolSkillDescription(toolName: string): Promise<string | null> {
    if (!isSafeBuiltinToolSkillName(toolName)) {
        return null;
    }

    const skillPath = `${BUILTIN_TOOL_SKILLS_DIR}/${toolName}.md`;
    const blob = await getFileBlob(skillPath);
    if (!blob) {
        return null;
    }

    return (await blob.text()).trim();
}

/**
 * 插件工具名称解析
 * 格式: plugin__{plugin_name}__{sub_tool}
 * 插件目录名中的下划线替换为连字符（与思源插件目录命名一致）
 */
const PLUGIN_TOOL_NAME_RE = /^plugin__([a-zA-Z0-9_]+)__([a-zA-Z0-9_]+)$/;

function parsePluginToolName(toolName: string): { pluginDirName: string; subTool: string } | null {
    const match = toolName.match(PLUGIN_TOOL_NAME_RE);
    if (!match) {
        return null;
    }
    return {
        pluginDirName: match[1].replace(/_/g, '-'),
        subTool: match[2],
    };
}

async function readPluginToolSkillDescription(toolName: string): Promise<string | null> {
    const parsed = parsePluginToolName(toolName);
    if (!parsed) {
        return null;
    }

    const skillPath = `/data/plugins/${parsed.pluginDirName}/skills/${parsed.subTool}/SKILL.md`;
    const blob = await getFileBlob(skillPath);
    if (!blob) {
        return null;
    }

    return (await blob.text()).trim();
}

/**
 * 获取工具的简短描述（用于工具列表展示）
 * 从完整描述中提取第一行非空内容
 */
function extractShortDescription(fullDescription: string): string {
    const lines = fullDescription.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('`')) {
            return trimmed;
        }
    }
    return fullDescription.substring(0, 100) + '...';
}

/**
 * 创建工具定义，同时注册完整描述
 */
function createTool(
    name: string,
    description: string,
    parameters: Tool['function']['parameters']
): Tool {
    // 注册完整描述
    TOOL_FULL_DESCRIPTIONS[name] = description;

    return {
        type: 'function',
        function: {
            name,
            description: extractShortDescription(description),
            parameters,
        },
    };
}

/**
 * 获取工具的完整描述
 */
export function getToolFullDescription(toolName: string): string | undefined {
    return TOOL_FULL_DESCRIPTIONS[toolName];
}

/**
 * 构建包含工具详细描述的系统提示词追加内容
 * @param toolNames 需要添加详细描述的工具名称列表
 * @param existingDescriptions 已存在的描述（用于避免重复）
 * @returns 追加的系统提示词内容，以及更新后的已存在描述集合
 */
export function buildToolDescriptionsPrompt(
    toolNames: string[],
    existingDescriptions: Set<string> = new Set()
): { prompt: string; newDescriptions: Set<string> } {
    const newToolDescriptions: string[] = [];
    const newDescriptions = new Set(existingDescriptions);

    for (const toolName of toolNames) {
        // 避免重复添加同一个工具的详细描述
        if (newDescriptions.has(toolName)) {
            continue;
        }

        const fullDesc = TOOL_FULL_DESCRIPTIONS[toolName];
        if (fullDesc) {
            newToolDescriptions.push(`## ${toolName}\n\n${fullDesc}`);
            newDescriptions.add(toolName);
        }
    }

    if (newToolDescriptions.length === 0) {
        return { prompt: '', newDescriptions };
    }

    const prompt = `\n\n=== 工具详细使用说明 ===\n\n${newToolDescriptions.join('\n\n---\n\n')}`;
    return { prompt, newDescriptions };
}

/**
 * 获取工具的详细描述文档
 * AI 应该先调用此工具获取目标工具的详细使用说明，然后再调用实际工具
 */
const TOOL_DESCRIPTION_SYSTEM_TOOL_NAMES = new Set(['get_siyuan_skills']);

function normalizeAllowedToolNames(allowedToolNames?: Iterable<string>): Set<string> | undefined {
    if (!allowedToolNames) {
        return undefined;
    }

    return new Set(
        Array.from(allowedToolNames)
            .map(name => name.trim())
            .filter(Boolean)
    );
}

function formatEnabledToolNames(allowedToolNames: Set<string>): string {
    const enabledToolNames = Array.from(allowedToolNames).filter(
        name => !TOOL_DESCRIPTION_SYSTEM_TOOL_NAMES.has(name)
    );
    return enabledToolNames.length > 0 ? enabledToolNames.join(', ') : '无';
}

export async function getSiyuanSkills(
    toolName: string,
    allowedToolNames?: Iterable<string>
): Promise<string> {
    const normalizedToolName = toolName.trim();
    const allowedToolNameSet = normalizeAllowedToolNames(allowedToolNames);
    if (
        allowedToolNameSet &&
        (
            !allowedToolNameSet.has(normalizedToolName) ||
            TOOL_DESCRIPTION_SYSTEM_TOOL_NAMES.has(normalizedToolName)
        )
    ) {
        return `工具 "${toolName}" 当前未启用。当前可用工具: ${formatEnabledToolNames(allowedToolNameSet)}`;
    }

    const description =
        await readBuiltinToolSkillDescription(normalizedToolName) ||
        await readPluginToolSkillDescription(normalizedToolName) ||
        TOOL_FULL_DESCRIPTIONS[normalizedToolName];
    if (!description) {
        const availableTools = allowedToolNameSet
            ? formatEnabledToolNames(allowedToolNameSet)
            : Object.keys(TOOL_FULL_DESCRIPTIONS).join(', ');
        return `未找到工具 "${toolName}" 的详细描述。可用工具: ${availableTools}`;
    }
    return description;
}

const GET_SIYUAN_SKILLS_TOOL_DESCRIPTION = getBuiltinToolSkillDescription('get_siyuan_skills');
const READ_SKILL_TOOL_DESCRIPTION = getBuiltinToolSkillDescription('read_skill');
const CREATE_SKILL_TOOL_DESCRIPTION = getBuiltinToolSkillDescription('create_skill');

const GET_SIYUAN_SKILLS_ALL_TOOL_NAMES = [
    'soul',
    'run_js',
    'run_python',
    'run_command',
    'read_skill',
    'create_skill',
] as const;

function buildGetSiyuanSkillsEnum(allowedToolNames?: string[]): string[] {
    if (!allowedToolNames) {
        return [...GET_SIYUAN_SKILLS_ALL_TOOL_NAMES];
    }

    const allowedSet = new Set(allowedToolNames);
    const builtInNames = GET_SIYUAN_SKILLS_ALL_TOOL_NAMES.filter(name => allowedSet.has(name));
    // 允许查询当前会话已启用的插件工具详细说明
    const pluginToolNames = allowedToolNames.filter(name => PLUGIN_TOOL_NAME_RE.test(name));
    return [...builtInNames, ...pluginToolNames];
}

/**
 * 构建 get_siyuan_skills 工具定义
 * - 未传入 allowedToolNames 时返回全量工具 enum（兼容旧调用）
 * - 传入 allowedToolNames 后只保留该范围（用于当前会话已启用工具）
 */
export function createGetSiyuanSkillsTool(allowedToolNames?: string[]): Tool {
    return {
        type: 'function',
        function: {
            name: 'get_siyuan_skills',
            description: GET_SIYUAN_SKILLS_TOOL_DESCRIPTION,
            parameters: {
                type: 'object',
                properties: {
                    toolName: {
                        type: 'string',
                        description: '要获取详细描述的工具名称',
                        enum: buildGetSiyuanSkillsEnum(allowedToolNames),
                    },
                },
                required: ['toolName'],
            },
        },
    };
}

/**
 * 构建 read_skill 工具定义
 * - 用于让模型读取自定义 Skill 的完整工作流文档
 */
export function createReadSkillTool(): Tool {
    return {
        type: 'function',
        function: {
            name: 'read_skill',
            description: extractShortDescription(READ_SKILL_TOOL_DESCRIPTION),
            parameters: {
                type: 'object',
                properties: {
                    skillId: {
                        type: 'string',
                        description: '要读取的 Skill 标识符，或 Skill 文件夹下子文件的相对路径（如 "my-skill" 或 "my-skill/references/guide.md"）',
                    },
                },
                required: ['skillId'],
            },
        },
    };
}

/**
 * 构建 create_skill 工具定义
 * - 用于让模型在 Agent 模式中创建或更新自定义 Skill
 */
export function createCreateSkillTool(): Tool {
    return {
        type: 'function',
        function: {
            name: 'create_skill',
            description: extractShortDescription(CREATE_SKILL_TOOL_DESCRIPTION),
            parameters: {
                type: 'object',
                properties: {
                    skillId: {
                        type: 'string',
                        description: 'Skill 标识符，会保存到 data/storage/ai/agent/skills/{skillId}/skill.md。不能包含路径分隔符或文件名非法字符。',
                    },
                    content: {
                        type: 'string',
                        description: '完整的 skill.md Markdown 内容。建议包含 YAML Frontmatter，例如 name 和 description。',
                    },
                    name: {
                        type: 'string',
                        description: '可选。content 缺少 YAML Frontmatter 时，用于自动补全 Frontmatter 的 Skill 名称。',
                    },
                    description: {
                        type: 'string',
                        description: '可选。content 缺少 YAML Frontmatter 时，用于自动补全 Frontmatter 的 Skill 描述。',
                    },
                    blockIds: {
                        type: 'array',
                        description: '可选。思源块 ID 列表。提供后会写入或更新 siyuan-plugin-copilot:skill-blocks 标记，使 Skill 内容从这些块展开。',
                        items: {
                            type: 'string',
                            description: '思源块 ID',
                        },
                    },
                },
                required: ['skillId', 'content'],
            },
        },
    };
}

export let AVAILABLE_TOOLS: Tool[] = [
    // 工具详细描述查询工具 - 系统隐藏工具，不在 UI 中显示
    createGetSiyuanSkillsTool(),
    // Skill 读取工具 - 用户可在工具选择器中启用
    createReadSkillTool(),
    // Skill 创建/更新工具 - 用户可在工具选择器中启用
    createCreateSkillTool(),
    // 运行本地命令工具
    createTool(
        'run_command',
        getBuiltinToolSkillDescription('run_command'),
        {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: '要在终端运行的命令内容',
                },
            },
            required: ['command'],
        }
    ),

    // SOUL 工具 - 受限的笔记操作
    createTool(
        'soul',
        getBuiltinToolSkillDescription('soul'),
        {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    description: '操作类型',
                    enum: ['append', 'update', 'delete', 'sql', 'insert', 'getDoc'],
                },
                content: {
                    type: 'string',
                    description: '内容（append、update、insert 操作需要）',
                },
                blockId: {
                    type: 'string',
                    description: '块ID（update 和 delete 操作需要）',
                },
                parentId: {
                    type: 'string',
                    description: '父块ID（append 操作可选，作为子块追加；insert 操作可选，作为子块插入）',
                },
                previousId: {
                    type: 'string',
                    description: '前一个块ID（insert 操作可选，在此块之后插入）',
                },
                nextId: {
                    type: 'string',
                    description: '后一个块ID（insert 操作可选，在此块之前插入）',
                },
                query: {
                    type: 'string',
                    description: 'SQL 查询语句（sql 操作需要）',
                },
            },
            required: ['operation'],
        }
    ),

    // 运行 JavaScript 代码工具
    createTool(
        'run_js',
        getBuiltinToolSkillDescription('run_js'),
        {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: '要执行的 JavaScript 代码，必须使用 return 语句返回结果。可通过 input 变量访问 tool_input 执行后的数据',
                },
                input: {
                    type: 'string',
                    description: '可选的输入数据，会作为 input 变量传入。如果同时提供 tool_input，此值会被覆盖',
                },
                tool_input: {
                    type: 'object',
                    description: '可选。指定要执行的工具及其参数，工具执行结果会转为字符串后作为 input 传入',
                    properties: {
                        tool: {
                            type: 'string',
                            description: '工具名称：sql、get_block_content、fetch、get_doc_tree',
                            enum: ['sql', 'get_block_content', 'fetch', 'get_doc_tree'],
                        },
                        params: {
                            type: 'object',
                            description: '工具参数，根据 tool 类型传入对应的参数',
                        },
                    },
                    required: ['tool', 'params'],
                },
            },
            required: ['code'],
        }
    ),

    // 运行 Python 代码工具
    createTool(
        'run_python',
        getBuiltinToolSkillDescription('run_python'),
        {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: '要执行的 Python 代码',
                },
            },
            required: ['code'],
        }
    ),
];



/**
 * 插入块
 */
export async function siyuan_insert_block(
    dataType: 'markdown' | 'dom',
    data: string,
    parentID?: string,
    appendParentID?: string,
    previousID?: string,
    nextID?: string
): Promise<any> {
    try {
        if (!parentID && !appendParentID && !previousID && !nextID) {
            throw new Error('必须至少指定一个位置参数：parentID、appendParentID、previousID 或 nextID');
        }

        // 使用 insertBlock API 插入块
        let lute = window.Lute.New()
        let newBlockDom: string;
        if (dataType === 'dom') {
            newBlockDom = data;
        } else {
            newBlockDom = lute.Md2BlockDOM(data);
        }
        let newBlockId = newBlockDom.match(/data-node-id="([^"]*)"/)?.[1];

        let insertResult = null;
        // 创建可撤回的事务
        if (newBlockId) {
            try {
                const currentProtyle = getProtyle();
                if (currentProtyle) {

                    // 获取父块ID
                    let actualParentID = parentID || appendParentID;
                    if (!actualParentID && (previousID || nextID)) {
                        const refBlockId = previousID || nextID;
                        const refBlock = await getBlockByID(refBlockId as string);
                        actualParentID = refBlock?.root_id || currentProtyle.block?.id;
                    }

                    const doOperations = [];
                    if (appendParentID) {
                        // 使用appendBlock API作为后置子块插入
                        const appendResult = await appendBlock(dataType, data, appendParentID);
                        insertResult = {
                            id: newBlockId,
                            parentID: appendParentID,
                            previousID: previousID,
                            nextID: nextID,
                            appendParentID: appendParentID
                        };
                        return insertResult;
                    } else if (nextID) {
                        doOperations.push({
                            action: 'insert',
                            id: newBlockId,
                            data: newBlockDom,
                            parentID: actualParentID,
                            nextID: nextID,
                        });
                    } else if (previousID) {
                        doOperations.push({
                            action: 'insert',
                            id: newBlockId,
                            data: newBlockDom,
                            parentID: actualParentID,
                            previousID: previousID,
                        });
                    } else if (parentID) {
                        doOperations.push({
                            action: 'insert',
                            id: newBlockId,
                            data: newBlockDom,
                            parentID: actualParentID,
                        });
                    }

                    const undoOperations = [
                        {
                            action: 'delete',
                            id: newBlockId,
                            data: null,
                        },
                    ];
                    insertResult = {
                        id: newBlockId,
                        parentID: actualParentID,
                        previousID: previousID,
                        nextID: nextID,
                        appendParentID: appendParentID
                    };
                    // 执行事务以支持撤回
                    // @ts-ignore
                    currentProtyle.getInstance()?.transaction(doOperations, undoOperations);
                    setTimeout(() => {
                        currentProtyle.getInstance()?.reload(false);
                    }, 500);
                }

            } catch (transactionError) {

            }
        }

        return insertResult;
    } catch (error) {
        console.error('Insert block error:', error);
        throw new Error(`插入块失败: ${(error as Error).message}`);
    }
}

/**
 * 更新块
 */
export async function siyuan_update_block(
    dataType: 'markdown' | 'dom',
    data: string,
    id: string
): Promise<any> {
    try {
        // 保存旧的DOM用于撤回操作
        const oldBlockDomRes = await getBlockDOM(id);
        const oldBlockDom = oldBlockDomRes?.dom;

        // 使用 updateBlock API 更新块内容
        await updateBlock(dataType, data, id);
        await refreshSql();

        // 获取当前编辑器实例并创建可撤回的事务
        try {
            const currentProtyle = getProtyle();
            if (currentProtyle && oldBlockDom) {
                await refreshSql();
                const newBlockDomRes = await getBlockDOM(id);
                const newBlockDom = newBlockDomRes?.dom;

                if (newBlockDom) {
                    // @ts-ignore
                    currentProtyle.getInstance()?.updateTransaction(id, newBlockDom, oldBlockDom);
                    console.log('Created undo transaction for block update:', id);
                }
            }
        } catch (transactionError) {
            console.warn('创建撤回事务失败，但块内容已更新:', transactionError);
        }

        return { success: true, id };
    } catch (error) {
        console.error('Update block error:', error);
        throw new Error(`更新块失败: ${(error as Error).message}`);
    }
}





/**
 * 递归获取指定路径下的文档树结构
 */
export async function siyuan_get_doc_tree(notebook: string, path: string = '/', sortMode?: number): Promise<any[]> {
    try {
        // 决定最终的排序模式
        let finalSortMode = sortMode;
        if (finalSortMode === undefined || finalSortMode === null) {
            const confRes: any = await getNotebookConf(notebook);
            const notebookSortMode = confRes?.conf?.sortMode;
            if (notebookSortMode === 15) {
                finalSortMode = window.siyuan?.config?.fileTree?.sort ?? 15;
            } else {
                finalSortMode = notebookSortMode ?? 15;
            }
        }

        async function fetchDocsRecursively(currentPath: string): Promise<any[]> {
            try {
                const res: any = await listDocsByPath(notebook, currentPath, finalSortMode, false, 10000);
                if (!res || !res.files) {
                    console.error(`获取路径 [${currentPath}] 失败:`, res);
                    return [];
                }

                const docPromises = res.files.map(async (file: any) => {
                    const node: any = {
                        name: file.name.replace(/\.sy$/, ''),
                        id: file.id,
                        children: [] as any[],
                    };

                    if (file.subFileCount > 0) {
                        const childPath = file.path.replace(/\.sy$/, '');
                        node.children = await fetchDocsRecursively(childPath);
                    }
                    return node;
                });

                return await Promise.all(docPromises);

            } catch (error) {
                console.error(`处理路径 [${currentPath}] 时发生错误:`, error);
                return [];
            }
        }

        return await fetchDocsRecursively(path);
    } catch (error) {
        console.error('Get doc tree error:', error);
        throw new Error(`获取文档树失败: ${(error as Error).message}`);
    }
}


/**
 * 执行 tool_input 指定的工具并返回结果
 */
async function executeToolInput(toolInput: { tool: string; params: any }): Promise<string> {
    const { tool, params } = toolInput;
    let result: any;

    switch (tool) {
        case 'sql': {
            if (!params?.query) {
                throw new Error('sql 工具需要 query 参数');
            }
            result = await siyuan_sql_query(params.query);
            break;
        }
        case 'get_block_content': {
            if (!params?.id || !params?.format) {
                throw new Error('get_block_content 工具需要 id 和 format 参数');
            }
            result = await siyuan_get_block_content(params.id, params.format, params.command);
            break;
        }
        case 'fetch': {
            if (!params?.url) {
                throw new Error('fetch 工具需要 url 参数');
            }
            result = await web_fetch(params.url, params.useWebView);
            break;
        }
        case 'get_doc_tree': {
            if (!params?.notebook) {
                throw new Error('get_doc_tree 工具需要 notebook 参数');
            }
            result = await siyuan_get_doc_tree(params.notebook, params.path || '/', params.sortMode);
            break;
        }
        default:
            throw new Error(`不支持的 tool_input 类型: ${tool}`);
    }

    // 将结果转为字符串
    if (typeof result === 'string') {
        return result;
    } else if (result === null || result === undefined) {
        return '';
    } else {
        try {
            return JSON.stringify(result);
        } catch (e) {
            return String(result);
        }
    }
}

/**
 * 运行 JavaScript 代码
 * 在沙箱环境中执行 JS 代码并返回结果
 * @param code 要执行的 JavaScript 代码
 * @param input 可选的输入数据（用于管道操作）
 * @param tool_input 可选的工具输入，执行指定工具并将结果作为 input
 */
export async function run_js(
    code: string,
    input?: string,
    tool_input?: { tool: string; params: any }
): Promise<string> {
    try {
        if (!code || code.trim() === '') {
            throw new Error('代码内容是必需的');
        }

        // 如果提供了 tool_input，先执行工具获取结果
        let actualInput = input || '';
        if (tool_input) {
            try {
                actualInput = await executeToolInput(tool_input);
            } catch (toolError) {
                throw new Error(`执行 tool_input 失败: ${(toolError as Error).message}`);
            }
        }

        const consoleLogs: string[] = [];

        // 创建受控执行环境，显式传入常用对象和 input。
        // 保留 window 全局对象，方便访问思源/浏览器环境能力。
        const sandbox = {
            Math: Math,
            Date: Date,
            JSON: JSON,
            Array: Array,
            Object: Object,
            String: String,
            Number: Number,
            Boolean: Boolean,
            RegExp: RegExp,
            Error: Error,
            Map: Map,
            Set: Set,
            WeakMap: WeakMap,
            WeakSet: WeakSet,
            Promise: Promise,
            // 管道输入变量
            input: actualInput,
            console: {
                log: (...args: any[]) => {
                    consoleLogs.push(args.map(arg =>
                        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                    ).join(' '));
                },
                error: (...args: any[]) => {
                    consoleLogs.push('[ERROR] ' + args.map(arg =>
                        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                    ).join(' '));
                },
            },
            parseInt: parseInt,
            parseFloat: parseFloat,
            isNaN: isNaN,
            isFinite: isFinite,
            encodeURI: encodeURI,
            encodeURIComponent: encodeURIComponent,
            decodeURI: decodeURI,
            decodeURIComponent: decodeURIComponent,
            escape: escape,
            unescape: unescape,
            btoa: btoa,
            atob: atob,
            // 禁止直接访问的全局对象
            document: undefined,
            globalThis: undefined,
        };

        // 使用 Function 构造函数创建沙箱函数
        // 将 sandbox 的键作为参数名，值作为参数传入
        const sandboxKeys = Object.keys(sandbox);
        const sandboxValues = sandboxKeys.map(key => sandbox[key as keyof typeof sandbox]);

        // 包装用户代码，确保有 return 语句
        let wrappedCode = code;
        if (!code.includes('return')) {
            wrappedCode = `return ${code}`;
        }

        // 将用户代码包装在 async 函数中，以支持 await
        const asyncFn = new Function(...sandboxKeys, `
            "use strict";
            return (async () => {
                ${wrappedCode}
            })();
        `);

        // 设置 5 秒超时
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('代码执行超时（超过 5 秒）')), 5000);
        });

        const executionPromise = Promise.resolve(asyncFn(...sandboxValues));

        const result = await Promise.race([executionPromise, timeoutPromise]);

        // 构建返回结果
        let output = '';
        if (consoleLogs.length > 0) {
            output += `[Console Output]:\n${consoleLogs.join('\n')}\n\n`;
        }

        // 处理返回结果
        let resultStr: string;
        if (result === undefined) {
            resultStr = 'undefined';
        } else if (result === null) {
            resultStr = 'null';
        } else if (typeof result === 'object') {
            try {
                resultStr = JSON.stringify(result, null, 2);
            } catch (e) {
                resultStr = '[Object with circular references]';
            }
        } else if (typeof result === 'function') {
            resultStr = '[Function]';
        } else if (typeof result === 'symbol') {
            resultStr = result.toString();
        } else if (typeof result === 'bigint') {
            resultStr = result.toString() + 'n';
        } else {
            resultStr = String(result);
        }

        output += `[Return Value]:\n${resultStr}`;

        return output;
    } catch (error) {
        console.error('Run JS error:', error);
        throw new Error(`JavaScript 执行失败: ${(error as Error).message}`);
    }
}

/**
 * 运行 Python 代码
 * 调用本地 Python 解释器执行代码并返回结果
 * @param code 要执行的 Python 代码
 * @param pythonPath Python 解释器路径（可选，默认使用系统 python）
 */
export async function run_python(code: string, pythonPath?: string): Promise<string> {
    try {
        if (!code || code.trim() === '') {
            throw new Error('代码内容是必需的');
        }

        // 检查是否在桌面环境
        // @ts-ignore
        if (!window?.require) {
            throw new Error('当前环境不支持执行系统命令，请在思源笔记桌面版中使用此功能。');
        }

        // 动态引入 Node.js 模块
        // @ts-ignore
        const fs = window.require('fs');
        // @ts-ignore
        const path = window.require('path');
        // @ts-ignore
        const childProcess = window.require('child_process');
        // @ts-ignore
        const os = window.require('os');

        if (!fs || !path || !childProcess || !os) {
            throw new Error('所需的 Node.js 模块不可用');
        }

        // 使用用户配置的 Python 路径或默认命令
        const pythonCmd = pythonPath && pythonPath.trim() ? pythonPath.trim() : 'python';

        // 创建临时目录
        const tempDir = path.join(os.tmpdir(), 'siyuan_copilot');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // 创建临时 Python 文件
        const timestamp = Date.now();
        const scriptPath = path.join(tempDir, `python_${timestamp}.py`);

        // 添加 UTF-8 编码处理和 print 捕获
        const scriptContent = `# -*- coding: utf-8 -*-
import sys
import io
import json

# Set UTF-8 encoding for stdout/stderr
if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'buffer'):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Capture print output
_print_buffer = []
_original_print = print

def _captured_print(*args, **kwargs):
    sep = kwargs.get('sep', ' ')
    end = kwargs.get('end', '\\n')
    output = sep.join(str(arg) for arg in args) + end
    _print_buffer.append(output)
    _original_print(*args, **kwargs)

# Replace print function (handle both dict and module form of __builtins__)
import builtins
builtins.print = _captured_print

# User code starts here
__exec_globals = {}

# Get the user code
__user_code = '''${code.replace(/\\/g, '\\\\').replace(/'''/g, "\\'\\'\\'").replace(/\n/g, '\\n')}'''.strip()

# Execute the code
exec(__user_code, __exec_globals)

# Try to get the result from common patterns
__result = None
if '_result' in __exec_globals:
    __result = __exec_globals['_result']
elif '__return__' in __exec_globals:
    __result = __exec_globals['__return__']

# Build output
__output = {}
if _print_buffer:
    __output['print'] = ''.join(_print_buffer).rstrip()

if __result is not None:
    try:
        __output['result'] = repr(__result)
    except Exception:
        __output['result'] = str(__result)

# Output as JSON for easy parsing
print(json.dumps(__output, ensure_ascii=False))
`;

        // 写入临时文件
        fs.writeFileSync(scriptPath, scriptContent, 'utf-8');

        // 尝试执行 Python 代码，如果失败则自动安装依赖
        const executePython = async (attemptInstall: boolean = true): Promise<{
            stdout: string;
            stderr: string;
            exitCode: number;
            success: boolean;
            error?: string;
        }> => {
            return new Promise((resolve) => {
                const execOptions = {
                    timeout: 30000, // 30 秒超时
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        PYTHONIOENCODING: 'utf-8',
                        NO_COLOR: '1'
                    }
                };

                childProcess.execFile(pythonCmd, [scriptPath], execOptions, (error: any, stdout: string, stderr: string) => {
                    resolve({
                        stdout: stdout?.trim() || '',
                        stderr: stderr?.trim() || '',
                        exitCode: error?.code || 0,
                        success: !error,
                        error: error?.message
                    });
                });
            });
        };

        // 解析缺失的模块名
        const parseMissingModule = (stderr: string): string | null => {
            // 匹配 "No module named 'xxx'" 或 "ModuleNotFoundError: No module named 'xxx'"
            const match = stderr.match(/No module named ['"]([^'"]+)['"]/);
            if (match) {
                return match[1];
            }
            // 匹配 "ImportError: cannot import name 'xxx' from"
            const importMatch = stderr.match(/ImportError: cannot import name ['"]([^'"]+)['"]/);
            if (importMatch) {
                return importMatch[1];
            }
            return null;
        };

        // 安装单个模块
        const installModule = async (moduleName: string): Promise<boolean> => {
            return new Promise((resolve) => {
                // 常见的包名映射（pip 安装名 vs 导入名）
                const packageMap: Record<string, string> = {
                    'PIL': 'Pillow',
                    'sklearn': 'scikit-learn',
                    'cv2': 'opencv-python',
                    'bs4': 'beautifulsoup4',
                    'yaml': 'PyYAML',
                    'toml': 'toml',
                    'docx': 'python-docx',
                    'pptx': 'python-pptx',
                    'xlsx': 'openpyxl',
                    'xlrd': 'xlrd',
                    'openpyxl': 'openpyxl',
                    'numpy': 'numpy',
                    'pandas': 'pandas',
                    'requests': 'requests',
                    'matplotlib': 'matplotlib',
                    'seaborn': 'seaborn',
                    'flask': 'Flask',
                    'django': 'Django',
                    'sqlalchemy': 'SQLAlchemy',
                    'pytest': 'pytest',
                    'black': 'black',
                    'isort': 'isort',
                    'mypy': 'mypy',
                    'flake8': 'flake8',
                    'jinja2': 'Jinja2',
                    'markdown': 'Markdown',
                    'pillow': 'Pillow',
                };

                // 获取正确的包名
                const packageName = packageMap[moduleName] || moduleName;

                const execOptions = {
                    timeout: 120000, // pip 安装可能需要更长时间
                    encoding: 'utf8',
                    env: { ...process.env }
                };

                // 使用 -m pip 方式安装
                childProcess.execFile(pythonCmd, ['-m', 'pip', 'install', packageName], execOptions, (error: any, stdout: string, stderr: string) => {
                    if (error) {
                        console.warn(`安装模块 ${packageName} 失败:`, stderr || error.message);
                        resolve(false);
                    } else {
                        console.log(`安装模块 ${packageName} 成功:`, stdout);
                        resolve(true);
                    }
                });
            });
        };

        try {
            let result = await executePython();

            // 如果执行失败且是导入错误，尝试自动安装
            if (!result.success) {
                const missingModule = parseMissingModule(result.stderr);
                if (missingModule) {
                    console.log(`检测到缺失模块: ${missingModule}，尝试自动安装...`);
                    const installed = await installModule(missingModule);
                    if (installed) {
                        // 重新执行代码
                        console.log('模块安装成功，重新执行代码...');
                        result = await executePython(); // 重新执行，但不再尝试安装
                    }
                }
            }

            // 处理执行结果
            if (!result.success && result.exitCode !== 0) {
                throw new Error(`Python 错误 (退出码 ${result.exitCode}): ${result.stderr || result.error || '未知错误'}`);
            }

            // 解析 JSON 输出
            let output: { print?: string; result?: string } = {};
            try {
                const lastLine = result.stdout.split('\n').pop() || '';
                if (lastLine) {
                    output = JSON.parse(lastLine);
                }
            } catch (e) {
                // 不是 JSON 格式，直接使用原始输出
                output = { print: result.stdout };
            }

            // 构建返回结果
            let finalResult = '';
            if (output.print) {
                finalResult += `[Print Output]:\n${output.print}`;
            }
            if (output.result) {
                if (finalResult) finalResult += '\n\n';
                finalResult += `[Return Value]:\n${output.result}`;
            }
            if (result.stderr) {
                if (finalResult) finalResult += '\n\n';
                finalResult += `[Stderr]:\n${result.stderr}`;
            }
            if (!finalResult) {
                finalResult = '[执行成功，无输出]';
            }

            return finalResult;

        } finally {
            // 清理临时文件
            try {
                fs.unlinkSync(scriptPath);
            } catch (e) {
                // ignore
            }
        }

    } catch (error) {
        console.error('Run Python error:', error);
        const errorMsg = (error as Error).message;

        if (errorMsg.includes('window.require is not a function')) {
            throw new Error('当前环境不支持执行系统命令，请在思源笔记桌面版中使用此功能。');
        }
        if (errorMsg.includes('ENOENT') || errorMsg.includes('No such file')) {
            throw new Error(`Python 解释器未找到。请在设置中配置正确的 Python 路径，或将 Python 添加到系统 PATH。`);
        }

        throw new Error(`Python 执行失败: ${errorMsg}`);
    }
}

/**
 * 获取网页内容并转换为 Markdown
 * @param url 要获取的网页 URL
 * @param useWebView 是否使用 WebView 模式，默认为 false
 */
export async function web_fetch(url: string, useWebView: boolean = false): Promise<string> {
    // 如果明确指定使用 WebView 模式
    if (useWebView) {
        try {
            const webviewResult = await fetchWithWebView(url);

            if (webviewResult.success) {
                return `# ${webviewResult.title}\n\n来源: ${url}\n\n---\n\n${webviewResult.markdown}`;
            } else {
                return `WebView 模式获取失败: ${webviewResult.error}`;
            }
        } catch (error) {
            console.error('WebView fetch error:', error);
            return `WebView 模式获取失败: ${(error as Error).message}`;
        }
    }

    // 普通模式：直接获取
    const result = await parseWebPageToMarkdown(url);

    if (result.success) {
        return `# ${result.title}\n\n来源: ${result.url}\n\n---\n\n${result.markdown}`;
    }

    // 普通模式失败，提示用户可以尝试 WebView 模式
    return `获取网页内容失败: ${result.error}\n\n提示: 如果该网站需要登录、使用 JavaScript 动态加载内容或有反爬虫机制，请使用 WebView 模式重试。设置 useWebView: true 即可。`;
}

/**
 * 验证块是否属于 SOUL 文档
 * @param blockId 要验证的块ID
 * @param soulDocId SOUL 文档ID
 * @returns 是否属于 SOUL 文档
 */
async function verifyBlockInSoulDoc(blockId: string, soulDocId: string): Promise<boolean> {
    try {
        const block = await getBlockByID(blockId);
        if (!block) {
            return false;
        }
        // 检查块的 root_id 是否等于 SOUL 文档ID
        return block.root_id === soulDocId;
    } catch (error) {
        console.error('Verify block in SOUL doc error:', error);
        return false;
    }
}

/**
 * 获取插件设置
 */
function getPluginSettings(): any {
    // 从 settingsStore 同步获取设置
    return get(settingsStore);
}

/**
 * SOUL 工具 - 受限的笔记操作
 * 所有操作仅限于用户设置的 SOUL 文档内
 */
export async function soul(params: {
    operation: 'append' | 'update' | 'delete' | 'sql' | 'insert' | 'getDoc';
    content?: string;
    blockId?: string;
    parentId?: string;
    previousId?: string;
    nextId?: string;
    query?: string;
}): Promise<any> {
    const settings = getPluginSettings();
    const soulDocId = settings?.soulDocId;

    if (!soulDocId) {
        throw new Error('SOUL 文档未设置。请在插件设置中设置 SOUL 文档ID。');
    }

    // 验证 SOUL 文档是否存在
    const soulDoc = await getBlockByID(soulDocId);
    if (!soulDoc) {
        throw new Error(`SOUL 文档不存在，ID: ${soulDocId}`);
    }
    if (soulDoc.type !== 'd') {
        throw new Error(`设置的 SOUL ID 不是文档类型，当前类型: ${soulDoc.type}`);
    }

    const { operation } = params;

    switch (operation) {
        case 'append': {
            const { content, parentId } = params;
            if (!content) {
                throw new Error('append 操作需要提供 content 参数');
            }

            // 如果提供了 parentId，验证它是否属于 SOUL 文档
            if (parentId) {
                const isInSoul = await verifyBlockInSoulDoc(parentId, soulDocId);
                if (!isInSoul) {
                    throw new Error(`指定的 parentId 不属于 SOUL 文档，SOUL 文档ID: ${soulDocId}`);
                }
                // 作为子块追加
                const result = await appendBlock('markdown', content, parentId);
                return { success: true, operation: 'append', parentId, result };
            } else {
                // 追加到 SOUL 文档末尾
                const result = await appendBlock('markdown', content, soulDocId);
                return { success: true, operation: 'append', docId: soulDocId, result };
            }
        }

        case 'update': {
            const { blockId, content } = params;
            if (!blockId || !content) {
                throw new Error('update 操作需要提供 blockId 和 content 参数');
            }

            // 验证块是否属于 SOUL 文档
            const isInSoul = await verifyBlockInSoulDoc(blockId, soulDocId);
            if (!isInSoul) {
                throw new Error(`不能更新不属于 SOUL 文档的块，SOUL 文档ID: ${soulDocId}`);
            }

            const result = await updateBlock('markdown', content, blockId);
            return { success: true, operation: 'update', blockId, result };
        }

        case 'delete': {
            const { blockId } = params;
            if (!blockId) {
                throw new Error('delete 操作需要提供 blockId 参数');
            }

            // 验证块是否属于 SOUL 文档
            const isInSoul = await verifyBlockInSoulDoc(blockId, soulDocId);
            if (!isInSoul) {
                throw new Error(`不能删除不属于 SOUL 文档的块，SOUL 文档ID: ${soulDocId}`);
            }

            // 防止删除 SOUL 文档本身
            if (blockId === soulDocId) {
                throw new Error('不能删除 SOUL 文档本身');
            }

            const result = await deleteBlock(blockId);
            return { success: true, operation: 'delete', blockId, result };
        }

        case 'insert': {
            const { content, previousId, nextId, parentId } = params;
            if (!content) {
                throw new Error('insert 操作需要提供 content 参数');
            }

            // 检查至少提供了一个位置参数
            if (!previousId && !nextId && !parentId) {
                throw new Error('insert 操作需要提供 previousId、nextId 或 parentId 中的至少一个参数');
            }

            // 验证位置参数对应的块是否都属于 SOUL 文档
            if (previousId) {
                const isInSoul = await verifyBlockInSoulDoc(previousId, soulDocId);
                if (!isInSoul) {
                    throw new Error(`指定的 previousId 不属于 SOUL 文档，SOUL 文档ID: ${soulDocId}`);
                }
            }
            if (nextId) {
                const isInSoul = await verifyBlockInSoulDoc(nextId, soulDocId);
                if (!isInSoul) {
                    throw new Error(`指定的 nextId 不属于 SOUL 文档，SOUL 文档ID: ${soulDocId}`);
                }
            }
            if (parentId) {
                const isInSoul = await verifyBlockInSoulDoc(parentId, soulDocId);
                if (!isInSoul) {
                    throw new Error(`指定的 parentId 不属于 SOUL 文档，SOUL 文档ID: ${soulDocId}`);
                }
            }

            // 使用 insertBlock API 插入块
            const result = await insertBlock('markdown', content, nextId as any, previousId as any, parentId as any);
            return {
                success: true,
                operation: 'insert',
                previousId,
                nextId,
                parentId,
                result
            };
        }

        case 'sql': {
            const { query } = params;
            if (!query) {
                throw new Error('sql 操作需要提供 query 参数');
            }

            // 构建限制在 SOUL 文档内的查询
            // 将用户的查询包装在子查询中，限制 root_id
            let limitedQuery: string;

            // 检查是否已经有 WHERE 子句
            const lowerQuery = query.toLowerCase();
            if (lowerQuery.includes('where')) {
                // 在现有的 WHERE 后添加条件
                limitedQuery = query.replace(/where/i, `WHERE root_id = '${soulDocId}' AND `);
            } else {
                // 添加 WHERE 子句
                // 处理 ORDER BY, LIMIT, GROUP BY 等
                const orderMatch = lowerQuery.match(/\s+order\s+by\s+/i);
                const limitMatch = lowerQuery.match(/\s+limit\s+/i);
                const groupMatch = lowerQuery.match(/\s+group\s+by\s+/i);

                let insertPos = query.length;
                if (orderMatch && orderMatch.index) {
                    insertPos = Math.min(insertPos, orderMatch.index);
                }
                if (limitMatch && limitMatch.index) {
                    insertPos = Math.min(insertPos, limitMatch.index);
                }
                if (groupMatch && groupMatch.index) {
                    insertPos = Math.min(insertPos, groupMatch.index);
                }

                const beforeClause = query.substring(0, insertPos);
                const afterClause = query.substring(insertPos);

                // 检查是否从 FROM 开始
                if (lowerQuery.includes('from')) {
                    limitedQuery = `${beforeClause} WHERE root_id = '${soulDocId}'${afterClause}`;
                } else {
                    // 如果查询不完整，添加 FROM blocks
                    limitedQuery = `SELECT * FROM blocks WHERE root_id = '${soulDocId}' AND (${query})`;
                }
            }

            // 限制返回数量
            if (!limitedQuery.toLowerCase().includes('limit')) {
                limitedQuery += ' LIMIT 100';
            }

            const results = await sql(limitedQuery);
            return {
                success: true,
                operation: 'sql',
                docId: soulDocId,
                originalQuery: query,
                executedQuery: limitedQuery,
                count: results.length,
                results
            };
        }

        case 'getDoc': {
            // 获取 SOUL 文档的完整 Markdown 内容
            const docContent = await exportMdContent(soulDocId, false, false, 2, 0, false);
            if (!docContent || !docContent.content) {
                throw new Error('获取 SOUL 文档内容失败');
            }

            return {
                success: true,
                operation: 'getDoc',
                docId: soulDocId,
                content: docContent.content
            };
        }

        default:
            throw new Error(`未知的 SOUL 操作类型: ${operation}`);
    }
}

/**
 * 执行工具调用
 */
export async function executeToolCall(
    toolCall: ToolCall,
    allowedToolNames?: Iterable<string>,
    callbacks?: ToolExecutionCallbacks
): Promise<string> {
    const { name, arguments: argsStr } = toolCall.function;
    const allowedToolNameSet = normalizeAllowedToolNames(allowedToolNames);

    if (allowedToolNameSet && !allowedToolNameSet.has(name)) {
        return `工具 "${name}" 当前未启用，已拒绝执行。当前可用工具: ${formatEnabledToolNames(allowedToolNameSet)}`;
    }

    try {
        const args = JSON.parse(argsStr);

        switch (name) {


            case 'soul':
                const soulResult = await soul(args);
                return JSON.stringify(soulResult, null, 2);

            case 'get_siyuan_skills':
                // 获取工具详细描述
                const toolDesc = await getSiyuanSkills(args.toolName, allowedToolNameSet);
                return toolDesc;

                const removeRowsResult = await siyuan_remove_database_rows(args.avID, args.srcIDs);
            case 'web_fetch':
                const webResult = await web_fetch(args.url, args.useWebView);
                return webResult;


            case 'run_js':
                const jsResult = await run_js(args.code, args.input, args.tool_input);
                return jsResult;

            case 'run_python':
                // 获取 Python 路径设置
                const settings = get(settingsStore);
                const pythonPath = settings.pythonPath;
                const pyResult = await run_python(args.code, pythonPath);
                return pyResult;

            case 'read_skill':
                return await read_skill(args.skillId);

            case 'create_skill':
                return await create_skill(
                    args.skillId,
                    args.content,
                    args.name,
                    args.description,
                    args.blockIds
                );

            case 'run_command':
                return await run_command(args.command);

            case 'question': {
                // 思源内置 question 工具：需在 agent 循环中拦截，展示 QuestionCard UI
                if (!callbacks?.onAskQuestion) {
                    return 'question tool: onAskQuestion callback not registered';
                }
                // 将思源 question schema 映射到插件的 QuestionItem[]
                // 思源 schema: { questions: [{ header, question, options:[{label,description}], multiple?, custom? }] }
                const siyuanQuestions: Array<{
                    header: string;
                    question: string;
                    options: Array<{ label: string; description?: string }>;
                    multiple?: boolean;
                    custom?: boolean;
                }> = Array.isArray(args.questions) ? args.questions : [];

                const mappedQuestions: QuestionItem[] = siyuanQuestions.map((q, idx) => ({
                    id: `q_${idx}`,
                    type: q.multiple ? 'multiple' : 'single',
                    title: q.question,
                    description: q.header,
                    required: true,
                    custom: q.custom !== false, // 思源 question 工具默认允许自定义输入
                    options: (q.options || []).map(opt => ({
                        label: opt.label,
                        value: opt.label,
                        description: opt.description,
                    })),
                }));

                const answers = await callbacks.onAskQuestion({ questions: mappedQuestions });

                // 将答案整理为字符串返回给 AI
                const parts: string[] = [];
                for (const q of mappedQuestions) {
                    const ans = answers[q.id];
                    if (ans === undefined || ans === null || ans === '') continue;
                    const label = q.description ? `${q.description}: ` : '';
                    const value = Array.isArray(ans) ? ans.join(', ') : ans;
                    parts.push(`${label}${value}`);
                }
                return parts.length > 0 ? parts.join('\n') : 'User provided no answer.';
            }

            case 'todo_write': {
                // 思源内置 todo_write 工具：MCP handler 需要 _sessionID，插件无法注入，必须本地拦截处理
                // 输入 schema: { todos: [{ content: string, status: "pending"|"in_progress"|"completed"|"cancelled" }] }
                const rawTodos: Array<{ content?: string; status?: string }> =
                    Array.isArray(args.todos) ? args.todos : [];

                if (rawTodos.length === 0) {
                    return 'Todo list is empty.';
                }

                const validStatuses = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
                const lines: string[] = ['Todo List', ''];
                for (const item of rawTodos) {
                    const content = String(item.content ?? '').trim();
                    if (!content) continue;
                    const status = validStatuses.has(item.status ?? '') ? item.status : 'pending';
                    let marker: string;
                    switch (status) {
                        case 'completed': marker = '[x]'; break;
                        case 'in_progress': marker = '[/]'; break;
                        case 'cancelled': marker = '[-]'; break;
                        default: marker = '[ ]'; break;
                    }
                    lines.push(`- ${marker} ${content}`);
                }
                return lines.join('\n');
            }

            default:
                // 所有其他工具路由至思源 MCP 执行
                return await callSiyuanMcpTool(name, args);
        }
    } catch (error) {
        console.error(`Execute tool ${name} error:`, error);
        return `执行工具失败: ${(error as Error).message}`;
    }
}

/**
 * 解析 YAML Frontmatter
 */
function parseYamlFrontmatter(content: string) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return { yaml: null, markdown: content };
    const yamlStr = match[1];
    const markdown = content.substring(match[0].length).trim();
    const yaml: Record<string, string> = {};

    const lines = yamlStr.split(/\r?\n/);
    let currentKey: string | null = null;
    let inBlockScalar = false;
    let blockLines: string[] = [];
    let blockIndent = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (inBlockScalar) {
            const indentMatch = line.match(/^(\s+)/);
            if (line.trim() === '') {
                blockLines.push(line);
                continue;
            }
            if (indentMatch) {
                const indent = indentMatch[1].length;
                if (blockLines.length === 0) {
                    blockIndent = indent;
                }
                blockLines.push(line.substring(Math.min(indent, blockIndent)));
                continue;
            } else {
                if (currentKey) {
                    yaml[currentKey] = blockLines.join('\n').trimRight();
                }
                inBlockScalar = false;
                blockLines = [];
                currentKey = null;
            }
        }

        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            let val = line.substring(colonIndex + 1).trim();

            if (val === '|' || val === '|-' || val === '|+' || val === '>' || val === '>-' || val === '>+') {
                currentKey = key;
                inBlockScalar = true;
                blockLines = [];
                continue;
            }

            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.substring(1, val.length - 1);
            }
            yaml[key] = val;
        }
    }

    if (inBlockScalar && currentKey) {
        yaml[currentKey] = blockLines.join('\n').trimRight();
    }

    return { yaml, markdown };
}

const SIYUAN_SKILL_BLOCKS_MARKER = 'siyuan-plugin-copilot:skill-blocks';
const SIYUAN_SKILL_BLOCKS_RE = /<!--\s*siyuan-plugin-copilot:skill-blocks\s*([\s\S]*?)\s*-->/m;

function normalizeSkillBlockIds(blockIds: string[]): string[] {
    return Array.from(
        new Set(
            blockIds
                .map(id => id.trim())
                .filter(Boolean)
        )
    );
}

export function extractSiyuanSkillBlockIds(content: string): string[] {
    const markerMatch = content.match(SIYUAN_SKILL_BLOCKS_RE);
    if (!markerMatch) {
        return [];
    }

    const payload = markerMatch[1].trim();
    if (!payload) {
        return [];
    }

    try {
        const parsed = JSON.parse(payload);
        if (Array.isArray(parsed)) {
            return normalizeSkillBlockIds(parsed.filter(id => typeof id === 'string'));
        }
        if (Array.isArray(parsed?.blockIds)) {
            return normalizeSkillBlockIds(parsed.blockIds.filter((id: unknown) => typeof id === 'string'));
        }
    } catch {
        // 兼容手写的逐行/逗号分隔块 ID。
    }

    return normalizeSkillBlockIds(
        payload
            .split(/[\r\n,]+/)
            .map(line => line.trim().replace(/^-\s*/, '').replace(/^["']|["']$/g, ''))
    );
}

export function getSkillFrontmatter(content: string): string {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
    return match ? match[0] : '';
}

export function buildSiyuanBlockSkillMarkdown(frontmatter: string, blockIds: string[]): string {
    return `${frontmatter.trim()}\n\n${buildSiyuanSkillBlocksMarker(blockIds)}\n`;
}

export function buildSiyuanSkillBlocksMarker(blockIds: string[]): string {
    const normalizedBlockIds = normalizeSkillBlockIds(blockIds);
    return `<!-- ${SIYUAN_SKILL_BLOCKS_MARKER}\n${JSON.stringify(normalizedBlockIds, null, 2)}\n-->`;
}

export function upsertSiyuanSkillBlockIds(content: string, blockIds: string[]): string {
    const normalizedBlockIds = normalizeSkillBlockIds(blockIds);
    const withoutTrailingSpace = content.trimEnd();

    if (normalizedBlockIds.length === 0) {
        const nextContent = withoutTrailingSpace
            .replace(SIYUAN_SKILL_BLOCKS_RE, '')
            .replace(/\n{3,}/g, '\n\n')
            .trimEnd();
        return nextContent ? `${nextContent}\n` : '';
    }

    const marker = buildSiyuanSkillBlocksMarker(normalizedBlockIds);
    if (SIYUAN_SKILL_BLOCKS_RE.test(withoutTrailingSpace)) {
        return `${withoutTrailingSpace.replace(SIYUAN_SKILL_BLOCKS_RE, marker)}\n`;
    }

    return `${withoutTrailingSpace}\n\n${marker}\n`;
}

async function resolveSiyuanBlockSkillContent(rawContent: string, blockIds: string[]): Promise<string> {
    const sections: string[] = [];

    for (const blockId of blockIds) {
        try {
            const data = await exportMdContent(blockId, false, false, 2, 0, false);
            const content = data?.content?.trim();
            const sourceComment = `<!-- siyuan-block-id: ${blockId}${data?.hPath ? ` hPath: ${data.hPath}` : ''} -->`;
            sections.push(`${sourceComment}\n${content || `无法获取块内容：${blockId}`}`);
        } catch (error) {
            console.error('[Skills] Failed to export skill block:', blockId, error);
            sections.push(`<!-- siyuan-block-id: ${blockId} -->\n无法获取块内容：${blockId}`);
        }
    }

    return rawContent.replace(SIYUAN_SKILL_BLOCKS_RE, sections.join('\n\n')).trim();
}

function getSkillAbsolutePath(...pathParts: string[]): string {
    // @ts-ignore
    const dataDir = window.siyuan?.config?.system?.dataDir;
    // @ts-ignore
    if (!dataDir || !window?.require) {
        return '';
    }

    try {
        // @ts-ignore
        const path = window.require('path');
        return path.join(dataDir, 'storage', 'ai', 'agent', 'skills', ...pathParts);
    } catch (err) {
        console.error('Failed to get absolute path for skill:', err);
        return '';
    }
}

async function buildSkillReadResult(skillId: string, content: string, pathParts: string[]): Promise<string> {
    const blockIds = extractSiyuanSkillBlockIds(content);
    const isSiyuanBlockSkill = blockIds.length > 0;
    const resolvedContent = isSiyuanBlockSkill
        ? await resolveSiyuanBlockSkillContent(content, blockIds)
        : content;

    return JSON.stringify({
        skillId: skillId,
        source: isSiyuanBlockSkill ? 'siyuan-blocks' : 'markdown',
        blockIds: isSiyuanBlockSkill ? blockIds : undefined,
        absolutePath: getSkillAbsolutePath(...pathParts) || '未知绝对路径（可能非桌面版运行）',
        content: resolvedContent
    }, null, 2);
}

export interface Skill {
    id: string;
    name: string;
    description: string;
    filePath: string;
    source: 'markdown' | 'siyuan-blocks';
    blockIds: string[];
    yamlHeaders: Record<string, string>;
}

const CUSTOM_SKILLS_DIR = '/data/storage/ai/agent/skills';
const CUSTOM_SKILL_FILE_NAME = 'skill.md';

function normalizeCustomSkillId(skillId: string): string {
    if (typeof skillId !== 'string') {
        throw new Error('skillId 必须是字符串');
    }

    const normalizedSkillId = skillId.trim();
    if (!normalizedSkillId) {
        throw new Error('skillId 不能为空');
    }

    if (
        normalizedSkillId === '.' ||
        normalizedSkillId === '..' ||
        /[\u0000-\u001f\\/:*?"<>|]/.test(normalizedSkillId)
    ) {
        throw new Error('skillId 不能包含路径分隔符、控制字符或文件名非法字符');
    }

    return normalizedSkillId;
}

function hasSkillYamlFrontmatter(content: string): boolean {
    return /^---\r?\n[\s\S]*?\r?\n---/.test(content);
}

function formatSkillYamlScalar(value: string): string {
    const normalizedValue = value.replace(/\r?\n/g, ' ').trim();
    if (!normalizedValue) {
        return '""';
    }

    if (/[:#"'{}\[\],&*?|<>=!%@`]/.test(normalizedValue)) {
        return `"${normalizedValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }

    return normalizedValue;
}

function buildSkillFrontmatterFromMetadata(
    skillId: string,
    name?: string,
    description?: string
): string {
    return [
        '---',
        `name: ${formatSkillYamlScalar(name || skillId)}`,
        `description: ${formatSkillYamlScalar(description || '')}`,
        '---',
    ].join('\n');
}

function normalizeOptionalSkillBlockIds(blockIds: unknown): string[] | undefined {
    if (blockIds === undefined || blockIds === null) {
        return undefined;
    }

    if (Array.isArray(blockIds)) {
        return normalizeSkillBlockIds(blockIds.filter(id => typeof id === 'string'));
    }

    if (typeof blockIds === 'string') {
        return normalizeSkillBlockIds(blockIds.split(/[\r\n,]+/));
    }

    throw new Error('blockIds 必须是字符串数组');
}

function buildCustomSkillMarkdown(
    skillId: string,
    content: string,
    name?: string,
    description?: string,
    blockIds?: string[]
): string {
    if (typeof content !== 'string') {
        throw new Error('content 必须是字符串');
    }

    let markdown = content.trimStart();
    if (!markdown.trim()) {
        throw new Error('content 不能为空');
    }

    if (!hasSkillYamlFrontmatter(markdown)) {
        markdown = `${buildSkillFrontmatterFromMetadata(skillId, name, description)}\n\n${markdown}`;
    }

    if (blockIds) {
        markdown = upsertSiyuanSkillBlockIds(markdown, blockIds);
    }

    return markdown.endsWith('\n') ? markdown : `${markdown}\n`;
}

/**
 * 从 data/storage/ai/agent/skills 加载所有自定义 Skill
 */
export async function loadAllSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];
    try {
        // 迁移旧的 skills (从 /data/storage/petal/siyuan-plugin-copilot/skills 迁移到 /data/storage/ai/agent/skills)
        const OLD_CUSTOM_SKILLS_DIR = '/data/storage/petal/siyuan-plugin-copilot/skills';
        try {
            const oldItems = await readDir(OLD_CUSTOM_SKILLS_DIR);
            if (oldItems && Array.isArray(oldItems) && oldItems.length > 0) {
                // 确保新目录存在
                await putFile(CUSTOM_SKILLS_DIR, true, null);
                const newItems = await readDir(CUSTOM_SKILLS_DIR);
                const newFolderNames = new Set(
                    newItems && Array.isArray(newItems)
                        ? newItems.filter(item => item.isDir).map(item => item.name)
                        : []
                );

                for (const oldItem of oldItems) {
                    if (oldItem.isDir && !newFolderNames.has(oldItem.name)) {
                        const oldFolderPath = `${OLD_CUSTOM_SKILLS_DIR}/${oldItem.name}`;
                        const newFolderPath = `${CUSTOM_SKILLS_DIR}/${oldItem.name}`;
                        await putFile(newFolderPath, true, null);

                        const files = await readDir(oldFolderPath);
                        if (files && Array.isArray(files)) {
                            for (const file of files) {
                                if (!file.isDir) {
                                    const oldFilePath = `${oldFolderPath}/${file.name}`;
                                    const newFilePath = `${newFolderPath}/${file.name}`;
                                    const blob = await getFileBlob(oldFilePath);
                                    if (blob) {
                                        await putFile(newFilePath, false, blob);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (migrationError) {
            console.error('[Skills] Failed to migrate old skills:', migrationError);
        }

        // 确保目录存在
        await putFile(CUSTOM_SKILLS_DIR, true, null);

        const items = await readDir(CUSTOM_SKILLS_DIR);
        if (items && Array.isArray(items)) {
            for (const item of items) {
                if (item.isDir) {
                    const skillFolderName = item.name;
                    const subDirPath = `${CUSTOM_SKILLS_DIR}/${skillFolderName}`;
                    const filesInFolder = await readDir(subDirPath);
                    if (filesInFolder && Array.isArray(filesInFolder)) {
                        // 支持 skill.md 或 SKILL.md
                        const skillMdFile = filesInFolder.find(
                            f => f.name.toLowerCase() === 'skill.md'
                        );
                        if (skillMdFile) {
                            const skillFilePath = `${subDirPath}/${skillMdFile.name}`;
                            const blob = await getFileBlob(skillFilePath);
                            if (blob) {
                                const text = await blob.text();
                                const { yaml } = parseYamlFrontmatter(text);
                                if (yaml) {
                                    const blockIds = extractSiyuanSkillBlockIds(text);
                                    skills.push({
                                        id: skillFolderName,
                                        name: yaml.name || skillFolderName,
                                        description: yaml.description || '',
                                        filePath: skillFilePath,
                                        source: blockIds.length > 0 ? 'siyuan-blocks' : 'markdown',
                                        blockIds: blockIds,
                                        yamlHeaders: yaml
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('[Skills] Failed to load skills:', e);
    }
    return skills;
}

/**
 * 创建或更新指定 Custom Skill 的 skill.md 内容
 */
export async function create_skill(
    skillId: string,
    content: string,
    name?: string,
    description?: string,
    blockIds?: unknown
): Promise<string> {
    try {
        const normalizedSkillId = normalizeCustomSkillId(skillId);
        const normalizedBlockIds = normalizeOptionalSkillBlockIds(blockIds);
        const markdown = buildCustomSkillMarkdown(
            normalizedSkillId,
            content,
            name,
            description,
            normalizedBlockIds
        );
        const skillDirPath = `${CUSTOM_SKILLS_DIR}/${normalizedSkillId}`;
        const skillFilePath = `${skillDirPath}/${CUSTOM_SKILL_FILE_NAME}`;
        const existed = !!(await getFileBlob(skillFilePath));

        await putFile(CUSTOM_SKILLS_DIR, true, null);
        await putFile(skillDirPath, true, null);

        const fileBlob = new Blob([markdown], { type: 'text/markdown' });
        const result = await putFile(skillFilePath, false, fileBlob);
        if (!result) {
            throw new Error(`写入 Skill 文件失败: ${skillFilePath}`);
        }

        const { yaml } = parseYamlFrontmatter(markdown);
        const savedBlockIds = extractSiyuanSkillBlockIds(markdown);

        return JSON.stringify({
            action: existed ? 'updated' : 'created',
            skillId: normalizedSkillId,
            name: yaml?.name || normalizedSkillId,
            description: yaml?.description || '',
            source: savedBlockIds.length > 0 ? 'siyuan-blocks' : 'markdown',
            blockIds: savedBlockIds.length > 0 ? savedBlockIds : undefined,
            filePath: skillFilePath,
            absolutePath: getSkillAbsolutePath(normalizedSkillId, CUSTOM_SKILL_FILE_NAME) || '未知绝对路径（可能非桌面版运行）',
        }, null, 2);
    } catch (e) {
        console.error('[Skills] Failed to create/update skill:', e);
        return `错误：创建或更新 Skill "${skillId}" 失败。${e instanceof Error ? e.message : String(e)}`;
    }
}

/**
 * 读取指定 Custom Skill 文件的完整 Markdown 内容，或其子文件的完整内容
 */
export async function read_skill(skillId: string): Promise<string> {
    const normalizedSkillId = skillId.replace(/\\/g, '/');

    // 如果 skillId 包含文件扩展名，则视为直接读取子文件路径
    const isDirectFile = /\.[a-zA-Z0-9]+$/.test(normalizedSkillId);

    try {
        if (isDirectFile) {
            const filePath = `${CUSTOM_SKILLS_DIR}/${normalizedSkillId}`;
            const blob = await getFileBlob(filePath);
            if (blob) {
                const text = await blob.text();
                return await buildSkillReadResult(skillId, text, normalizedSkillId.split('/'));
            } else {
                return `错误：未找到文件 "${filePath}"。`;
            }
        } else {
            // 原有逻辑：读取 skillId 目录下的 skill.md
            const subDirPath = `${CUSTOM_SKILLS_DIR}/${normalizedSkillId}`;
            const filesInFolder = await readDir(subDirPath);
            if (filesInFolder && Array.isArray(filesInFolder)) {
                const skillMdFile = filesInFolder.find(
                    f => f.name.toLowerCase() === 'skill.md'
                );
                if (skillMdFile) {
                    const skillFilePath = `${subDirPath}/${skillMdFile.name}`;
                    const blob = await getFileBlob(skillFilePath);
                    if (blob) {
                        const text = await blob.text();
                        return await buildSkillReadResult(skillId, text, [normalizedSkillId, skillMdFile.name]);
                    }
                }
            }
            return `错误：未找到 Skill "${skillId}" 对应的 skill.md 文件。`;
        }
    } catch (e) {
        console.error('[Skills] Failed to read skill:', e);
        return `错误：读取 Skill "${skillId}" 失败。${e instanceof Error ? e.message : String(e)}`;
    }
}

/**
 * 执行本地终端命令（Windows 上使用 PowerShell）
 */
export async function run_command(command: string): Promise<string> {
    try {
        if (!command || command.trim() === '') {
            throw new Error('命令内容是必需的');
        }

        // 检查是否在桌面环境
        // @ts-ignore
        if (!window?.require) {
            throw new Error('当前环境不支持执行系统命令，请在思源笔记桌面版中使用此功能。');
        }

        // @ts-ignore
        const childProcess = window.require('child_process');

        return new Promise((resolve) => {
            // @ts-ignore
            const envCopy = { ...(window.process?.env || {}) };
            envCopy.PYTHONIOENCODING = 'utf-8';

            const options: any = {
                encoding: 'utf8',
                maxBuffer: 10 * 1024 * 1024, // 10MB
                env: envCopy
            };

            let execCommand = command;
            // @ts-ignore
            if (window.process && window.process.platform === 'win32') {
                options.shell = 'powershell.exe';
                // 前置设置 PowerShell 的输出编码为 UTF-8，防止中文乱码
                execCommand = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
            }

            childProcess.exec(execCommand, options, (error: any, stdout: string, stderr: string) => {
                let result = '';
                if (stdout) {
                    result += stdout;
                }
                if (stderr) {
                    result += `\n[标准错误输出]:\n${stderr}`;
                }
                if (error) {
                    result += `\n[执行错误]:\n${error.message}`;
                }
                resolve(result.trim() || '[命令执行完毕，无输出内容]');
            });
        });
    } catch (e) {
        console.error('[Terminal] Failed to execute command:', e);
        return `错误：执行命令失败。${e instanceof Error ? e.message : String(e)}`;
    }
}

// ==================== 思源内部 MCP 工具集成 ====================

let mcpSessionId = null;

async function getMcpSessionId() {
    if (mcpSessionId) return mcpSessionId;

    const initRes = await fetch("/mcp", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "MCP-Protocol-Version": "2024-11-05",
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "siyuan-plugin-copilot", version: "1.0.0" },
            },
        }),
    });

    if (!initRes.ok) {
        throw new Error("Failed to initialize MCP: " + initRes.statusText);
    }

    const sessionId = initRes.headers.get("Mcp-Session-Id");
    if (!sessionId) {
        throw new Error("No Mcp-Session-Id header returned");
    }

    await fetch("/mcp", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "MCP-Protocol-Version": "2024-11-05",
            "Mcp-Session-Id": sessionId,
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
        }),
    });

    mcpSessionId = sessionId;
    return mcpSessionId;
}

export async function listSiyuanMcpTools() {
    const sessionId = await getMcpSessionId();

    const toolsRes = await fetch("/mcp", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "MCP-Protocol-Version": "2024-11-05",
            "Mcp-Session-Id": sessionId,
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
        }),
    });

    if (!toolsRes.ok) {
        throw new Error("Failed to list MCP tools: " + toolsRes.statusText);
    }

    const toolsData = await toolsRes.json();
    return toolsData.result?.tools || [];
}

export async function callSiyuanMcpTool(name, args) {
    let sessionId = await getMcpSessionId();

    const sendCall = async (sessId) => {
        return await fetch("/mcp", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "MCP-Protocol-Version": "2024-11-05",
                "Mcp-Session-Id": sessId,
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: Math.floor(Math.random() * 100000),
                method: "tools/call",
                params: {
                    name,
                    arguments: args,
                },
            }),
        });
    };

    let res = await sendCall(sessionId);
    if (res.status === 404 || res.status === 401 || res.status === 403) {
        mcpSessionId = null;
        sessionId = await getMcpSessionId();
        res = await sendCall(sessionId);
    }

    if (!res.ok) {
        throw new Error("MCP tool call failed with status: " + res.statusText);
    }

    const data = await res.json();
    if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
    }

    if (data.result && Array.isArray(data.result.content)) {
        return data.result.content
            .map((item) => {
                if (item.type === 'text') {
                    return item.text;
                }
                return JSON.stringify(item);
            })
            .join('\n');
    }
    return JSON.stringify(data.result || '');
}

export async function initializeMcpTools() {
    try {
        const mcpToolsList = await listSiyuanMcpTools();
        console.log("Loaded Siyuan MCP tools:", mcpToolsList.map((t) => t.name));

        // Keep only base non-MCP tools
        const baseTools = AVAILABLE_TOOLS.filter(t => {
            const name = t.function.name;
            return name === 'get_siyuan_skills' ||
                name === 'read_skill' ||
                name === 'create_skill' ||
                name === 'soul' ||
                name === 'run_js' ||
                name === 'run_python' ||
                name === 'run_command';
        });

        // 过滤默认屏蔽的思源 MCP 工具
        const filteredMcpToolsList = mcpToolsList.filter(
            t => !SIYUAN_MCP_BLOCKED_TOOL_NAMES.has(t.name)
        );

        // Map MCP tools to Tool interface
        const mappedMcpTools: Tool[] = filteredMcpToolsList.map((mcpTool): Tool => {
            const parameters = mcpTool.inputSchema || { type: 'object', properties: {}, required: [] };

            // Translate the description dynamically if there is a translation
            const descKey = `tools.${mcpTool.name}.description`;
            const translatedDesc = i18n(descKey);
            const description = (translatedDesc !== descKey) ? translatedDesc : (mcpTool.description || '');

            const tool: Tool = {
                type: 'function',
                function: {
                    name: mcpTool.name,
                    description: description,
                    parameters: parameters
                }
            };

            // Register full description in TOOL_FULL_DESCRIPTIONS
            if (!TOOL_FULL_DESCRIPTIONS[mcpTool.name]) {
                TOOL_FULL_DESCRIPTIONS[mcpTool.name] = description;
            }

            return tool;
        });

        // 重建 get_siyuan_skills 工具，使其可选值包含所有已加载的工具
        const allAvailableToolNames = [
            ...baseTools.map(t => t.function.name).filter(n => n !== 'get_siyuan_skills'),
            ...mappedMcpTools.map(t => t.function.name)
        ];
        const getSiyuanSkillsTool = createGetSiyuanSkillsTool(allAvailableToolNames);

        // Clear and update AVAILABLE_TOOLS
        AVAILABLE_TOOLS.length = 0;
        AVAILABLE_TOOLS.push(
            getSiyuanSkillsTool,
            ...baseTools.filter(t => t.function.name !== 'get_siyuan_skills'),
            ...mappedMcpTools
        );

        // Update TOOL_CATEGORIES and QA_TOOL_CATEGORIES
        // Group plugin tools, task note management plugin tools and siyuan tools
        const TASK_NOTE_MANAGEMENT_PREFIX = 'plugin__siyuan_plugin_task_note_management__';
        const TASK_NOTE_MANAGEMENT_ORDER = ['task', 'project', 'habit', 'stats'];

        const taskNoteManagementToolNames = filteredMcpToolsList
            .filter(t => t.name.startsWith(TASK_NOTE_MANAGEMENT_PREFIX))
            .map(t => t.name)
            .sort((a, b) => {
                const suffixA = a.slice(TASK_NOTE_MANAGEMENT_PREFIX.length);
                const suffixB = b.slice(TASK_NOTE_MANAGEMENT_PREFIX.length);
                const idxA = TASK_NOTE_MANAGEMENT_ORDER.indexOf(suffixA);
                const idxB = TASK_NOTE_MANAGEMENT_ORDER.indexOf(suffixB);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });

        const pluginToolNames = filteredMcpToolsList.filter(
            t => t.name.startsWith("plugin__") && !t.name.startsWith(TASK_NOTE_MANAGEMENT_PREFIX)
        ).map(t => t.name);
        const siyuanToolNames = filteredMcpToolsList.filter(t => !t.name.startsWith("plugin__")).map(t => t.name);

        TOOL_CATEGORIES.siyuan.tools = siyuanToolNames;
        TOOL_CATEGORIES.plugin.tools = pluginToolNames;
        TOOL_CATEGORIES.plugin_task_note_management.tools = taskNoteManagementToolNames;

        QA_TOOL_CATEGORIES.siyuan.tools = siyuanToolNames;
        QA_TOOL_CATEGORIES.plugin.tools = pluginToolNames;
        QA_TOOL_CATEGORIES.plugin_task_note_management.tools = taskNoteManagementToolNames;

        console.log("Successfully initialized Siyuan MCP tools!");
    } catch (error) {
        console.error("Failed to initialize Siyuan MCP tools:", error);
    }
}
