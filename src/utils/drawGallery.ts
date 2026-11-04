import type { DrawGenerationContext, Message, MessageAttachment } from '../ai-chat';

export interface DrawGalleryItem {
    key: string;
    image: MessageAttachment;
    prompt: string;
    generation?: DrawGenerationContext;
    referenceImages: MessageAttachment[];
}

/** 按生成批次从新到旧展示，批次内保留图片顺序；兼容旧会话且不修改消息历史。 */
export function getDrawGalleryItems(messages: Message[]): DrawGalleryItem[] {
    const batches: DrawGalleryItem[][] = [];
    let userPrompt = '';
    let userReferences: MessageAttachment[] = [];
    messages.forEach((message, messageIndex) => {
        if (message.role === 'user') {
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
        batches.push(images.map((image, imageIndex) => ({
            key: `${messageIndex}:${imageIndex}:${image.path || image.name}`,
            image,
            prompt: message.drawGeneration?.prompt || userPrompt,
            generation: message.drawGeneration,
            referenceImages: message.drawGeneration?.referenceImages || userReferences,
        })));
    });
    return batches.reverse().flat();
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
