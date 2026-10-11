<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import SettingPanel from '@/libs/components/setting-panel.svelte';
    import { i18n, tf } from './utils/i18n';
    import { getDefaultSettings } from './defaultSettings';
    import { settingsStore } from './stores/settings';
    import { cloneSettings, rebaseSettings } from './utils/settingsStorage';
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

    const DEFAULT_SKILL_FRONTMATTER = i18n('settingsSkillDefaultFrontmatter');

    let loadedSkills: Skill[] = [];

    async function refreshSkills() {
        loadedSkills = await loadAllSkills();
    }

    async function openSkillsFolder() {
        try {
            // @ts-ignore
            if (!window?.require) {
                pushErrMsg(i18n('settingsFolderDesktopOnly'));
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
                pushErrMsg(i18n('settingsDataDirUnavailable'));
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
            pushErrMsg(i18n('settingsFolderOpenFailed') + (e instanceof Error ? e.message : String(e)));
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
        return tf('settingsSkillDefaultContent', DEFAULT_SKILL_FRONTMATTER);
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
            pushMsg(i18n('settingsSkillBlockAdded'));
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
                    ? i18n('settingsSkillBlockAddedToast')
                    : tf('settingsSkillBlocksAdded', newBlocks.length)
            );
        } finally {
            isAddingSkillBlock = false;
            isSkillBlockDragOver = false;
        }
    }

    async function addCurrentBlockAsSkillBlock() {
        const blockId = getFocusedBlockId();
        if (!blockId) {
            pushErrMsg(i18n('commonCurrentBlockMissing'));
            return;
        }
        await addSkillBlocksByIds([blockId]);
    }

    async function refreshSkillBlocksFromEditorContent() {
        const blockIds = extractSiyuanSkillBlockIds(editorContent);
        skillBlocks = await buildSkillBlocksFromIds(blockIds);
        pushMsg(
            blockIds.length > 0 ? tf('settingsSkillBlocksSynced', blockIds.length) : i18n('settingsSkillBlocksMarkerMissing')
        );
    }

    async function addSkillBlockIdsFromInput() {
        const blockIds = parseBlockIdList(skillBlockIdInput);
        if (blockIds.length === 0) {
            pushErrMsg(i18n('settingsSkillBlockIdRequired'));
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
            pushErrMsg(tf('commonOpenBlockFailed', blockId));
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
                pushErrMsg(i18n('settingsFolderDesktopOnly'));
                return;
            }
            // @ts-ignore
            const { shell } = window.require('electron');
            // @ts-ignore
            const path = window.require('path');
            // @ts-ignore
            const dataDir = window.siyuan?.config?.system?.dataDir;
            if (!dataDir) {
                pushErrMsg(i18n('settingsDataDirUnavailable'));
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
            pushErrMsg(i18n('settingsFolderOpenFailed') + (e instanceof Error ? e.message : String(e)));
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
            editorTitle = i18n('settingsSkillEditTitle') + skill.name;
            showEditor = true;
        } catch (e) {
            console.error('Failed to load skill content:', e);
            pushErrMsg(i18n('settingsSkillLoadFailed') + (e instanceof Error ? e.message : String(e)));
        }
    }

    function startCreateSkill() {
        editorSkillId = '';
        skillIdInput = '';
        editorMode = 'markdown';
        skillBlocks = [];
        skillBlockIdInput = '';
        editorContent = buildDefaultMarkdownSkill();
        editorTitle = i18n('settingsSkillCreate');
        showEditor = true;
    }

    async function saveSkill() {
        const normalizedId = skillIdInput.trim().replace(/[\\/:*?"<>|]/g, '');
        if (!normalizedId) {
            pushErrMsg(i18n('settingsSkillInvalidId'));
            return;
        }

        if (!hasYamlFrontmatter(editorContent)) {
            pushErrMsg(i18n('settingsSkillFrontmatterRequired'));
            return;
        }

        try {
            const skillFilePath = `/data/storage/ai/agent/skills/${normalizedId}/skill.md`;
            const fileBlob = new Blob([editorContent], { type: 'text/markdown' });
            await putFile(skillFilePath, false, fileBlob);

            pushMsg(i18n('commonSaveSuccess'));
            showEditor = false;
            await refreshSkills();
        } catch (e) {
            console.error('Failed to save skill:', e);
            pushErrMsg(i18n('settingsSkillSaveFailed') + (e instanceof Error ? e.message : String(e)));
        }
    }

    async function deleteSkill(skill: Skill) {
        confirm(
            i18n('settingsSkillDeleteTitle'),
            tf('settingsSkillDeleteConfirm', skill.name, skill.id),
            async () => {
                try {
                    await removeSkill(skill.id);
                    pushMsg(i18n('aiSidebarTranslateDeleteSuccess'));
                    await refreshSkills();
                } catch (e) {
                    console.error('Failed to delete skill:', e);
                    pushErrMsg(i18n('settingsSkillDeleteFailed') + (e instanceof Error ? e.message : String(e)));
                }
            }
        );
    }

    // 使用动态默认设置
    let settings = { ...getDefaultSettings() };
    let unsubscribeSettings: (() => void) | undefined;
    let pendingSettingsSaves = 0;
    let settingsSaveVersion = 0;
    let isDestroyed = false;

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
        apimart: i18n('platformBuiltInApimart'),
        Achuan: i18n('platformBuiltInAchuan'),
        gemini: i18n('platformBuiltInGemini'),
        openai: i18n('platformBuiltInOpenai'),
        codex: i18n('platformBuiltInCodex'),
        deepseek: i18n('platformBuiltInDeepseek'),
        moonshot: i18n('platformBuiltInMoonshot'),
        volcano: i18n('platformBuiltInVolcano'),
        minimax: i18n('platformBuiltInMinimax'),
    };

    // 内置平台的默认 API 地址
    const builtInProviderDefaultUrls: Record<string, string> = {
        apimart: 'https://api.apimart.ai',
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
        apimart: 'https://go.apimart.ai/gh-slidesci',
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
    let platformTouchDragTimer: ReturnType<typeof setTimeout> | null = null;
    let platformTouchDragActive = false;
    let platformTouchPointerId: number | null = null;
    let platformTouchStartX = 0;
    let platformTouchStartY = 0;

    const PLATFORM_TOUCH_DRAG_DELAY = 350;
    const PLATFORM_TOUCH_MOVE_THRESHOLD = 8;

    // 平台右键菜单状态
    let contextMenuPlatformId: string | null = null;
    let contextMenuPosition = { x: 0, y: 0 };

    // 移动端模型配置面板状态
    let isMobileLayout = false;
    let mobileModelPanelOpen = false;
    let platformLayoutElement: HTMLElement | null = null;
    let platformLayoutObserver: ResizeObserver | null = null;
    let observedLayoutElement: HTMLElement | null = null;

    function updateIsMobileLayout(width: number) {
        isMobileLayout = width <= 599;
        if (!isMobileLayout) {
            mobileModelPanelOpen = false;
        }
    }

    function openMobileModelPanel() {
        mobileModelPanelOpen = true;
    }

    function closeMobileModelPanel() {
        mobileModelPanelOpen = false;
    }

    function syncLayoutObserver() {
        if (platformLayoutElement === observedLayoutElement) return;

        if (platformLayoutObserver) {
            platformLayoutObserver.disconnect();
            platformLayoutObserver = null;
        }

        observedLayoutElement = platformLayoutElement;

        if (platformLayoutElement) {
            platformLayoutObserver = new ResizeObserver(entries => {
                for (const entry of entries) {
                    updateIsMobileLayout(entry.contentRect.width);
                }
            });
            platformLayoutObserver.observe(platformLayoutElement);
            updateIsMobileLayout(platformLayoutElement.clientWidth);
        }
    }

    $: syncLayoutObserver();

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

    function resetPlatformDragState() {
        dragOverIndex = null;
        dragSourceIndex = null;
        dragSourceId = null;
    }

    // 处理拖拽结束
    function handleDragEnd() {
        resetPlatformDragState();
    }

    function reorderPlatforms(sourceIndex: number, targetIndex: number) {
        if (
            sourceIndex === targetIndex ||
            sourceIndex < 0 ||
            targetIndex < 0 ||
            sourceIndex >= allProviderOptions.length ||
            targetIndex >= allProviderOptions.length
        ) {
            return;
        }

        const items = [...allProviderOptions];
        const [removed] = items.splice(sourceIndex, 1);
        items.splice(targetIndex, 0, removed);

        const newOrder = items.map(p => p.id);
        settings = {
            ...settings,
            aiProviders: {
                ...settings.aiProviders,
                providerOrder: newOrder,
            },
        };

        saveSettings();
        pushMsg(i18n('platformReorderSuccess'));
    }

    // 处理放置
    function handleDrop(e: DragEvent, targetIndex: number) {
        if (platformSearchQuery.trim()) {
            return;
        }
        e.preventDefault();
        if (dragSourceIndex === null || dragSourceIndex === targetIndex) {
            resetPlatformDragState();
            return;
        }

        reorderPlatforms(dragSourceIndex, targetIndex);
        resetPlatformDragState();
    }

    // 处理拖拽悬停（防止默认行为）
    function handleDragOver(e: DragEvent) {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
    }

    function clearPlatformTouchDragTimer() {
        if (platformTouchDragTimer !== null) {
            clearTimeout(platformTouchDragTimer);
            platformTouchDragTimer = null;
        }
    }

    function handlePlatformPointerDown(event: PointerEvent, index: number, providerId: string) {
        if (event.pointerType !== 'touch' || platformSearchQuery.trim()) return;

        event.preventDefault();
        clearPlatformTouchDragTimer();
        platformTouchPointerId = event.pointerId;
        platformTouchStartX = event.clientX;
        platformTouchStartY = event.clientY;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

        platformTouchDragTimer = setTimeout(() => {
            platformTouchDragTimer = null;
            platformTouchDragActive = true;
            dragSourceIndex = index;
            dragSourceId = providerId;
            dragOverIndex = null;
            navigator.vibrate?.(20);
        }, PLATFORM_TOUCH_DRAG_DELAY);
    }

    function handlePlatformPointerMove(event: PointerEvent) {
        if (event.pointerType !== 'touch' || event.pointerId !== platformTouchPointerId) return;

        event.preventDefault();
        if (!platformTouchDragActive) {
            const movedDistance = Math.hypot(
                event.clientX - platformTouchStartX,
                event.clientY - platformTouchStartY
            );
            if (movedDistance > PLATFORM_TOUCH_MOVE_THRESHOLD) {
                clearPlatformTouchDragTimer();
            }
            return;
        }

        const element = document.elementFromPoint(event.clientX, event.clientY);
        const target = element?.closest<HTMLElement>('.platform-item[data-platform-index]');
        const targetIndex = Number(target?.dataset.platformIndex);
        dragOverIndex = Number.isInteger(targetIndex) && targetIndex !== dragSourceIndex
            ? targetIndex
            : null;
    }

    function finishPlatformTouchDrag(event: PointerEvent) {
        if (event.pointerType !== 'touch' || event.pointerId !== platformTouchPointerId) return;

        event.preventDefault();
        clearPlatformTouchDragTimer();
        if (
            platformTouchDragActive &&
            dragSourceIndex !== null &&
            dragOverIndex !== null
        ) {
            reorderPlatforms(dragSourceIndex, dragOverIndex);
        }

        platformTouchDragActive = false;
        platformTouchPointerId = null;
        resetPlatformDragState();
    }

    function cancelPlatformTouchDrag(event: PointerEvent) {
        if (event.pointerType !== 'touch' || event.pointerId !== platformTouchPointerId) return;

        clearPlatformTouchDragTimer();
        platformTouchDragActive = false;
        platformTouchPointerId = null;
        resetPlatformDragState();
    }

    function handleProviderChange() {
        saveSettings();
    }

    // 处理平台重命名
    function handleProviderRename(providerId: string, newName: string) {
        if (builtInProviderNames[providerId]) {
            // 内置平台：将自定义名称存入对应 ProviderConfig
            const providerConfig = settings.aiProviders[providerId];
            if (providerConfig) {
                providerConfig.name = newName;
                settings = {
                    ...settings,
                    aiProviders: {
                        ...settings.aiProviders,
                        [providerId]: { ...providerConfig },
                    },
                };
                saveSettings();
                pushMsg(tf('platformRenameSuccess', newName));
            }
            return;
        }

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
            pushMsg(tf('platformRenameSuccess', newName));
        }
    }

    // 生成自定义平台ID
    function generateCustomPlatformId(): string {
        return `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // 添加自定义平台
    function addCustomPlatform() {
        if (!newPlatformName.trim()) {
            pushErrMsg(i18n('platformNameRequired'));
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
        pushMsg(i18n('aiSidebarSuccessAddPromptSuccess') + `: ${newPlatform.name}`);
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
            i18n('platformUnknown');

        confirm(
            i18n('aiSidebarConfirmDeletePlatformTitle'),
            i18n('aiSidebarConfirmDeletePlatformMessage', { platformName }),
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
                pushMsg(i18n('aiSidebarSuccessDeletePromptSuccess') + `: ${platformName}`);
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
                name: settings.aiProviders?.[id]?.name || builtInProviderNames[id],
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
            // 按顺序排序，未在顺序中的放到最后（apimart 默认优先排在第一位）
            allProviders.sort((a, b) => {
                const orderA = orderMap.get(a.id);
                const orderB = orderMap.get(b.id);
                if (orderA !== undefined && orderB !== undefined) {
                    return orderA - orderB;
                }
                if (a.id === 'apimart') return -1;
                if (b.id === 'apimart') return 1;
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
        if (!selectedProviderId) return i18n('platformSelect');

        if (builtInProviderNames[selectedProviderId]) {
            // 优先使用用户自定义的名称
            return settings.aiProviders?.[selectedProviderId]?.name || builtInProviderNames[selectedProviderId];
        }

        const customProvider = settings.aiProviders?.customProviders?.find(
            (p: CustomProviderConfig) => p.id === selectedProviderId
        );
        return customProvider?.name || i18n('platformUnknown');
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
            name: i18n('settingsSettingsGroupSystemPrompt'),
            items: [
                {
                    key: 'aiSystemPromptAsk',
                    value: settings.aiSystemPromptAsk,
                    type: 'textarea',
                    title: i18n('settingsAiSystemPromptAskTitle'),
                    description: i18n('settingsAiSystemPromptAskDescription'),
                    direction: 'row',
                    rows: 4,
                    placeholder: i18n('settingsAiSystemPromptAskPlaceholder'),
                },
                {
                    key: 'aiSystemPromptAgent',
                    value: settings.aiSystemPromptAgent,
                    type: 'textarea',
                    title: i18n('settingsAiSystemPromptAgentTitle'),
                    description: i18n('settingsAiSystemPromptAgentDescription'),
                    direction: 'row',
                    rows: 4,
                    placeholder: i18n('settingsAiSystemPromptAgentPlaceholder'),
                },
                {
                    key: 'aiSystemPromptDraw',
                    value: settings.aiSystemPromptDraw,
                    type: 'textarea',
                    title: i18n('settingsAiSystemPromptDrawTitle'),
                    description: i18n('settingsAiSystemPromptDrawDescription'),
                    direction: 'row',
                    rows: 4,
                    placeholder: i18n('settingsAiSystemPromptDrawPlaceholder'),
                },
            ],
        },
        {
            name: i18n('settingsSettingsGroupPlatformManagement'),
            items: [],
        },
        {
            name: i18n('settingsSettingsGroupDisplayAndOperation'),
            items: [
                {
                    key: 'sendMessageShortcut',
                    value: settings.sendMessageShortcut,
                    type: 'select',
                    title: i18n('settingsSendMessageShortcutTitle'),
                    description: i18n('settingsSendMessageShortcutDescription'),
                    options: {
                        'ctrl+enter': i18n('settingsSendMessageShortcutOptionsCtrlEnter'),
                        enter: i18n('settingsSendMessageShortcutOptionsEnter'),
                    },
                },
                {
                    key: 'messageFontSize',
                    value: settings.messageFontSize,
                    type: 'number',
                    title: i18n('settingsMessageFontSizeTitle'),
                    description: i18n('settingsMessageFontSizeDescription'),
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
                    title: i18n('settingsMultiModelViewModeTitle'),
                    description: i18n('settingsMultiModelViewModeDescription'),
                    options: {
                        tab: i18n('settingsMultiModelViewModeOptionsTab'),
                        card: i18n('settingsMultiModelViewModeOptionsCard'),
                    },
                },
            ],
        },
        {
            name: i18n('settingsSettingsGroupNoteExport'),
            items: [
                {
                    key: 'exportNotebook',
                    value: settings.exportNotebook,
                    type: 'select',
                    title: i18n('settingsExportNotebookTitle'),
                    description: i18n('settingsExportNotebookDescription'),
                    options: notebookOptions,
                },
                {
                    key: 'exportDefaultPath',
                    value: settings.exportDefaultPath,
                    type: 'textinput',
                    title: i18n('settingsExportDefaultPathTitle'),
                    description: i18n('settingsExportDefaultPathDescription'),
                    placeholder: i18n('settingsExportDefaultPathPlaceholder'),
                },
            ],
        },
        {
            name: i18n('settingsSettingsGroupSessionManagement'),
            items: [
                {
                    key: 'autoRenameSession',
                    value: settings.autoRenameSession,
                    type: 'checkbox',
                    title: i18n('settingsAutoRenameSessionTitle'),
                    description:
                        i18n('settingsAutoRenameSessionDescription'),
                },
            ],
        },
        {
            name: i18n('settingsSettingsGroupTranslate'),
            items: [
                {
                    key: 'translateTemperature',
                    value: settings.translateTemperature,
                    type: 'number',
                    title: i18n('settingsTranslateTemperatureTitle'),
                    description:
                        i18n('settingsTranslateTemperatureDescription'),
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
                    title: i18n('settingsTranslatePromptTitle'),
                    description:
                        i18n('settingsTranslatePromptDescription'),
                    direction: 'row',
                    rows: 8,
                    placeholder:
                        i18n('settingsTranslatePromptPlaceholder'),
                },
            ],
        },
        {
            name: i18n('settingsSettingsGroupTools'),
            items: [
                {
                    key: 'pythonPath',
                    value: settings.pythonPath,
                    type: 'textinput',
                    title: i18n('settingsPythonPathTitle'),
                    description:
                        i18n('settingsPythonPathDescription'),
                    placeholder:
                        i18n('settingsPythonPathPlaceholder'),
                },
            ],
        },
        {
            name: i18n('settingsSettingsGroupSoul'),
            items: [
                {
                    key: 'soulDocId',
                    value: settings.soulDocId,
                    type: 'textinput',
                    title: i18n('settingsSoulDocIdTitle'),
                    description:
                        i18n('settingsSoulDocIdDescription'),
                    placeholder:
                        i18n('settingsSoulDocIdPlaceholder'),
                },
            ],
        },
        {
            name: i18n('settingsSettingsGroupWebApp'),
            items: [
                {
                    key: 'openLinksInWebView',
                    value: settings.openLinksInWebView,
                    type: 'checkbox',
                    title: i18n('settingsOpenLinksInWebViewTitle'),
                    description:
                        i18n('settingsOpenLinksInWebViewDescription'),
                },
                {
                    key: 'webAppCollectionDock',
                    value: settings.webAppCollectionDock,
                    type: 'checkbox',
                    title: i18n('settingsWebAppCollectionDockTitle'),
                    description:
                        i18n('settingsWebAppCollectionDockDescription'),
                },
                {
                    key: 'searchEngine',
                    value: settings.searchEngine,
                    type: 'select',
                    title: i18n('settingsSearchEngineTitle'),
                    description: i18n('settingsSearchEngineDescription'),
                    options: {
                        google: 'Google',
                        bing: 'Bing',
                    },
                },
            ],
        },
        {
            name: i18n('settingsCustomSkillsGroup'),
            items: [],
        },
        {
            name: i18n('settingsSettingsGroupReset'),
            items: [
                {
                    key: 'reset',
                    value: '',
                    type: 'button',
                    title: i18n('settingsResetTitle'),
                    description:
                        i18n('settingsResetDescription'),
                    button: {
                        label: i18n('settingsResetLabel'),
                        callback: async () => {
                            confirm(
                                i18n('settingsResetTitle'),
                                i18n('settingsResetConfirmMessage'),
                                async () => {
                                    // 确认回调
                                    settings = { ...getDefaultSettings() };
                                    updateGroupItems();
                                    await saveSettings({ replace: true });
                                    await pushMsg(i18n('settingsResetMessage'));
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
            name: i18n('settingsDonateGroup'),
            items: [
                {
                    key: 'donateInfo',
                    value: '',
                    type: 'hint',
                    title: i18n('settingsDonateTitle'),
                    description: `
                        <p style="margin-top:12px;">${i18n('settingsDonateSupport')}</p>

                        <p style="margin-top:12px;">${i18n('settingsDonateMaintenance')}</p>


                        
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

            // 切换小程序集合侧栏设置时，立即同步集合 Dock
            if (detail.key === 'webAppCollectionDock') {
                plugin.syncWebAppCollectionDock(
                    settings.webApps || [],
                    settings.webAppCollectionDock,
                    settings.openedWebAppIds
                );
            }
        }
    };

    async function saveSettings(options: { replace?: boolean } = {}) {
        const version = ++settingsSaveVersion;
        pendingSettingsSaves++;
        try {
            const saved = await plugin.saveSettings(settings, options);
            if (!isDestroyed && version === settingsSaveVersion) {
                settings = cloneSettings(saved);
                normalizeProviderSettings();
                updateGroupItems();
            }
        } finally {
            pendingSettingsSaves--;
        }
    }

    onMount(async () => {
        await runload();
        if (isDestroyed) return;
        unsubscribeSettings = settingsStore.subscribe(handleSettingsUpdate);
        document.addEventListener('click', closePlatformContextMenu);
        window.addEventListener('blur', closePlatformContextMenu);
    });

    function handleSettingsUpdate(value: any) {
        // 保存中的输入保留在本地；最后一次保存成功后会合并到最新配置。
        if (isDestroyed || pendingSettingsSaves || !value || Object.keys(value).length === 0) return;
        settings = cloneSettings(value);
        normalizeProviderSettings();
        updateGroupItems();
    }

    onDestroy(() => {
        isDestroyed = true;
        unsubscribeSettings?.();
        document.removeEventListener('click', closePlatformContextMenu);
        window.removeEventListener('blur', closePlatformContextMenu);
        clearPlatformTouchDragTimer();
        if (platformLayoutObserver) {
            platformLayoutObserver.disconnect();
            platformLayoutObserver = null;
        }
    });

    async function runload() {
        const loadedSettings = await plugin.loadSettings();
        if (isDestroyed) return;
        settings = cloneSettings(loadedSettings);
        normalizeProviderSettings();

        // 加载笔记本列表
        await loadNotebooks();

        // 如果有设置 SOUL 文档 ID，自动验证
        if (settings.soulDocId) await validateSoulDocId();
        await refreshSkills();
        if (!isDestroyed) updateGroupItems();
    }

    function normalizeProviderSettings() {
        // 确保 aiProviders 存在
        if (!settings.aiProviders) {
            settings.aiProviders = {
                apimart: { apiKey: '', customApiUrl: '', models: [], enabled: true },
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
            'apimart',
            'Achuan',
            'gemini',
            'deepseek',
            'openai',
            'codex',
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
        } else if (
            settings.aiProviders.providerOrder.length > 0 &&
            !settings.aiProviders.providerOrder.includes('apimart')
        ) {
            settings.aiProviders.providerOrder.unshift('apimart');
        }

        // 恢复选中的平台ID（仅用于设置面板显示）
        // 优先使用 selectedProviderId，如果不存在则使用 currentProvider 作为初始值
        selectedProviderId = settings.selectedProviderId || settings.currentProvider || 'apimart';

        // 补全设置面板显示所需字段，用户实际修改时再保存。
        if (!settings.selectedProviderId) {
            settings.selectedProviderId = selectedProviderId;
        }

        settings = rebaseSettings(settings);
    }

    // 加载笔记本列表
    async function loadNotebooks() {
        try {
            const notebooks = await lsNotebooks();
            if (notebooks?.notebooks && notebooks.notebooks.length > 0) {
                // 构建笔记本选项对象 { id: name }，只显示 closed=false 的笔记本
                notebookOptions = {};
                notebookOptions[''] =
                    i18n('settingsExportNotebookPlaceholder');
                notebooks.notebooks
                    .filter(notebook => notebook.closed === false)
                    .forEach(notebook => {
                        notebookOptions[notebook.id] = notebook.name;
                    });
            } else {
                notebookOptions = {
                    '': i18n('settingsExportNotebookPlaceholder'),
                };
            }
        } catch (error) {
            console.error('Load notebooks error:', error);
            notebookOptions = {
                '': i18n('settingsExportNotebookPlaceholder'),
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
            message: i18n('settingsSoulDocIdValidating'),
        };

        try {
            const block = await getBlockByID(docId);
            if (!block) {
                soulDocValidation = {
                    status: 'invalid',
                    message: i18n('settingsSoulDocIdNotFound'),
                };
                return;
            }

            if (block.type !== 'd') {
                soulDocValidation = {
                    status: 'invalid',
                    message: tf('settingsSoulDocTypeError', block.type),
                };
                return;
            }

            soulDocValidation = {
                status: 'valid',
                message: tf('settingsSoulDocValid', block.content || i18n('commonUntitledName')),
            };
        } catch (error) {
            soulDocValidation = {
                status: 'invalid',
                message:
                    i18n('settingsSoulDocIdError') + (error as Error).message,
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
        {#if focusGroup === i18n('settingsSettingsGroupSystemPrompt')}
            <SettingPanel
                group={currentGroup?.name || ''}
                settingItems={currentGroup?.items || []}
                display={true}
                on:changed={onChanged}
            />
        {:else if focusGroup === i18n('settingsSettingsGroupPlatformManagement')}
            <!-- 新的侧边栏布局：左侧为平台列表/操作，右侧为平台配置主区域 -->
            <div
                class="platform-management-layout"
                bind:this={platformLayoutElement}
            >
                <aside
                    class="platform-sidebar"
                    class:platform-sidebar--hidden-mobile={mobileModelPanelOpen}
                >
                    <div class="unified-platform-manager">
                        <div class="manager-header">
                            <h5>{i18n('platformManagement')}</h5>
                            <button
                                class="b3-button b3-button--outline"
                                on:click={() => (showAddPlatform = !showAddPlatform)}
                            >
                                {showAddPlatform ? i18n('platformCancel') : i18n('platformAdd')}
                            </button>
                        </div>

                        {#if showAddPlatform}
                            <div class="add-platform-form">
                                <div>
                                    <div>{i18n('platformName')}</div>
                                    <input
                                        class="b3-text-field fn__flex-1"
                                        type="text"
                                        bind:value={newPlatformName}
                                        placeholder={i18n('platformNamePlaceholder')}
                                        on:keydown={e => e.key === 'Enter' && addCustomPlatform()}
                                    />
                                </div>
                                <button
                                    class="b3-button b3-button--outline"
                                    on:click={addCustomPlatform}
                                    disabled={!newPlatformName.trim()}
                                >
                                    {i18n('platformConfirmAdd')}
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
                                placeholder={i18n('platformSearchPlaceholder')}
                            />
                        </div>

                        <div class="platform-list">
                            {#each displayedProviderOptions as item (item.platform.id)}
                                <div
                                    class="platform-item"
                                    data-platform-index={item.index}
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
                                    on:click={() => {
                                        selectedProviderId = item.platform.id;
                                        handleProviderSelect();
                                        openMobileModelPanel();
                                    }}
                                    on:keydown={e => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            selectedProviderId = item.platform.id;
                                            handleProviderSelect();
                                            openMobileModelPanel();
                                        }
                                    }}
                                    on:dragenter={() =>
                                        !isMobileLayout &&
                                        !platformSearchQuery.trim() &&
                                        handleDragEnter(item.index)}
                                    on:dragover={e =>
                                        !isMobileLayout &&
                                        !platformSearchQuery.trim() &&
                                        handleDragOver(e)}
                                    on:drop={e =>
                                        !isMobileLayout &&
                                        !platformSearchQuery.trim() &&
                                        handleDrop(e, item.index)}
                                    on:contextmenu={e =>
                                        openPlatformContextMenu(e, item.platform.id)}
                                    role="button"
                                    tabindex="0"
                                    title={tf('platformItemActionsHint', platformSearchQuery.trim() ? i18n('platformSearchNoSort') : i18n('platformDragSort'))}
                                >
                                    <div
                                        class="platform-item__drag-handle"
                                        draggable={!isMobileLayout && !platformSearchQuery.trim()}
                                        role="button"
                                        tabindex="0"
                                        title={platformSearchQuery.trim()
                                            ? i18n('platformSearchNoSort')
                                            : i18n('platformDragSort')}
                                        on:click|stopPropagation
                                        on:dragstart|stopPropagation={e =>
                                            handleDragStart(e, item.index, item.platform.id)}
                                        on:dragend={handleDragEnd}
                                        on:pointerdown={e =>
                                            handlePlatformPointerDown(
                                                e,
                                                item.index,
                                                item.platform.id
                                            )}
                                        on:pointermove={handlePlatformPointerMove}
                                        on:pointerup={finishPlatformTouchDrag}
                                        on:pointercancel={cancelPlatformTouchDrag}
                                        on:contextmenu|preventDefault|stopPropagation
                                    >
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
                                                ? i18n('platformTypeBuiltin')
                                                : i18n('platformTypeCustom')}
                                        </span>
                                    </div>
                                    <label
                                        class="platform-item__switch"
                                        title={item.platform.enabled
                                            ? i18n('platformEnabledHint')
                                            : i18n('platformDisabledHint')}
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
                                <div class="empty-hint">{i18n('platformNoResults')}</div>
                            {/if}
                            {#if allProviderOptions.length === 0}
                                <div class="empty-hint">{i18n('platformNoAvailable')}</div>
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
                            <span>{i18n('commonDelete')}</span>
                        </button>
                    </div>
                {/if}

                <main
                    class="platform-main"
                    class:platform-main--mobile-open={mobileModelPanelOpen}
                >
                    <div class="platform-main__mobile-header">
                        <button
                            class="b3-button b3-button--text"
                            on:click={closeMobileModelPanel}
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconLeft"></use>
                            </svg>
                            {i18n('commonBack')}
                        </button>
                        <span class="platform-main__mobile-title">
                            {selectedProviderId ? selectedProviderName : (i18n('platformSelect'))}
                        </span>
                    </div>
                    {#if selectedProviderId}
                        {#if builtInProviderNames[selectedProviderId]}
                            {#key selectedProviderId}
                                <ProviderConfigPanel
                                    providerId={selectedProviderId}
                                    providerName={selectedProviderName}
                                    defaultApiUrl={builtInProviderDefaultUrls[selectedProviderId]}
                                    websiteUrl={builtInProviderWebsites[selectedProviderId]}
                                    bind:config={settings.aiProviders[selectedProviderId]}
                                    on:change={handleProviderChange}
                                    on:rename={e =>
                                        handleProviderRename(
                                            selectedProviderId,
                                            e.detail.newName
                                        )}
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
                            {i18n('platformSelectHint')}
                        </div>
                    {/if}
                </main>
            </div>
        {:else if focusGroup === (i18n('settingsSettingsGroupSessionManagement'))}
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
                                    {i18n('settingsAutoRenameSessionModelTitle')}
                                </div>
                                <div class="config__item-description">
                                    {i18n('settingsAutoRenameSessionModelDescription')}
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
                                        {i18n('settingsAutoRenameSessionSelectProvider')}
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
                                            {i18n('settingsAutoRenameSessionSelectModel')}
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
                                    {i18n('settingsAutoRenameSessionPromptTitle')}
                                </div>
                                <div class="config__item-description">
                                    {i18n('settingsAutoRenameSessionPromptDescription')}
                                </div>
                            </div>
                            <div class="config__item-control">
                                <textarea
                                    class="b3-text-field"
                                    rows="4"
                                    bind:value={settings.autoRenamePrompt}
                                    on:change={saveSettings}
                                    placeholder={i18n('settingsAutoRenameSessionPromptPlaceholder'
                                    )}
                                ></textarea>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        {:else if focusGroup === (i18n('settingsSettingsGroupSoul'))}
            <!-- SOUL 文档设置特殊处理 -->
            <div class="soul-settings-panel">
                <div class="config__item">
                    <div class="config__item-label">
                        <div class="config__item-title">
                            {i18n('settingsSoulDocIdTitle')}
                        </div>
                        <div class="config__item-description">
                            {i18n('settingsSoulDocIdDescription')}
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
                            placeholder={i18n('settingsSoulDocIdPlaceholder')}
                        />
                        <button
                            class="b3-button b3-button--outline"
                            on:click={validateSoulDocId}
                            disabled={soulDocValidation.status === 'checking'}
                        >
                            {soulDocValidation.status === 'checking'
                                ? i18n('settingsSoulDocIdValidating')
                                : i18n('settingsSoulDocIdValidate')}
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
        {:else if focusGroup === i18n('settingsCustomSkillsGroup')}
            <!-- 自定义 Skill 页面 -->
            <div
                style="padding: 24px; max-width: 800px; display: flex; flex-direction: column; gap: 16px; height: 100%; overflow-y: auto;"
            >
                <h3 style="margin: 0; font-size: 16px; font-weight: 500;">
                    {i18n('settingsCustomSkillsTitle')}
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
                            {@html i18n('settingsSkillsStorageHint')}
                        </p>
                        <p style="margin: 0;">
                            {@html i18n('settingsSkillsFormatHint')}
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
                                {i18n('settingsSkillIdLabel')}
                            </div>
                            <input
                                class="b3-text-field"
                                type="text"
                                placeholder={i18n('settingsSkillIdPlaceholder')}
                                bind:value={skillIdInput}
                                disabled={editorSkillId !== ''}
                            />
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div
                                style="font-size: 12px; color: var(--b3-theme-on-surface-light); font-weight: 500;"
                            >
                                {i18n('settingsSkillContentMode')}
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
                                    {i18n('settingsSkillSiyuanBlocks')}
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
                                        {tf('settingsSkillContentBlocksCount', skillBlocks.length)}
                                    </span>
                                    <div style="display: flex; gap: 8px;">
                                        <button
                                            class="b3-button b3-button--outline"
                                            style="padding: 4px 8px; font-size: 12px;"
                                            disabled={isAddingSkillBlock}
                                            on:click={refreshSkillBlocksFromEditorContent}
                                        >
                                            {i18n('settingsSkillSourceSync')}
                                        </button>
                                        <button
                                            class="b3-button b3-button--outline"
                                            style="padding: 4px 8px; font-size: 12px;"
                                            disabled={isAddingSkillBlock}
                                            on:click={addCurrentBlockAsSkillBlock}
                                        >
                                            {i18n('modelPresetAddCurrentBlock')}
                                        </button>
                                    </div>
                                </div>

                                <div style="display: flex; gap: 8px;">
                                    <input
                                        class="b3-text-field"
                                        type="text"
                                        placeholder={i18n('settingsSkillBlocksPlaceholder')}
                                        style="width: 100%;"
                                        bind:value={skillBlockIdInput}
                                    />
                                    <button
                                        class="b3-button b3-button--outline"
                                        style="white-space: nowrap;"
                                        disabled={isAddingSkillBlock}
                                        on:click={addSkillBlockIdsFromInput}
                                    >
                                        {i18n('settingsSkillAddIds')}
                                    </button>
                                </div>

                                {#if skillBlocks.length === 0}
                                    <div
                                        style="padding: 18px; text-align: center; color: var(--b3-theme-on-surface-light); border: 1px dashed var(--b3-border-color); border-radius: 4px;"
                                    >
                                        {i18n('settingsSkillBlocksDrop')}
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
                                                        {i18n('multiModelMoveUp')}
                                                    </button>
                                                    <button
                                                        class="b3-button b3-button--text"
                                                        style="padding: 4px 6px; font-size: 12px;"
                                                        disabled={index === skillBlocks.length - 1}
                                                        on:click={() => moveSkillBlock(block.id, 1)}
                                                    >
                                                        {i18n('multiModelMoveDown')}
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
                                                        {i18n('aiSidebarContextOpen')}
                                                    </button>
                                                    <button
                                                        class="b3-button b3-button--text"
                                                        style="padding: 4px 6px; font-size: 12px; color: var(--b3-theme-error);"
                                                        on:click={() => removeSkillBlock(block.id)}
                                                    >
                                                        {i18n('multiModelRemove')}
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
                                {i18n('settingsSkillMarkdownLabel')}
                            </div>
                            <textarea
                                class="b3-text-field"
                                style="font-family: monospace; min-height: 300px; resize: vertical; line-height: 1.5; font-size: 13px; padding: 8px;"
                                placeholder={i18n('settingsSkillMarkdownPlaceholder')}
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
                                {@html i18n('settingsSkillBlocksSourceHint')}
                            {:else}
                                {i18n('settingsSkillMarkdownHint')}
                            {/if}
                        </div>

                        <div
                            style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;"
                        >
                            <button
                                class="b3-button b3-button--text"
                                on:click={() => (showEditor = false)}
                            >
                                {i18n('platformCancel')}
                            </button>
                            <button class="b3-button" on:click={saveSkill}>{i18n('commonSave')}</button>
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
                            {tf('settingsSkillsLoadedCount', loadedSkills.length)}
                        </h4>
                        <div style="display: flex; gap: 8px;">
                            <button
                                class="b3-button b3-button--outline"
                                on:click={openSkillsFolder}
                            >
                                {i18n('settingsSkillFolderOpen')}
                            </button>
                            <button
                                class="b3-button b3-button--outline"
                                on:click={startCreateSkill}
                            >
                                {i18n('settingsSkillNew')}
                            </button>
                            <button class="b3-button b3-button--outline" on:click={refreshSkills}>
                                {i18n('settingsSkillRefresh')}
                            </button>
                        </div>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        {#if loadedSkills.length === 0}
                            <div
                                style="padding: 24px; text-align: center; border: 1px dashed var(--b3-border-color); border-radius: 4px; color: var(--b3-theme-on-surface-light);"
                            >
                                {@html i18n('settingsSkillsEmptyHint')}
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
                                                    ? tf('settingsSkillBlocksCount', skill.blockIds.length)
                                                    : 'Markdown'}
                                            </span>
                                        </span>
                                        <div style="display: flex; gap: 8px;">
                                            <button
                                                class="b3-button b3-button--text"
                                                style="padding: 4px 8px; font-size: 12px;"
                                                on:click={() => openSkillFolder(skill.id)}
                                            >
                                                {i18n('settingsFolderOpen')}
                                            </button>
                                            <button
                                                class="b3-button b3-button--text"
                                                style="padding: 4px 8px; font-size: 12px;"
                                                on:click={() => startEditSkill(skill)}
                                            >
                                                {i18n('commonEdit')}
                                            </button>
                                            <button
                                                class="b3-button b3-button--text"
                                                style="padding: 4px 8px; font-size: 12px; color: var(--b3-theme-error);"
                                                on:click={() => deleteSkill(skill)}
                                            >
                                                {i18n('commonDelete')}
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
                                                    {i18n('aiSidebarContextOpen')} {blockId}
                                                </button>
                                            {/each}
                                        </div>
                                    {/if}
                                    <div
                                        style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 4px; font-family: monospace; word-break: break-all;"
                                    >
                                        {i18n('commonPathLabel')} {skill.filePath}
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

    .config__tab-wrap > :global(.config__tab-container_plugin) {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
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

    .platform-main__mobile-header {
        display: none;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        flex-shrink: 0;
    }

    .platform-main__mobile-title {
        font-size: 14px;
        font-weight: 500;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        touch-action: none;

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
            gap: 0;
            overflow: hidden;
            position: relative;
        }

        .platform-sidebar {
            width: 100%;
            max-height: none;
            flex: 1;
        }

        .platform-sidebar--hidden-mobile {
            display: none;
        }

        .platform-main {
            min-height: 0;
            width: 100%;
            display: none;
            position: absolute;
            inset: 0;
            background: var(--b3-theme-background);
            z-index: 1;
        }

        .platform-main--mobile-open {
            display: flex;
        }

        .platform-main__mobile-header {
            display: flex;
        }

        .platform-item__drag-handle {
            display: flex;
            width: 28px;
            height: 32px;
            margin-left: -6px;
            opacity: 0.65;
        }

        :global(.platform-main--mobile-open .provider-config) {
            flex: 1;
            height: auto;
            min-height: 0;
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
