import modelsData from './models.json';

/**
 * 规格化名称：转小写并将点和下划线替换为连字符，便于模糊/前缀匹配
 */
function normalizeName(name: string): string {
    return name.toLowerCase().replace(/[\._]/g, '-');
}

/**
 * 模型上下文限制估算工具
 */
export function getModelContextLimit(modelId: string, provider: string): number {
    const id = modelId.toLowerCase();
    
    // 对 modelId 进行处理：如果是 path 结构（如 provider/model-id），取最后一段
    const lastSegment = id.includes('/') ? id.split('/').pop() || id : id;

    const data = modelsData as Record<string, { contextLength?: number }>;
    const keys = Object.keys(data).sort((a, b) => b.length - a.length);

    // 1. 尝试使用 OpenRouter models.json 精确与模糊前缀匹配
    const normId = normalizeName(id);
    const normLastSegment = normalizeName(lastSegment);

    for (const key of keys) {
        const normKey = normalizeName(key);
        // 如果完全相同，或者模型 ID 以该 key 开头（例如 gpt-4o-mini 以 gpt-4o 开头），或者包含该 key
        if (
            normId === normKey || 
            normId.startsWith(normKey + '-') || 
            normId.includes(normKey)
        ) {
            if (data[key]?.contextLength) {
                return data[key].contextLength;
            }
        }
        if (
            normLastSegment === normKey || 
            normLastSegment.startsWith(normKey + '-') || 
            normLastSegment.includes(normKey)
        ) {
            if (data[key]?.contextLength) {
                return data[key].contextLength;
            }
        }
    }

    // 2. 如果 models.json 中没有找到，退回到基于命名的启发式匹配
    // 检查是否有显式限制后缀，例如 -8k, -32k, -128k, -2m 等
    if (id.endsWith('-8k') || id.includes('-8k-')) return 8000;
    if (id.endsWith('-16k') || id.includes('-16k-')) return 16000;
    if (id.endsWith('-32k') || id.includes('-32k-')) return 32000;
    if (id.endsWith('-64k') || id.includes('-64k-')) return 64000;
    if (id.endsWith('-128k') || id.includes('-128k-')) return 128000;
    if (id.endsWith('-256k') || id.includes('-256k-')) return 256000;
    if (id.endsWith('-512k') || id.includes('-512k-')) return 512000;
    if (id.endsWith('-1m') || id.includes('-1m-')) return 1000000;
    if (id.endsWith('-2m') || id.includes('-2m-')) return 2000000;

    // Gemini
    if (id.includes('gemini')) {
        if (id.includes('pro')) return 2000000;
        return 1000000;
    }
    
    // Claude
    if (id.includes('claude')) {
        return 200000; // 默认 Claude 3/3.5 为 200,000 (20万)
    }
    
    // GPT
    if (id.includes('gpt-4') || id.includes('gpt-4o') || id.includes('gpt-3.5') || id.includes('o1') || id.includes('o3')) {
        if (id.includes('32k')) return 32000;
        return 128000;
    }
    
    // DeepSeek
    if (id.includes('deepseek')) {
        return 64000;
    }

    // Moonshot/Kimi
    if (provider === 'moonshot') {
        if (id.includes('128k')) return 128000;
        if (id.includes('32k')) return 32000;
        if (id.includes('8k')) return 8000;
        return 128000;
    }

    // Qwen
    if (id.includes('qwen')) {
        if (id.includes('max') || id.includes('plus')) return 32000;
        if (id.includes('1m') || id.includes('long')) return 1000000;
        return 128000;
    }

    // Doubao
    if (id.includes('doubao')) {
        if (id.includes('32k')) return 32000;
        if (id.includes('128k')) return 128000;
        if (id.includes('4k')) return 4000;
        return 32000;
    }

    // Minimax
    if (id.includes('minimax') || id.includes('abab')) {
        return 128000;
    }

    return 128000;
}
