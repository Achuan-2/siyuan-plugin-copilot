/**
 * Agent 模式工具定义
 * 实现各种工具的调用接口
 */

import {
    sql,
    updateBlock,
    getBlockKramdown,
    exportMdContent,
    createDocWithMd,
    getBlockByID,
    getBlockDOM,
    refreshSql,
    openBlock,
    lsNotebooks,
    createNotebook,
    renameDocByID,
    moveDocsByID,
    appendBlock,
    insertBlock,
    getBlockAttrs,
    setBlockAttrs,
    getNotebookConf,
    listDocsByPath,
    searchAttributeView,
    getAttributeViewKeysByAvID,
    renderAttributeView,
    appendAttributeViewDetachedBlocksWithValues,
    addAttributeViewBlocks,
    setAttributeViewBlockAttr,
    batchSetAttributeViewBlockAttrs,
    getAttributeViewKeys,
    getAttributeViewBoundBlockIDsByItemIDs,
    getAttributeViewItemIDsByBoundIDs,
    addAttributeViewKey,
    removeAttributeViewKey,
    removeAttributeViewBlocks,
    deleteBlock,
    request,
    sendNotification,
    putFile,
    readDir,
    getFileBlob,
    renderSprig,
} from '../api';
import { getActiveEditor } from 'siyuan';
import { parseWebPageToMarkdown, fetchWithWebView } from '../utils/webParser';
import { settingsStore } from '../stores/settings';
import { get } from 'svelte/store';

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
        tools: [
            'siyuan_sql_query',
            'siyuan_get_block_content',
            'siyuan_get_block_attrs',
            'siyuan_set_block_attrs',
            'siyuan_insert_block',
            'siyuan_update_block',
            'siyuan_delete_block',
            'siyuan_create_document',
            'siyuan_create_child_document',
            'siyuan_get_doc_tree',
            'siyuan_list_notebooks',
            'siyuan_create_notebook',
            'siyuan_rename_document',
            'siyuan_move_documents',
            'siyuan_send_notification',
            'siyuan_get_current_time',
            'siyuan_fetch_sync_post',
        ],
    },
    database: {
        tools: [
            'siyuan_search_database',
            'siyuan_get_database_columns',
            'siyuan_render_database',
            'siyuan_add_database_rows',
            'siyuan_add_database_blocks',
            'siyuan_set_database_cell',
            'siyuan_batch_set_database_cells',
            'siyuan_get_block_databases',
            'siyuan_convert_blockid_to_itemid',
            'siyuan_convert_itemid_to_blockid',
            'siyuan_add_database_column',
            'siyuan_remove_database_column',
            'siyuan_remove_database_rows',
        ],
    },
    other: {
        tools: [
            'web_fetch',
            'soul',
            'run_js',
            'run_python',
            'run_command',
            'create_skill',
        ],
    },
};

/**
 * 问答模式工具分类配置
 */
export const QA_TOOL_CATEGORIES: Record<string, { tools: string[] }> = {
    siyuan: {
        tools: [
            'siyuan_sql_query',
            'siyuan_get_block_content',
            'siyuan_get_block_attrs',
            'siyuan_get_doc_tree',
            'siyuan_list_notebooks',
            'siyuan_get_current_time',
        ],
    },
    other: {
        tools: [
            'web_fetch',
            'soul',
            'run_js',
            'run_command',
        ],
    },
};

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
const TOOL_DESCRIPTION_SYSTEM_TOOL_NAMES = new Set(['get_siyuan_skills', 'read_skill']);

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

const GET_SIYUAN_SKILLS_ALL_TOOL_NAMES = [
    'siyuan_sql_query',
    'siyuan_update_block',
    'siyuan_insert_block',
    'siyuan_get_block_content',
    'siyuan_create_document',
    'siyuan_create_child_document',
    'siyuan_list_notebooks',
    'siyuan_get_doc_tree',
    'siyuan_create_notebook',
    'siyuan_rename_document',
    'siyuan_move_documents',
    'siyuan_get_block_attrs',
    'siyuan_set_block_attrs',
    'siyuan_search_database',
    'siyuan_get_database_columns',
    'siyuan_render_database',
    'siyuan_add_database_rows',
    'siyuan_add_database_blocks',
    'siyuan_set_database_cell',
    'siyuan_batch_set_database_cells',
    'siyuan_get_block_databases',
    'siyuan_convert_blockid_to_itemid',
    'siyuan_convert_itemid_to_blockid',
    'siyuan_add_database_column',
    'siyuan_remove_database_column',
    'siyuan_remove_database_rows',
    'web_fetch',
    'siyuan_delete_block',
    'siyuan_fetch_sync_post',
    'siyuan_send_notification',
    'siyuan_get_current_time',
    'soul',
    'run_js',
    'run_python',
    'run_command',
    'create_skill',
] as const;

