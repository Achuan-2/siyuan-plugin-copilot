<script lang="ts">
    import { onMount } from "svelte";
    import SettingPanel from "@/libs/components/setting-panel.svelte";
    import { t } from "./utils/i18n";
    import { getDefaultSettings } from "./defaultSettings";
    import { pushMsg, pushErrMsg, lsNotebooks } from "./api";
    import { confirm } from "siyuan";
    import ProviderConfigPanel from "./components/ProviderConfigPanel.svelte";
    import type { CustomProviderConfig } from "./defaultSettings";
    export let plugin;

    // 使用动态默认设置
    let settings = { ...getDefaultSettings() };

    // 笔记本列表
    let notebookOptions: Record<string, string> = {};

    interface ISettingGroup {
        name: string;
        items: ISettingItem[];
        //  Type："checkbox" | "select" | "textinput" | "textarea" | "number" | "slider" | "button" | "hint" | "custom";
    }

    const builtInProviderNames: Record<string, string> = {
        gemini: t("platform.builtIn.gemini"),
        deepseek: t("platform.builtIn.deepseek"),
        moonshot: t("platform.builtIn.moonshot"),
        openai: t("platform.builtIn.openai"),
        volcano: t("platform.builtIn.volcano"),
        v3: t("platform.builtIn.v3"),
    };

    // 内置平台的默认 API 地址
    const builtInProviderDefaultUrls: Record<string, string> = {
        gemini: "https://generativelanguage.googleapis.com",
        deepseek: "https://api.deepseek.com",
        moonshot: "https://api.moonshot.cn",
        openai: "https://api.openai.com",
        volcano: "https://ark.cn-beijing.volces.com",
        v3: "https://api.v3.cm",
    };

    // 内置平台的官网链接
    const builtInProviderWebsites: Record<string, string> = {
        gemini: "https://aistudio.google.com/apikey",
        deepseek: "https://platform.deepseek.com/",
        moonshot: "https://platform.moonshot.cn/",
        openai: "https://platform.openai.com/",
        volcano: "https://console.volcengine.com/ark",
        v3: "https://api.gpt.ge/register?aff=fQIZ",
    };

    // 当前选中的平台ID
    let selectedProviderId = "";

    // 新增自定义平台相关状态
    let showAddPlatform = false;
    let newPlatformName = "";

    // 拖拽排序相关状态
    let draggedIndex: number | null = null;
    let dragOverIndex: number | null = null;

    // 拖拽开始
    function handleDragStart(event: DragEvent, index: number) {
        draggedIndex = index;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/html", "");
        }
    }

    // 拖拽经过
    function handleDragOver(event: DragEvent, index: number) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }
        dragOverIndex = index;
    }

    // 拖拽离开
    function handleDragLeave() {
        dragOverIndex = null;
    }

    // 放置
    function handleDrop(event: DragEvent, dropIndex: number) {
        event.preventDefault();

        if (draggedIndex === null || draggedIndex === dropIndex) {
            draggedIndex = null;
            dragOverIndex = null;
            return;
        }

        // 重新排序平台列表
        const newProviderOptions = [...allProviderOptions];
        const [draggedItem] = newProviderOptions.splice(draggedIndex, 1);
        newProviderOptions.splice(dropIndex, 0, draggedItem);

        // 保存新的排序（所有平台的ID顺序）
        const newPlatformOrder = newProviderOptions.map(
            (platform) => platform.id,
        );

        // 同时更新 customProviders 数组的顺序，保持与 platformOrder 一致
        const customProviders = settings.aiProviders?.customProviders || [];
        const orderedCustomProviders: CustomProviderConfig[] = [];

        newPlatformOrder.forEach((id) => {
            const customProvider = customProviders.find((p) => p.id === id);
            if (customProvider) {
                orderedCustomProviders.push(customProvider);
            }
        });

        // 更新设置
        settings = {
            ...settings,
            platformOrder: newPlatformOrder,
            aiProviders: {
                ...settings.aiProviders,
                customProviders: orderedCustomProviders,
            },
        };

        saveSettings();
        pushMsg("平台顺序已更新");

        draggedIndex = null;
        dragOverIndex = null;
    }

    // 拖拽结束
    function handleDragEnd() {
        draggedIndex = null;
        dragOverIndex = null;
    }

    function handleProviderChange() {
        saveSettings();
    }

    // 处理平台重命名
    function handleProviderRename(providerId: string, newName: string) {
        const provider = settings.aiProviders.customProviders.find(
            (p) => p.id === providerId,
        );
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
            pushErrMsg(t("platform.nameRequired"));
            return;
        }

        const newPlatform: CustomProviderConfig = {
            id: generateCustomPlatformId(),
            name: newPlatformName.trim(),
            apiKey: "",
            customApiUrl: "",
            models: [],
        };

        // 使用响应式更新确保 Svelte 检测到变化
        settings = {
            ...settings,
            aiProviders: {
                ...settings.aiProviders,
                customProviders: [
                    ...settings.aiProviders.customProviders,
                    newPlatform,
                ],
            },
            // 自动选中新创建的平台（仅设置面板，不影响对话）
            selectedProviderId: newPlatform.id,
        };

        // 更新本地选中状态
        selectedProviderId = newPlatform.id;

        newPlatformName = "";
        showAddPlatform = false;
        saveSettings();
        pushMsg(
            t("aiSidebar.success.addPromptSuccess") + `: ${newPlatform.name}`,
        );
    }

    // 删除平台（内置平台也可删除）
    function removePlatform(providerId: string) {
        const platformName =
            builtInProviderNames[providerId] ||
            settings.aiProviders?.customProviders?.find(
                (p) => p.id === providerId,
            )?.name ||
            t("platform.unknown");

        confirm(
            t("aiSidebar.confirm.deletePlatform.title"),
            t("aiSidebar.confirm.deletePlatform.message", { platformName }),
            async () => {
                // 检查是否需要清空当前选中的模型
                // 只有当删除的平台是当前正在使用的平台时才清空模型选择
                const shouldClearModel =
                    settings.currentProvider === providerId;

                // 如果是内置平台，删除其所有配置
                if (builtInProviderNames[providerId]) {
                    // 使用响应式更新确保 Svelte 检测到变化
                    settings = {
                        ...settings,
                        aiProviders: {
                            ...settings.aiProviders,
                            [providerId]: {
                                apiKey: "",
                                customApiUrl: "",
                                models: [],
                            },
                        },
                    };
                } else {
                    // 如果是自定义平台，从列表中移除
                    // 使用响应式更新确保 Svelte 检测到变化
                    const filteredProviders =
                        settings.aiProviders.customProviders.filter(
                            (p) => p.id !== providerId,
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
                    selectedProviderId = "";
                    settings.selectedProviderId = "";
                }

                // 只有当删除的平台是当前对话使用的平台时，才清空对话中的平台和模型选择
                if (shouldClearModel) {
                    settings = {
                        ...settings,
                        currentProvider: "",
                        currentModelId: "",
                    };
                }

                saveSettings();
                pushMsg(
                    t("aiSidebar.success.deletePromptSuccess") +
                        `: ${platformName}`,
                );
            },
        );
    }

    // 获取所有平台选项（内置+自定义） - 使用响应式语句
    $: allProviderOptions = (() => {
        // 获取所有平台的ID和配置
        const builtInIds = Object.keys(builtInProviderNames);
        const customProviders = settings.aiProviders?.customProviders || [];
        const customIds = customProviders.map((p) => p.id);
        const allPlatformIds = [...builtInIds, ...customIds];

        // 如果有保存的排序，使用保存的顺序
        let orderedPlatformIds: string[];
        if (settings.platformOrder && settings.platformOrder.length > 0) {
            // 使用保存的顺序，并添加任何新的平台
            orderedPlatformIds = [
                ...settings.platformOrder.filter((id) =>
                    allPlatformIds.includes(id),
                ),
                ...allPlatformIds.filter(
                    (id) => !settings.platformOrder.includes(id),
                ),
            ];
        } else {
            // 使用默认顺序：内置平台在前，自定义平台在后
            orderedPlatformIds = allPlatformIds;
        }

        // 根据排序后的ID列表生成平台选项
        return orderedPlatformIds
            .map((id) => {
                if (builtInIds.includes(id)) {
                    return {
                        id,
                        name: builtInProviderNames[id],
                        type: "built-in" as const,
                    };
                } else {
                    const customProvider = customProviders.find(
                        (p) => p.id === id,
                    );
                    if (customProvider) {
                        return {
                            id: customProvider.id,
                            name: customProvider.name,
                            type: "custom" as const,
                        };
                    }
                }
            })
            .filter(Boolean) as Array<{
            id: string;
            name: string;
            type: "built-in" | "custom";
        }>;
    })();

    // 获取当前选中平台的名称 - 使用响应式语句
    $: selectedProviderName = (() => {
        if (!selectedProviderId) return t("platform.select");

        if (builtInProviderNames[selectedProviderId]) {
            return builtInProviderNames[selectedProviderId];
        }

        const customProvider = settings.aiProviders?.customProviders?.find(
            (p: CustomProviderConfig) => p.id === selectedProviderId,
        );
        return customProvider?.name || t("platform.unknown");
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
            name: t("settings.settingsGroup.systemPrompt"),
            items: [
                {
                    key: "aiSystemPrompt",
                    value: settings.aiSystemPrompt,
                    type: "textarea",
                    title: t("settings.ai.systemPrompt.title"),
                    description: t("settings.ai.systemPrompt.description"),
                    direction: "row",
                    rows: 4,
                    placeholder: t("settings.ai.systemPrompt.placeholder"),
                },
            ],
        },
        {
            name: t("settings.settingsGroup.platformManagement"),
            items: [],
        },
        {
            name: t("settings.settingsGroup.displayAndOperation"),
            items: [
                {
                    key: "sendMessageShortcut",
                    value: settings.sendMessageShortcut,
                    type: "select",
                    title: t("settings.sendMessageShortcut.title"),
                    description: t("settings.sendMessageShortcut.description"),
                    options: {
                        "ctrl+enter": t(
                            "settings.sendMessageShortcut.options.ctrlEnter",
                        ),
                        enter: t("settings.sendMessageShortcut.options.enter"),
                    },
                },
                {
                    key: "messageFontSize",
                    value: settings.messageFontSize,
                    type: "number",
                    title: t("settings.messageFontSize.title"),
                    description: t("settings.messageFontSize.description"),
                    number: {
                        min: 5,
                        max: 32,
                        step: 1,
                    },
                },
                {
                    key: "modeSelectorType",
                    value: settings.modeSelectorType,
                    type: "select",
                    title: t("settings.modeSelectorType.title"),
                    description: t("settings.modeSelectorType.description"),
                    options: {
                        buttons: t("settings.modeSelectorType.options.buttons"),
                        select: t("settings.modeSelectorType.options.select"),
                    },
                },
            ],
        },
        {
            name: t("settings.settingsGroup.noteExport"),
            items: [
                {
                    key: "exportNotebook",
                    value: settings.exportNotebook,
                    type: "select",
                    title: t("settings.exportNotebook.title"),
                    description: t("settings.exportNotebook.description"),
                    options: notebookOptions,
                },
                {
                    key: "exportDefaultPath",
                    value: settings.exportDefaultPath,
                    type: "textinput",
                    title: t("settings.exportDefaultPath.title"),
                    description: t("settings.exportDefaultPath.description"),
                    placeholder: t("settings.exportDefaultPath.placeholder"),
                },
            ],
        },
        {
            name: t("settings.settingsGroup.sessionManagement") || "会话管理",
            items: [
                {
                    key: "autoRenameSession",
                    value: settings.autoRenameSession,
                    type: "checkbox",
                    title:
                        t("settings.autoRenameSession.title") ||
                        "会话自动重命名",
                    description:
                        t("settings.autoRenameSession.description") ||
                        "在首次发送消息时，自动使用AI生成会话标题",
                },
            ],
        },
        {
            name: t("settings.settingsGroup.reset") || "Reset Settings",
            items: [
                {
                    key: "reset",
                    value: "",
                    type: "button",
                    title: t("settings.reset.title") || "Reset Settings",
                    description:
                        t("settings.reset.description") ||
                        "Reset all settings to default values",
                    button: {
                        label: t("settings.reset.label") || "Reset",
                        callback: async () => {
                            confirm(
                                t("settings.reset.title") || "Reset Settings",
                                t("settings.reset.confirmMessage") ||
                                    "Are you sure you want to reset all settings to default values? This action cannot be undone.",
                                async () => {
                                    // 确认回调
                                    settings = { ...getDefaultSettings() };
                                    updateGroupItems();
                                    await saveSettings();
                                    await pushMsg(t("settings.reset.message"));
                                },
                                () => {
                                    // 取消回调（可选）
                                    console.log("Reset cancelled");
                                },
                            );
                        },
                    },
                },
            ],
        },
        {
            name: "❤️用爱发电",
            items: [
                {
                    key: "donateInfo",
                    value: "",
                    type: "hint",
                    title: "用爱发电",
                    description: `
                        <p style="margin-top:12px;">如果喜欢我的插件，欢迎给GitHub仓库点star和微信赞赏，这会激励我继续完善此插件和开发新插件。</p>

                        <p style="margin-top:12px;">维护插件费时费力，个人时间和精力有限，开源只是分享，不等于我要浪费我的时间免费帮用户实现ta需要的功能，</p>

                        <p style="margin-top:12px;">我需要的功能我会慢慢改进（打赏可以催更），有些我觉得可以改进、但是现阶段不必要的功能需要打赏才改进（会标注打赏标签和需要打赏金额），而不需要的功能、实现很麻烦的功能会直接关闭issue不考虑实现，我没实现的功能欢迎有大佬来pr</p>

                        <p style="margin-top:12px;">累积赞赏50元的朋友如果想加我微信，可以在赞赏的时候备注微信号，或者发邮件到<a href="mailto:achuan-2@outlook.com">achuan-2@outlook.com</a>来进行好友申请</p>

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
        const setting = settings[detail.key];
        if (setting !== undefined) {
            settings[detail.key] = detail.value;
            saveSettings();
        }
    };

    async function saveSettings() {
        await plugin.saveSettings(settings);
    }

    onMount(async () => {
        await runload();
    });

    async function runload() {
        const loadedSettings = await plugin.loadSettings();
        settings = { ...loadedSettings };

        // 确保 aiProviders 存在
        if (!settings.aiProviders) {
            settings.aiProviders = {
                gemini: { apiKey: "", customApiUrl: "", models: [] },
                deepseek: { apiKey: "", customApiUrl: "", models: [] },
                openai: { apiKey: "", customApiUrl: "", models: [] },
                moonshot: { apiKey: "", customApiUrl: "", models: [] },
                volcano: { apiKey: "", customApiUrl: "", models: [] },
                v3: { apiKey: "", customApiUrl: "", models: [] },
                customProviders: [],
            };
        }

        // 确保每个内置平台都存在（支持旧配置升级）
        const builtInPlatformIds = [
            "gemini",
            "deepseek",
            "openai",
            "moonshot",
            "volcano",
            "v3",
        ];
        for (const platformId of builtInPlatformIds) {
            if (!settings.aiProviders[platformId]) {
                settings.aiProviders[platformId] = {
                    apiKey: "",
                    customApiUrl: "",
                    models: [],
                };
            }
        }

        // 确保 customProviders 数组存在
        if (!settings.aiProviders.customProviders) {
            settings.aiProviders.customProviders = [];
        }

        // 恢复选中的平台ID（仅用于设置面板显示）
        // 优先使用 selectedProviderId，如果不存在则使用 currentProvider 作为初始值
        selectedProviderId =
            settings.selectedProviderId || settings.currentProvider || "openai";

        // 确保 selectedProviderId 设置被保存
        if (!settings.selectedProviderId) {
            settings.selectedProviderId = selectedProviderId;
        }

        // 加载笔记本列表
        await loadNotebooks();

        updateGroupItems();
        // 确保设置已保存（可能包含新的默认值）
        await saveSettings();

        // console.debug(t('common.configComplete'));
    }

    // 加载笔记本列表
    async function loadNotebooks() {
        try {
            const notebooks = await lsNotebooks();
            if (notebooks?.notebooks && notebooks.notebooks.length > 0) {
                // 构建笔记本选项对象 { id: name }，只显示 closed=false 的笔记本
                notebookOptions = {};
                notebookOptions[""] =
                    t("settings.exportNotebook.placeholder") ||
                    "-- 请选择笔记本 --";
                notebooks.notebooks
                    .filter((notebook) => notebook.closed === false)
                    .forEach((notebook) => {
                        notebookOptions[notebook.id] = notebook.name;
                    });
            } else {
                notebookOptions = {
                    "":
                        t("settings.exportNotebook.placeholder") ||
                        "-- 请选择笔记本 --",
                };
            }
        } catch (error) {
            console.error("Load notebooks error:", error);
            notebookOptions = {
                "":
                    t("settings.exportNotebook.placeholder") ||
                    "-- 请选择笔记本 --",
            };
        }
    }

    function updateGroupItems() {
        groups = groups.map((group) => ({
            ...group,
            items: group.items.map((item) => {
                const updatedItem: any = {
                    ...item,
                    value: settings[item.key] ?? item.value,
                };
                // 为笔记本选择器更新 options
                if (item.key === "exportNotebook") {
                    updatedItem.options = notebookOptions;
                }
                return updatedItem;
            }),
        }));
    }

    $: currentGroup = groups.find((group) => group.name === focusGroup);
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
                on:keydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
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
        {#if focusGroup === t("settings.settingsGroup.systemPrompt")}
            <SettingPanel
                group={currentGroup?.name || ""}
                settingItems={currentGroup?.items || []}
                display={true}
                on:changed={onChanged}
            />
        {:else if focusGroup === t("settings.settingsGroup.platformManagement")}
            <!-- 新的侧边栏布局：左侧为平台列表/操作，右侧为平台配置主区域 -->
            <div class="platform-management-layout">
                <aside class="platform-sidebar">
                    <div class="unified-platform-manager">
                        <div class="manager-header">
                            <h5>{t("platform.management")}</h5>
                            <button
                                class="b3-button b3-button--outline"
                                on:click={() =>
                                    (showAddPlatform = !showAddPlatform)}
                            >
                                {showAddPlatform
                                    ? t("platform.cancel")
                                    : t("platform.add")}
                            </button>
                        </div>

                        {#if showAddPlatform}
                            <div class="add-platform-form">
                                <div>
                                    <div>{t("platform.name")}</div>
                                    <input
                                        class="b3-text-field fn__flex-1"
                                        type="text"
                                        bind:value={newPlatformName}
                                        placeholder={t(
                                            "platform.namePlaceholder",
                                        )}
                                        on:keydown={(e) =>
                                            e.key === "Enter" &&
                                            addCustomPlatform()}
                                    />
                                </div>
                                <button
                                    class="b3-button b3-button--outline"
                                    on:click={addCustomPlatform}
                                    disabled={!newPlatformName.trim()}
                                >
                                    {t("platform.confirmAdd")}
                                </button>
                            </div>
                        {/if}

                        <div class="platform-list">
                            {#each allProviderOptions as platform, index}
                                <div
                                    class="platform-item"
                                    class:platform-item--selected={selectedProviderId ===
                                        platform.id}
                                    class:platform-item--dragging={draggedIndex ===
                                        index}
                                    class:platform-item--drag-over={dragOverIndex ===
                                        index}
                                    draggable="true"
                                    on:dragstart={(e) =>
                                        handleDragStart(e, index)}
                                    on:dragover={(e) =>
                                        handleDragOver(e, index)}
                                    on:dragleave={handleDragLeave}
                                    on:drop={(e) => handleDrop(e, index)}
                                    on:dragend={handleDragEnd}
                                    on:click={() => {
                                        selectedProviderId = platform.id;
                                        handleProviderSelect();
                                    }}
                                    on:keydown={(e) => {
                                        if (
                                            e.key === "Enter" ||
                                            e.key === " "
                                        ) {
                                            selectedProviderId = platform.id;
                                            handleProviderSelect();
                                        }
                                    }}
                                    role="button"
                                    tabindex="0"
                                >
                                    <div
                                        class="platform-item__drag-handle"
                                        title="拖动排序"
                                    >
                                        <svg class="b3-button__icon">
                                            <use xlink:href="#iconMenu"></use>
                                        </svg>
                                    </div>
                                    <div class="platform-item__info">
                                        <span class="platform-item__name"
                                            >{platform.name}</span
                                        >
                                        <span class="platform-item__type">
                                            {platform.type === "built-in"
                                                ? t("platform.type.builtin")
                                                : t("platform.type.custom")}
                                        </span>
                                    </div>
                                    <button
                                        class="b3-button b3-button--text b3-button--error"
                                        on:click|stopPropagation={() =>
                                            removePlatform(platform.id)}
                                        title="删除平台"
                                    >
                                        <svg class="b3-button__icon">
                                            <use xlink:href="#iconTrashcan"
                                            ></use>
                                        </svg>
                                    </button>
                                </div>
                            {/each}
                            {#if allProviderOptions.length === 0}
                                <div class="empty-hint">暂无可用平台</div>
                            {/if}
                        </div>
                    </div>
                </aside>

                <main class="platform-main">
                    {#if selectedProviderId}
                        {#if builtInProviderNames[selectedProviderId]}
                            {#key selectedProviderId}
                                <ProviderConfigPanel
                                    providerId={selectedProviderId}
                                    providerName={selectedProviderName}
                                    defaultApiUrl={builtInProviderDefaultUrls[
                                        selectedProviderId
                                    ]}
                                    websiteUrl={builtInProviderWebsites[
                                        selectedProviderId
                                    ]}
                                    bind:config={
                                        settings.aiProviders[selectedProviderId]
                                    }
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
                                            on:rename={(e) =>
                                                handleProviderRename(
                                                    customProvider.id,
                                                    e.detail.newName,
                                                )}
                                        />
                                    {/key}
                                {/if}
                            {/each}
                        {/if}
                    {:else}
                        <div class="no-selection">
                            {t("platform.selectHint") ||
                                "请选择一个平台以查看或编辑其配置"}
                        </div>
                    {/if}
                </main>
            </div>
        {:else if focusGroup === (t("settings.settingsGroup.sessionManagement") || "会话管理")}
            <div class="session-management-panel">
                <SettingPanel
                    group={currentGroup?.name || ""}
                    settingItems={currentGroup?.items || []}
                    display={true}
                    on:changed={onChanged}
                />

                {#if settings.autoRenameSession}
                    <div class="auto-rename-model-selector">
                        <div class="config__item">
                            <div class="config__item-label">
                                <div class="config__item-title">
                                    {t(
                                        "settings.autoRenameSession.modelTitle",
                                    ) || "重命名模型"}
                                </div>
                                <div class="config__item-description">
                                    {t(
                                        "settings.autoRenameSession.modelDescription",
                                    ) || "选择用于生成会话标题的AI模型"}
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
                                        settings.autoRenameModelId = "";
                                        saveSettings();
                                    }}
                                >
                                    <option value=""
                                        >{t(
                                            "settings.autoRenameSession.selectProvider",
                                        ) || "-- 选择平台 --"}</option
                                    >
                                    {#each allProviderOptions as provider}
                                        {#if settings.aiProviders[provider.id]?.models?.length > 0 || (provider.type === "custom" && settings.aiProviders.customProviders.find((p) => p.id === provider.id)?.models?.length > 0)}
                                            <option value={provider.id}
                                                >{provider.name}</option
                                            >
                                        {/if}
                                    {/each}
                                </select>

                                {#if settings.autoRenameProvider}
                                    <select
                                        class="b3-select"
                                        bind:value={settings.autoRenameModelId}
                                        on:change={saveSettings}
                                    >
                                        <option value=""
                                            >{t(
                                                "settings.autoRenameSession.selectModel",
                                            ) || "-- 选择模型 --"}</option
                                        >
                                        {#if builtInProviderNames[settings.autoRenameProvider]}
                                            {#each settings.aiProviders[settings.autoRenameProvider]?.models || [] as model}
                                                <option value={model.id}
                                                    >{model.name ||
                                                        model.id}</option
                                                >
                                            {/each}
                                        {:else}
                                            {#each settings.aiProviders.customProviders.find((p) => p.id === settings.autoRenameProvider)?.models || [] as model}
                                                <option value={model.id}
                                                    >{model.name ||
                                                        model.id}</option
                                                >
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
                                    {t(
                                        "settings.autoRenameSession.promptTitle",
                                    ) || "自定义提示词"}
                                </div>
                                <div class="config__item-description">
                                    {t(
                                        "settings.autoRenameSession.promptDescription",
                                    ) ||
                                        "自定义生成会话标题的提示词，使用 {message} 作为用户消息的占位符"}
                                </div>
                            </div>
                            <div class="config__item-control">
                                <textarea
                                    class="b3-text-field"
                                    rows="4"
                                    bind:value={settings.autoRenamePrompt}
                                    on:change={saveSettings}
                                    placeholder={t(
                                        "settings.autoRenameSession.promptPlaceholder",
                                    ) ||
                                        "请根据以下用户消息生成一个简洁的会话标题（不超过20个字，不要使用引号）：\n\n{message}"}
                                ></textarea>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        {:else}
            <SettingPanel
                group={currentGroup?.name || ""}
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
    }
    .config__panel > .b3-tab-bar {
        width: 170px;
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
        gap: 8px;

        &:hover {
            background: var(--b3-theme-surface);
            border-color: var(--b3-theme-primary);
        }

        &.platform-item--selected {
            background: var(--b3-theme-primary-lightest);
            border-color: var(--b3-theme-primary);
        }

        &.platform-item--dragging {
            opacity: 0.5;
            cursor: grabbing;
        }

        &.platform-item--drag-over {
            border-color: var(--b3-theme-primary);
            border-width: 2px;
            border-style: dashed;
        }
    }

    .platform-item__drag-handle {
        display: flex;
        align-items: center;
        cursor: grab;
        color: var(--b3-theme-on-surface-light);
        opacity: 0.6;
        transition: opacity 0.2s;
        flex-shrink: 0;

        &:hover {
            opacity: 1;
        }

        &:active {
            cursor: grabbing;
        }

        svg {
            width: 16px;
            height: 16px;
        }
    }

    .platform-item__info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
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
</style>
