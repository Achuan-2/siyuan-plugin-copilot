<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import SettingPanel from '@/libs/components/setting-panel.svelte';
    import { i18n } from './utils/i18n';
    import { getDefaultSettings } from './defaultSettings';
    import {
        pushMsg,
        pushErrMsg,
        lsNotebooks,
        getBlockByID,
        putFile,
        getFileBlob,
        removeFile,
        removeSkill,
        exportMdContent,
        openBlock,
    } from './api';
    import { confirm, Constants, getActiveEditor } from 'siyuan';
    import ProviderConfigPanel from './components/ProviderConfigPanel.svelte';
    import type { CustomProviderConfig } from './defaultSettings';
    import {
        buildSiyuanSkillBlocksMarker,
        extractSiyuanSkillBlockIds,
        loadAllSkills,
        upsertSiyuanSkillBlockIds,
        type Skill,
    } from './tools';
    export let plugin;

    type SkillEditorMode = 'markdown' | 'siyuan-blocks';
    interface SkillContentBlock {
        id: string;
        title: string;
        addedAt: number;
    }

    const DEFAULT_SKILL_FRONTMATTER = `---
name: 我的自定义 Skill
description: 描述这个 Skill 的功能
---`;

    let loadedSkills: Skill[] = [];

    async function refreshSkills() {
        loadedSkills = await loadAllSkills();
    }

    async function openSkillsFolder() {
        try {
            // @ts-ignore
            if (!window?.require) {
                pushErrMsg('当前环境不支持打开本地文件夹，请在思源笔记桌面版中使用此功能。');
                return;
            }
            const skillsDir = '/data/storage/ai/agent/skills';
            // 确保目录存在
            await putFile(skillsDir, true, null);

            // @ts-ignore
            const { shell } = window.require('electron');
            // @ts-ignore
            const path = window.require('path');
            // @ts-ignore
            const dataDir = window.siyuan?.config?.system?.dataDir;
            if (!dataDir) {
                pushErrMsg('无法获取思源笔记数据目录。');
                return;
            }
            const absolutePath = path.join(
                dataDir,
                'storage',
                'ai',
                'agent',
                'skills'
            );
            shell.openPath(absolutePath);
        } catch (e) {
            console.error('Failed to open skills folder:', e);
            pushErrMsg('打开文件夹失败: ' + (e instanceof Error ? e.message : String(e)));
        }
    }

    let showEditor = false;
    let editorSkillId = ''; // 空字符串表示创建新 skill
    let editorContent = '';
    let editorTitle = '';
    let skillIdInput = '';
    let editorMode: SkillEditorMode = 'markdown';
    let skillBlocks: SkillContentBlock[] = [];
    let skillBlockIdInput = '';
    let isAddingSkillBlock = false;
    let isSkillBlockDragOver = false;
    let skillMarkdownTextarea: HTMLTextAreaElement;
    let editorSelectionStart: number | null = null;
    let editorSelectionEnd: number | null = null;

    function hasYamlFrontmatter(content: string): boolean {
        return /^---\r?\n[\s\S]*?\r?\n---/.test(content.trim());
    }

    function buildDefaultMarkdownSkill(): string {
        return `${DEFAULT_SKILL_FRONTMATTER}
# 我的自定义 Skill 指令

1. 第一步...
2. 第二步...
`;
    }

    function buildSkillBlockTitle(content: string, blockId: string): string {
        const preview = content.replace(/\s+/g, ' ').trim();
        if (!preview) return blockId;
        return preview.length > 30 ? `${preview.substring(0, 30)}...` : preview;
    }

    function parseBlockIdList(blockIdText: string): string[] {
        return Array.from(
            new Set(
                (blockIdText || '')
                    .split(/[\s,，]+/)
                    .map(id => id.trim())
                    .filter(id => id && id !== '/')
            )
        );
    }

    function getDroppedSkillBlockIds(event: DragEvent): string[] {
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer) return [];

        const types = Array.from(dataTransfer.types || []);
        const gutterType = types.find(type => type.startsWith(Constants.SIYUAN_DROP_GUTTER));
        if (gutterType) {
            const meta = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, '');
            const info = meta.split(Constants.ZWSP);
            return parseBlockIdList(info[2] || '');
        }

        if (types.some(type => type.startsWith(Constants.SIYUAN_DROP_FILE))) {
            const ele: HTMLElement | undefined = (window as any).siyuan?.dragElement;
            return parseBlockIdList(ele?.innerText || '');
        }

        return [];
    }

    function getFocusedBlockId(): string | null {
        const protyle = getActiveEditor(false)?.protyle;
        return protyle?.block?.id || protyle?.options?.blockId || protyle?.block?.parentID || null;
    }

    async function buildSkillBlocksFromIds(blockIds: string[]): Promise<SkillContentBlock[]> {
        const blocks: SkillContentBlock[] = [];
        for (const blockId of parseBlockIdList(blockIds.join(','))) {
            try {
                const data = await exportMdContent(blockId, false, false, 2, 0, false);
                blocks.push({
                    id: blockId,
                    title: buildSkillBlockTitle(data?.content || '', blockId),
                    addedAt: Date.now(),
                });
            } catch (error) {
                console.error('Load skill block error:', error);
                blocks.push({
                    id: blockId,
                    title: blockId,
                    addedAt: Date.now(),
                });
            }
        }
        return blocks;
    }

    async function setEditorMode(mode: SkillEditorMode) {
        if (editorMode === mode) return;
        editorMode = mode;
        if (mode === 'siyuan-blocks') {
            skillBlocks = await buildSkillBlocksFromIds(extractSiyuanSkillBlockIds(editorContent));
        }
    }

    function rememberEditorSelection() {
        if (!skillMarkdownTextarea) return;
        editorSelectionStart = skillMarkdownTextarea.selectionStart;
        editorSelectionEnd = skillMarkdownTextarea.selectionEnd;
    }

    function syncSkillBlocksToEditorContent(blocks: SkillContentBlock[]) {
        const blockIds = blocks.map(block => block.id);
        const hasExistingMarker = editorContent.includes('siyuan-plugin-copilot:skill-blocks');
        if (
            hasExistingMarker ||
            blockIds.length === 0 ||
            editorSelectionStart === null ||
            editorSelectionEnd === null
        ) {
            editorContent = upsertSiyuanSkillBlockIds(editorContent, blockIds);
            return;
        }

        const marker = buildSiyuanSkillBlocksMarker(blockIds);
        const before = editorContent.slice(0, editorSelectionStart).trimEnd();
        const after = editorContent.slice(editorSelectionEnd).trimStart();
        const insertText = `${before ? '\n\n' : ''}${marker}${after ? '\n\n' : ''}`;
        const nextCursor = before.length + insertText.length;
        editorContent = `${before}${insertText}${after}`;

        setTimeout(() => {
            skillMarkdownTextarea?.focus();
            skillMarkdownTextarea?.setSelectionRange(nextCursor, nextCursor);
            rememberEditorSelection();
        }, 0);
    }

    async function addSkillBlocksByIds(blockIds: string[]) {
        const sourceBlockIds = extractSiyuanSkillBlockIds(editorContent);
        const baseBlockIds =
            sourceBlockIds.length > 0 ? sourceBlockIds : skillBlocks.map(block => block.id);
        const idsToAdd = parseBlockIdList(blockIds.join(',')).filter(
            id => !baseBlockIds.includes(id)
        );

        if (idsToAdd.length === 0) {
            pushMsg('Skill 块已添加');
            return;
        }

        isAddingSkillBlock = true;
        try {
            const existingBlocks =
                sourceBlockIds.length > 0
                    ? await buildSkillBlocksFromIds(sourceBlockIds)
                    : skillBlocks;
            const newBlocks = await buildSkillBlocksFromIds(idsToAdd);
            if (newBlocks.length === 0) return;
            const nextBlocks = [...existingBlocks, ...newBlocks];
            skillBlocks = nextBlocks;
            syncSkillBlocksToEditorContent(nextBlocks);
            pushMsg(
                newBlocks.length === 1
                    ? '已添加 Skill 块'
                    : `已添加 ${newBlocks.length} 个 Skill 块`
            );
        } finally {
            isAddingSkillBlock = false;
            isSkillBlockDragOver = false;
        }
    }

    async function addCurrentBlockAsSkillBlock() {
        const blockId = getFocusedBlockId();
        if (!blockId) {
            pushErrMsg('未找到当前块');
            return;
        }
        await addSkillBlocksByIds([blockId]);
    }

    async function refreshSkillBlocksFromEditorContent() {
        const blockIds = extractSiyuanSkillBlockIds(editorContent);
        skillBlocks = await buildSkillBlocksFromIds(blockIds);
        pushMsg(
            blockIds.length > 0 ? `已从源码同步 ${blockIds.length} 个块` : '源码中未找到思源块标记'
        );
    }

    async function addSkillBlockIdsFromInput() {
        const blockIds = parseBlockIdList(skillBlockIdInput);
        if (blockIds.length === 0) {
            pushErrMsg('请输入块 ID');
            return;
        }
        await addSkillBlocksByIds(blockIds);
        skillBlockIdInput = '';
    }

    function removeSkillBlock(blockId: string) {
        const nextBlocks = skillBlocks.filter(block => block.id !== blockId);
        skillBlocks = nextBlocks;
        syncSkillBlocksToEditorContent(nextBlocks);
    }

    function moveSkillBlock(blockId: string, direction: -1 | 1) {
        const index = skillBlocks.findIndex(block => block.id === blockId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= skillBlocks.length) return;
        const nextBlocks = [...skillBlocks];
        [nextBlocks[index], nextBlocks[nextIndex]] = [nextBlocks[nextIndex], nextBlocks[index]];
        skillBlocks = nextBlocks;
        syncSkillBlocksToEditorContent(nextBlocks);
    }

    async function handleOpenSkillBlock(blockId: string) {
        try {
            await openBlock(blockId);
        } catch (error) {
            console.error('Open skill block error:', error);
            pushErrMsg(`打开块失败: ${blockId}`);
        }
    }

    function showSkillBlockFloatLayer(blockId: string, event: MouseEvent) {
        const targetElement = event.currentTarget as HTMLElement | null;
        if (!targetElement || typeof plugin?.addFloatLayer !== 'function') {
            return;
        }

        try {
            targetElement.dataset.type = 'block-ref';
            targetElement.dataset.id = blockId;
            targetElement.setAttribute('prevent-popover', 'true');
            plugin.addFloatLayer({
                refDefs: [{ refID: blockId, defIDs: [] }],
                targetElement,
                isBacklink: false,
            });
        } catch (error) {
            console.error('Show skill block float layer error:', error);
        }
    }

    function handleSkillBlockDragOver(event: DragEvent) {
        if (getDroppedSkillBlockIds(event).length > 0) {
            event.preventDefault();
            isSkillBlockDragOver = true;
        }
    }

    function handleSkillBlockDragLeave(event: DragEvent) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        if (
            event.clientX <= rect.left ||
            event.clientX >= rect.right ||
            event.clientY <= rect.top ||
            event.clientY >= rect.bottom
        ) {
            isSkillBlockDragOver = false;
        }
    }

    async function handleSkillBlockDrop(event: DragEvent) {
        event.preventDefault();
        const blockIds = getDroppedSkillBlockIds(event);
        isSkillBlockDragOver = false;
        if (blockIds.length === 0) return;

        await addSkillBlocksByIds(blockIds);
        if (
            Array.from(event.dataTransfer?.types || []).some(type =>
                type.startsWith(Constants.SIYUAN_DROP_FILE)
            )
        ) {
            (window as any).siyuan.dragElement = undefined;
        }
    }

    async function openSkillFolder(skillId: string) {
        try {
            // @ts-ignore
            if (!window?.require) {
                pushErrMsg('当前环境不支持打开本地文件夹，请在思源笔记桌面版中使用此功能。');
                return;
            }
            // @ts-ignore
            const { shell } = window.require('electron');
            // @ts-ignore
            const path = window.require('path');
            // @ts-ignore
            const dataDir = window.siyuan?.config?.system?.dataDir;
            if (!dataDir) {
                pushErrMsg('无法获取思源笔记数据目录。');
                return;
            }
            const absolutePath = path.join(
                dataDir,
                'storage',
                'petal',
                'siyuan-plugin-copilot',
                'skills',
                skillId
            );
            shell.openPath(absolutePath);
        } catch (e) {
            console.error('Failed to open skill folder:', e);
            pushErrMsg('打开文件夹失败: ' + (e instanceof Error ? e.message : String(e)));
        }
    }

    async function startEditSkill(skill: Skill) {
        try {
            const blob = await getFileBlob(skill.filePath);
            let content = '';
            if (blob) {
                content = await blob.text();
            }
            const blockIds = skill.blockIds?.length
                ? skill.blockIds
                : extractSiyuanSkillBlockIds(content);
            editorSkillId = skill.id;
            skillIdInput = skill.id;
            editorMode = blockIds.length > 0 ? 'siyuan-blocks' : 'markdown';
            editorContent = content;
            skillBlocks =
                editorMode === 'siyuan-blocks' ? await buildSkillBlocksFromIds(blockIds) : [];
            skillBlockIdInput = '';
            editorTitle = '编辑 Skill: ' + skill.name;
            showEditor = true;
        } catch (e) {
            console.error('Failed to load skill content:', e);
            pushErrMsg('加载 Skill 内容失败: ' + (e instanceof Error ? e.message : String(e)));
        }
    }

    function startCreateSkill() {
        editorSkillId = '';
        skillIdInput = '';
        editorMode = 'markdown';
        skillBlocks = [];
        skillBlockIdInput = '';
        editorContent = buildDefaultMarkdownSkill();
        editorTitle = '创建自定义 Skill';
        showEditor = true;
    }

    async function saveSkill() {
        const normalizedId = skillIdInput.trim().replace(/[\\/:*?"<>|]/g, '');
        if (!normalizedId) {
            pushErrMsg('请输入有效的 Skill 标识符（不能包含 \\ / : * ? " < > | 等非法字符）');
            return;
        }

        if (!hasYamlFrontmatter(editorContent)) {
            pushErrMsg('Skill 内容必须包含 YAML 头信息 (Frontmatter)');
            return;
        }

        try {
            const skillFilePath = `/data/storage/ai/agent/skills/${normalizedId}/skill.md`;
            const fileBlob = new Blob([editorContent], { type: 'text/markdown' });
            await putFile(skillFilePath, false, fileBlob);

            pushMsg('保存成功');
            showEditor = false;
            await refreshSkills();
        } catch (e) {
            console.error('Failed to save skill:', e);
            pushErrMsg('保存 Skill 失败: ' + (e instanceof Error ? e.message : String(e)));
        }
    }

    async function deleteSkill(skill: Skill) {
        confirm(
            '确定删除',
            `确定要删除 Skill "${skill.name}" (${skill.id}) 吗？此操作无法撤销。`,
            async () => {
                try {
                    await removeSkill(skill.id);
                    pushMsg('删除成功');
                    await refreshSkills();
                } catch (e) {
                    console.error('Failed to delete skill:', e);
                    pushErrMsg('删除 Skill 失败: ' + (e instanceof Error ? e.message : String(e)));
                }
            }
        );
    }

    // 使用动态默认设置
    let settings = { ...getDefaultSettings() };

    // 笔记本列表
    let notebookOptions: Record<string, string> = {};

    // SOUL 文档验证状态
    let soulDocValidation: { status: 'idle' | 'checking' | 'valid' | 'invalid'; message: string } =
        {
            status: 'idle',
            message: '',
        };

    interface ISettingGroup {
        name: string;
        items: ISettingItem[];
        //  Type："checkbox" | "select" | "textinput" | "textarea" | "number" | "slider" | "button" | "hint" | "custom";
    }

    const builtInProviderNames: Record<string, string> = {
        Achuan: i18n('platform.builtIn.Achuan'),
        gemini: i18n('platform.builtIn.gemini'),
        openai: i18n('platform.builtIn.openai'),
        deepseek: i18n('platform.builtIn.deepseek'),
        moonshot: i18n('platform.builtIn.moonshot'),
        volcano: i18n('platform.builtIn.volcano'),
        minimax: i18n('platform.builtIn.minimax'),
    };

    // 内置平台的默认 API 地址
    const builtInProviderDefaultUrls: Record<string, string> = {
        Achuan: 'https://gpt.achuan-2.top/',
        gemini: 'https://generativelanguage.googleapis.com',
        deepseek: 'https://api.deepseek.com',
        moonshot: 'https://api.moonshot.cn',
        openai: 'https://api.openai.com',
        volcano: 'https://ark.cn-beijing.volces.com',
        minimax: 'https://api.minimaxi.com',
    };

    // 内置平台的官网链接
    const builtInProviderWebsites: Record<string, string> = {
        Achuan: 'https://gpt.achuan-2.top/register?aff=ZndO',
        gemini: 'https://aistudio.google.com/apikey',
        deepseek: 'https://platform.deepseek.com/',
        moonshot: 'https://platform.moonshot.cn/',
        openai: 'https://platform.openai.com/',
        volcano: 'https://console.volcengine.com/ark',
        minimax: 'https://platform.minimaxi.com/',
    };

    // 当前选中的平台ID
    let selectedProviderId = '';

    // 新增自定义平台相关状态
    let showAddPlatform = false;
    let newPlatformName = '';
    let platformSearchQuery = '';

    // 拖拽排序相关状态
    let dragOverIndex: number | null = null;
    let dragSourceIndex: number | null = null;
    let dragSourceId: string | null = null;

    // 平台右键菜单状态
    let contextMenuPlatformId: string | null = null;
    let contextMenuPosition = { x: 0, y: 0 };

    function closePlatformContextMenu() {
        contextMenuPlatformId = null;
    }

    function openPlatformContextMenu(event: MouseEvent, platformId: string) {
        event.preventDefault();
        event.stopPropagation();

        const menuWidth = 140;
        const menuHeight = 44;
        const gap = 8;

        let x = event.clientX;
        let y = event.clientY;

        if (x + menuWidth > window.innerWidth - gap) {
            x = Math.max(gap, window.innerWidth - menuWidth - gap);
        }
        if (y + menuHeight > window.innerHeight - gap) {
            y = Math.max(gap, window.innerHeight - menuHeight - gap);
        }

        contextMenuPosition = { x, y };
        contextMenuPlatformId = platformId;
    }

    function deletePlatformFromContextMenu() {
        if (!contextMenuPlatformId) return;
        const providerId = contextMenuPlatformId;
        closePlatformContextMenu();
        removePlatform(providerId);
    }

    // 处理拖拽开始
    function handleDragStart(e: DragEvent, index: number, providerId: string) {
        dragSourceIndex = index;
        dragSourceId = providerId;
        e.dataTransfer?.setData('text/plain', providerId);
        e.dataTransfer!.effectAllowed = 'move';
    }

    // 处理拖拽进入
    function handleDragEnter(index: number) {
        if (index !== dragSourceIndex) {
            dragOverIndex = index;
        }
    }

    // 处理拖拽结束
    function handleDragEnd() {
        dragOverIndex = null;
        dragSourceIndex = null;
        dragSourceId = null;
    }

    // 处理放置
    function handleDrop(e: DragEvent, targetIndex: number) {
        if (platformSearchQuery.trim()) {
            return;
        }
        e.preventDefault();
        dragOverIndex = null;

        if (dragSourceIndex === null || dragSourceIndex === targetIndex) {
            return;
        }

        // 重新排序
        const items = [...allProviderOptions];
        const [removed] = items.splice(dragSourceIndex, 1);
        items.splice(targetIndex, 0, removed);

        // 保存新顺序
        const newOrder = items.map(p => p.id);
        settings = {
            ...settings,
            aiProviders: {
                ...settings.aiProviders,
                providerOrder: newOrder,
            },
        };

        saveSettings();
        pushMsg(i18n('platform.reorderSuccess') || '平台顺序已更新');
    }

    // 处理拖拽悬停（防止默认行为）
    function handleDragOver(e: DragEvent) {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
    }

    function handleProviderChange() {
        saveSettings();
    }

    // 处理平台重命名
    function handleProviderRename(providerId: string, newName: string) {
        const provider = settings.aiProviders.customProviders.find(p => p.id === providerId);
        if (provider) {
            provider.name = newName;
            // 触发响应式更新
            settings = {
                ...settings,
                aiProviders: {
                    ...settings.aiProviders,
                    customProviders: [...settings.aiProviders.customProviders],
                },
            };
            saveSettings();
            pushMsg(`平台已重命名为: ${newName}`);
        }
    }

    // 生成自定义平台ID
    function generateCustomPlatformId(): string {
        return `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // 添加自定义平台
    function addCustomPlatform() {
        if (!newPlatformName.trim()) {
            pushErrMsg(i18n('platform.nameRequired'));
            return;
        }

        const newPlatform: CustomProviderConfig = {
            id: generateCustomPlatformId(),
            name: newPlatformName.trim(),
            apiKey: '',
            customApiUrl: '',
            models: [],
            enabled: true,
        };

        // 使用响应式更新确保 Svelte 检测到变化
        settings = {
            ...settings,
            aiProviders: {
                ...settings.aiProviders,
                customProviders: [...settings.aiProviders.customProviders, newPlatform],
            },
            // 自动选中新创建的平台（仅设置面板，不影响对话）
            selectedProviderId: newPlatform.id,
        };

        // 更新本地选中状态
        selectedProviderId = newPlatform.id;

        newPlatformName = '';
        showAddPlatform = false;
        saveSettings();
        pushMsg(i18n('aiSidebar.success.addPromptSuccess') + `: ${newPlatform.name}`);
    }

    function updateProviderEnabled(providerId: string, enabled: boolean) {
        if (builtInProviderNames[providerId]) {
            const providerConfig = settings.aiProviders?.[providerId];
            if (!providerConfig) return;

            settings = {
                ...settings,
                aiProviders: {
                    ...settings.aiProviders,
                    [providerId]: {
                        ...providerConfig,
                        enabled,
                    },
                },
            };
            saveSettings();
            return;
        }

        const customProviders = settings.aiProviders?.customProviders || [];
        const providerIndex = customProviders.findIndex(p => p.id === providerId);
        if (providerIndex === -1) return;

        const updatedProviders = [...customProviders];
        updatedProviders[providerIndex] = {
            ...updatedProviders[providerIndex],
            enabled,
        };

        settings = {
            ...settings,
            aiProviders: {
                ...settings.aiProviders,
                customProviders: updatedProviders,
            },
        };
        saveSettings();
    }

    function handleProviderEnabledChange(providerId: string, event: Event) {
        const target = event.currentTarget as HTMLInputElement;
        updateProviderEnabled(providerId, target.checked);
    }

    // 删除平台（由右键菜单触发）
    function removePlatform(providerId: string) {
        const platformName =
            builtInProviderNames[providerId] ||
            settings.aiProviders?.customProviders?.find(p => p.id === providerId)?.name ||
            i18n('platform.unknown');

        confirm(
            i18n('aiSidebar.confirm.deletePlatform.title'),
            i18n('aiSidebar.confirm.deletePlatform.message', { platformName }),
            async () => {
                // 检查是否需要清空当前选中的模型
                // 只有当删除的平台是当前正在使用的平台时才清空模型选择
                const shouldClearModel = settings.currentProvider === providerId;

                // 内置平台：仅禁用；自定义平台：从列表中移除
                if (builtInProviderNames[providerId]) {
                    const providerConfig = settings.aiProviders?.[providerId];
                    if (providerConfig) {
                        const disabledBuiltIn =
                            settings.aiProviders?.disabledBuiltInProviders || [];
                        const nextDisabledBuiltIn = disabledBuiltIn.includes(providerId)
                            ? disabledBuiltIn
                            : [...disabledBuiltIn, providerId];
                        settings = {
                            ...settings,
                            aiProviders: {
                                ...settings.aiProviders,
                                [providerId]: {
                                    ...providerConfig,
                                    enabled: false,
                                },
                                disabledBuiltInProviders: nextDisabledBuiltIn,
                            },
                        };
                    }
                } else {
                    // 如果是自定义平台，从列表中移除
                    // 使用响应式更新确保 Svelte 检测到变化
                    const filteredProviders = settings.aiProviders.customProviders.filter(
                        p => p.id !== providerId
                    );
                    settings = {
                        ...settings,
                        aiProviders: {
                            ...settings.aiProviders,
                            customProviders: filteredProviders,
                        },
                    };
                }

                // 如果删除的是当前选中的平台（在设置面板中），清空面板选择
                if (selectedProviderId === providerId) {
                    selectedProviderId = '';
                    settings.selectedProviderId = '';
                }

                // 只有当删除的平台是当前对话使用的平台时，才清空对话中的平台和模型选择
                if (shouldClearModel) {
                    settings = {
                        ...settings,
                        currentProvider: '',
                        currentModelId: '',
                    };
                }

                saveSettings();
                pushMsg(i18n('aiSidebar.success.deletePromptSuccess') + `: ${platformName}`);
            }
        );
    }

    // 获取所有平台选项（内置+自定义） - 使用响应式语句
    $: allProviderOptions = (() => {
        const deletedBuiltIn = settings.aiProviders?.disabledBuiltInProviders || [];

        // Achuan 平台已下架：只有已配置的旧用户才显示
        const achuanConfig = settings.aiProviders?.Achuan;
        const showAchuan =
            !!achuanConfig?.apiKey ||
            achuanConfig?.models?.length > 0 ||
            !!achuanConfig?.customApiUrl;

        const builtIn = Object.keys(builtInProviderNames)
            .filter(id => {
                if (id === 'Achuan' && !showAchuan) {
                    return false;
                }
                return !deletedBuiltIn.includes(id);
            })
            .map(id => ({
                id,
                name: builtInProviderNames[id],
                type: 'built-in' as const,
                enabled: settings.aiProviders?.[id]?.enabled !== false,
            }));

        const custom = (settings.aiProviders?.customProviders || []).map(
            (p: CustomProviderConfig) => ({
                id: p.id,
                name: p.name,
                type: 'custom' as const,
                enabled: p.enabled !== false,
            })
        );

        const allProviders = [...builtIn, ...custom];

        // 根据保存的顺序排序
        const savedOrder = settings.aiProviders?.providerOrder || [];
        if (savedOrder.length > 0) {
            // 创建ID到位置的映射
            const orderMap = new Map(savedOrder.map((id, index) => [id, index]));
            // 按顺序排序，未在顺序中的放到最后
            allProviders.sort((a, b) => {
                const orderA = orderMap.get(a.id);
                const orderB = orderMap.get(b.id);
                if (orderA !== undefined && orderB !== undefined) {
                    return orderA - orderB;
                }
                if (orderA !== undefined) return -1;
                if (orderB !== undefined) return 1;
                return 0;
            });
        }

        return allProviders;
    })();

    // 平台搜索过滤（保留原始索引，便于拖拽排序）
    $: displayedProviderOptions = (() => {
        const query = platformSearchQuery.trim().toLowerCase();
        const withIndex = allProviderOptions.map((platform, index) => ({ platform, index }));
        if (!query) return withIndex;

        return withIndex.filter(({ platform }) =>
            `${platform.name} ${platform.id}`.toLowerCase().includes(query)
        );
    })();

    // 获取当前选中平台的名称 - 使用响应式语句
    $: selectedProviderName = (() => {
        if (!selectedProviderId) return i18n('platform.select');

        if (builtInProviderNames[selectedProviderId]) {
            return builtInProviderNames[selectedProviderId];
        }

        const customProvider = settings.aiProviders?.customProviders?.find(
            (p: CustomProviderConfig) => p.id === selectedProviderId
        );
        return customProvider?.name || i18n('platform.unknown');
    })();

    // 保存选中的平台ID（仅在设置面板中选择平台，不影响对话中的当前平台）
    function handleProviderSelect() {
        // 使用响应式更新确保 Svelte 检测到变化
        settings = {
            ...settings,
            selectedProviderId: selectedProviderId,
        };
        saveSettings();
    }

    let groups: ISettingGroup[] = [
        {
            name: i18n('settings.settingsGroup.systemPrompt'),
            items: [
                {
                    key: 'aiSystemPrompt',
                    value: settings.aiSystemPrompt,
                    type: 'textarea',
                    title: i18n('settings.ai.systemPrompt.title'),
                    description: i18n('settings.ai.systemPrompt.description'),
                    direction: 'row',
                    rows: 4,
                    placeholder: i18n('settings.ai.systemPrompt.placeholder'),
                },
            ],
        },
        {
            name: i18n('settings.settingsGroup.platformManagement'),
            items: [],
        },
        {
            name: i18n('settings.settingsGroup.displayAndOperation'),
            items: [
                {
                    key: 'sendMessageShortcut',
                    value: settings.sendMessageShortcut,
                    type: 'select',
                    title: i18n('settings.sendMessageShortcut.title'),
                    description: i18n('settings.sendMessageShortcut.description'),
                    options: {
                        'ctrl+enter': i18n('settings.sendMessageShortcut.options.ctrlEnter'),
                        enter: i18n('settings.sendMessageShortcut.options.enter'),
                    },
                },
                {
                    key: 'messageFontSize',
                    value: settings.messageFontSize,
                    type: 'number',
                    title: i18n('settings.messageFontSize.title'),
                    description: i18n('settings.messageFontSize.description'),
                    number: {
                        min: 5,
                        max: 32,
                        step: 1,
                    },
                },
                {
                    key: 'multiModelViewMode',
                    value: settings.multiModelViewMode,
                    type: 'select',
                    title: i18n('settings.multiModelViewMode.title'),
                    description: i18n('settings.multiModelViewMode.description'),
                    options: {
                        tab: i18n('settings.multiModelViewMode.options.tab'),
                        card: i18n('settings.multiModelViewMode.options.card'),
                    },
                },
            ],
        },
        {
            name: i18n('settings.settingsGroup.noteExport'),
            items: [
                {
                    key: 'exportNotebook',
                    value: settings.exportNotebook,
                    type: 'select',
                    title: i18n('settings.exportNotebook.title'),
                    description: i18n('settings.exportNotebook.description'),
                    options: notebookOptions,
                },
                {
                    key: 'exportDefaultPath',
                    value: settings.exportDefaultPath,
                    type: 'textinput',
                    title: i18n('settings.exportDefaultPath.title'),
                    description: i18n('settings.exportDefaultPath.description'),
                    placeholder: i18n('settings.exportDefaultPath.placeholder'),
                },
            ],
        },
        {
            name: i18n('settings.settingsGroup.sessionManagement') || '会话管理',
            items: [
                {
                    key: 'autoRenameSession',
                    value: settings.autoRenameSession,
                    type: 'checkbox',
                    title: i18n('settings.autoRenameSession.title') || '会话自动重命名',
                    description:
                        i18n('settings.autoRenameSession.description') ||
                        '在首次发送消息时，自动使用AI生成会话标题',
                },
            ],
        },
        {
            name: i18n('settings.settingsGroup.translate') || '翻译设置',
            items: [
                {
                    key: 'translateTemperature',
                    value: settings.translateTemperature,
                    type: 'number',
                    title: i18n('settings.translate.temperature.title') || '翻译 Temperature',
                    description:
                        i18n('settings.translate.temperature.description') ||
                        '翻译专用的 temperature 参数（0-2），为空则使用模型默认值。值越小，翻译越准确一致；值越大，翻译越灵活多样',
                    number: {
                        min: 0,
                        max: 2,
                        step: 0.1,
                    },
                },
                {
                    key: 'translatePrompt',
                    value: settings.translatePrompt,
                    type: 'textarea',
                    title: i18n('settings.translate.prompt.title') || '翻译提示词',
                    description:
                        i18n('settings.translate.prompt.description') ||
                        '翻译时使用的提示词模板，${content} 会被替换为要翻译的内容',
                    direction: 'row',
                    rows: 8,
                    placeholder:
                        i18n('settings.translate.prompt.placeholder') || '输入翻译提示词模板...',
                },
            ],
        },
        {
            name: i18n('settings.settingsGroup.tools') || '工具设置',
            items: [
                {
                    key: 'pythonPath',
                    value: settings.pythonPath,
                    type: 'textinput',
                    title: i18n('settings.pythonPath.title') || 'Python 解释器路径',
                    description:
                        i18n('settings.pythonPath.description') ||
                        '设置 Python 可执行文件的路径，用于运行 Python 代码工具。留空则使用系统默认的 python 命令',
                    placeholder:
                        i18n('settings.pythonPath.placeholder') ||
                        '例如：C:\\Python311\\python.exe 或 /usr/bin/python3',
                },
            ],
        },
        {
            name: i18n('settings.settingsGroup.soul') || 'SOUL 文档',
            items: [
                {
                    key: 'soulDocId',
                    value: settings.soulDocId,
                    type: 'textinput',
                    title: i18n('settings.soulDocId.title') || 'SOUL 文档 ID',
                    description:
                        i18n('settings.soulDocId.description') ||
                        '设置 SOUL 数据存储的文档 ID。SOUL 工具只能在此文档内进行增删改查操作。',
                    placeholder:
                        i18n('settings.soulDocId.placeholder') ||
                        '输入文档块 ID，如 20260312120000-xxxxxxxx',
                },
            ],
        },
        {
            name: i18n('settings.settingsGroup.webApp') || '网页小程序',
            items: [
                {
                    key: 'openLinksInWebView',
                    value: settings.openLinksInWebView,
                    type: 'checkbox',
                    title: i18n('settings.openLinksInWebView.title') || '在 WebView 中打开链接',
                    description:
                        i18n('settings.openLinksInWebView.description') ||
                        '点击思源笔记中的 https 链接时，在内置 WebView 标签页中打开，而不是外部浏览器',
                },
                {
                    key: 'searchEngine',
                    value: settings.searchEngine,
                    type: 'select',
                    title: '搜索引擎',
                    description: '选择地址栏使用的默认搜索引擎',
                    options: {
                        google: 'Google',
                        bing: 'Bing',
                    },
                },
            ],
        },
        {
            name: '自定义 Skill',
            items: [],
        },
        {
            name: i18n('settings.settingsGroup.reset') || 'Reset Settings',
            items: [
                {
                    key: 'reset',
                    value: '',
                    type: 'button',
                    title: i18n('settings.reset.title') || 'Reset Settings',
                    description:
                        i18n('settings.reset.description') ||
                        'Reset all settings to default values',
                    button: {
                        label: i18n('settings.reset.label') || 'Reset',
                        callback: async () => {
                            confirm(
                                i18n('settings.reset.title') || 'Reset Settings',
                                i18n('settings.reset.confirmMessage') ||
                                    'Are you sure you want to reset all settings to default values? This action cannot be undone.',
                                async () => {
                                    // 确认回调
                                    settings = { ...getDefaultSettings() };
                                    updateGroupItems();
                                    await saveSettings();
                                    await pushMsg(i18n('settings.reset.message'));
                                },
                                () => {
                                    // 取消回调（可选）
                                    console.log('Reset cancelled');
                                }
                            );
                        },
                    },
                },
            ],
        },
        {
            name: '❤️用爱发电',
            items: [
                {
                    key: 'donateInfo',
                    value: '',
                    type: 'hint',
                    title: '用爱发电',
                    description: `
                        <p style="margin-top:12px;">如果喜欢我的插件，欢迎给GitHub仓库点star和微信赞赏，这会激励我继续完善此插件和开发新插件。</p>

                        <p style="margin-top:12px;">维护插件费时费力，个人时间和精力有限，开源只是分享，不等于我要浪费我的时间免费帮用户实现ta需要的功能，</p>

                        <p style="margin-top:12px;">我需要的功能我会慢慢改进（打赏可以催更），有些我觉得可以改进、但是现阶段不必要的功能需要打赏才改进（会标注打赏标签和需要打赏金额），而不需要的功能、实现很麻烦的功能会直接关闭issue不考虑实现，我没实现的功能欢迎有大佬来pr</p>

                        <p style="margin-top:12px;">累积赞赏50元的朋友如果想加我微信和进粉丝交流群，可以在赞赏的时候备注微信号，或者发邮件到<a href="mailto:achuan-2@outlook.com">achuan-2@outlook.com</a>来进行好友申请</p>
                        
                        <div style="margin-top:12px;">
                        <img src="plugins/siyuan-plugin-copilot/assets/donate.png" alt="donate" style="max-width:260px; height:auto; border:1px solid var(--b3-border-color);"/>
                        </div>
                    `,
                },
            ],
        },
    ];

    let focusGroup = groups[0].name;

    interface ChangeEvent {
        group: string;
        key: string;
        value: any;
    }

    const onChanged = ({ detail }: CustomEvent<ChangeEvent>) => {
        console.log(detail.key, detail.value);
        // 使用 in 操作符检查 key 是否存在，而不是检查值是否为 undefined
        // 这样可以正确处理值为 undefined 的设置项（如 translateTemperature）
        if (detail.key in settings) {
            settings[detail.key] = detail.value;
            saveSettings();
        }
    };

    async function saveSettings() {
        await plugin.saveSettings(settings);
    }

    onMount(async () => {
        await runload();
        document.addEventListener('click', closePlatformContextMenu);
        window.addEventListener('blur', closePlatformContextMenu);
    });

    onDestroy(() => {
        document.removeEventListener('click', closePlatformContextMenu);
        window.removeEventListener('blur', closePlatformContextMenu);
    });

    async function runload() {
        const loadedSettings = await plugin.loadSettings();
        settings = { ...loadedSettings };

        // 确保 aiProviders 存在
        if (!settings.aiProviders) {
            settings.aiProviders = {
                gemini: { apiKey: '', customApiUrl: '', models: [], enabled: true },
                deepseek: { apiKey: '', customApiUrl: '', models: [], enabled: true },
                openai: { apiKey: '', customApiUrl: '', models: [], enabled: true },
                moonshot: { apiKey: '', customApiUrl: '', models: [], enabled: true },
                volcano: { apiKey: '', customApiUrl: '', models: [], enabled: true },
                Achuan: { apiKey: '', customApiUrl: '', models: [], enabled: true },
                minimax: { apiKey: '', customApiUrl: '', models: [], enabled: true },
                customProviders: [],
                disabledBuiltInProviders: [],
                providerOrder: [],
            };
        }

        // 确保每个内置平台都存在（支持旧配置升级）
        const builtInPlatformIds = [
            'Achuan',
            'gemini',
            'deepseek',
            'openai',
            'moonshot',
            'volcano',
            'minimax',
        ];
        for (const platformId of builtInPlatformIds) {
            if (!settings.aiProviders[platformId]) {
                settings.aiProviders[platformId] = {
                    apiKey: '',
                    customApiUrl: '',
                    models: [],
                    enabled: true,
                };
            }
            if (typeof settings.aiProviders[platformId].enabled !== 'boolean') {
                settings.aiProviders[platformId].enabled = true;
            }
        }

        // 确保 customProviders 数组存在
        if (!settings.aiProviders.customProviders) {
            settings.aiProviders.customProviders = [];
        }
        settings.aiProviders.customProviders = settings.aiProviders.customProviders.map(
            provider => ({
                ...provider,
                enabled: provider.enabled !== false,
            })
        );

        // 确保 disabledBuiltInProviders 数组存在
        if (!settings.aiProviders.disabledBuiltInProviders) {
            settings.aiProviders.disabledBuiltInProviders = [];
        }
        // 兼容旧配置：disabledBuiltInProviders -> provider.enabled = false
        const disabledBuiltIn = settings.aiProviders.disabledBuiltInProviders || [];
        for (const platformId of disabledBuiltIn) {
            if (settings.aiProviders[platformId]) {
                settings.aiProviders[platformId].enabled = false;
            }
        }

        // 确保 providerOrder 数组存在
        if (!settings.aiProviders.providerOrder) {
            settings.aiProviders.providerOrder = [];
        }

        // 恢复选中的平台ID（仅用于设置面板显示）
        // 优先使用 selectedProviderId，如果不存在则使用 currentProvider 作为初始值
        selectedProviderId = settings.selectedProviderId || settings.currentProvider || 'openai';

        // 确保 selectedProviderId 设置被保存
        if (!settings.selectedProviderId) {
            settings.selectedProviderId = selectedProviderId;
        }

        // 加载笔记本列表
        await loadNotebooks();

        // 如果有设置 SOUL 文档 ID，自动验证
        if (settings.soulDocId) {
            await validateSoulDocId();
        }

        await refreshSkills();

        updateGroupItems();
    }

    // 加载笔记本列表
    async function loadNotebooks() {
        try {
            const notebooks = await lsNotebooks();
            if (notebooks?.notebooks && notebooks.notebooks.length > 0) {
                // 构建笔记本选项对象 { id: name }，只显示 closed=false 的笔记本
                notebookOptions = {};
                notebookOptions[''] =
                    i18n('settings.exportNotebook.placeholder') || '-- 请选择笔记本 --';
                notebooks.notebooks
                    .filter(notebook => notebook.closed === false)
                    .forEach(notebook => {
                        notebookOptions[notebook.id] = notebook.name;
                    });
            } else {
                notebookOptions = {
                    '': i18n('settings.exportNotebook.placeholder') || '-- 请选择笔记本 --',
                };
            }
        } catch (error) {
            console.error('Load notebooks error:', error);
            notebookOptions = {
                '': i18n('settings.exportNotebook.placeholder') || '-- 请选择笔记本 --',
            };
        }
    }

    /**
     * 验证 SOUL 文档 ID
     */
    async function validateSoulDocId() {
        const docId = settings.soulDocId?.trim();
        if (!docId) {
            soulDocValidation = { status: 'idle', message: '' };
            return;
        }

        soulDocValidation = {
            status: 'checking',
            message: i18n('settings.soulDocId.validating') || '验证中...',
        };

        try {
            const block = await getBlockByID(docId);
            if (!block) {
                soulDocValidation = {
                    status: 'invalid',
                    message: i18n('settings.soulDocId.notFound') || '块不存在，请检查 ID 是否正确',
                };
                return;
            }

            if (block.type !== 'd') {
                soulDocValidation = {
                    status: 'invalid',
                    message:
                        i18n('settings.soulDocId.notDoc') ||
                        `该 ID 不是文档类型，当前类型: ${block.type}`,
                };
                return;
            }

            soulDocValidation = {
                status: 'valid',
                message:
                    i18n('settings.soulDocId.valid') || `✓ 有效文档: ${block.content || '未命名'}`,
            };
        } catch (error) {
            soulDocValidation = {
                status: 'invalid',
                message:
                    i18n('settings.soulDocId.error') || '验证失败: ' + (error as Error).message,
            };
        }
    }

    function updateGroupItems() {
        groups = groups.map(group => ({
            ...group,
            items: group.items.map(item => {
                const updatedItem: any = {
                    ...item,
                    value: settings[item.key] ?? item.value,
                };
                // 为笔记本选择器更新 options
                if (item.key === 'exportNotebook') {
                    updatedItem.options = notebookOptions;
                }
                return updatedItem;
            }),
        }));
    }

    $: currentGroup = groups.find(group => group.name === focusGroup);
</script>

<div class="fn__flex-1 fn__flex config__panel">
    <ul class="b3-tab-bar b3-list b3-list--background">
        {#each groups as group}
            <li
                data-name="editor"
                class:b3-list-item--focus={group.name === focusGroup}
                class="b3-list-item"
                on:click={() => {
                    focusGroup = group.name;
                }}
                on:keydown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        focusGroup = group.name;
                    }
                }}
                role="tab"
                tabindex="0"
            >
                <span class="b3-list-item__text">{group.name}</span>
            </li>
        {/each}
    </ul>
    <div class="config__tab-wrap">
        {#if focusGroup === i18n('settings.settingsGroup.systemPrompt')}
            <SettingPanel
                group={currentGroup?.name || ''}
                settingItems={currentGroup?.items || []}
                display={true}
                on:changed={onChanged}
            />
        {:else if focusGroup === i18n('settings.settingsGroup.platformManagement')}
            <!-- 新的侧边栏布局：左侧为平台列表/操作，右侧为平台配置主区域 -->
            <div class="platform-management-layout">
                <aside class="platform-sidebar">
                    <div class="unified-platform-manager">
                        <div class="manager-header">
                            <h5>{i18n('platform.management')}</h5>
                            <button
                                class="b3-button b3-button--outline"
                                on:click={() => (showAddPlatform = !showAddPlatform)}
                            >
                                {showAddPlatform ? i18n('platform.cancel') : i18n('platform.add')}
                            </button>
                        </div>

                        {#if showAddPlatform}
                            <div class="add-platform-form">
                                <div>
                                    <div>{i18n('platform.name')}</div>
                                    <input
                                        class="b3-text-field fn__flex-1"
                                        type="text"
                                        bind:value={newPlatformName}
                                        placeholder={i18n('platform.namePlaceholder')}
                                        on:keydown={e => e.key === 'Enter' && addCustomPlatform()}
                                    />
                                </div>
                                <button
                                    class="b3-button b3-button--outline"
                                    on:click={addCustomPlatform}
                                    disabled={!newPlatformName.trim()}
                                >
                                    {i18n('platform.confirmAdd')}
                                </button>
                            </div>
                        {/if}

                        <div class="platform-search">
                            <svg class="platform-search__icon">
                                <use xlink:href="#iconSearch"></use>
                            </svg>
                            <input
                                class="b3-text-field fn__flex-1"
                                type="text"
                                bind:value={platformSearchQuery}
                                placeholder={i18n('common.search') + '平台名称'}
                            />
                        </div>

                        <div class="platform-list">
                            {#each displayedProviderOptions as item (item.platform.id)}
                                <div
                                    class="platform-item"
                                    class:platform-item--selected={selectedProviderId ===
                                        item.platform.id}
                                    class:platform-item--dragging={dragSourceIndex === item.index}
                                    class:platform-item--drag-over-top={dragOverIndex ===
                                        item.index &&
                                        dragSourceIndex !== null &&
                                        dragSourceIndex > item.index}
                                    class:platform-item--drag-over-bottom={dragOverIndex ===
                                        item.index &&
                                        dragSourceIndex !== null &&
                                        dragSourceIndex < item.index}
                                    draggable={!platformSearchQuery.trim()}
                                    on:click={() => {
                                        selectedProviderId = item.platform.id;
                                        handleProviderSelect();
                                    }}
                                    on:keydown={e => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            selectedProviderId = item.platform.id;
                                            handleProviderSelect();
                                        }
                                    }}
                                    on:dragstart={e =>
                                        !platformSearchQuery.trim() &&
                                        handleDragStart(e, item.index, item.platform.id)}
                                    on:dragenter={() =>
                                        !platformSearchQuery.trim() && handleDragEnter(item.index)}
                                    on:dragend={handleDragEnd}
                                    on:dragover={e =>
                                        !platformSearchQuery.trim() && handleDragOver(e)}
                                    on:drop={e =>
                                        !platformSearchQuery.trim() && handleDrop(e, item.index)}
                                    on:contextmenu={e =>
                                        openPlatformContextMenu(e, item.platform.id)}
                                    role="button"
                                    tabindex="0"
                                    title={`${platformSearchQuery.trim() ? '搜索中暂不支持拖拽排序' : '拖动以排序'} · ${i18n('common.delete') || '删除'}：右键`}
                                >
                                    <div class="platform-item__drag-handle">
                                        <svg class="b3-button__icon">
                                            <use xlink:href="#iconDrag"></use>
                                        </svg>
                                    </div>
                                    <div class="platform-item__info">
                                        <span class="platform-item__name">
                                            {item.platform.name}
                                        </span>
                                        <span class="platform-item__type">
                                            {item.platform.type === 'built-in'
                                                ? i18n('platform.type.builtin')
                                                : i18n('platform.type.custom')}
                                        </span>
                                    </div>
                                    <label
                                        class="platform-item__switch"
                                        title={item.platform.enabled
                                            ? '平台已启用，关闭后不会在模型选择里显示'
                                            : '平台已停用，开启后会在模型选择里显示'}
                                    >
                                        <input
                                            class="b3-switch"
                                            type="checkbox"
                                            checked={item.platform.enabled}
                                            on:click|stopPropagation
                                            on:change={e =>
                                                handleProviderEnabledChange(item.platform.id, e)}
                                        />
                                    </label>
                                </div>
                            {/each}
                            {#if displayedProviderOptions.length === 0 && allProviderOptions.length > 0}
                                <div class="empty-hint">无匹配平台</div>
                            {/if}
                            {#if allProviderOptions.length === 0}
                                <div class="empty-hint">暂无可用平台</div>
                            {/if}
                        </div>
                    </div>
                </aside>
                {#if contextMenuPlatformId}
                    <div
                        class="platform-context-menu"
                        style={`left:${contextMenuPosition.x}px;top:${contextMenuPosition.y}px;`}
                        on:click|stopPropagation
                    >
                        <button
                            class="platform-context-menu__item platform-context-menu__item--danger"
                            on:click={deletePlatformFromContextMenu}
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconTrashcan"></use>
                            </svg>
                            <span>{i18n('common.delete') || '删除'}</span>
                        </button>
                    </div>
                {/if}

                <main class="platform-main">
                    {#if selectedProviderId}
                        {#if builtInProviderNames[selectedProviderId]}
                            {#key selectedProviderId}
                                <ProviderConfigPanel
                                    providerId={selectedProviderId}
                                    providerName={selectedProviderName}
                                    defaultApiUrl={builtInProviderDefaultUrls[selectedProviderId]}
                                    websiteUrl={builtInProviderWebsites[selectedProviderId]}
                                    bind:config={settings.aiProviders[selectedProviderId]}
                                    isCustomProvider={false}
                                    on:change={handleProviderChange}
                                />
                            {/key}
                        {:else}
                            {#each settings.aiProviders.customProviders as customProvider}
                                {#if customProvider.id === selectedProviderId}
                                    {#key customProvider.id}
                                        <ProviderConfigPanel
                                            providerId={customProvider.id}
                                            providerName={customProvider.name}
                                            defaultApiUrl=""
                                            websiteUrl=""
                                            bind:config={customProvider}
                                            isCustomProvider={true}
                                            on:change={handleProviderChange}
                                            on:rename={e =>
                                                handleProviderRename(
                                                    customProvider.id,
                                                    e.detail.newName
                                                )}
                                        />
                                    {/key}
                                {/if}
                            {/each}
                        {/if}
                    {:else}
                        <div class="no-selection">
                            {i18n('platform.selectHint') || '请选择一个平台以查看或编辑其配置'}
                        </div>
                    {/if}
                </main>
            </div>
        {:else if focusGroup === (i18n('settings.settingsGroup.sessionManagement') || '会话管理')}
            <div class="session-management-panel">
                <SettingPanel
                    group={currentGroup?.name || ''}
                    settingItems={currentGroup?.items || []}
                    display={true}
                    on:changed={onChanged}
                />

                {#if settings.autoRenameSession}
                    <div class="auto-rename-model-selector">
                        <div class="config__item">
                            <div class="config__item-label">
                                <div class="config__item-title">
                                    {i18n('settings.autoRenameSession.modelTitle') || '重命名模型'}
                                </div>
                                <div class="config__item-description">
                                    {i18n('settings.autoRenameSession.modelDescription') ||
                                        '选择用于生成会话标题的AI模型'}
                                </div>
                            </div>
                            <div
                                class="config__item-control"
                                style="display: flex; gap: 8px; align-items: center;"
                            >
                                <select
                                    class="b3-select"
                                    bind:value={settings.autoRenameProvider}
                                    on:change={() => {
                                        settings.autoRenameModelId = '';
                                        saveSettings();
                                    }}
                                >
                                    <option value="">
                                        {i18n('settings.autoRenameSession.selectProvider') ||
                                            '-- 选择平台 --'}
                                    </option>
                                    {#each allProviderOptions as provider}
                                        {#if settings.aiProviders[provider.id]?.models?.length > 0 || (provider.type === 'custom' && settings.aiProviders.customProviders.find(p => p.id === provider.id)?.models?.length > 0)}
                                            <option value={provider.id}>{provider.name}</option>
                                        {/if}
                                    {/each}
                                </select>

                                {#if settings.autoRenameProvider}
                                    <select
                                        class="b3-select"
                                        bind:value={settings.autoRenameModelId}
                                        on:change={saveSettings}
                                    >
                                        <option value="">
                                            {i18n('settings.autoRenameSession.selectModel') ||
                                                '-- 选择模型 --'}
                                        </option>
                                        {#if builtInProviderNames[settings.autoRenameProvider]}
                                            {#each settings.aiProviders[settings.autoRenameProvider]?.models || [] as model}
                                                <option value={model.id}>
                                                    {model.name || model.id}
                                                </option>
                                            {/each}
                                        {:else}
                                            {#each settings.aiProviders.customProviders.find(p => p.id === settings.autoRenameProvider)?.models || [] as model}
                                                <option value={model.id}>
                                                    {model.name || model.id}
                                                </option>
                                            {/each}
                                        {/if}
                                    </select>
                                {/if}
                            </div>
                        </div>

                        <!-- 自定义提示词 -->
                        <div class="config__item" style="margin-top: 16px;">
                            <div class="config__item-label">
                                <div class="config__item-title">
                                    {i18n('settings.autoRenameSession.promptTitle') ||
                                        '自定义提示词'}
                                </div>
                                <div class="config__item-description">
                                    {i18n('settings.autoRenameSession.promptDescription') ||
                                        '自定义生成会话标题的提示词，使用 {message} 作为用户消息的占位符'}
                                </div>
                            </div>
                            <div class="config__item-control">
                                <textarea
                                    class="b3-text-field"
                                    rows="4"
                                    bind:value={settings.autoRenamePrompt}
                                    on:change={saveSettings}
                                    placeholder={i18n(
                                        'settings.autoRenameSession.promptPlaceholder'
                                    ) ||
                                        '请根据以下用户消息生成一个简洁的会话标题（不超过20个字，不要使用引号）：\n\n{message}'}
                                ></textarea>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        {:else if focusGroup === (i18n('settings.settingsGroup.soul') || 'SOUL 文档')}
            <!-- SOUL 文档设置特殊处理 -->
            <div class="soul-settings-panel">
                <div class="config__item">
                    <div class="config__item-label">
                        <div class="config__item-title">
                            {i18n('settings.soulDocId.title') || 'SOUL 文档 ID'}
                        </div>
                        <div class="config__item-description">
                            {i18n('settings.soulDocId.description') ||
                                '设置 SOUL 数据存储的文档 ID'}
                        </div>
                    </div>
                    <div class="config__item-control">
                        <input
                            class="b3-text-field"
                            type="text"
                            bind:value={settings.soulDocId}
                            on:change={async () => {
                                await saveSettings();
                                await validateSoulDocId();
                            }}
                            placeholder={i18n('settings.soulDocId.placeholder') ||
                                '输入文档块 ID，如 20260312120000-xxxxxxxx'}
                        />
                        <button
                            class="b3-button b3-button--outline"
                            on:click={validateSoulDocId}
                            disabled={soulDocValidation.status === 'checking'}
                        >
                            {soulDocValidation.status === 'checking'
                                ? i18n('settings.soulDocId.validating') || '验证中...'
                                : i18n('settings.soulDocId.validate') || '验证'}
                        </button>
                    </div>
                    {#if soulDocValidation.message}
                        <div
                            class="soul-validation-message"
                            class:soul-validation-valid={soulDocValidation.status === 'valid'}
                            class:soul-validation-invalid={soulDocValidation.status === 'invalid'}
                        >
                            {soulDocValidation.message}
                        </div>
                    {/if}
                </div>
            </div>
        {:else if focusGroup === '自定义 Skill'}
            <!-- 自定义 Skill 页面 -->
            <div
                style="padding: 24px; max-width: 800px; display: flex; flex-direction: column; gap: 16px; height: 100%; overflow-y: auto;"
            >
                <h3 style="margin: 0; font-size: 16px; font-weight: 500;">
                    自定义 Skill (Custom Skills)
                </h3>
                <div
                    style="padding: 12px; background: var(--b3-theme-primary-lightest); border-radius: 4px; font-size: 13px; color: var(--b3-theme-on-surface); display: flex; align-items: flex-start; gap: 8px;"
                >
                    <svg
                        class="svg"
                        style="width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px;"
                    >
                        <use xlink:href="#iconInfo"></use>
                    </svg>
                    <div>
                        <p style="margin: 0 0 8px 0;">
                            数据存储在 <code>
                                data/storage/ai/agent/skills/
                            </code>
                             目录下。
                        </p>
                        <p style="margin: 0;">
                            为每个 Skill 创建一个子文件夹并包含一个 <code>skill.md</code>
                            (有 YAML 头)。切换到引用思源块模式时，会在
                            <code>skill.md</code>
                            中保存块 ID，并在
                            <code>read_skill</code>
                             读取时自动展开为 Markdown。
                        </p>
                    </div>
                </div>

                {#if showEditor}
                    <!-- Editor View -->
                    <div
                        style="padding: 16px; border: 1px solid var(--b3-border-color); border-radius: 6px; background: var(--b3-theme-surface); display: flex; flex-direction: column; gap: 12px;"
                    >
                        <h4
                            style="margin: 0; font-size: 14px; font-weight: 500; color: var(--b3-theme-primary);"
                        >
                            {editorTitle}
                        </h4>

                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div
                                style="font-size: 12px; color: var(--b3-theme-on-surface-light); font-weight: 500;"
                            >
                                Skill 标识符 (也是子文件夹名称，支持中文/英文/数字/下划线/短横线)
                            </div>
                            <input
                                class="b3-text-field"
                                type="text"
                                placeholder="例如: my-skill 或 介绍思源笔记"
                                bind:value={skillIdInput}
                                disabled={editorSkillId !== ''}
                            />
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div
                                style="font-size: 12px; color: var(--b3-theme-on-surface-light); font-weight: 500;"
                            >
                                内容模式
                            </div>
                            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                <button
                                    class={editorMode === 'markdown'
                                        ? 'b3-button'
                                        : 'b3-button b3-button--outline'}
                                    on:click={() => setEditorMode('markdown')}
                                >
                                    Markdown
                                </button>
                                <button
                                    class={editorMode === 'siyuan-blocks'
                                        ? 'b3-button'
                                        : 'b3-button b3-button--outline'}
                                    on:click={() => setEditorMode('siyuan-blocks')}
                                >
                                    引用思源块
                                </button>
                            </div>
                        </div>

                        {#if editorMode === 'siyuan-blocks'}
                            <div
                                style="display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px dashed {isSkillBlockDragOver
                                    ? 'var(--b3-theme-primary)'
                                    : 'var(--b3-border-color)'}; border-radius: 6px; background: {isSkillBlockDragOver
                                    ? 'var(--b3-theme-primary-lightest)'
                                    : 'var(--b3-theme-background)'};"
                                on:dragover={handleSkillBlockDragOver}
                                on:dragleave={handleSkillBlockDragLeave}
                                on:drop={handleSkillBlockDrop}
                            >
                                <div
                                    style="display: flex; justify-content: space-between; align-items: center; gap: 8px;"
                                >
                                    <span
                                        style="font-size: 12px; color: var(--b3-theme-on-surface-light); font-weight: 500;"
                                    >
                                        Skill 内容块 ({skillBlocks.length})
                                    </span>
                                    <div style="display: flex; gap: 8px;">
                                        <button
                                            class="b3-button b3-button--outline"
                                            style="padding: 4px 8px; font-size: 12px;"
                                            disabled={isAddingSkillBlock}
                                            on:click={refreshSkillBlocksFromEditorContent}
                                        >
                                            从源码同步
                                        </button>
                                        <button
                                            class="b3-button b3-button--outline"
                                            style="padding: 4px 8px; font-size: 12px;"
                                            disabled={isAddingSkillBlock}
                                            on:click={addCurrentBlockAsSkillBlock}
                                        >
                                            添加当前块
                                        </button>
                                    </div>
                                </div>

                                <div style="display: flex; gap: 8px;">
                                    <input
                                        class="b3-text-field"
                                        type="text"
                                        placeholder="粘贴一个或多个块 ID，用逗号或空格分隔"
                                        bind:value={skillBlockIdInput}
                                    />
                                    <button
                                        class="b3-button b3-button--outline"
                                        style="white-space: nowrap;"
                                        disabled={isAddingSkillBlock}
                                        on:click={addSkillBlockIdsFromInput}
                                    >
                                        添加 ID
                                    </button>
                                </div>

                                {#if skillBlocks.length === 0}
                                    <div
                                        style="padding: 18px; text-align: center; color: var(--b3-theme-on-surface-light); border: 1px dashed var(--b3-border-color); border-radius: 4px;"
                                    >
                                        拖入思源块，或使用当前块/块 ID 添加
                                    </div>
                                {:else}
                                    <div style="display: flex; flex-direction: column; gap: 8px;">
                                        {#each skillBlocks as block, index (block.id)}
                                            <div
                                                style="display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--b3-border-color); border-radius: 4px; background: var(--b3-theme-surface);"
                                            >
                                                <div
                                                    style="min-width: 0; display: flex; flex-direction: column; gap: 2px;"
                                                >
                                                    <span
                                                        style="font-size: 13px; color: var(--b3-theme-on-surface); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                                                    >
                                                        {index + 1}. {block.title}
                                                    </span>
                                                    <code
                                                        style="font-size: 11px; color: var(--b3-theme-on-surface-light); word-break: break-all;"
                                                    >
                                                        {block.id}
                                                    </code>
                                                </div>
                                                <div
                                                    style="display: flex; gap: 6px; flex-shrink: 0;"
                                                >
                                                    <button
                                                        class="b3-button b3-button--text"
                                                        style="padding: 4px 6px; font-size: 12px;"
                                                        disabled={index === 0}
                                                        on:click={() =>
                                                            moveSkillBlock(block.id, -1)}
                                                    >
                                                        上移
                                                    </button>
                                                    <button
                                                        class="b3-button b3-button--text"
                                                        style="padding: 4px 6px; font-size: 12px;"
                                                        disabled={index === skillBlocks.length - 1}
                                                        on:click={() => moveSkillBlock(block.id, 1)}
                                                    >
                                                        下移
                                                    </button>
                                                    <button
                                                        class="b3-button b3-button--text"
                                                        style="padding: 4px 6px; font-size: 12px;"
                                                        data-type="block-ref"
                                                        data-id={block.id}
                                                        prevent-popover="true"
                                                        on:mouseenter={event =>
                                                            showSkillBlockFloatLayer(
                                                                block.id,
                                                                event
                                                            )}
                                                        on:click={() =>
                                                            handleOpenSkillBlock(block.id)}
                                                    >
                                                        打开
                                                    </button>
                                                    <button
                                                        class="b3-button b3-button--text"
                                                        style="padding: 4px 6px; font-size: 12px; color: var(--b3-theme-error);"
                                                        on:click={() => removeSkillBlock(block.id)}
                                                    >
                                                        移除
                                                    </button>
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/if}

                        <div style="display: flex; flex-direction: column; gap: 4px; flex: 1;">
                            <div
                                style="font-size: 12px; color: var(--b3-theme-on-surface-light); font-weight: 500;"
                            >
                                Markdown 源码 (skill.md，包含 YAML 头信息)
                            </div>
                            <textarea
                                class="b3-text-field"
                                style="font-family: monospace; min-height: 300px; resize: vertical; line-height: 1.5; font-size: 13px; padding: 8px;"
                                placeholder="输入 Markdown 内容..."
                                bind:value={editorContent}
                                bind:this={skillMarkdownTextarea}
                                on:focus={rememberEditorSelection}
                                on:click={rememberEditorSelection}
                                on:keyup={rememberEditorSelection}
                                on:select={rememberEditorSelection}
                            ></textarea>
                        </div>

                        <div
                            style="padding: 10px 12px; border-left: 3px solid var(--b3-theme-primary); background: var(--b3-theme-background); font-size: 12px; color: var(--b3-theme-on-surface-light);"
                        >
                            {#if editorMode === 'siyuan-blocks'}
                                添加、排序或移除块时会更新源码中的 <code>
                                    &lt;!-- siyuan-plugin-copilot:skill-blocks ... --&gt;
                                </code>
                                 标记；你也可以直接编辑这段源码。
                            {:else}
                                Markdown 模式会直接保存并读取完整 skill.md 内容。
                            {/if}
                        </div>

                        <div
                            style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;"
                        >
                            <button
                                class="b3-button b3-button--text"
                                on:click={() => (showEditor = false)}
                            >
                                取消
                            </button>
                            <button class="b3-button" on:click={saveSkill}>保存</button>
                        </div>
                    </div>
                {:else}
                    <!-- List View -->
                    <div
                        style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px;"
                    >
                        <h4
                            style="margin: 0; font-size: 14px; font-weight: 500; color: var(--b3-theme-primary);"
                        >
                            已加载的 Skills ({loadedSkills.length})
                        </h4>
                        <div style="display: flex; gap: 8px;">
                            <button
                                class="b3-button b3-button--outline"
                                on:click={openSkillsFolder}
                            >
                                打开 Skills 文件夹
                            </button>
                            <button
                                class="b3-button b3-button--outline"
                                on:click={startCreateSkill}
                            >
                                新建 Skill
                            </button>
                            <button class="b3-button b3-button--outline" on:click={refreshSkills}>
                                刷新列表
                            </button>
                        </div>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        {#if loadedSkills.length === 0}
                            <div
                                style="padding: 24px; text-align: center; border: 1px dashed var(--b3-border-color); border-radius: 4px; color: var(--b3-theme-on-surface-light);"
                            >
                                暂无自定义 Skill，请点击“新建 Skill”或在 <code>
                                    data/storage/ai/agent/skills/
                                </code>
                                 文件夹下创建
                            </div>
                        {:else}
                            {#each loadedSkills as skill}
                                <div
                                    style="padding: 16px; border: 1px solid var(--b3-border-color); border-radius: 6px; background: var(--b3-theme-surface); display: flex; flex-direction: column; gap: 8px;"
                                >
                                    <div
                                        style="display: flex; justify-content: space-between; align-items: center;"
                                    >
                                        <span
                                            style="font-weight: 600; font-size: 14px; color: var(--b3-theme-on-surface);"
                                        >
                                            {skill.name}
                                            <span
                                                style="font-weight: normal; font-size: 12px; color: var(--b3-theme-on-surface-light); margin-left: 6px;"
                                            >
                                                {skill.source === 'siyuan-blocks'
                                                    ? `思源块 · ${skill.blockIds.length} 个`
                                                    : 'Markdown'}
                                            </span>
                                        </span>
                                        <div style="display: flex; gap: 8px;">
                                            <button
                                                class="b3-button b3-button--text"
                                                style="padding: 4px 8px; font-size: 12px;"
                                                on:click={() => openSkillFolder(skill.id)}
                                            >
                                                打开文件夹
                                            </button>
                                            <button
                                                class="b3-button b3-button--text"
                                                style="padding: 4px 8px; font-size: 12px;"
                                                on:click={() => startEditSkill(skill)}
                                            >
                                                编辑
                                            </button>
                                            <button
                                                class="b3-button b3-button--text"
                                                style="padding: 4px 8px; font-size: 12px; color: var(--b3-theme-error);"
                                                on:click={() => deleteSkill(skill)}
                                            >
                                                删除
                                            </button>
                                        </div>
                                    </div>
                                    <div
                                        style="font-size: 13px; color: var(--b3-theme-on-surface-light);"
                                    >
                                        {skill.description}
                                    </div>
                                    {#if skill.source === 'siyuan-blocks'}
                                        <div
                                            style="display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; color: var(--b3-theme-on-surface-light);"
                                        >
                                            {#each skill.blockIds as blockId}
                                                <button
                                                    class="b3-button b3-button--text"
                                                    style="padding: 2px 6px; font-size: 12px;"
                                                    data-type="block-ref"
                                                    data-id={blockId}
                                                    prevent-popover="true"
                                                    on:mouseenter={event =>
                                                        showSkillBlockFloatLayer(blockId, event)}
                                                    on:click={() => handleOpenSkillBlock(blockId)}
                                                >
                                                    打开 {blockId}
                                                </button>
                                            {/each}
                                        </div>
                                    {/if}
                                    <div
                                        style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 4px; font-family: monospace; word-break: break-all;"
                                    >
                                        路径: {skill.filePath}
                                    </div>
                                </div>
                            {/each}
                        {/if}
                    </div>
                {/if}
            </div>
        {:else}
            <SettingPanel
                group={currentGroup?.name || ''}
                settingItems={currentGroup?.items || []}
                display={true}
                on:changed={onChanged}
            />
        {/if}
    </div>
</div>

<style lang="scss">
    .config__panel {
        height: 100%;
        display: flex;
        flex-direction: row;
        overflow: hidden;
        container-type: inline-size;
        container-name: settings-panel;
    }
    .config__panel > .b3-tab-bar {
        width: min(25%, 170px);
        flex-shrink: 0;
    }

    .config__tab-wrap {
        flex: 1;
        height: 100%;
        overflow: hidden;
        padding: 2px;
        display: flex;
        flex-direction: column;
    }

    /* 平台管理：侧边栏布局 */
    .platform-management-layout {
        display: flex;
        gap: 16px;
        flex: 1;
        min-height: 0;
        align-items: stretch;
    }

    .platform-sidebar {
        width: 260px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    .platform-main {
        flex: 1;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }

    .no-selection {
        padding: 24px;
        background: var(--b3-theme-background);
        border: 1px dashed var(--b3-border-color);
        border-radius: 6px;
        color: var(--b3-theme-on-surface-light);
    }

    .unified-platform-manager {
        background: var(--b3-theme-surface);
        border-radius: 6px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    .manager-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;

        h5 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-surface);
        }
    }

    .add-platform-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        background: var(--b3-theme-background);
        border-radius: 4px;
        margin-bottom: 16px;
    }

    .platform-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
        overflow-y: auto;
        min-height: 0;
    }

    .platform-search {
        position: relative;
        margin-bottom: 10px;

        .platform-search__icon {
            position: absolute;
            left: 10px;
            top: 50%;
            width: 14px;
            height: 14px;
            transform: translateY(-50%);
            color: var(--b3-theme-on-surface-light);
            pointer-events: none;
            z-index: 1;
        }

        .b3-text-field {
            padding-left: 32px;
        }
    }

    .platform-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px;
        background: var(--b3-theme-background);
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        cursor: pointer;
        transition: all 0.2s;
        position: relative;

        &:hover {
            background: var(--b3-theme-surface);
            border-color: var(--b3-theme-primary);
        }

        &.platform-item--selected {
            background: var(--b3-theme-primary-lightest);
            border-color: var(--b3-theme-primary);
        }

        // 拖拽时的样式
        &.platform-item--dragging {
            opacity: 0.5;
            background: var(--b3-theme-surface);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            transform: scale(1.02);
        }

        // 顶部放置指示器
        &.platform-item--drag-over-top::before {
            content: '';
            position: absolute;
            top: -4px;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--b3-theme-primary);
            border-radius: 2px;
            z-index: 1;
        }

        // 底部放置指示器
        &.platform-item--drag-over-bottom::after {
            content: '';
            position: absolute;
            bottom: -4px;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--b3-theme-primary);
            border-radius: 2px;
            z-index: 1;
        }
    }

    .platform-item__drag-handle {
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 8px;
        padding: 2px;
        cursor: grab;
        opacity: 0.4;
        transition: opacity 0.2s;
        flex-shrink: 0;

        &:hover {
            opacity: 0.8;
        }

        &:active {
            cursor: grabbing;
        }

        svg {
            width: 14px;
            height: 14px;
        }
    }

    .platform-item__info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
    }

    .platform-item__name {
        font-size: 14px;
        font-weight: 500;
        color: var(--b3-theme-on-background);
    }

    .platform-item__type {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        padding: 2px 6px;
        background: var(--b3-theme-surface);
        border-radius: 10px;
        align-self: flex-start;
    }

    .platform-item__switch {
        display: flex;
        align-items: center;
        justify-content: center;
        margin-left: 8px;
        flex-shrink: 0;
    }

    .platform-context-menu {
        position: fixed;
        z-index: 1200;
        min-width: 120px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        box-shadow: var(--b3-dialog-shadow);
        padding: 6px;
    }

    .platform-context-menu__item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 6px;
        border: none;
        background: transparent;
        border-radius: 4px;
        padding: 6px 8px;
        cursor: pointer;
        color: var(--b3-theme-on-background);
        font-size: 13px;

        &:hover {
            background: var(--b3-theme-surface);
        }

        .b3-button__icon {
            width: 14px;
            height: 14px;
        }
    }

    .platform-context-menu__item--danger {
        color: var(--b3-theme-error);
    }

    .empty-hint {
        padding: 20px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-size: 13px;
    }

    .session-management-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
        flex: 1;
        overflow-y: auto;
    }

    .soul-settings-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
        flex: 1;
        overflow-y: auto;
        padding: 16px;
    }

    .soul-validation-message {
        margin-top: 8px;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 13px;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
    }

    .soul-validation-valid {
        background: var(--b3-card-success-background);
        color: var(--b3-card-success-color);
    }

    .soul-validation-invalid {
        background: var(--b3-card-error-background);
        color: var(--b3-card-error-color);
    }

    .auto-rename-model-selector {
        padding: 16px;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        margin-top: 8px;
    }

    .config__item {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .config__item-label {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .config__item-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--b3-theme-on-background);
    }

    .config__item-description {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.5;
    }

    .config__item-control {
        display: flex;
        gap: 8px;
        align-items: center;

        .b3-select {
            flex: 1;
            min-width: 0;
        }

        textarea.b3-text-field {
            width: 100%;
            min-height: 80px;
            padding: 8px 12px;
            font-size: 13px;
            line-height: 1.6;
            font-family: var(--b3-font-family);
            resize: vertical;

            &::placeholder {
                color: var(--b3-theme-on-surface-light);
                opacity: 0.6;
            }
        }
    }

    @container settings-panel (max-width: 599px) {
        .platform-management-layout {
            flex-direction: column;
            gap: 12px;
            overflow-y: auto;
        }

        .platform-sidebar {
            width: 100%;
            max-height: 42%;
        }

        .platform-main {
            min-height: 260px;
        }
    }

    @container settings-panel (max-width: 768px) {
        .config__panel > .b3-tab-bar {
            width: min(25%, 170px);
            overflow-y: auto;
            overflow-x: hidden;
        }

        .config__panel > .b3-tab-bar .b3-list-item__text {
            display: inline-block !important;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100%;
        }
    }
</style>
