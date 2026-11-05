<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
    import type { DrawImageAnnotation, MessageAttachment } from '../ai-chat';
    import { saveAsset } from '../utils/assets';
    import { floatingLayer } from '../utils/floatingLayer';
    import { i18n, tf } from '../utils/i18n';
    import { createDrawAnnotation, getAnnotationPoint, paintDrawAnnotations, type AnnotationPoint } from '../utils/drawAnnotations';

    export let attachment: MessageAttachment;
    export let readImage: (image: MessageAttachment) => Promise<Blob>;
    const dispatch = createEventDispatcher();
    let regions: DrawImageAnnotation[] = (attachment.drawAnnotations?.regions || []).map(region => ({ ...region }));
    let selectedId = regions[0]?.id || '';
    let canvas: HTMLCanvasElement;
    let dialog: HTMLDivElement;
    let commentInputs: Record<string, HTMLTextAreaElement> = {};
    let sourceImage: HTMLImageElement;
    let sourceBlob: Blob;
    let sourceUrl = '';
    let ready = false;
    let saving = false;
    let error = '';
    let destroyed = false;
    let paintFrame = 0;
    let activePointer: number | null = null;
    let startPoint: AnnotationPoint | null = null;
    let draft: DrawImageAnnotation | null = null;
    const previousFocus = document.activeElement as HTMLElement | null;

    onMount(() => { void initialize(); dialog?.focus(); });
    onDestroy(() => {
        destroyed = true;
        if (paintFrame) cancelAnimationFrame(paintFrame);
        if (sourceUrl) URL.revokeObjectURL(sourceUrl);
        previousFocus?.focus({ preventScroll: true });
    });

    async function initialize() {
        try {
            sourceBlob = await readImage(attachment);
            if (destroyed) return;
            sourceUrl = URL.createObjectURL(sourceBlob);
            const image = new Image();
            await new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error(i18n('aiSidebarDrawAnnotationLoadFailed')));
                image.src = sourceUrl;
            });
            if (destroyed) return;
            sourceImage = image;
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            ready = true;
        } catch (reason) {
            if (!destroyed) error = (reason as Error).message || i18n('aiSidebarDrawAnnotationLoadFailed');
        }
    }

    function schedulePaint() {
        if (!ready || destroyed || paintFrame) return;
        paintFrame = requestAnimationFrame(() => {
            paintFrame = 0;
            const context = canvas.getContext('2d');
            if (!context) return;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(sourceImage, 0, 0);
            paintDrawAnnotations(context, canvas.width, canvas.height, draft ? [...regions, draft] : regions, selectedId);
        });
    }

    $: if (ready) { regions; selectedId; draft; schedulePaint(); }

    function pointerPoint(event: PointerEvent, clip = false) {
        return getAnnotationPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height, clip);
    }

    function startRegion(event: PointerEvent) {
        if (!ready || saving || activePointer !== null || event.button !== 0) return;
        const point = pointerPoint(event);
        if (!point) return;
        event.preventDefault();
        activePointer = event.pointerId;
        startPoint = point;
        draft = createDrawAnnotation(point, point, `region-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        canvas.setPointerCapture(event.pointerId);
    }

    function moveRegion(event: PointerEvent) {
        if (event.pointerId !== activePointer || !startPoint || !draft) return;
        const point = pointerPoint(event, true);
        if (point) draft = createDrawAnnotation(startPoint, point, draft.id);
    }

    async function finishRegion(event: PointerEvent) {
        if (event.pointerId !== activePointer || !startPoint) return;
        moveRegion(event);
        if (draft && draft.width > .003 && draft.height > .003) {
            regions = [...regions, draft];
            selectedId = draft.id;
            error = '';
        } else {
            const point = startPoint;
            const hit = [...regions].reverse().find(region => point.x >= region.x && point.x <= region.x + region.width &&
                point.y >= region.y && point.y <= region.y + region.height);
            if (hit) selectedId = hit.id;
        }
        cancelRegion(event);
        await tick();
        commentInputs[selectedId]?.focus();
    }

    function cancelRegion(event: PointerEvent) {
        if (event.pointerId !== activePointer) return;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        activePointer = null;
        startPoint = null;
        draft = null;
    }

    function removeRegion(id: string) {
        regions = regions.filter(region => region.id !== id);
        if (selectedId === id) selectedId = regions[0]?.id || '';
        error = '';
    }

    function close() {
        if (!saving) dispatch('close');
    }

    async function save() {
        if (!ready || saving || activePointer !== null) return;
        const missing = regions.find(region => !region.comment.trim());
        if (missing) {
            error = i18n('aiSidebarDrawAnnotationCommentRequired');
            selectedId = missing.id;
            commentInputs[missing.id]?.focus();
            return;
        }
        saving = true;
        error = '';
        try {
            let annotations: MessageAttachment['drawAnnotations'];
            if (regions.length) {
                const output = document.createElement('canvas');
                output.width = canvas.width;
                output.height = canvas.height;
                const context = output.getContext('2d');
                if (!context) throw new Error(i18n('aiSidebarDrawAnnotationSaveFailed'));
                context.drawImage(sourceImage, 0, 0);
                const savedRegions = regions.map(region => ({ ...region, comment: region.comment.trim() }));
                paintDrawAnnotations(context, output.width, output.height, savedRegions);
                const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(value => value ? resolve(value) :
                    reject(new Error(i18n('aiSidebarDrawAnnotationSaveFailed'))), 'image/png'));
                annotations = { imagePath: await saveAsset(blob, `annotation-${Date.now()}.png`), regions: savedRegions };
            }
            const originalPath = attachment.path || await saveAsset(sourceBlob, attachment.name);
            if (!destroyed) dispatch('save', { original: attachment,
                attachment: { ...attachment, path: originalPath, drawAnnotations: annotations } });
        } catch (reason) {
            if (!destroyed) error = (reason as Error).message || i18n('aiSidebarDrawAnnotationSaveFailed');
        } finally {
            saving = false;
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        if (!dialog || event.defaultPrevented || event.isComposing || getComputedStyle(dialog).visibility === 'hidden') return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if (event.key === 'Tab') {
            const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')];
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first?.focus();
            }
        }
    }
</script>

<svelte:window on:keydown|capture={handleKeydown} />

<div use:floatingLayer class="draw-annotation__overlay" role="presentation">
    <div class="draw-annotation" bind:this={dialog} role="dialog" aria-modal="true" tabindex="-1"
        aria-label={i18n('aiSidebarDrawAnnotationTitle')}>
        <header>
            <strong>{i18n('aiSidebarDrawAnnotationTitle')}</strong>
            <span title={attachment.name}>{attachment.name}</span>
            <button type="button" disabled={saving} on:click={close} aria-label={i18n('commonCancel')}>×</button>
        </header>
        <div class="draw-annotation__content">
            <div class="draw-annotation__workspace">
                <canvas bind:this={canvas} aria-label={i18n('aiSidebarDrawAnnotationHint')}
                    on:pointerdown={startRegion} on:pointermove={moveRegion} on:pointerup={finishRegion} on:pointercancel={cancelRegion}></canvas>
                {#if !ready && !error}<div class="draw-annotation__loading">{i18n('aiSidebarDrawAnnotationLoading')}</div>{/if}
            </div>
            <div class="draw-annotation__comments">
                <div class="draw-annotation__tools">
                    <button type="button" disabled={saving || !regions.length} on:click={() => { regions = []; selectedId = ''; error = ''; }}>
                        {i18n('aiSidebarDrawAnnotationClear')}
                    </button>
                </div>
                <div class="draw-annotation__regions">
                    {#if !regions.length}<p>{i18n('aiSidebarDrawAnnotationHint')}</p>{/if}
                    {#each regions as region, index (region.id)}
                        <div class="draw-annotation__region" class:draw-annotation__region--active={selectedId === region.id}>
                            <div class="draw-annotation__label">
                                <label for={region.id}>{tf('aiSidebarDrawAnnotationRegion', index + 1)}</label>
                                <button type="button" disabled={saving} on:click={() => removeRegion(region.id)}
                                    title={i18n('aiSidebarDrawAnnotationRemove')} aria-label={i18n('aiSidebarDrawAnnotationRemove')}>×</button>
                            </div>
                            <textarea id={region.id} bind:this={commentInputs[region.id]} bind:value={region.comment} disabled={saving}
                                on:focus={() => selectedId = region.id} on:input={() => error = ''} rows="3"
                                placeholder={i18n('aiSidebarDrawAnnotationPlaceholder')}></textarea>
                        </div>
                    {/each}
                </div>
                {#if error}<p class="draw-annotation__error" role="alert">{error}</p>{/if}
                <footer>
                    <button type="button" class="b3-button b3-button--outline" disabled={saving} on:click={close}>{i18n('commonCancel')}</button>
                    <button type="button" class="b3-button b3-button--primary" disabled={!ready || saving || activePointer !== null} on:click={save}>
                        {saving ? i18n('aiSidebarDrawAnnotationSaving') : i18n('commonSave')}
                    </button>
                </footer>
            </div>
        </div>
    </div>
</div>

<style>
    .draw-annotation__overlay { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; background: rgba(0,0,0,.6); }
    .draw-annotation { display: flex; flex-direction: column; width: min(1280px, calc(100vw - 32px)); height: min(900px, calc(100vh - 32px)); border-radius: 12px; overflow: hidden; outline: none; background: var(--b3-theme-background); color: var(--b3-theme-on-background); box-shadow: var(--b3-dialog-shadow); font-size: 13px; }
    button, textarea { font: inherit; color: inherit; }
    button { cursor: pointer; }
    button:disabled { opacity: .45; cursor: default; }
    button:focus-visible, textarea:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    header { display: flex; align-items: center; gap: 16px; padding: 12px 16px; border-bottom: 1px solid var(--b3-border-color); }
    header strong { flex-shrink: 0; } header span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--b3-theme-on-surface); }
    header button, .draw-annotation__label button { border: 0; background: transparent; font-size: 22px; line-height: 1; }
    .draw-annotation__content { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 280px; }
    .draw-annotation__workspace { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: #161616; }
    canvas { display: block; width: 100%; height: 100%; object-fit: contain; touch-action: none; cursor: crosshair; }
    .draw-annotation__loading { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; pointer-events: none; }
    .draw-annotation__comments { min-height: 0; display: flex; flex-direction: column; padding: 12px; gap: 12px; }
    .draw-annotation__tools { display: flex; justify-content: flex-end; }
    .draw-annotation__tools button { border: 0; border-radius: 4px; padding: 4px 8px; background: var(--b3-theme-surface); }
    .draw-annotation__regions { flex: 1; min-height: 0; overflow-y: auto; }
    .draw-annotation__regions > p { margin: 16px 4px; color: var(--b3-theme-on-surface); line-height: 1.7; }
    .draw-annotation__region { padding: 10px; margin-bottom: 10px; border: 1px solid var(--b3-border-color); border-radius: 8px; }
    .draw-annotation__region--active { border-color: var(--b3-theme-primary); }
    .draw-annotation__label { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .draw-annotation__label label { font-weight: 600; }
    textarea { box-sizing: border-box; width: 100%; resize: vertical; min-height: 76px; padding: 8px; border: 1px solid var(--b3-border-color); border-radius: 5px; background: var(--b3-theme-surface); line-height: 1.6; }
    .draw-annotation__error { margin: 0; color: var(--b3-theme-error); line-height: 1.6; overflow-wrap: anywhere; }
    footer { display: flex; justify-content: flex-end; gap: 8px; }
    @media (max-width: 640px) {
        .draw-annotation { width: calc(100vw - 16px); height: calc(100vh - 16px); }
        .draw-annotation__content { grid-template-columns: 1fr; grid-template-rows: minmax(0, 55%) minmax(0, 1fr); }
        .draw-annotation__comments { gap: 8px; }
    }
</style>
