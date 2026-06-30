<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { pushMsg, pushErrMsg } from '../api';

    export let isOpen = false;
    export let plugin: any;
    export let editAppId: string | null = null;
    export let webApps: Array<{
        id: string;
        name: string;
        url: string;
        icon?: string;
        createdAt: number;
        updatedAt: number;
    }> = [];

    const dispatch = createEventDispatcher();

    // 编辑状态
    let editingApp: any = null;
    let isEditMode = false;
    let showForm = false; // 控制是否显示表单
    let editForm = {
        name: '',
        url: '',
        icon: '',
        showInSidebar: false,
    };
    let iconFile: File | null = null;
    let fileInputElement: HTMLInputElement;
    let isUploadingIcon = false;

    // 图标选择模态
    let showIconSelector = false;
    let isFetchingIcons = false;
    let fetchedIcons: Array<{
        source: string;
        url: string;
        dataUrl?: string;
    }> = [];

    // 拖拽排序
    let draggedIndex: number | null = null;
    let dragOverIndex: number | null = null;
    let dropPosition: 'before' | 'after' | null = null; // 插入位置：之前或之后

    // 打开添加小程序对话框
    function openAddDialog() {
        isEditMode = false;
        editingApp = null;
        showForm = true;
        editForm = {
            name: '',
            url: '',
            icon: '',
            showInSidebar: false,
        };
        iconFile = null;
    }

    // 打开编辑小程序对话框
    function openEditDialog(app: any) {
        isEditMode = true;
        editingApp = app;
        showForm = true;
        editForm = {
            name: app.name,
            url: app.url,
            icon: app.icon || '',
            showInSidebar: !!app.showInSidebar,
        };
        iconFile = null;
    }

    // 取消编辑
    function cancelEdit() {
        const wasEditOnly = !!editAppId;

        isEditMode = false;
        editingApp = null;
        showForm = false;
        editForm = {
            name: '',
            url: '',
            icon: '',
            showInSidebar: false,
        };
        iconFile = null;
        editAppId = null;

        // 便捷编辑模式下取消即关闭弹窗，不回到列表
        if (wasEditOnly) {
            isOpen = false;
        }
    }

    // 打开指定 id 的小程序编辑表单
    function openEditDialogById(appId: string | null) {
        if (!appId) return;
        const app = webApps.find(a => a.id === appId);
        if (app) {
            openEditDialog(app);
        }
    }

    // 当管理器以 editAppId 打开时，自动进入编辑模式
    $: if (isOpen && editAppId) {
        openEditDialogById(editAppId);
    }

    function normalizeWebAppUrl(url: string): string {
        const trimmed = url.trim();
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
        return trimmed;
    }

    // 保存小程序
    async function saveWebApp() {
        if (!editForm.name.trim()) {
            pushErrMsg('请输入小程序名称');
            return;
        }
        if (!editForm.url.trim()) {
            pushErrMsg('请输入网站链接');
            return;
        }

        const normalizedUrl = normalizeWebAppUrl(editForm.url);

        // 验证 URL 格式
        try {
            new URL(normalizedUrl);
        } catch (e) {
            pushErrMsg('网站链接格式不正确');
            return;
        }

        try {
            let iconBase64 = editForm.icon;

            // 如果选择了新的图标文件，转换为base64
            if (iconFile) {
                isUploadingIcon = true;
                iconBase64 = await convertToBase64(iconFile);
                isUploadingIcon = false;
            }

            if (isEditMode && editingApp) {
                // 更新现有小程序
                const index = webApps.findIndex(app => app.id === editingApp.id);
                if (index !== -1) {
                    webApps[index] = {
                        ...editingApp,
                        name: editForm.name.trim(),
                        url: normalizedUrl,
                        icon: iconBase64,
                        showInSidebar: editForm.showInSidebar,
                        sidebarPosition: 'RightBottom',
                        updatedAt: Date.now(),
                    };
                    pushMsg('小程序已更新');
                }
            } else {
                // 添加新小程序
                const newApp = {
                    id: generateId(),
                    name: editForm.name.trim(),
                    url: normalizedUrl,
                    icon: iconBase64,
                    showInSidebar: editForm.showInSidebar,
                    sidebarPosition: 'RightBottom',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };
                webApps = [...webApps, newApp];
                pushMsg('小程序已添加');
            }

            // 通知父组件保存设置
            dispatch('save', { webApps });

            // 关闭编辑对话框
            cancelEdit();
        } catch (e) {
            console.error('保存小程序失败:', e);
            pushErrMsg('保存小程序失败: ' + e.message);
            isUploadingIcon = false;
        }
    }

    // 删除小程序
    async function deleteWebApp(app: any) {
        if (confirm(`确定要删除小程序"${app.name}"吗？`)) {
            try {
                webApps = webApps.filter(a => a.id !== app.id);
                dispatch('save', { webApps });
                pushMsg('小程序已删除');
            } catch (e) {
                console.error('删除小程序失败:', e);
                pushErrMsg('删除小程序失败: ' + e.message);
            }
        }
    }

    // 打开小程序
    function openWebApp(app: any) {
        dispatch('open', { app });
        close();
    }

    // 将文件转换为base64
    async function convertToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                resolve(reader.result as string);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // 选择图标文件
    function selectIconFile() {
        fileInputElement?.click();
    }

    // 处理文件选择
    function handleFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            const file = input.files[0];

            // 验证文件类型
            if (!file.type.startsWith('image/')) {
                pushErrMsg('请选择图片文件');
                return;
            }

            // 验证文件大小（限制为 2MB）
            if (file.size > 2 * 1024 * 1024) {
                pushErrMsg('图片文件不能超过 2MB');
                return;
            }

            iconFile = file;
        }
    }

    // 从 URL 获取图标
    async function fetchIconFromUrl() {
        if (!editForm.url.trim()) {
            pushErrMsg('请先输入网站链接');
            return;
        }

        if (isFetchingIcons) {
            return; // 防止重复点击
        }

        try {
            const url = new URL(editForm.url);
            isFetchingIcons = true;
            showIconSelector = true;
            fetchedIcons = [];

            // 尝试多种方式获取图标
            const results = await Promise.allSettled([
                // 方式1: 使用 favicon.im 服务
                fetchIconFromFaviconIm(url),
                // 方式2: Google Favicons API
                fetchIconFromGoogle(url),
                // 方式3: Unavatar
                fetchIconFromUnavatar(url),
                // 方式4: DuckDuckGo Icons
                fetchIconFromDuckDuckGo(url),
                // 方式5: 尝试常见的图标路径
                fetchIconFromCommonPaths(url),
            ]);

            // 收集成功获取的图标
            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    if (Array.isArray(result.value)) {
                        fetchedIcons = [...fetchedIcons, ...result.value];
                    } else {
                        fetchedIcons = [...fetchedIcons, result.value];
                    }
                }
            });

            if (fetchedIcons.length === 0) {
                pushErrMsg('无法获取网站图标，请手动上传');
                showIconSelector = false;
            }
        } catch (e) {
            console.error('获取网站图标失败:', e);
            pushErrMsg('获取网站图标失败，请手动上传');
            showIconSelector = false;
        } finally {
            isFetchingIcons = false;
        }
    }

    // 从 favicon.im 服务获取图标
    async function fetchIconFromFaviconIm(url: URL) {
        try {
            const faviconUrl = `https://favicon.im/${url.host}`;
            const response = await fetch(faviconUrl);
            if (!response.ok) {
                throw new Error('Failed to fetch from favicon.im');
            }

            const blob = await response.blob();
            const file = new File([blob], 'favicon.png', { type: blob.type });
            const dataUrl = await convertToBase64(file);

            return {
                source: 'Favicon.im',
                url: faviconUrl,
                dataUrl,
            };
        } catch (e) {
            console.error('从 favicon.im 获取图标失败:', e);
            return null;
        }
    }

    // 从 Google Favicons API 获取图标
    async function fetchIconFromGoogle(url: URL) {
        try {
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${url.host}&sz=128`;
            const response = await fetch(faviconUrl);
            if (!response.ok) {
                throw new Error('Failed to fetch from Google');
            }

            const blob = await response.blob();
            const file = new File([blob], 'favicon.png', { type: blob.type });
            const dataUrl = await convertToBase64(file);

            return {
                source: 'Google Favicons',
                url: faviconUrl,
                dataUrl,
            };
        } catch (e) {
            console.error('从 Google 获取图标失败:', e);
            return null;
        }
    }

    // 从 Unavatar 获取图标
    async function fetchIconFromUnavatar(url: URL) {
        try {
            const faviconUrl = `https://unavatar.io/${url.host}`;
            const response = await fetch(faviconUrl);
            if (!response.ok) {
                throw new Error('Failed to fetch from Unavatar');
            }

            const blob = await response.blob();
            const file = new File([blob], 'favicon.png', { type: blob.type });
            const dataUrl = await convertToBase64(file);

            return {
                source: 'Unavatar',
                url: faviconUrl,
                dataUrl,
            };
        } catch (e) {
            console.error('从 Unavatar 获取图标失败:', e);
            return null;
        }
    }

    // 从 DuckDuckGo Icons 获取图标
    async function fetchIconFromDuckDuckGo(url: URL) {
        try {
            const faviconUrl = `https://icons.duckduckgo.com/ip3/${url.host}.ico`;
            const response = await fetch(faviconUrl);
            if (!response.ok) {
                throw new Error('Failed to fetch from DuckDuckGo');
            }

            const blob = await response.blob();
            const file = new File([blob], 'favicon.ico', { type: blob.type });
            const dataUrl = await convertToBase64(file);

            return {
                source: 'DuckDuckGo Icons',
                url: faviconUrl,
                dataUrl,
            };
        } catch (e) {
            console.error('从 DuckDuckGo 获取图标失败:', e);
            return null;
        }
    }

    // 从网站源获取 favicon.ico
    async function fetchIconFromCommonPaths(url: URL) {
        // 尝试多个常见的图标路径
        const commonPaths = [
            '/favicon.ico',
            '/favicon.svg',
            '/favicon.png',
            '/apple-touch-icon.png',
            '/_/static/branding/v5/light_mode/favicon/favicon.svg', // Google NotebookLM 等
        ];

        const results = [];

        for (const path of commonPaths) {
            try {
                const faviconUrl = `${url.origin}${path}`;

                // 使用 Image 对象验证并获取图片
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';

                    const timeout = setTimeout(() => {
                        reject(new Error('Timeout'));
                    }, 3000); // 3秒超时

                    img.onload = () => {
                        clearTimeout(timeout);
                        try {
                            // 将图片转换为 base64
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0);
                            const base64 = canvas.toDataURL('image/png');
                            resolve(base64);
                        } catch (e) {
                            reject(e);
                        }
                    };

                    img.onerror = () => {
                        clearTimeout(timeout);
                        reject(new Error('Failed to load favicon'));
                    };

                    img.src = faviconUrl;
                });

                results.push({
                    source: `网站源文件 (${path})`,
                    url: faviconUrl,
                    dataUrl: dataUrl,
                });
            } catch (e) {
                // 静默失败，继续尝试下一个路径
                console.debug(`尝试获取 ${path} 失败:`, e);
            }
        }

        return results.length > 0 ? results : null;
    }

    // 选择图标
    function selectFetchedIcon(icon: any) {
        editForm.icon = icon.dataUrl;
        iconFile = null;
        showIconSelector = false;
        fetchedIcons = [];
        pushMsg('已选择图标');
    }

    // 取消图标选择
    function cancelIconSelection() {
        showIconSelector = false;
        fetchedIcons = [];
    }

    // 生成唯一 ID
    function generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // 获取图标 URL（如果是base64直接返回）
    function getIconUrl(icon: string): string {
        if (!icon) return '';
        // 如果已经是base64格式，直接返回
        if (icon.startsWith('data:')) {
            return icon;
        }
    }

    // 关闭对话框
    function close() {
        isOpen = false;
        cancelEdit();
    }

    // 拖拽开始
    function handleDragStart(index: number) {
        draggedIndex = index;
    }

    // 拖拽进入
    function handleDragEnter(index: number, event: DragEvent) {
        if (draggedIndex === null || draggedIndex === index) {
            return;
        }

        dragOverIndex = index;

        // 判断插入位置（在目标元素之前还是之后）
        const target = event.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        if (event.clientY < midpoint) {
            dropPosition = 'before';
        } else {
            dropPosition = 'after';
        }
    }

    // 拖拽结束
    function handleDragEnd() {
        if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
            const newWebApps = [...webApps];
            const draggedItem = newWebApps[draggedIndex];
            newWebApps.splice(draggedIndex, 1);

            // 根据 dropPosition 调整插入位置
            let insertIndex = dragOverIndex;
            if (draggedIndex < dragOverIndex) {
                insertIndex = dragOverIndex;
                if (dropPosition === 'before') {
                    insertIndex--;
                }
            } else {
                insertIndex = dragOverIndex;
                if (dropPosition === 'after') {
                    insertIndex++;
                }
            }

            newWebApps.splice(insertIndex, 0, draggedItem);
            webApps = newWebApps;
            dispatch('save', { webApps });
        }
        draggedIndex = null;
        dragOverIndex = null;
        dropPosition = null;
    }

    // 阻止默认拖拽行为
    function handleDragOver(event: DragEvent) {
        event.preventDefault();

        // 更新 dropPosition
        if (draggedIndex !== null && dragOverIndex !== null) {
            const target = event.currentTarget as HTMLElement;
            const rect = target.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;

            if (event.clientY < midpoint) {
                dropPosition = 'before';
            } else {
                dropPosition = 'after';
            }
        }
    }

    // 处理 Escape 键
    function handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            if (showIconSelector) {
                cancelIconSelection();
            } else if (isEditMode || editingApp || showForm) {
                cancelEdit();
            } else {
                close();
            }
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
    <div class="webapp-manager-overlay" on:click={close}>
        <div class="webapp-manager" on:click|stopPropagation>
            <div class="webapp-manager__header">
                <h3 class="webapp-manager__title">小程序管理</h3>
                <button class="b3-button b3-button--text" on:click={close}>
                    <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                </button>
            </div>

            <div class="webapp-manager__content">
                {#if !showForm && !editAppId}
                    <!-- 小程序列表 -->
                    <div class="webapp-manager__list">
                        <div class="webapp-manager__list-header">
                            <button class="b3-button b3-button--primary" on:click={openAddDialog}>
                                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                添加小程序
                            </button>
                        </div>

                        {#if webApps.length === 0}
                            <div class="webapp-manager__empty">
                                <p>还没有添加小程序</p>
                                <p class="webapp-manager__empty-hint">
                                    点击"添加小程序"按钮来添加你的第一个小程序
                                </p>
                            </div>
                        {:else}
                            <div class="webapp-manager__items">
                                {#each webApps as app, index (app.id)}
                                    <div
                                        class="webapp-item"
                                        class:dragging={draggedIndex === index}
                                        class:drop-before={dragOverIndex === index &&
                                            dropPosition === 'before' &&
                                            draggedIndex !== index}
                                        class:drop-after={dragOverIndex === index &&
                                            dropPosition === 'after' &&
                                            draggedIndex !== index}
                                        draggable="true"
                                        role="button"
                                        tabindex="0"
                                        on:dragstart={() => handleDragStart(index)}
                                        on:dragenter={e => handleDragEnter(index, e)}
                                        on:dragover={handleDragOver}
                                        on:dragend={handleDragEnd}
                                    >
                                        <div class="webapp-item__drag-handle" title="拖动排序">
                                            <svg><use xlink:href="#iconMove"></use></svg>
                                        </div>
                                        <div class="webapp-item__icon">
                                            {#if app.icon}
                                                <img src={getIconUrl(app.icon)} alt={app.name} />
                                            {:else}
                                                <svg><use xlink:href="#iconGlobe"></use></svg>
                                            {/if}
                                        </div>
                                        <div class="webapp-item__info">
                                            <div class="webapp-item__name">{app.name}</div>
                                            <div class="webapp-item__url">{app.url}</div>
                                        </div>
                                        <div class="webapp-item__actions">
                                            <button
                                                class="b3-button b3-button--text"
                                                on:click={() => openWebApp(app)}
                                                title="打开"
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconOpenWindow"></use>
                                                </svg>
                                            </button>
                                            <button
                                                class="b3-button b3-button--text"
                                                on:click={() => openEditDialog(app)}
                                                title="编辑"
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconEdit"></use>
                                                </svg>
                                            </button>
                                            <button
                                                class="b3-button b3-button--text"
                                                on:click={() => deleteWebApp(app)}
                                                title="删除"
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconTrashcan"></use>
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {:else}
                    <!-- 编辑/添加表单 -->
                    <div class="webapp-manager__form">
                        <div class="webapp-manager__form-header">
                            <h4>{isEditMode ? '编辑小程序' : '添加小程序'}</h4>
                            <button class="b3-button b3-button--text" on:click={cancelEdit}>
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconClose"></use>
                                </svg>
                            </button>
                        </div>

                        <div class="webapp-manager__form-body">
                            <div class="webapp-manager__form-item">
                                <label class="webapp-manager__form-label">名称 *</label>
                                <input
                                    type="text"
                                    class="b3-text-field"
                                    bind:value={editForm.name}
                                    placeholder="请输入小程序名称"
                                />
                            </div>

                            <div class="webapp-manager__form-item">
                                <label class="webapp-manager__form-label">网站链接 *</label>
                                <input
                                    type="text"
                                    class="b3-text-field"
                                    bind:value={editForm.url}
                                    placeholder="https://example.com 或 www.example.com"
                                />
                            </div>

                            <div class="webapp-manager__form-item">
                                <label class="webapp-manager__form-label">图标</label>
                                <div class="webapp-manager__icon-selector">
                                    <div class="webapp-manager__icon-preview">
                                        {#if iconFile}
                                            <img
                                                src={URL.createObjectURL(iconFile)}
                                                alt="Preview"
                                            />
                                        {:else if editForm.icon}
                                            <img
                                                src={getIconUrl(editForm.icon)}
                                                alt="Current icon"
                                            />
                                        {:else}
                                            <svg><use xlink:href="#iconGlobe"></use></svg>
                                        {/if}
                                    </div>
                                    <div class="webapp-manager__icon-actions">
                                        <button
                                            class="b3-button"
                                            on:click={selectIconFile}
                                            disabled={isUploadingIcon || isFetchingIcons}
                                        >
                                            <svg class="b3-button__icon">
                                                <use xlink:href="#iconUpload"></use>
                                            </svg>
                                            上传图标
                                        </button>
                                        <button
                                            class="b3-button"
                                            on:click={fetchIconFromUrl}
                                            disabled={isFetchingIcons}
                                        >
                                            <svg class="b3-button__icon">
                                                <use xlink:href="#iconDownload"></use>
                                            </svg>
                                            {isFetchingIcons ? '获取中...' : '获取网站图标'}
                                        </button>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            bind:this={fileInputElement}
                                            on:change={handleFileSelect}
                                            style="display: none;"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div class="webapp-manager__form-item">
                                <label class="webapp-manager__form-label">注册到侧栏</label>
                                <label class="fn__flex" style="align-items: center; gap: 8px; cursor: pointer;">
                                    <input
                                        type="checkbox"
                                        class="b3-switch"
                                        bind:checked={editForm.showInSidebar}
                                    />
                                    <span>在思源侧边栏中作为一个独立面板显示</span>
                                </label>
                            </div>

                            <!-- 侧栏位置选项已取消，默认即为右下角，用户可通过思源笔记拖拽调整 -->

                            <div class="webapp-manager__form-item" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 8px;">
                                <span>* 修改侧栏设置需重新加载/启用插件以生效</span>
                            </div>
                        </div>

                        <div class="webapp-manager__form-footer">
                            <button class="b3-button b3-button--cancel" on:click={cancelEdit}>
                                取消
                            </button>
                            <button
                                class="b3-button b3-button--primary"
                                on:click={saveWebApp}
                                disabled={isUploadingIcon || isFetchingIcons}
                            >
                                {isUploadingIcon
                                    ? '上传中...'
                                    : isFetchingIcons
                                      ? '获取中...'
                                      : '保存'}
                            </button>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<!-- 图标选择模态 -->
{#if showIconSelector}
    <div class="icon-selector-overlay" on:click={cancelIconSelection}>
        <div class="icon-selector" on:click|stopPropagation>
            <div class="icon-selector__header">
                <h3 class="icon-selector__title">选择图标</h3>
                <button class="b3-button b3-button--text" on:click={cancelIconSelection}>
                    <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                </button>
            </div>

            <div class="icon-selector__content">
                {#if isFetchingIcons}
                    <div class="icon-selector__loading">
                        <div class="icon-selector__spinner"></div>
                        <p>正在获取图标...</p>
                    </div>
                {:else if fetchedIcons.length > 0}
                    <div class="icon-selector__options">
                        {#each fetchedIcons as icon (icon.source)}
                            <button class="icon-option" on:click={() => selectFetchedIcon(icon)}>
                                <div class="icon-option__preview">
                                    <img src={icon.dataUrl} alt={icon.source} />
                                </div>
                                <div class="icon-option__info">
                                    <div class="icon-option__source">{icon.source}</div>
                                    <div class="icon-option__url">{icon.url}</div>
                                </div>
                            </button>
                        {/each}
                    </div>
                {:else}
                    <div class="icon-selector__empty">
                        <p>未能获取到图标</p>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style lang="scss">
    .webapp-manager-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }

    .webapp-manager {
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        width: 90%;
        max-width: 600px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
    }

    .webapp-manager__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .webapp-manager__title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
    }

    .webapp-manager__content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
    }

    .webapp-manager__list-header {
        margin-bottom: 16px;
    }

    .webapp-manager__empty {
        text-align: center;
        padding: 40px 20px;
        color: var(--b3-theme-on-surface-light);
    }

    .webapp-manager__empty-hint {
        font-size: 12px;
        margin-top: 8px;
    }

    .webapp-manager__items {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .webapp-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        transition: all 0.2s ease;
        cursor: move;
        position: relative;

        &:hover {
            background: var(--b3-theme-surface-lighter);
            border-color: var(--b3-theme-primary);
        }

        &.dragging {
            opacity: 0.4;
            cursor: grabbing;
        }

        // 上方指示器
        &.drop-before::before {
            content: '';
            position: absolute;
            top: -2px;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--b3-theme-primary);
            border-radius: 2px;
            box-shadow: 0 0 4px var(--b3-theme-primary);
        }

        // 下方指示器
        &.drop-after::after {
            content: '';
            position: absolute;
            bottom: -2px;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--b3-theme-primary);
            border-radius: 2px;
            box-shadow: 0 0 4px var(--b3-theme-primary);
        }
    }

    .webapp-item__drag-handle {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        color: var(--b3-theme-on-surface-light);
        flex-shrink: 0;

        &:active {
            cursor: grabbing;
        }

        svg {
            width: 16px;
            height: 16px;
        }
    }

    .webapp-item__icon {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        overflow: hidden;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);

        img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        svg {
            width: 24px;
            height: 24px;
            color: var(--b3-theme-on-surface-light);
        }
    }

    .webapp-item__info {
        flex: 1;
        min-width: 0;
    }

    .webapp-item__name {
        font-weight: 500;
        margin-bottom: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .webapp-item__url {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .webapp-item__actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .webapp-manager__form {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .webapp-manager__form-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;

        h4 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }
    }

    .webapp-manager__form-body {
        flex: 1;
        overflow-y: auto;
    }

    .webapp-manager__form-item {
        margin-bottom: 20px;

        .b3-text-field {
            width: 100%;
        }
    }

    .webapp-manager__form-label {
        display: block;
        margin-bottom: 8px;
        font-weight: 500;
        font-size: 14px;
    }

    .webapp-manager__icon-selector {
        display: flex;
        align-items: center;
        gap: 16px;
    }

    .webapp-manager__icon-preview {
        width: 60px;
        height: 60px;
        border-radius: 8px;
        overflow: hidden;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);

        img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        svg {
            width: 32px;
            height: 32px;
            color: var(--b3-theme-on-surface-light);
        }
    }

    .webapp-manager__icon-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
    }

    .webapp-manager__form-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding-top: 16px;
        border-top: 1px solid var(--b3-border-color);
        margin-top: 16px;
    }

    // 图标选择器样式
    .icon-selector-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1001;
    }

    .icon-selector {
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        width: 90%;
        max-width: 500px;
        max-height: 70vh;
        display: flex;
        flex-direction: column;
    }

    .icon-selector__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .icon-selector__title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
    }

    .icon-selector__content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
    }

    .icon-selector__loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        color: var(--b3-theme-on-surface-light);
    }

    .icon-selector__spinner {
        width: 40px;
        height: 40px;
        border: 3px solid var(--b3-border-color);
        border-top-color: var(--b3-theme-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-bottom: 16px;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .icon-selector__options {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .icon-option {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px;
        background: var(--b3-theme-surface);
        border: 2px solid var(--b3-border-color);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        width: 100%;
        text-align: left;

        &:hover {
            background: var(--b3-theme-surface-lighter);
            border-color: var(--b3-theme-primary);
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }

        &:active {
            transform: translateY(0);
        }
    }

    .icon-option__preview {
        width: 64px;
        height: 64px;
        border-radius: 8px;
        overflow: hidden;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);

        img {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
    }

    .icon-option__info {
        flex: 1;
        min-width: 0;
    }

    .icon-option__source {
        font-weight: 600;
        margin-bottom: 4px;
        color: var(--b3-theme-on-surface);
    }

    .icon-option__url {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .icon-selector__empty {
        text-align: center;
        padding: 40px 20px;
        color: var(--b3-theme-on-surface-light);
    }
</style>