function buildGetSiyuanSkillsEnum(allowedToolNames?: string[]): string[] {
    if (!allowedToolNames) {
        return [...GET_SIYUAN_SKILLS_ALL_TOOL_NAMES];
    }

    const allowedSet = new Set(allowedToolNames);
    return GET_SIYUAN_SKILLS_ALL_TOOL_NAMES.filter(name => allowedSet.has(name));
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

export const AVAILABLE_TOOLS: Tool[] = [
    // 工具详细描述查询工具 - 隐藏工具，不在 UI 中显示
    createGetSiyuanSkillsTool(),

    // 自定义 Skill 读取工具 - 隐藏工具，不在 UI 中显示
    createTool(
        'read_skill',
        getBuiltinToolSkillDescription('read_skill'),
        {
            type: 'object',
            properties: {
                skillId: {
                    type: 'string',
                    description: '要读取的 Skill 的标识符或其子文件的相对路径（如 "my-skill" 或 "my-skill/references/guide.md"）',
                },
            },
            required: ['skillId'],
        }
    ),

    // 自定义 Skill 创建/更新工具
    createTool(
        'create_skill',
        getBuiltinToolSkillDescription('create_skill'),
        {
            type: 'object',
            properties: {
                skillId: {
                    type: 'string',
                    description: 'Skill 标识符，会保存到 data/storage/ai/agent/skills/{skillId}/skill.md。不能包含路径分隔符或文件名非法字符。',
                },
                content: {
                    type: 'string',
                    description: '完整的 skill.md Markdown 内容。建议包含 YAML Frontmatter；缺失时会使用 name/description 自动补全。',
                },
                name: {
                    type: 'string',
                    description: '可选。content 缺少 YAML Frontmatter 时写入 Frontmatter 的 Skill 名称。',
                },
                description: {
                    type: 'string',
                    description: '可选。content 缺少 YAML Frontmatter 时写入 Frontmatter 的 Skill 描述。',
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
        }
    ),

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

    // SQL查询工具
    createTool(
        'siyuan_sql_query',
        getBuiltinToolSkillDescription('siyuan_sql_query'),
        {
            type: 'object',
            properties: {
                sql: {
                    type: 'string',
                    description: 'SQL查询语句，必须是有效的SQLite语法',
                },
            },
            required: ['sql'],
        }
    ),
    // 更新块工具
    createTool(
        'siyuan_update_block',
        getBuiltinToolSkillDescription('siyuan_update_block'),
        {
            type: 'object',
            properties: {
                dataType: {
                    type: 'string',
                    description: '数据类型，通常使用 "markdown"',
                    enum: ['markdown', 'dom'],
                },
                data: {
                    type: 'string',
                    description: '新的块内容，使用Markdown格式',
                },
                id: {
                    type: 'string',
                    description: '要更新的块ID',
                },
            },
            required: ['dataType', 'data', 'id'],
        }
    ),
    // 插入块工具
    createTool(
        'siyuan_insert_block',
        getBuiltinToolSkillDescription('siyuan_insert_block'),
        {
            type: 'object',
            properties: {
                dataType: {
                    type: 'string',
                    description: '数据类型，通常使用 "markdown"',
                    enum: ['markdown', 'dom'],
                },
                data: {
                    type: 'string',
                    description: '要插入的内容，使用Markdown格式，可以一次性插入多个块，无需一个个插入',
                },
                parentID: {
                    type: 'string',
                    description: '父块ID，将新块作为前置子块插入（可选）',
                },
                appendParentID: {
                    type: 'string',
                    description: '父块ID，将新块作为后置子块追加到父块最后（可选）',
                },
                previousID: {
                    type: 'string',
                    description: '前一个块的ID，将新块插入到该块之后（可选）',
                },
                nextID: {
                    type: 'string',
                    description: '后一个块的ID，将新块插入到该指定块之前（可选）',
                },
            },
            required: ['dataType', 'data'],
        }
    ),



    // 获取块内容工具
    createTool(
        'siyuan_get_block_content',
        getBuiltinToolSkillDescription('siyuan_get_block_content'),
        {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: '要获取内容的块ID',
                },
                format: {
                    type: 'string',
                    description: '返回格式：markdown（纯文本）或 kramdown（包含ID信息）',
                    enum: ['markdown', 'kramdown'],
                },
                command: {
                    type: 'string',
                    description: '可选。文本处理命令，支持 length、grep、replace、head 及管道组合。详见工具描述。',
                },
            },
            required: ['id', 'format'],
        }
    ),

    // 创建文档工具
    createTool(
        'siyuan_create_document',
        getBuiltinToolSkillDescription('siyuan_create_document'),
        {
            type: 'object',
            properties: {
                notebook: {
                    type: 'string',
                    description: '笔记本ID。如果用户未指定，则创建在默认笔记本,不要自行选择。',
                },
                path: {
                    type: 'string',
                    description: '文档保存的目录路径（不含文档标题/文件名）。必须以 "/" 开头。如果未指定，则使用默认目录路径。',
                },
                title: {
                    type: 'string',
                    description: '文档标题（即文档名称/文件名）。如果未指定，将使用默认的时间戳文件名。',
                },
                markdown: {
                    type: 'string',
                    description: '文档内容，使用Markdown格式。思源笔记会自动把 title 作为文档的标题，因此不需要在 Markdown 内容中再使用一级标题（# 标题）作为笔记标题。',
                },
            },
            required: ['markdown'],
        }
    ),

    // 创建子文档工具
    createTool(
        'siyuan_create_child_document',
        getBuiltinToolSkillDescription('siyuan_create_child_document'),
        {
            type: 'object',
            properties: {
                parentId: {
                    type: 'string',
                    description: '父文档ID，子文档将创建在此文档下',
                },
                title: {
                    type: 'string',
                    description: '子文档标题（不含路径，仅文档名）',
                },
                markdown: {
                    type: 'string',
                    description: '文档内容，使用Markdown格式',
                },
            },
            required: ['parentId', 'title', 'markdown'],
        }
    ),

    // 列出笔记本工具
    createTool(
        'siyuan_list_notebooks',
        getBuiltinToolSkillDescription('siyuan_list_notebooks'),
        {
            type: 'object',
            properties: {},
            required: [],
        }
    ),

    // 获取文档树工具
    createTool(
        'siyuan_get_doc_tree',
        getBuiltinToolSkillDescription('siyuan_get_doc_tree'),
        {
            type: 'object',
            properties: {
                notebook: {
                    type: 'string',
                    description: '笔记本ID',
                },
                path: {
                    type: 'string',
                    description: "起始路径，默认 '/'",
                },
                sortMode: {
                    type: 'number',
                    description: '可选的排序模式，若不提供将由笔记本或全局配置决定',
                },
            },
            required: ['notebook'],
        }
    ),

    // 创建笔记本工具
    createTool(
        'siyuan_create_notebook',
        getBuiltinToolSkillDescription('siyuan_create_notebook'),
        {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '笔记本名称',
                },
            },
            required: ['name'],
        }
    ),

    // 重命名文档工具
    createTool(
        'siyuan_rename_document',
        getBuiltinToolSkillDescription('siyuan_rename_document'),
        {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: '文档ID',
                },
                title: {
                    type: 'string',
                    description: '新的文档标题',
                },
            },
            required: ['id', 'title'],
        }
    ),

    // 移动文档工具
    createTool(
        'siyuan_move_documents',
        getBuiltinToolSkillDescription('siyuan_move_documents'),
        {
            type: 'object',
            properties: {
                fromIDs: {
                    type: 'array',
                    description: '源文档ID数组，可以是一个或多个文档ID',
                    items: {
                        type: 'string',
                    },
                },
                toID: {
                    type: 'string',
                    description: '目标父文档ID或笔记本ID',
                },
            },
            required: ['fromIDs', 'toID'],
        }
    ),
    // 获取块属性工具
    createTool(
        'siyuan_get_block_attrs',
        getBuiltinToolSkillDescription('siyuan_get_block_attrs'),
        {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: '要获取属性的块ID',
                },
            },
            required: ['id'],
        }
    ),

    // 设置块属性工具
    createTool(
        'siyuan_set_block_attrs',
        getBuiltinToolSkillDescription('siyuan_set_block_attrs'),
        {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: '要设置属性的块ID',
                },
                attrs: {
                    type: 'object',
                    description: '属性对象，键为属性名，值为字符串',
                },
            },
            required: ['id', 'attrs'],
        }
    ),

    // ==================== 数据库属性视图工具 ====================

    // 搜索数据库
    createTool(
        'siyuan_search_database',
        getBuiltinToolSkillDescription('siyuan_search_database'),
        {
            type: 'object',
            properties: {
                keyword: {
                    type: 'string',
                    description: '搜索关键词',
                },
                avID: {
                    type: 'string',
                    description: '数据库ID（可选，用于精确搜索）',
                },
            },
            required: ['keyword'],
        }
    ),

    // 获取数据库列信息
    createTool(
        'siyuan_get_database_columns',
        getBuiltinToolSkillDescription('siyuan_get_database_columns'),
        {
            type: 'object',
            properties: {
                avID: {
                    type: 'string',
                    description: '数据库ID',
                },
            },
            required: ['avID'],
        }
    ),

    // 渲染/获取数据库内容
    createTool(
        'siyuan_render_database',
        getBuiltinToolSkillDescription('siyuan_render_database'),
        {
            type: 'object',
            properties: {
                avID: {
                    type: 'string',
                    description: '数据库ID或块ID',
                },
                viewID: {
                    type: 'string',
                    description: '视图ID',
                },
                pageSize: {
                    type: 'number',
                    description: '每页数量，默认9999999',
                },
                page: {
                    type: 'number',
                    description: '页码，默认1',
                },
                createIfNotExist: {
                    type: 'boolean',
                    description: '如果不存在是否创建，默认true',
                },
            },
            required: ['avID', 'viewID'],
        }
    ),

    // 添加数据库行（非绑定行）
    createTool(
        'siyuan_add_database_rows',
        getBuiltinToolSkillDescription('siyuan_add_database_rows'),
        {
            type: 'object',
            properties: {
                avID: {
                    type: 'string',
                    description: '数据库ID',
                },
                blocksValues: {
                    type: 'array',
                    description: '二维数组，每个元素是一行的数据，每行是一个数组，包含该行的单元格值对象',
                    items: {
                        type: 'array',
                        description: '一行的数据数组',
                        items: {
                            type: 'object',
                            description: '单元格值对象，根据列类型设置值，如 { "keyID": "列ID", "text": { "content": "文本内容" } }',
                        },
                    },
                },
            },
            required: ['avID', 'blocksValues'],
        }
    ),

    // 添加绑定块到数据库
    createTool(
        'siyuan_add_database_blocks',
        getBuiltinToolSkillDescription('siyuan_add_database_blocks'),
        {
            type: 'object',
            properties: {
                avID: {
                    type: 'string',
                    description: '数据库ID',
                },
                blockIDs: {
                    type: 'array',
                    description: '要绑定的块ID数组',
                    items: {
                        type: 'string',
                    },
                },
                itemIDs: {
                    type: 'array',
                    description: 'ItemID数组（可选，与blockIDs一一对应）',
                    items: {
                        type: 'string',
                    },
                },
            },
            required: ['avID', 'blockIDs'],
        }
    ),

    // 设置数据库单元格值
    createTool(
        'siyuan_set_database_cell',
        getBuiltinToolSkillDescription('siyuan_set_database_cell'),
        {
            type: 'object',
            properties: {
                avID: {
                    type: 'string',
                    description: '数据库ID',
                },
                keyID: {
                    type: 'string',
                    description: '列ID',
                },
                itemID: {
                    type: 'string',
                    description: '行ID/ItemID',
                },
                value: {
                    type: 'object',
                    description: '属性值对象',
                },
            },
            required: ['avID', 'keyID', 'itemID', 'value'],
        }
    ),

    // 批量设置数据库单元格
    createTool(
        'siyuan_batch_set_database_cells',
        getBuiltinToolSkillDescription('siyuan_batch_set_database_cells'),
        {
            type: 'object',
            properties: {
                avID: {
                    type: 'string',
                    description: '数据库ID',
                },
                values: {
                    type: 'array',
                    description: '属性值数组，每个元素包含 keyID、itemID 和 value',
                    items: {
                        type: 'object',
                        description: '单元格值对象，如 { "keyID": "列ID", "itemID": "行ID/ItemID", "value": { "text": { "content": "文本" } } }',
                        properties: {
                            keyID: {
                                type: 'string',
                                description: '列ID',
                            },
                            itemID: {
                                type: 'string',
                                description: '行ID/ItemID',
                            },
                            value: {
                                type: 'object',
                                description: '属性值对象',
                            },
                        },
                        required: ['keyID', 'itemID', 'value'],
                    },
                },
            },
            required: ['avID', 'values'],
        }
    ),

    // 获取块所在的数据库
    createTool(
        'siyuan_get_block_databases',
        getBuiltinToolSkillDescription('siyuan_get_block_databases'),
        {
            type: 'object',
            properties: {
                blockID: {
                    type: 'string',
                    description: '块ID',
                },
            },
            required: ['blockID'],
        }
    ),

    // 块ID转ItemID
    createTool(
        'siyuan_convert_blockid_to_itemid',
        getBuiltinToolSkillDescription('siyuan_convert_blockid_to_itemid'),
        {
            type: 'object',
            properties: {
                avID: {
                    type: 'string',
                    description: '数据库ID',
                },
                blockIDs: {
                    type: 'array',
                    description: '块ID数组',
                    items: {
                        type: 'string',
                    },
                },
            },
            required: ['avID', 'blockIDs'],
        }
    ),

    // ItemID转块ID
    createTool(
        'siyuan_convert_itemid_to_blockid',
        getBuiltinToolSkillDescription('siyuan_convert_itemid_to_blockid'),
        {
            type: 'object',
            properties: {
                avID: {
                    type: 'string',
                    description: '数据库ID',
                },
                itemIDs: {
                    type: 'array',
                    description: 'ItemID数组',
                    items: {
                        type: 'string',
                    },
                },
            },
            required: ['avID', 'itemIDs'],
        }
    ),

    // 添加数据库列
    createTool(
        'siyuan_add_database_column',
        getBuiltinToolSkillDescription('siyuan_add_database_column'),
        {
            type: 'object',
            properties: {
                avID: {
                    type: 'string',
                    description: '数据库ID',
                },
                keyName: {
                    type: 'string',
                    description: '列名称',
                },
                keyType: {
                    type: 'string',
                    description: '列类型',
                    enum: ['text', 'number', 'select', 'mSelect', 'block', 'date', 'url', 'email', 'phone'],
                },
                previousKeyID: {
                    type: 'string',
                    description: '前一列ID（用于指定新列的位置）',
                },
                keyIcon: {
                    type: 'string',
                    description: '列图标（可选，unicode字符）',
                },
            },
            required: ['avID', 'keyName', 'keyType', 'previousKeyID'],
        }
    ),

    // 删除数据库列
    createTool(
        'siyuan_remove_database_column',
        getBuiltinToolSkillDescription('siyuan_remove_database_column'),
        {
            type: 'object',
            properties: {
                avID: {
                    type: 'string',
                    description: '数据库ID',
                },
                keyID: {
                    type: 'string',
                    description: '要删除的列ID',
                },
            },
            required: ['avID', 'keyID'],
        }
    ),

    // 删除数据库行
    createTool(
        'siyuan_remove_database_rows',
        getBuiltinToolSkillDescription('siyuan_remove_database_rows'),
        {
            type: 'object',
            properties: {
                avID: {
                    type: 'string',
                    description: '数据库ID',
                },
                srcIDs: {
                    type: 'array',
                    description: '要删除的行ID数组',
                    items: {
                        type: 'string',
                    },
                },
            },
            required: ['avID', 'srcIDs'],
        }
    ),

    // 网页内容获取工具
    createTool(
        'web_fetch',
        getBuiltinToolSkillDescription('web_fetch'),
        {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '要获取的网页 URL，必须是完整的 http:// 或 https:// 链接',
                },
                useWebView: {
                    type: 'boolean',
                    description: '是否使用 WebView 模式加载页面。默认为 false（普通模式）。对于需要登录、动态加载或有反爬虫机制的网站，建议设为 true',
                    default: false,
                },
            },
            required: ['url'],
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

    // 获取当前时间工具
    createTool(
        'siyuan_get_current_time',
        getBuiltinToolSkillDescription('siyuan_get_current_time'),
        {
            type: 'object',
            properties: {
                format: {
                    type: 'string',
                    description: '返回格式：local(默认)、iso、date、time、timestamp',
                    enum: ['iso', 'local', 'date', 'time', 'timestamp'],
                    default: 'local',
                },
            },
            required: [],
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

    // 系统通知工具
    createTool(
        'siyuan_send_notification',
        getBuiltinToolSkillDescription('siyuan_send_notification'),
        {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: '通知标题（必填）',
                },
                body: {
                    type: 'string',
                    description: '通知内容（可选，默认为空）',
                },
                delay: {
                    type: 'string',
                    description: '延迟时间：数字字符串表示秒数（如 "300" 表示5分钟后），ISO 8601 格式字符串表示具体时间。本地时间格式 "2026-03-12T11:50:00"，UTC 时间格式 "2026-03-12T11:50:00Z"，立即发送可不传或传 "0"',
                },
                timeoutType: {
                    type: 'string',
                    description: '超时类型："default"（默认）或 "never"（不自动消失）',
                    enum: ['default', 'never'],
                    default: 'default',
                },
            },
            required: ['title'],
        }
    ),

    // 删除块工具
    createTool(
        'siyuan_delete_block',
        getBuiltinToolSkillDescription('siyuan_delete_block'),
        {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: '要删除的块ID',
                },
            },
            required: ['id'],
        }
    ),

    // 通用思源API调用工具
    createTool(
        'siyuan_fetch_sync_post',
        getBuiltinToolSkillDescription('siyuan_fetch_sync_post'),
        {
            type: 'object',
            properties: {
                api: {
                    type: 'string',
                    description: 'API 路径，如 "/api/block/getChildBlocks" 或 "block/getChildBlocks"',
                },
                data: {
                    type: 'object',
                    description: '请求数据对象，根据具体 API 的要求构造',
                },
            },
            required: ['api'],
        }
    ),
];

