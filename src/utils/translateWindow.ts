export const TRANSLATE_TAB_TYPE = 'copilot-translate';

export function supportsTranslateWindow(frontend: string): boolean {
    return frontend === 'desktop' || frontend === 'desktop-window';
}

export interface TranslateWindowDraft {
    inputLanguage: string;
    outputLanguage: string;
    inputText: string;
    outputText: string;
    provider: string;
    modelId: string;
    historyId: string | null;
}

/** 草稿只在内存中传递，避免将长文本放进原生窗口的布局 URL。 */
export class TranslateDraftTransfer {
    private channel: BroadcastChannel;
    private pending: { id: string; draft: TranslateWindowDraft } | null = null;

    constructor(pluginName: string) {
        this.channel = new BroadcastChannel(`copilot-translate-draft:${pluginName}`);
        this.channel.addEventListener('message', this.handleRequest);
    }

    private handleRequest = ({ data }: MessageEvent) => {
        if (!this.pending || data?.id !== this.pending.id) return;
        if (data.type === 'request') {
            this.channel.postMessage({ type: 'draft', ...this.pending });
        } else if (data.type === 'received') {
            this.pending = null;
        }
    };

    offer(draft: TranslateWindowDraft): string {
        const id = crypto.randomUUID();
        this.pending = { id, draft };
        this.channel.postMessage({ type: 'available', id });
        return id;
    }

    receive(initialId: string, apply: (draft: TranslateWindowDraft) => void): () => void {
        let requestedId = initialId;
        const request = () => this.channel.postMessage({ type: 'request', id: requestedId });
        const listener = ({ data }: MessageEvent) => {
            if (data?.type === 'available') {
                requestedId = data.id;
                request();
            } else if (data?.type === 'draft' && data.id === requestedId) {
                apply(data.draft);
                this.channel.postMessage({ type: 'received', id: data.id });
            }
        };
        this.channel.addEventListener('message', listener);
        if (requestedId) request();
        return () => this.channel.removeEventListener('message', listener);
    }

    dispose(): void {
        this.pending = null;
        this.channel.close();
    }
}

export function isTranslateWindowURL(href: string, pluginName: string, origin: string): boolean {
    try {
        const modelType = pluginName + TRANSLATE_TAB_TYPE;
        const containsTranslator = (layout: any): boolean => {
            if (!layout || typeof layout !== 'object') return false;
            if (layout.customModelType === modelType) return true;
            return Object.values(layout).some(value =>
                value && typeof value === 'object' && containsTranslator(value));
        };
        const url = new URL(href);
        return url.origin === origin && url.pathname.endsWith('/window.html') &&
            containsTranslator(JSON.parse(url.searchParams.get('json') || 'null'));
    } catch {
        return false;
    }
}

/** 查找同一内核中的翻译窗口，包括仍在初始化的窗口。 */
export function findTranslateWindow(pluginName: string, origin: string): any | null {
    try {
        const remote = (window as any).require?.('@electron/remote');
        return remote?.BrowserWindow?.getAllWindows().find((win: any) => {
            if (win.isDestroyed()) return false;
            try {
                return isTranslateWindowURL(win.webContents.getURL(), pluginName, origin);
            } catch {
                return false;
            }
        }) || null;
    } catch {
        // 不提供 remote 的桌面宿主仍可通过官方 openWindow 接口打开窗口。
        return null;
    }
}

export function focusTranslateWindow(win: any): void {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}
