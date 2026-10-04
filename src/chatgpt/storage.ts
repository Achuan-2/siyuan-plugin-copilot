import { nativeModule } from './http';

export interface ChatGPTProfile {
    id: string;
    clientId: string;
    issuer?: string;
    subject?: string;
    email?: string;
    name?: string;
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    scopes?: string[];
    expiresAt?: number;
    signingOut?: boolean;
}

interface StoredAccounts { activeId?: string; profiles: ChatGPTProfile[] }

/** All credential files live outside the synchronized SiYuan workspace. */
export class ChatGPTStorage {
    readonly directory: string;
    private fs: any;
    private path: any;
    constructor() {
        this.fs = nativeModule('fs');
        this.path = nativeModule('path');
        const process = nativeModule('process');
        this.directory = this.path.join(process.env.LOCALAPPDATA || nativeModule('os').homedir(),
            'siyuan-plugin-copilot', 'chatgpt');
        this.fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    }

    read(): StoredAccounts {
        const filename = this.path.join(this.directory, 'accounts.json');
        if (!this.fs.existsSync(filename)) return { profiles: [] };
        const data = JSON.parse(this.fs.readFileSync(filename, 'utf8'));
        if (!Array.isArray(data.profiles)) throw new Error('Invalid ChatGPT account storage');
        return data;
    }

    write(data: StoredAccounts): void {
        const filename = this.path.join(this.directory, 'accounts.json');
        const temporary = `${filename}.${nativeModule('crypto').randomUUID()}.tmp`;
        try {
            this.fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
            this.fs.renameSync(temporary, filename);
        } finally {
            if (this.fs.existsSync(temporary)) this.fs.unlinkSync(temporary);
        }
    }

    hostId(): string {
        const filename = this.path.join(this.directory, 'host-id');
        const id = `urn:uuid:${nativeModule('crypto').randomUUID()}`;
        try { this.fs.writeFileSync(filename, id, { mode: 0o600, flag: 'wx' }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        return this.fs.readFileSync(filename, 'utf8').trim();
    }

    /** Serialize rotating-token refresh and account updates across SiYuan windows. */
    async locked<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        const lock = this.path.join(this.directory, 'accounts.lock');
        const deadline = Date.now() + 130000;
        while (true) {
            if (signal?.aborted) throw new Error('Request aborted');
            try { this.fs.mkdirSync(lock, { mode: 0o700 }); break; }
            catch (error) {
                if (error.code !== 'EEXIST') throw error;
                try {
                    if (Date.now() - this.fs.statSync(lock).mtimeMs > 120000) this.fs.rmdirSync(lock);
                } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
                if (Date.now() > deadline) throw new Error('ChatGPT account storage is busy');
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        const heartbeat = setInterval(() => {
            const now = new Date();
            this.fs.utimesSync(lock, now, now);
        }, 10000);
        try { return await action(); }
        finally { clearInterval(heartbeat); this.fs.rmdirSync(lock); }
    }
}