// ==================== 工具实现 ====================


/**
 * 执行SQL查询（带限制）
 */
export async function siyuan_sql_query(sqlQuery: string): Promise<any[]> {
    try {

        // 限制返回数量
        const limitedQuery = sqlQuery.includes('LIMIT') ? sqlQuery : `${sqlQuery} LIMIT 1000`;

        const results = await sql(limitedQuery);

        // 如果结果过多，提供摘要
        if (results.length >= 1000) {
            console.warn('SQL query returned 1000+ results, might be truncated');
        }

        return results;
    } catch (error) {
        console.error('Execute SQL query error:', error);
        throw new Error(`SQL查询失败: ${(error as Error).message}`);
    }
}

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
        const result = await updateBlock(dataType, data, id);
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

        return result;
    } catch (error) {
        console.error('Update block error:', error);
        throw new Error(`更新块失败: ${(error as Error).message}`);
    }
}

/**
 * 解析并执行单条命令
 */
function executeCommand(content: string, cmdStr: string): string {
    const parts = cmdStr.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
        case 'length': {
            return String(content.length);
        }

        case 'grep': {
            if (parts.length < 2) {
                throw new Error('grep 命令需要 pattern 参数');
            }
            const patternStr = parts.slice(1).join(' ');
            let regex: RegExp;

            // 检测是否为 /pattern/flags 格式
            const regexMatch = patternStr.match(/^\/(.*)\/([gimuy]*)$/);
            if (regexMatch) {
                regex = new RegExp(regexMatch[1], regexMatch[2] || 'm');
            } else {
                // 普通字符串匹配
                regex = new RegExp(patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm');
            }

            const lines = content.split('\n');
            const matchedLines = lines.filter(line => regex.test(line));
            return matchedLines.join('\n');
        }

        case 'replace': {
            if (parts.length < 3) {
                throw new Error('replace 命令需要 pattern 和 replacement 参数');
            }

            // 最后一个参数是 replacement，中间的是 pattern
            const replacement = parts[parts.length - 1];
            const patternStr = parts.slice(1, -1).join(' ');

            let regex: RegExp;
            // 检测是否为 /pattern/flags 格式
            const regexMatch = patternStr.match(/^\/(.*)\/([gimuy]*)$/);
            if (regexMatch) {
                regex = new RegExp(regexMatch[1], regexMatch[2] || 'g');
            } else {
                // 普通字符串替换，全局替换
                regex = new RegExp(patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            }

            return content.replace(regex, replacement);
        }

        case 'head': {
            if (parts.length < 2) {
                throw new Error('head 命令需要行数参数');
            }

            const lines = content.split('\n');

            if (parts.length === 2) {
                // head n: 返回前 n 行
                const n = parseInt(parts[1], 10);
                if (isNaN(n) || n < 1) {
                    throw new Error('head 参数必须是正整数');
                }
                return lines.slice(0, n).join('\n');
            } else {
                // head start end: 返回第 start 到 end 行（1-based，包含）
                const start = parseInt(parts[1], 10);
                const end = parseInt(parts[2], 10);
                if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
                    throw new Error('head 参数格式错误，应为 "head start end"');
                }
                return lines.slice(start - 1, end).join('\n');
            }
        }

        default:
            throw new Error(`未知命令: ${cmd}`);
    }
}

