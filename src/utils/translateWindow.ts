export const TRANSLATE_TAB_TYPE = 'copilot-translate';

export function usesTranslateWindow(frontend: string): boolean {
    return frontend === 'desktop' || frontend === 'desktop-window';
}

/** 查找同一内核中的翻译窗口，包括仍在初始化的窗口。 */
export function findTranslateWindow(pluginName: string, origin: string): any | null {
    try {
        const remote = (window as any).require?.('@electron/remote');
        const modelType = pluginName + TRANSLATE_TAB_TYPE;
        const containsTranslator = (layout: any): boolean => {
            if (!layout || typeof layout !== 'object') return false;
            if (layout.customModelType === modelType) return true;
            return Object.values(layout).some(value =>
                value && typeof value === 'object' && containsTranslator(value));
        };
        return remote?.BrowserWindow?.getAllWindows().find((win: any) => {
            if (win.isDestroyed()) return false;
            try {
                const url = new URL(win.webContents.getURL());
                return url.origin === origin && url.pathname.endsWith('/window.html') &&
                    containsTranslator(JSON.parse(url.searchParams.get('json') || 'null'));
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
