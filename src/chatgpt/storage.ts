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

interface AccountStoragePlugin {
    name: string;
    saveData(filename: string, data: StoredAccounts): Promise<any>;
}

export const CHATGPT_ACCOUNTS_FILE = 'chatgpt/accounts.json';
let storagePlugin: AccountStoragePlugin | null = null;

export function configureChatGPTStorage(plugin: AccountStoragePlugin | null): void {
    storagePlugin = plugin;
}

/** Accounts sync with the workspace; device identity and process locks stay local. */
export class ChatGPTStorage {
    readonly directory: string;
    private localDirectory: string;
    private fs: any;
    private path: any;
    private plugin: AccountStoragePlugin;
    private initialization?: Promise<void>;
    constructor() {
        const workspace = (window as any).siyuan?.config?.system?.workspaceDir;
        if (!storagePlugin || !workspace) throw new Error('ChatGPT workspace storage is unavailable');
        this.plugin = storagePlugin;
        this.fs = nativeModule('fs');
        this.path = nativeModule('path');
        const process = nativeModule('process');
        this.directory = this.path.join(workspace, 'data', 'storage', 'petal', this.plugin.name, 'chatgpt');
        this.localDirectory = this.path.join(process.env.LOCALAPPDATA || nativeModule('os').homedir(),
            'siyuan-plugin-copilot', 'chatgpt');
        this.fs.mkdirSync(this.localDirectory, { recursive: true, mode: 0o700 });
    }

    private readFile(filename: string): StoredAccounts {
        if (!this.fs.existsSync(filename)) return { profiles: [] };
        const data = JSON.parse(this.fs.readFileSync(filename, 'utf8'));
        if (!Array.isArray(data.profiles)) throw new Error('Invalid ChatGPT account storage');
        return data;
    }

    private initialize(): Promise<void> {
        return this.initialization ||= this.withLocalLock(async () => {
            const filename = this.path.join(this.directory, 'accounts.json');
            const legacy = this.path.join(this.localDirectory, 'accounts.json');
            // Synced data, including a signed-out account, always takes precedence.
            if (this.fs.existsSync(filename) || !this.fs.existsSync(legacy)) return;
            await this.save(this.readFile(legacy));
            // Remove only after a successful save, so failed migration never loses a session.
            this.fs.unlinkSync(legacy);
        }).catch(error => {
            this.initialization = undefined;
            throw error;
        });
    }

    async read(): Promise<StoredAccounts> {
        await this.initialize();
        // Read disk every time: another window or cloud sync may have replaced the file.
        return this.readFile(this.path.join(this.directory, 'accounts.json'));
    }

    private async save(data: StoredAccounts): Promise<void> {
        const result = await this.plugin.saveData(CHATGPT_ACCOUNTS_FILE, data);
        if (result?.code !== 0) {
            throw new Error('Failed to save ChatGPT accounts to the SiYuan workspace');
        }
    }

    async write(data: StoredAccounts): Promise<void> {
        await this.initialize();
        // Use the kernel write path so SiYuan records the change for synchronization.
        await this.save(data);
    }

    hostId(): string {
        const filename = this.path.join(this.localDirectory, 'host-id');
        const id = `urn:uuid:${nativeModule('crypto').randomUUID()}`;
        try { this.fs.writeFileSync(filename, id, { mode: 0o600, flag: 'wx' }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        return this.fs.readFileSync(filename, 'utf8').trim();
    }

    /** Serialize rotating-token refresh and account updates across SiYuan windows. */
    async locked<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        await this.initialize();
        return this.withLocalLock(action, signal);
    }

    private async withLocalLock<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        const lock = this.path.join(this.localDirectory, 'accounts.lock');
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