/**
 * 执行命令管道（支持 | 连接的多条命令）
 */
function executeCommandPipeline(content: string, command: string): string {
    if (!command || command.trim() === '') {
        return content;
    }

    // 分割管道命令
    const commands = command.split('|').map(cmd => cmd.trim()).filter(cmd => cmd);

    let result = content;
    for (const cmd of commands) {
        result = executeCommand(result, cmd);
    }

    return result;
}

/**
 * 获取块内容
 * @param id 块ID
 * @param format 格式：markdown 或 kramdown
 * @param command 可选的文本处理命令
 */
export async function siyuan_get_block_content(
    id: string,
    format: 'markdown' | 'kramdown',
    command?: string
): Promise<string> {
    try {
        let content: string;

        if (format === 'kramdown') {
            const result = await getBlockKramdown(id);
            if (!result || !result.kramdown) {
                throw new Error('获取Kramdown内容失败');
            }
            content = result.kramdown;
        } else {
            const result = await exportMdContent(id, false, false, 2, 0, false);
            if (!result || !result.content) {
                throw new Error('获取Markdown内容失败');
            }
            content = result.content;
        }

        // 如果有命令参数，执行文本处理
        if (command && command.trim()) {
            content = executeCommandPipeline(content, command);
        }

        return content;
    } catch (error) {
        console.error('Get block content error:', error);
        throw new Error(`获取块内容失败: ${(error as Error).message}`);
    }
}

