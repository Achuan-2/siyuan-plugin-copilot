import type { Message } from '../ai-chat';

export type ChatSessionMode = 'ask' | 'agent' | 'draw';

export function createChatSessionId(): string {
    const suffix = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    return `session_${Date.now()}_${suffix}`;
}

export function hasGeneratedSessionImages(messages: Message[]): boolean {
    return messages.some(message => message.role === 'assistant' && (
        !!message.generatedImages?.length ||
        !!message.attachments?.some(attachment => attachment.type === 'image')
    ));
}

export function resolveChatSessionMode(
    messages: Message[], savedMode?: ChatSessionMode, drawModeLocked = false
): ChatSessionMode {
    if (drawModeLocked || hasGeneratedSessionImages(messages)) return 'draw';
    return savedMode === 'agent' || savedMode === 'draw' ? savedMode : 'ask';
}

export interface SessionMetadata {
    id: string;
    [key: string]: unknown;
}

export interface SessionMetadataChanges {
    updates: SessionMetadata[];
    deletedIds: string[];
}

/** 只记录本视图修改过的字段，后台视图中的旧列表不能覆盖其他会话的新进度。 */
export function diffSessionMetadata(previous: SessionMetadata[], next: SessionMetadata[]): SessionMetadataChanges {
    const before = new Map(previous.map(session => [session.id, session]));
    const ids = new Set(next.map(session => session.id));
    const updates: SessionMetadata[] = [];
    for (const session of next) {
        const old = before.get(session.id);
        const changed: SessionMetadata = { id: session.id };
        for (const [key, value] of Object.entries(session)) {
            if (key !== 'id' && (!old || JSON.stringify(old[key]) !== JSON.stringify(value))) changed[key] = value;
        }
        if (!old || Object.keys(changed).length > 1) updates.push(changed);
    }
    return { updates, deletedIds: previous.filter(session => !ids.has(session.id)).map(session => session.id) };
}

/** 在串行写入队列内合并最新磁盘数据；删除与新增均基于本次明确的差量。 */
export function mergeSessionMetadata(current: SessionMetadata[], changes: SessionMetadataChanges): SessionMetadata[] {
    const deleted = new Set(changes.deletedIds);
    const byId = new Map(current.filter(session => !deleted.has(session.id)).map(session => [session.id, { ...session }]));
    const newIds: string[] = [];
    for (const update of changes.updates) {
        if (deleted.has(update.id)) continue;
        if (!byId.has(update.id)) {
            // 已被别的视图删除的会话不能被迟到的局部状态更新重新创建。
            if (typeof update.createdAt !== 'number') continue;
            newIds.push(update.id);
        }
        byId.set(update.id, { ...byId.get(update.id), ...update });
    }
    return [...newIds.map(id => byId.get(id)!), ...current.filter(session => byId.has(session.id)).map(session => byId.get(session.id)!)];
}
