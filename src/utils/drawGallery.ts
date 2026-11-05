import type { DrawGenerationContext, Message, MessageAttachment } from '../ai-chat';

export interface DrawGalleryRequest {
    key: string;
    prompt: string;
    generation?: DrawGenerationContext;
    referenceImages: MessageAttachment[];
}

export interface DrawGalleryItem extends DrawGalleryRequest {
    image: MessageAttachment;
}

export interface DrawGalleryFailure extends DrawGalleryRequest {
    error: string;
    interrupted: boolean;
}

export type DrawGalleryCard = DrawGalleryItem | DrawGalleryFailure;

export interface DrawPendingTask {
    key: string;
    count: number;
    status: string;
    prompt: string;
}

/** 按生成批次从新到旧展示，批次内保留图片顺序；兼容旧会话且不修改消息历史。 */
export function getDrawGalleryItems(messages: Message[]): DrawGalleryItem[] {
    return getDrawGalleryCards(messages).filter((card): card is DrawGalleryItem => 'image' in card);
}

/** 未完成的请求恢复为失败卡片；仍在运行的各轮请求由独立任务卡片展示。 */
export function getDrawGalleryCards(
    messages: Message[], loading = false, activeGenerations?: ReadonlySet<DrawGenerationContext>
): DrawGalleryCard[] {
    const batches: DrawGalleryCard[][] = [];
    let userPrompt = '';
    let userReferences: MessageAttachment[] = [];
    let userGeneration: DrawGenerationContext | undefined;
    let userIndex = -1;
    let answered = true;
    function addInterruptedRequest() {
        if (answered || userIndex < 0) return;
        if (userGeneration && activeGenerations?.has(userGeneration)) return;
        batches.push([{
            key: `${userIndex}:failed`, prompt: userGeneration?.prompt || userPrompt,
            generation: userGeneration, referenceImages: userGeneration?.referenceImages || userReferences,
            error: '', interrupted: true,
        }]);
    }
    messages.forEach((message, messageIndex) => {
        if (message.role === 'user') {
            addInterruptedRequest();
            userIndex = messageIndex;
            userGeneration = message.drawGeneration;
            answered = Boolean(message.drawFailureDismissed);
            userPrompt = typeof message.content === 'string' ? message.content :
                message.content.filter(part => part.type === 'text').map(part => part.text || '').join('\n');
            userReferences = message.attachments?.filter(image => image.type === 'image') || [];
            return;
        }
        if (message.role !== 'assistant') return;
        const attachments = message.attachments?.filter(image => image.type === 'image') || [];
        const images: MessageAttachment[] = message.generatedImages?.length
            ? message.generatedImages.map((image, index) => ({
                type: 'image', name: image.name || attachments[index]?.name || `image-${index + 1}.png`,
                path: image.path || attachments[index]?.path,
                mimeType: image.mimeType || attachments[index]?.mimeType || 'image/png',
                data: attachments[index]?.data || (image as typeof image & { previewUrl?: string }).previewUrl ||
                    image.url || (image.data ? `data:${image.mimeType || 'image/png'};base64,${image.data}` : '') || image.path || '',
            })) : [...attachments];
        if (!images.length && typeof message.content === 'string') {
            for (const match of message.content.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
                images.push({ type: 'image', name: match[1] || 'image.png', data: match[2],
                    path: match[2].startsWith('/data/') ? match[2] : undefined });
            }
        }
        const generation = message.drawGeneration || userGeneration;
        const error = message.drawGenerationError ||
            (typeof message.content === 'string' && message.content.startsWith('❌') ? message.content : '');
        if (images.length) {
            answered = true;
        } else if (error) {
            answered = true;
            if (!message.drawFailureDismissed) batches.push([{
                key: `${messageIndex}:failed`, prompt: generation?.prompt || userPrompt,
                generation, referenceImages: generation?.referenceImages || userReferences,
                error, interrupted: false,
            }]);
        } else if (!generation && typeof message.content === 'string' && message.content.trim()) {
            // 兼容会话中切换到画图模式之前已经完成的普通文字回复。
            answered = true;
        }
        batches.push(images.map((image, imageIndex) => ({
            key: `${messageIndex}:${imageIndex}:${image.path || image.name}`,
            image,
            prompt: generation?.prompt || userPrompt,
            generation,
            referenceImages: generation?.referenceImages || userReferences,
        })));
    });
    if (!loading || activeGenerations) addInterruptedRequest();
    return batches.reverse().flat();
}

/** 恢复重试草稿后移除对应失败卡片；保留消息供历史和其他图片分支使用。 */
export function dismissDrawGalleryFailure(messages: Message[], key: string, sourceMessages = messages): Message[] {
    const failure = getDrawGalleryCards(sourceMessages).find(card => card.key === key && !('image' in card));
    if (!failure) return messages;
    const sourceMessage = sourceMessages[Number(failure.key.split(':')[0])];
    if (!messages.includes(sourceMessage)) return messages;
    return messages.map(message => message === sourceMessage
        ? { ...message, drawFailureDismissed: true }
        : message);
}

/** 参考图持久化只保留资源路径或稳定 URL，避免把临时 blob URL 写进生成记录。 */
export function snapshotDrawReferences(images: MessageAttachment[]): MessageAttachment[] {
    return images.map(image => ({ ...image, data: image.path ? '' : image.data, drawEditSource: undefined }));
}

export function getDrawEditReferences(item: DrawGalleryItem): MessageAttachment[] {
    const originalReferences = item.generation?.originalReferenceImages || item.referenceImages;
    const images = [{ ...item.image, drawEditSource: true }, ...originalReferences];
    const seen = new Set<string>();
    return images.filter(image => {
        const key = image.path || image.data;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function buildDrawBranchPrompt(prompt: string, history: string[]): string {
    if (!history.length) return prompt;
    return `Previous requests for this image (context only):\n${history.map((text, index) => `${index + 1}. ${text}`).join('\n')}\n\nCurrent edit request (takes priority):\n${prompt}`;
}

export function createDrawGenerationContext(
    prompt: string,
    requestPrompt: string,
    history: string[],
    references: MessageAttachment[],
    provider: string,
    modelId: string,
    settings: DrawGenerationContext['settings']
): DrawGenerationContext {
    return {
        prompt, requestPrompt, history: [...history, prompt],
        referenceImages: snapshotDrawReferences(references),
        originalReferenceImages: snapshotDrawReferences(references.filter(image => !image.drawEditSource)),
        provider, modelId, settings: { ...settings }, createdAt: Date.now(),
    };
}