/**
 * 创建文档
 */
function normalizeDocumentPath(path: string): string {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
        return '';
    }
    return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

async function resolveCreateDocumentDefaults(
    notebook?: string,
    path?: string,
    title?: string
): Promise<{ notebook: string; path: string }> {
    const fileTreeConfig = window.siyuan?.config?.fileTree;
    const resolvedNotebook = notebook?.trim() || fileTreeConfig?.docCreateSaveBox;
    
    let defaultPath = fileTreeConfig?.docCreateSavePath || '';
    let defaultDirTemplate = '/';
    if (defaultPath) {
        defaultPath = defaultPath.trim();
        if (defaultPath.endsWith('/')) {
            defaultPath = defaultPath.slice(0, -1);
        }
        const lastSlashIdx = defaultPath.lastIndexOf('/');
        if (lastSlashIdx > 0) {
            defaultDirTemplate = defaultPath.substring(0, lastSlashIdx);
        } else if (lastSlashIdx === 0) {
            defaultDirTemplate = '/';
        }
    }

    let defaultDir = defaultDirTemplate;
    if (defaultDir.includes('{{')) {
        defaultDir = await renderSprig(defaultDir);
    }
    if (!defaultDir.startsWith('/')) {
        defaultDir = '/' + defaultDir;
    }
    if (!defaultDir.endsWith('/')) {
        defaultDir = defaultDir + '/';
    }

    let resolvedDir = defaultDir;
    const inputPath = path?.trim();
    if (inputPath) {
        resolvedDir = inputPath.startsWith('/') ? inputPath : '/' + inputPath;
        if (resolvedDir.endsWith('/')) {
            resolvedDir = resolvedDir.slice(0, -1);
        }
    } else {
        if (resolvedDir.endsWith('/') && resolvedDir.length > 1) {
            resolvedDir = resolvedDir.slice(0, -1);
        }
    }

    let resolvedTitle = title?.trim();
    if (!resolvedTitle) {
        let fullDefaultPath = fileTreeConfig?.docCreateSavePath || '';
        if (fullDefaultPath) {
            fullDefaultPath = fullDefaultPath.trim();
            if (fullDefaultPath.endsWith('/')) {
                fullDefaultPath = fullDefaultPath.slice(0, -1);
            }
            const lastSlashIdx = fullDefaultPath.lastIndexOf('/');
            let titleTemplate = '';
            if (lastSlashIdx >= 0) {
                titleTemplate = fullDefaultPath.substring(lastSlashIdx + 1);
            } else {
                titleTemplate = fullDefaultPath;
            }

            if (titleTemplate) {
                if (titleTemplate.includes('{{')) {
                    resolvedTitle = await renderSprig(titleTemplate);
                } else {
                    resolvedTitle = titleTemplate;
                }
            }
        }
    }

    if (!resolvedTitle) {
        resolvedTitle = '未命名文档';
    }

    let finalPath = '';
    if (resolvedDir === '/') {
        finalPath = '/' + resolvedTitle;
    } else {
        finalPath = resolvedDir + '/' + resolvedTitle;
    }

    finalPath = normalizeDocumentPath(finalPath);

    if (!resolvedNotebook) {
        throw new Error('未提供笔记本ID，且无法读取思源默认新建文档笔记本 docCreateSaveBox');
    }
    if (!finalPath) {
        throw new Error('无法生成或解析文档路径');
    }

    return {
        notebook: resolvedNotebook,
        path: finalPath,
    };
}



export async function siyuan_create_document(
    notebook: string | undefined,
    path: string | undefined,
    title: string | undefined,
    markdown: string
): Promise<string> {
    try {
        const createOptions = await resolveCreateDocumentDefaults(notebook, path, title);

        // 首先创建文档
        const docId = await createDocWithMd(createOptions.notebook, createOptions.path, markdown);

        // 自动打开创建的文档
        try {
            await openBlock(docId);
        } catch (openError) {
            console.warn('打开文档失败，但文档已创建:', openError);
        }

        return docId;
    } catch (error) {
        console.error('Create document error:', error);
        throw new Error(`创建文档失败: ${(error as Error).message}`);
    }
}

/**
 * 创建子文档
 * @param parentId 父文档ID
 * @param title 子文档标题
 * @param markdown 文档内容
 */
export async function siyuan_create_child_document(
    parentId: string,
    title: string,
    markdown: string
): Promise<string> {
    try {
        // 获取父文档信息
        const parentBlock = await getBlockByID(parentId);
        if (!parentBlock) {
            throw new Error(`父文档不存在，ID: ${parentId}`);
        }
        if (parentBlock.type !== 'd') {
            throw new Error(`指定的 parentId 不是文档类型，当前类型: ${parentBlock.type}`);
        }

        // 获取父文档的笔记本和路径
        const notebook = parentBlock.box;
        const parentPath = parentBlock.hpath;

        // 构建子文档路径
        const childTitle = title || '未命名文档';
        const path = `${parentPath}/${childTitle}`;

        // 创建文档
        const docId = await createDocWithMd(notebook, path, markdown);

        // 自动打开创建的文档
        try {
            await openBlock(docId);
        } catch (openError) {
            console.warn('打开文档失败，但文档已创建:', openError);
        }

        return docId;
    } catch (error) {
        console.error('Create child document error:', error);
        throw new Error(`创建子文档失败: ${(error as Error).message}`);
    }
}

/**
 * 列出所有笔记本
 */
