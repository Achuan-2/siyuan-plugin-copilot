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

/** 在原图分辨率绘制边框和编号，评论通过文本单独传给模型。 */
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
    return image.type === 'image' && image.drawAnnotations?.imagePath
        ? image.drawAnnotations.regions.filter(region => region.comment.trim() && region.width > 0 && region.height > 0)
        : [];
}

export function hasDrawAnnotationComments(images: MessageAttachment[]): boolean {
    return images.some(image => annotatedRegions(image).length > 0);
}

/** 每张原图后紧接对应的标注副本；原图与生成快照均不被覆盖。 */
export function createDrawRequestReferences(images: MessageAttachment[]): MessageAttachment[] {
    return images.flatMap(image => annotatedRegions(image).length ? [image, {
        type: 'image' as const, name: `annotation-guide-${image.name}.png`,
        path: image.drawAnnotations!.imagePath, mimeType: 'image/png', data: '',
    }] : [image]);
}

export function buildDrawAnnotationPrompt(prompt: string, images: MessageAttachment[]): string {
    const instructions: string[] = [];
    let imageNumber = 0;
    for (const image of images) {
        imageNumber++;
        const regions = annotatedRegions(image);
        if (!regions.length) continue;
        const originalNumber = imageNumber++;
        instructions.push(`Original input image ${originalNumber} (${image.name}), annotated guide image ${imageNumber}:\n` +
            regions.map((region, index) => `${index + 1}. Region (left ${Math.round(region.x * 100)}%, top ${Math.round(region.y * 100)}%, ` +
                `width ${Math.round(region.width * 100)}%, height ${Math.round(region.height * 100)}%): ${region.comment.trim()}`).join('\n'));
    }
    if (!instructions.length) return prompt;
    return `${prompt}\n\nReference image annotations (editing instructions):\n` +
        'Each original image is followed by its numbered annotation guide. Match each numbered box to the comment below. ' +
        'Boxes and number badges are guides only; do not include them in the output. ' +
        'Preserve unmentioned areas unless the user requests otherwise.\n\n' + instructions.join('\n\n');
}
