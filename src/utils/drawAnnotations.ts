import type { DrawImageAnnotation, MessageAttachment } from '../ai-chat';

export interface AnnotationPoint { x: number; y: number }
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** 将 contain 布局中的指针换算到原图坐标，排除宽高比造成的留白。 */
export function getAnnotationPoint(
    clientX: number, clientY: number,
    rect: { left: number; top: number; width: number; height: number },
    imageWidth: number, imageHeight: number, clip = false
): AnnotationPoint | null {
    if (rect.width <= 0 || rect.height <= 0 || imageWidth <= 0 || imageHeight <= 0) return null;
    const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    const x = (clientX - rect.left - (rect.width - width) / 2) / width;
    const y = (clientY - rect.top - (rect.height - height) / 2) / height;
    if (!clip && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
    return { x: clamp(x), y: clamp(y) };
}

export function createDrawAnnotation(start: AnnotationPoint, end: AnnotationPoint, id: string): DrawImageAnnotation {
    const left = Math.min(clamp(start.x), clamp(end.x));
    const top = Math.min(clamp(start.y), clamp(end.y));
    return { id, x: left, y: top, width: Math.max(clamp(start.x), clamp(end.x)) - left,
        height: Math.max(clamp(start.y), clamp(end.y)) - top, comment: '' };
}

/** 在原图分辨率绘制本地预览用的边框和编号，不作为模型输入图片。 */
export function paintDrawAnnotations(
    context: CanvasRenderingContext2D, width: number, height: number,
    regions: DrawImageAnnotation[], selectedId = ''
) {
    context.save();
    const unit = Math.max(2, Math.min(width, height) / 350);
    const radius = unit * 4;
    context.lineWidth = unit;
    context.font = `bold ${radius * 1.3}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    regions.forEach((region, index) => {
        const color = region.id === selectedId ? '#009dff' : '#ff3b30';
        const x = region.x * width;
        const y = region.y * height;
        context.strokeStyle = color;
        context.strokeRect(x, y, region.width * width, region.height * height);
        const badgeX = Math.min(width - radius, Math.max(radius, x + radius));
        const badgeY = Math.min(height - radius, Math.max(radius, y + radius));
        context.beginPath();
        context.arc(badgeX, badgeY, radius, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        context.fillStyle = '#ffffff';
        context.fillText(String(index + 1), badgeX, badgeY);
    });
    context.restore();
}

function annotatedRegions(image: MessageAttachment): DrawImageAnnotation[] {
    return image.type === 'image'
        ? image.drawAnnotations?.regions.filter(region => region.comment.trim() && region.width > 0 && region.height > 0) || []
        : [];
}

export function hasDrawAnnotationComments(images: MessageAttachment[]): boolean {
    return images.some(image => annotatedRegions(image).length > 0);
}

/** 只上传干净原图，标注坐标与评论由提示词提供，避免模型把标记当作画面内容。 */
export function createDrawRequestReferences(images: MessageAttachment[]): MessageAttachment[] {
    return images.filter(image => image.type === 'image').map(({ drawAnnotations, ...image }) => image);
}

export function buildDrawAnnotationPrompt(prompt: string, images: MessageAttachment[]): string {
    const instructions: string[] = [];
    let imageNumber = 0;
    for (const image of images.filter(image => image.type === 'image')) {
        imageNumber++;
        const regions = annotatedRegions(image);
        if (!regions.length) continue;
        instructions.push(`Input image ${imageNumber} (${image.name}):\n` +
            regions.map((region, index) => `${index + 1}. Region (left ${Math.round(region.x * 100)}%, top ${Math.round(region.y * 100)}%, ` +
                `width ${Math.round(region.width * 100)}%, height ${Math.round(region.height * 100)}%): ${region.comment.trim()}`).join('\n'));
    }
    if (!instructions.length) return prompt;
    return `${prompt}\n\nReference image annotations (editing instructions):\n` +
        'Use the supplied clean original images as the editing base. The regions below are described only in text; ' +
        'coordinates are percentages of each image, measured from its top-left corner (x increases to the right, y increases downward). ' +
        'Apply each comment to the corresponding region. Region numbers and coordinates are instructions only: ' +
        'do not draw region boundaries, boxes, outlines, number badges, labels, coordinates or comments in the output. ' +
        'Preserve unmentioned areas unless the user requests otherwise.\n\n' + instructions.join('\n\n');
}
