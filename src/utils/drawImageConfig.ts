export type DrawImageResolution = '512' | '1K' | '2K' | '4K';
export type DrawImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'standard' | 'hd';

export interface DrawImageCapabilities {
    aspectRatios: string[];
    resolutions: DrawImageResolution[];
    qualities: DrawImageQuality[];
    defaultResolution: DrawImageResolution;
}

const COMMON_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

export function geminiModelSupportsImageSize(modelId: string): boolean {
    return /gemini-(?:3(?:\.\d+)?-(?:flash|pro)-image|nano-banana)/i.test(modelId);
}

export function getDrawImageCapabilities(modelId: string, isGemini: boolean): DrawImageCapabilities {
    if (isGemini) {
        const supportsResolution = geminiModelSupportsImageSize(modelId);
        const supportsSmall = /gemini-(?:3\.1-(?:flash|pro)-image|nano-banana-2(?:\.\d+)?)(?:$|[-_])/i.test(modelId);
        const resolutions: DrawImageResolution[] = supportsResolution
            ? supportsSmall ? ['512', '1K', '2K', '4K'] : ['1K', '2K', '4K']
            : ['1K'];
        const modelResolution = modelId.match(/(?:^|[-_])(1k|2k|4k)(?:$|[-_])/i)?.[1].toUpperCase();
        return {
            aspectRatios: ['auto', ...COMMON_RATIOS, ...(supportsSmall ? ['1:4', '4:1', '1:8', '8:1'] : [])],
            resolutions,
            qualities: [],
            defaultResolution: resolutions.find(value => value === modelResolution) || '1K',
        };
    }

    const isDalle = /dall-e/i.test(modelId);
    const isLegacyGpt = /gpt-image-1(?:[.-]|$)/i.test(modelId);
    const isDalle3 = /dall-e-3/i.test(modelId);
    const qualities: DrawImageQuality[] = isDalle
        ? isDalle3 ? ['standard', 'hd'] : ['standard']
        : ['auto', 'low', 'medium', 'high', ...(/gpt-image-2\.5/i.test(modelId) ? ['xhigh', 'max'] as const : [])];
    return {
        aspectRatios: ['auto', ...(isDalle
            ? isDalle3 ? ['1:1', '16:9', '9:16'] : ['1:1']
            : isLegacyGpt ? ['1:1', '3:2', '2:3'] : COMMON_RATIOS)],
        resolutions: [],
        qualities,
        defaultResolution: '1K',
    };
}

export function getClosestDrawAspectRatio(width: number, height: number, ratios = COMMON_RATIOS): string {
    const value = width / height;
    return ratios.filter(ratio => ratio !== 'auto').reduce((best, ratio) => {
        const numeric = (item: string) => {
            const [w, h] = item.split(':').map(Number);
            return w / h;
        };
        // 使用相对距离，让横版与竖版的匹配行为一致。
        return Math.abs(Math.log(numeric(ratio) / value)) < Math.abs(Math.log(numeric(best) / value)) ? ratio : best;
    });
}

export function inferDrawImageResolution(width: number, height: number): DrawImageResolution {
    const longEdge = Math.max(width, height);
    const resolutions = [
        { pixels: 1024, value: '1K' as const },
        { pixels: 2048, value: '2K' as const },
        { pixels: 4096, value: '4K' as const },
    ];
    return resolutions.reduce((best, item) =>
        Math.abs(item.pixels - longEdge) < Math.abs(best.pixels - longEdge) ? item : best
    ).value;
}

export function buildGeminiDrawImageConfig(modelId: string, aspectRatio: string, resolution: DrawImageResolution) {
    const capabilities = getDrawImageCapabilities(modelId, true);
    const config: { aspectRatio?: string; imageSize?: DrawImageResolution } = {};
    if (aspectRatio !== 'auto' && capabilities.aspectRatios.includes(aspectRatio)) {
        config.aspectRatio = aspectRatio;
    }
    if (geminiModelSupportsImageSize(modelId)) {
        config.imageSize = capabilities.resolutions.includes(resolution) ? resolution : capabilities.defaultResolution;
    }
    return Object.keys(config).length ? config : null;
}

/** GPT 的比例控件转换成 Images API 的 size，质量独立传入 quality。 */
export function getOpenAIDrawImageSize(modelId: string, aspectRatio: string): string {
    if (aspectRatio === 'auto') return /dall-e/i.test(modelId) ? '1024x1024' : 'auto';
    if (!getDrawImageCapabilities(modelId, false).aspectRatios.includes(aspectRatio)) return 'auto';
    if (/dall-e-3/i.test(modelId)) {
        return aspectRatio === '16:9' ? '1792x1024' : aspectRatio === '9:16' ? '1024x1792' : '1024x1024';
    }
    const sizes: Record<string, string> = {
        '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536',
        '4:3': '1536x1152', '3:4': '1152x1536', '5:4': '1280x1024',
        '4:5': '1024x1280', '16:9': '1536x864', '9:16': '864x1536', '21:9': '1536x656',
    };
    return sizes[aspectRatio] || 'auto';
}
