interface MainDevToolsHooks {
    hook(id: number): boolean;
    unhook(id: number): void;
    unhookAll(): void;
}

interface GuestView extends HTMLElement {
    getWebContentsId(): number;
}

let mainHooks: MainDevToolsHooks | null | undefined;

function loadMainHooks(pluginName: string): MainDevToolsHooks | null {
    if (mainHooks !== undefined) return mainHooks;
    try {
        const req = (window as any).require;
        const remote = req?.('@electron/remote');
        const path = req?.('path');
        const dataDir = (window as any).siyuan?.config?.system?.dataDir;
        if (!remote?.require || !path?.join || !dataDir) return mainHooks = null;
        const modulePath = path.join(dataDir, 'plugins', pluginName, 'devtools-hook.cjs');
        mainHooks = remote.require(modulePath).createDevToolsHooks();
        return mainHooks;
    } catch (error) {
        console.error('Copilot: failed to load webview devtools hook', error);
        return mainHooks = null;
    }
}

export function bindWebviewDevTools(view: GuestView, pluginName: string): () => void {
    let guestId = 0;
    const onReady = () => {
        const hooks = loadMainHooks(pluginName);
        if (!hooks) return;
        try {
            const id = view.getWebContentsId();
            if (!id || id === guestId) return;
            if (guestId) hooks.unhook(guestId);
            guestId = hooks.hook(id) ? id : 0;
        } catch (error) {
            console.warn('Copilot: failed to bind webview devtools shortcut', error);
        }
    };
    // did-attach 尽早接管；dom-ready 重试，且不会因刷新重复绑定。
    view.addEventListener('did-attach', onReady);
    view.addEventListener('dom-ready', onReady);
    return () => {
        view.removeEventListener('did-attach', onReady);
        view.removeEventListener('dom-ready', onReady);
        // 关闭页签时 DOM 可能已经移除，使用绑定时保存的 id。
        if (guestId) mainHooks?.unhook(guestId);
        guestId = 0;
    };
}

export function disposeWebviewDevTools(): void {
    mainHooks?.unhookAll();
    mainHooks = undefined;
}
