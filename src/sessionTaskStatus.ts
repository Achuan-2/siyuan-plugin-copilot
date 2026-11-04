const sessionTaskOwners = new Map<string, Set<string>>();
let sessionMetadataSaveQueue: Promise<void> = Promise.resolve();

export function getSessionTaskStatus(sessionId: string): boolean | undefined {
    const owners = sessionTaskOwners.get(sessionId);
    return owners ? owners.size > 0 : undefined;
}

export function setSessionTaskStatus(sessionId: string, isLoading: boolean, ownerId = 'default'): boolean {
    if (!sessionId) return false;
    const owners = sessionTaskOwners.get(sessionId) || new Set<string>();
    if (isLoading) owners.add(ownerId);
    else owners.delete(ownerId);
    sessionTaskOwners.set(sessionId, owners);
    return owners.size > 0;
}

export function enqueueSessionMetadataSave(save: () => Promise<void>): Promise<void> {
    const operation = sessionMetadataSaveQueue.then(save);
    sessionMetadataSaveQueue = operation.catch(() => undefined);
    return operation;
}