export async function siyuan_list_notebooks(): Promise<any> {
    try {
        const result = await lsNotebooks();
        return result;
    } catch (error) {
        console.error('List notebooks error:', error);
        throw new Error(`获取笔记本列表失败: ${(error as Error).message}`);
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
 * 创建笔记本
 */
export async function siyuan_create_notebook(name: string): Promise<any> {
    try {
        const result = await createNotebook(name);
        return result;
    } catch (error) {
        console.error('Create notebook error:', error);
        throw new Error(`创建笔记本失败: ${(error as Error).message}`);
    }
}

/**
 * 重命名文档
 */
export async function siyuan_rename_document(
    id: string,
    title: string
): Promise<string> {
    try {
        const result = await renameDocByID(id, title);
        return result;
    } catch (error) {
        console.error('Rename document error:', error);
        throw new Error(`重命名文档失败: ${(error as Error).message}`);
    }
}

/**
 * 移动文档
 */
export async function siyuan_move_documents(
    fromIDs: string[],
    toID: string
): Promise<any> {
    try {
        if (!fromIDs || fromIDs.length === 0) {
            throw new Error('fromIDs 不能为空');
        }
        if (!toID) {
            throw new Error('toID 不能为空');
        }

        const result = await moveDocsByID(fromIDs, toID);
        return result;
    } catch (error) {
        console.error('Move documents error:', error);
        throw new Error(`移动文档失败: ${(error as Error).message}`);
    }
}

/**
 * 获取块属性
 */
export async function siyuan_get_block_attrs(id: string): Promise<{ [key: string]: string } | any> {
    try {
        const res = await getBlockAttrs(id);
        return res;
    } catch (error) {
        console.error('Get block attrs error:', error);
        throw new Error(`获取块属性失败: ${(error as Error).message}`);
    }
}

/**
 * 设置块属性
 */
export async function siyuan_set_block_attrs(id: string, attrs: { [key: string]: string }): Promise<any> {
    try {
        const result = await setBlockAttrs(id, attrs);
        return result;
    } catch (error) {
        console.error('Set block attrs error:', error);
        throw new Error(`设置块属性失败: ${(error as Error).message}`);
    }
}

// ==================== 数据库属性视图工具实现 ====================

/**
 * 规范化 mSelect 值中的 color 字段
 * 如果 color > 13，则取余数保证范围在 1-13
 */
function normalizeMSelectColor(value: any): any {
    if (!value || typeof value !== 'object') {
        return value;
    }

    // 处理 mSelect 类型
    if (value.mSelect && Array.isArray(value.mSelect)) {
        value.mSelect = value.mSelect.map((item: any) => {
            if (item && item.color !== undefined) {
                const colorNum = parseInt(item.color, 10);
                if (!isNaN(colorNum)) {
                    // 取余数，范围为 1-13
                    const normalizedColor = ((colorNum - 1) % 13) + 1;
                    item.color = String(normalizedColor);
                }
            }
            return item;
        });
    }

    // 处理 select 类型（与 mSelect 类似）
    if (value.select && Array.isArray(value.select)) {
        value.select = value.select.map((item: any) => {
            if (item && item.color !== undefined) {
                const colorNum = parseInt(item.color, 10);
                if (!isNaN(colorNum)) {
                    const normalizedColor = ((colorNum - 1) % 13) + 1;
                    item.color = String(normalizedColor);
                }
            }
            return item;
        });
    }

    return value;
}

/**
 * 搜索数据库
 */
export async function siyuan_search_database(keyword: string, avID?: string): Promise<any> {
    try {
        if (!keyword) {
            throw new Error('keyword参数是必需的');
        }
        const result = await searchAttributeView(keyword, avID);
        return result;
    } catch (error) {
        console.error('Search database error:', error);
        throw new Error(`搜索数据库失败: ${(error as Error).message}`);
    }
}

/**
 * 获取数据库列信息
 */
export async function siyuan_get_database_columns(avID: string): Promise<any> {
    try {
        if (!avID) {
            throw new Error('avID参数是必需的');
        }
        const result = await getAttributeViewKeysByAvID(avID);
        return result;
    } catch (error) {
        console.error('Get database columns error:', error);
        throw new Error(`获取数据库列信息失败: ${(error as Error).message}`);
    }
}

/**
 * 渲染/获取数据库内容
 */
export async function siyuan_render_database(
    avID: string,
    viewID: string,
    pageSize: number = 9999999,
    page: number = 1,
    createIfNotExist: boolean = true
): Promise<any> {
    try {
        if (!avID || !viewID) {
            throw new Error('avID和viewID参数是必需的');
        }
        const result = await renderAttributeView(avID, viewID, pageSize, page, createIfNotExist);
        return result;
    } catch (error) {
        console.error('Render database error:', error);
        throw new Error(`渲染数据库失败: ${(error as Error).message}`);
    }
}

/**
 * 添加数据库行（非绑定行）
 */
export async function siyuan_add_database_rows(avID: string, blocksValues: any[][]): Promise<any> {
    try {
        if (!avID || !blocksValues) {
            throw new Error('avID和blocksValues参数是必需的');
        }
        // 规范化所有值中的 mSelect/select color
        const normalizedBlocksValues = blocksValues.map((row: any[]) => {
            return row.map((cell: any) => {
                if (cell && (cell.mSelect || cell.select)) {
                    return normalizeMSelectColor(cell);
                }
                return cell;
            });
        });
        const result = await appendAttributeViewDetachedBlocksWithValues(avID, normalizedBlocksValues);
        return result;
    } catch (error) {
        console.error('Add database rows error:', error);
        throw new Error(`添加数据库行失败: ${(error as Error).message}`);
    }
}

/**
 * 添加绑定块到数据库
 */
export async function siyuan_add_database_blocks(
    avID: string,
    blockIDs: string[],
    itemIDs?: string[]
): Promise<any> {
    try {
        if (!avID || !blockIDs) {
            throw new Error('avID和blockIDs参数是必需的');
        }
        const srcs = blockIDs.map((id: string, index: number) => ({
            id: id,
            isDetached: false,
            itemID: itemIDs ? itemIDs[index] : id
        }));
        const result = await addAttributeViewBlocks(avID, srcs);
        return result;
    } catch (error) {
        console.error('Add database blocks error:', error);
        throw new Error(`添加数据库绑定块失败: ${(error as Error).message}`);
    }
}

/**
 * 设置数据库单元格值
 */
export async function siyuan_set_database_cell(
    avID: string,
    keyID: string,
    itemID: string,
    value: any
): Promise<any> {
    try {
        if (!avID || !keyID || !itemID || !value) {
            throw new Error('avID、keyID、itemID和value参数是必需的');
        }
        // 规范化 mSelect/select 的 color 值
        const normalizedValue = normalizeMSelectColor(value);
        const result = await setAttributeViewBlockAttr(avID, keyID, itemID, normalizedValue);
        return result;
    } catch (error) {
        console.error('Set database cell error:', error);
        throw new Error(`设置数据库单元格失败: ${(error as Error).message}`);
    }
}

/**
 * 批量设置数据库单元格
 */
export async function siyuan_batch_set_database_cells(
    avID: string,
    values: any[]
): Promise<any> {
    try {
        if (!avID || !Array.isArray(values)) {
            throw new Error('avID和values参数是必需的');
        }
        // 规范化每个值中的 mSelect/select color
        const normalizedValues = values.map((item: any) => {
            const itemID = item?.itemID;
            if (!item?.keyID || !itemID || item.value === undefined) {
                throw new Error('values每项必须包含keyID、itemID和value');
            }
            return {
                keyID: item.keyID,
                itemID: itemID,
                value: normalizeMSelectColor(item.value),
            };
        });
        const result = await batchSetAttributeViewBlockAttrs(avID, normalizedValues);
        return result;
    } catch (error) {
        console.error('Batch set database cells error:', error);
        throw new Error(`批量设置数据库单元格失败: ${(error as Error).message}`);
    }
}

/**
 * 获取块所在的数据库
 */
export async function siyuan_get_block_databases(blockID: string): Promise<any> {
    try {
        if (!blockID) {
            throw new Error('blockID参数是必需的');
        }
        const result = await getAttributeViewKeys(blockID);
        return result;
    } catch (error) {
        console.error('Get block databases error:', error);
        throw new Error(`获取块所在数据库失败: ${(error as Error).message}`);
    }
}

/**
 * 块ID转ItemID
 */
export async function siyuan_convert_blockid_to_itemid(
    avID: string,
    blockIDs: string[]
): Promise<any> {
    try {
        if (!avID || !blockIDs) {
            throw new Error('avID和blockIDs参数是必需的');
        }
        const result = await getAttributeViewItemIDsByBoundIDs(avID, blockIDs);
        return result;
    } catch (error) {
        console.error('Convert blockID to itemID error:', error);
        throw new Error(`块ID转ItemID失败: ${(error as Error).message}`);
    }
}

/**
 * ItemID转块ID
 */
export async function siyuan_convert_itemid_to_blockid(
    avID: string,
    itemIDs: string[]
): Promise<any> {
    try {
        if (!avID || !itemIDs) {
            throw new Error('avID和itemIDs参数是必需的');
        }
        const result = await getAttributeViewBoundBlockIDsByItemIDs(avID, itemIDs);
        return result;
    } catch (error) {
        console.error('Convert itemID to blockID error:', error);
        throw new Error(`ItemID转块ID失败: ${(error as Error).message}`);
    }
}

/**
 * 添加数据库列
 */
export async function siyuan_add_database_column(
    avID: string,
    keyName: string,
    keyType: string,
    previousKeyID: string,
    keyIcon?: string
): Promise<any> {
    try {
        if (!avID || !keyName || !keyType || !previousKeyID) {
            throw new Error('avID、keyName、keyType和previousKeyID参数是必需的');
        }
        // addAttributeViewKey 会自动生成 keyID，keyIcon 默认为空字符串
        const result = await addAttributeViewKey(
            avID,
            keyName,
            keyType,
            previousKeyID,
            undefined, // keyID 自动生成
            keyIcon || "" // keyIcon 默认为空字符串
        );
        return result;
    } catch (error) {
        console.error('Add database column error:', error);
        throw new Error(`添加数据库列失败: ${(error as Error).message}`);
    }
}

/**
 * 删除数据库列
 */
export async function siyuan_remove_database_column(avID: string, keyID: string): Promise<any> {
    try {
        if (!avID || !keyID) {
            throw new Error('avID和keyID参数是必需的');
        }
        const result = await removeAttributeViewKey(avID, keyID);
        return result;
    } catch (error) {
        console.error('Remove database column error:', error);
        throw new Error(`删除数据库列失败: ${(error as Error).message}`);
    }
}

/**
 * 删除数据库行
 */
export async function siyuan_remove_database_rows(avID: string, srcIDs: string[]): Promise<any> {
    try {
        if (!avID || !srcIDs) {
            throw new Error('avID和srcIDs参数是必需的');
        }
        const result = await removeAttributeViewBlocks(avID, srcIDs);
        return result;
    } catch (error) {
        console.error('Remove database rows error:', error);
        throw new Error(`删除数据库行失败: ${(error as Error).message}`);
    }
}

/**
 * 删除块工具
 * @param id 要删除的块ID
 */
export async function siyuan_delete_block(id: string): Promise<any> {
    try {
        if (!id) {
            throw new Error('块ID是必需的');
        }

        const targetBlock = await getBlockByID(id);
        if (!targetBlock) {
            throw new Error(`块不存在: ${id}`);
        }

        // 思源中标题块的“子内容”可能不会随 deleteBlock 自动删除。
        // 对标题块执行递归删除：按 parent_id 收集后代，先删后代，再删标题本身。
        if (targetBlock.type === 'h') {
            const descendants: Array<{ id: string; level: number }> = [];
            const queue: Array<{ id: string; level: number }> = [{ id, level: 0 }];

            // 宽度优先遍历 parent_id 关系，收集整棵子树
            while (queue.length > 0) {
                const current = queue.shift();
                if (!current) break;
                const safeCurrentId = current.id.replace(/'/g, "''");
                const children = await sql(`
                    SELECT id
                    FROM blocks
                    WHERE parent_id = '${safeCurrentId}'
                `);

                for (const child of children || []) {
                    if (!child?.id) continue;
                    const childId = String(child.id);
                    const nextLevel = current.level + 1;
                    descendants.push({ id: childId, level: nextLevel });
                    queue.push({ id: childId, level: nextLevel });
                }
            }

            // 深层后代先删除，避免父级先删导致子级查找/删除异常
            descendants.sort((a, b) => b.level - a.level);

            const deletedIds: string[] = [];
            for (const item of descendants) {
                await deleteBlock(item.id);
                deletedIds.push(item.id);
            }

            const selfResult = await deleteBlock(id);
            deletedIds.push(id);

            return {
                id,
                deletedCount: deletedIds.length,
                deletedIds,
                selfResult,
            };
        }

        const result = await deleteBlock(id);
        return {
            id,
            deletedCount: 1,
            deletedIds: [id],
            selfResult: result,
        };
    } catch (error) {
        console.error('Delete block error:', error);
        throw new Error(`删除块失败: ${(error as Error).message}`);
    }
}

/**
 * 通用思源API调用工具
 * 可以调用任何思源笔记的API
 * @param api API路径，如 '/api/block/insertBlock'
 * @param data 请求数据对象
 */
export async function siyuan_fetch_sync_post(api: string, data: any): Promise<any> {
    try {
        if (!api) {
            throw new Error('API路径是必需的');
        }
        // 确保API路径以 /api/ 开头
        const url = api.startsWith('/api/') ? api : `/api/${api}`;
        const result = await request(url, data || {});
        return result;
    } catch (error) {
        console.error('API call error:', error);
        throw new Error(`API调用失败: ${(error as Error).message}`);
    }
}

/**
 * 发送系统通知
 * @param title 通知标题
 * @param body 通知内容
 * @param delay 延迟时间（秒）或具体时间字符串/Date对象
 * @param timeoutType 超时类型：'default' 或 'never'
 */
export async function siyuan_send_notification(
    title: string,
    body: string,
    delay: number | string = 0,
    timeoutType: 'default' | 'never' = 'default'
): Promise<any> {
    try {
        if (!title) {
            throw new Error('通知标题是必需的');
        }
        console.log(`siyuan_send_notification: title="${title}", delay=${delay}, type=${typeof delay}`);
        const result = await sendNotification(title, body || '', delay, timeoutType);
        return result;
    } catch (error) {
        console.error('Send notification error:', error);
        throw new Error(`发送通知失败: ${(error as Error).message}`);
    }
}

/**
 * 获取当前日期和时间
 * @param format 返回格式，'iso' | 'local' | 'date' | 'time' | 'timestamp'，默认为 'iso'
 */
export async function siyuan_get_current_time(
    format: 'iso' | 'local' | 'date' | 'time' | 'timestamp' = 'local'
): Promise<string> {
    const now = new Date();

    switch (format) {
        case 'iso':
            return now.toISOString();
        case 'local':
            return now.toLocaleString('zh-CN');
        case 'date':
            return now.toISOString().split('T')[0];
        case 'time':
            return now.toTimeString().split(' ')[0];
        case 'timestamp':
            return now.getTime().toString();
        default:
            return now.toISOString();
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
    allowedToolNames?: Iterable<string>
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

            case 'siyuan_sql_query':
                const results = await siyuan_sql_query(args.sql);
                return JSON.stringify(results, null, 2);

            case 'siyuan_insert_block':
                const insertResult = await siyuan_insert_block(
                    args.dataType,
                    args.data,
                    args.parentID,
                    args.appendParentID,
                    args.previousID,
                    args.nextID
                );
                return JSON.stringify(insertResult, null, 2);

            case 'siyuan_update_block':
                const updateResult = await siyuan_update_block(args.dataType, args.data, args.id);
                return JSON.stringify(updateResult, null, 2);

            case 'siyuan_get_block_content':
                return await siyuan_get_block_content(args.id, args.format, args.command);

            case 'siyuan_create_document':
                const docId = await siyuan_create_document(args.notebook, args.path, args.title, args.markdown);
                return `文档创建成功，ID: ${docId}`;

            case 'siyuan_create_child_document':
                const childDocId = await siyuan_create_child_document(args.parentId, args.title, args.markdown);
                return `子文档创建成功，ID: ${childDocId}`;

            case 'siyuan_list_notebooks':
                const notebooks = await siyuan_list_notebooks();
                return JSON.stringify(notebooks, null, 2);

            case 'siyuan_get_doc_tree':
                {
                    const tree = await siyuan_get_doc_tree(args.notebook, args.path || '/', args.sortMode);
                    return JSON.stringify(tree, null, 2);
                }

            case 'siyuan_create_notebook':
                const notebook = await siyuan_create_notebook(args.name);
                return JSON.stringify(notebook, null, 2);

            case 'siyuan_get_block_attrs':
                {
                    const attrs = await siyuan_get_block_attrs(args.id);
                    return JSON.stringify(attrs, null, 2);
                }

            case 'siyuan_set_block_attrs':
                {
                    const setRes = await siyuan_set_block_attrs(args.id, args.attrs);
                    return JSON.stringify(setRes, null, 2);
                }

            case 'siyuan_rename_document':
                const renameResult = await siyuan_rename_document(args.id, args.title);
                return `文档重命名成功，新ID: ${renameResult}`;

            case 'siyuan_move_documents':
                const moveResult = await siyuan_move_documents(args.fromIDs, args.toID);
                return JSON.stringify(moveResult, null, 2);

            // 数据库属性视图工具
            case 'siyuan_search_database':
                const searchDbResult = await siyuan_search_database(args.keyword, args.avID);
                return JSON.stringify(searchDbResult, null, 2);

            case 'siyuan_get_database_columns':
                const columnsResult = await siyuan_get_database_columns(args.avID);
                return JSON.stringify(columnsResult, null, 2);

            case 'siyuan_render_database':
                const renderResult = await siyuan_render_database(
                    args.avID,
                    args.viewID,
                    args.pageSize,
                    args.page,
                    args.createIfNotExist
                );
                return JSON.stringify(renderResult, null, 2);

            case 'siyuan_add_database_rows':
                const addRowsResult = await siyuan_add_database_rows(args.avID, args.blocksValues);
                return JSON.stringify(addRowsResult, null, 2);

            case 'siyuan_add_database_blocks':
                const addBlocksResult = await siyuan_add_database_blocks(
                    args.avID,
                    args.blockIDs,
                    args.itemIDs
                );
                return JSON.stringify(addBlocksResult, null, 2);

            case 'siyuan_set_database_cell':
                const setCellResult = await siyuan_set_database_cell(
                    args.avID,
                    args.keyID,
                    args.itemID,
                    args.value
                );
                return JSON.stringify(setCellResult, null, 2);

            case 'siyuan_batch_set_database_cells':
                const batchSetResult = await siyuan_batch_set_database_cells(args.avID, args.values);
                return JSON.stringify(batchSetResult, null, 2);

            case 'siyuan_get_block_databases':
                const blockDbsResult = await siyuan_get_block_databases(args.blockID);
                return JSON.stringify(blockDbsResult, null, 2);

            case 'siyuan_convert_blockid_to_itemid':
                const blockToItemResult = await siyuan_convert_blockid_to_itemid(
                    args.avID,
                    args.blockIDs
                );
                return JSON.stringify(blockToItemResult, null, 2);

            case 'siyuan_convert_itemid_to_blockid':
                const itemToBlockResult = await siyuan_convert_itemid_to_blockid(
                    args.avID,
                    args.itemIDs
                );
                return JSON.stringify(itemToBlockResult, null, 2);

            case 'siyuan_add_database_column':
                const addColumnResult = await siyuan_add_database_column(
                    args.avID,
                    args.keyName,
                    args.keyType,
                    args.previousKeyID,
                    args.keyIcon
                );
                return JSON.stringify(addColumnResult, null, 2);

            case 'siyuan_remove_database_column':
                const removeColumnResult = await siyuan_remove_database_column(args.avID, args.keyID);
                return JSON.stringify(removeColumnResult, null, 2);

            case 'siyuan_remove_database_rows':
                const removeRowsResult = await siyuan_remove_database_rows(args.avID, args.srcIDs);
                return JSON.stringify(removeRowsResult, null, 2);

            case 'web_fetch':
                const webResult = await web_fetch(args.url, args.useWebView);
                return webResult;

            case 'siyuan_delete_block':
                const deleteResult = await siyuan_delete_block(args.id);
                return JSON.stringify(deleteResult, null, 2);

            case 'siyuan_fetch_sync_post':
                const apiResult = await siyuan_fetch_sync_post(args.api, args.data);
                return JSON.stringify(apiResult, null, 2);

            case 'siyuan_send_notification': {
                // 处理 delay 参数：如果是纯数字字符串，转换为数字
                let delay: number | string = args.delay;
                if (typeof delay === 'string' && /^\d+$/.test(delay)) {
                    delay = parseInt(delay, 10);
                }
                const notifyResult = await siyuan_send_notification(
                    args.title,
                    args.body,
                    delay,
                    args.timeoutType
                );
                return JSON.stringify(notifyResult, null, 2);
            }

            case 'siyuan_get_current_time':
                const timeResult = await siyuan_get_current_time(args.format);
                return timeResult;

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

            default:
                throw new Error(`未知的工具: ${name}`);
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
