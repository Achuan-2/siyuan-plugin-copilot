const sessionTaskStatuses = new Map<string, boolean>();
let sessionMetadataSaveQueue: Promise<void> = Promise.resolve();

export function getSessionTaskStatus(sessionId: string): boolean | undefined {
    return sessionTaskStatuses.get(sessionId);
}

export function setSessionTaskStatus(sessionId: string, isLoading: boolean): void {
    if (sessionId) {
        sessionTaskStatuses.set(sessionId, isLoading);
    }
}

export function enqueueSessionMetadataSave(save: () => Promise<void>): Promise<void> {
    const operation = sessionMetadataSaveQueue.then(save);
    sessionMetadataSaveQueue = operation.catch(() => undefined);
    return operation;
}
