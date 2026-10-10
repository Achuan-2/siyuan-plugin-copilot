type Settings = Record<string, any>;
interface SettingsPlugin {
    name: string;
    saveData(filename: string, data: Settings): Promise<any>;
}
interface SettingsSnapshot { baseline: Settings; writable: boolean }
export interface SettingsSaveOptions { replace?: boolean; expected?: Settings }

// Symbol 会跟随对象展开，但不会被 JSON 序列化，旧视图始终保留自己的编辑基线。
const snapshotKey = Symbol('copilot-settings-snapshot');
const SETTINGS_FILE = 'settings.json';
const REQUEST_TIMEOUT = 10000;

function copy<T>(value: T): T {
    // 保留值为 undefined 的默认设置键（设置面板用 in 判断键是否存在），忽略 Symbol 元数据。
    if (Array.isArray(value)) return value.map(item => copy(item)) as T;
    if (isObject(value)) return Object.fromEntries(Object.entries(value)
        .map(([key, item]) => [key, copy(item)])) as T;
    return value;
}

export function cloneSettings<T extends Settings>(settings: T): T {
    const cloned = copy(settings);
    const snapshot: SettingsSnapshot = (settings as any)[snapshotKey];
    if (snapshot) Object.assign(cloned, { [snapshotKey]: snapshot });
    return cloned;
}

/** 面板兼容性补全属于显示初始化，不能在下次保存时被当作用户编辑。 */
export function rebaseSettings<T extends Settings>(settings: T): T {
    const snapshot: SettingsSnapshot = (settings as any)[snapshotKey];
    if (snapshot) Object.assign(settings, {
        [snapshotKey]: { baseline: copy(settings), writable: snapshot.writable },
    });
    return settings;
}

function isObject(value: any): value is Settings {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Settings, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function equal(left: any, right: any): boolean {
    if (left === right) return true;
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((value, index) => equal(value, right[index]));
    }
    if (!isObject(left) || !isObject(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key =>
        hasOwn(right, key) && equal(left[key], right[key]));
}

function hasUniqueIds(items: any[]): boolean {
    return items.every(item => isObject(item) && typeof item.id === 'string') &&
        new Set(items.map(item => item.id)).size === items.length;
}

/** 三方合并：只应用本视图相对加载基线的改动，保留磁盘上的其他更新。 */
function mergeChanges(baseline: any, edited: any, current: any): any {
    if (equal(baseline, edited)) return copy(current);
    if (isObject(edited) && (isObject(baseline) || baseline === undefined) && isObject(current)) {
        const result = copy(current);
        for (const key of new Set([...Object.keys(baseline || {}), ...Object.keys(edited)])) {
            if (!hasOwn(edited, key)) delete result[key];
            else if (!equal(baseline?.[key], edited[key])) {
                result[key] = mergeChanges(baseline?.[key], edited[key], current[key]);
            }
        }
        return result;
    }
    // 平台、模型等带 id 的数组按项合并，不能因修改一个模型丢掉同步新增的平台。
    if (Array.isArray(baseline) && Array.isArray(edited) && Array.isArray(current) &&
        [baseline, edited, current].every(hasUniqueIds)) {
        const byId = (items: any[]) => Object.fromEntries(items.map(item => [item.id, item]));
        const merged = mergeChanges(byId(baseline), byId(edited), byId(current));
        const reordered = !equal(baseline.map(item => item.id), edited.map(item => item.id));
        const order = [...(reordered ? edited : current), ...(reordered ? current : edited)];
        return [...new Set(order.map(item => item.id))].filter(id => hasOwn(merged, id))
            .map(id => merged[id]);
    }
    return copy(edited);
}

export class SettingsConflictError extends Error {
    constructor() { super('迁移期间设置已更新，取消旧配置回写'); }
}

/** 仅处理设置；正常写入仍通过 SDK，以保留思源同步与生命周期检查。 */
export class SettingsStorage {
    private queue: Promise<unknown> = Promise.resolve();
    private lastGood?: Settings;
    private existingFileSeen = false;
    private disposed = false;
    private writeTimedOut = false;

    constructor(private plugin: SettingsPlugin) {}

    dispose(): void { this.disposed = true; }

    private assertActive(): void {
        if (this.disposed) throw new Error('插件已卸载，停止读写设置');
    }

    async run<T>(action: () => Promise<T>): Promise<T> {
        const execute = async () => {
            this.assertActive();
            // 同源窗口共享 Web Locks；不支持时仍保证本实例的读写顺序。
            const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
            return locks ? locks.request(`copilot-settings:${this.plugin.name}`, action) : action();
        };
        const result = this.queue.then(execute, execute);
        this.queue = result.catch(() => undefined);
        return result;
    }

    async read(): Promise<Settings | null> {
        this.assertActive();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
        try {
            // loadData 会在失败时回退缓存，不能用它判断设置文件是否真的读取成功。
            const response = await fetch('/api/file/getFile', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: `/data/storage/petal/${this.plugin.name}/${SETTINGS_FILE}` }),
                signal: controller.signal, cache: 'no-store',
            });
            this.assertActive();
            const value = await response.json();
            this.assertActive();
            const missing = response.status === 404 ||
                (response.ok && isObject(value) && value.code === 404 && typeof value.msg === 'string');
            if (missing && !this.existingFileSeen) return null;
            if (!response.ok || response.status === 202 || !isObject(value) ||
                Object.keys(value).length === 0 ||
                (typeof value.code === 'number' && typeof value.msg === 'string')) {
                throw new Error('设置文件暂时无法读取，已阻止覆盖，请同步完成后重试');
            }
            this.existingFileSeen = true;
            return copy(value);
        } catch (error) {
            if (this.disposed) throw error;
            throw new Error('设置文件暂时无法读取，已阻止覆盖，请同步完成后重试');
        } finally {
            clearTimeout(timer);
        }
    }

    view(settings: Settings, writable = true): Settings {
        const result = copy(settings);
        Object.assign(result, { [snapshotKey]: { baseline: copy(settings), writable } });
        return result;
    }

    remember(settings: Settings): void {
        this.assertActive();
        this.lastGood = cloneSettings(settings);
    }

    fallback(defaults: Settings): Settings {
        this.assertActive();
        return this.lastGood ? cloneSettings(this.lastGood) : this.view(defaults, false);
    }

    // 在进入队列前捕获编辑内容，后续用户输入不能改变已经排队的保存请求。
    capture(settings: Settings, options: SettingsSaveOptions = {}) {
        const snapshot: SettingsSnapshot = (settings as any)[snapshotKey];
        return { source: settings, edited: copy(settings), snapshot, options };
    }

    async save(request: ReturnType<SettingsStorage['capture']>): Promise<Settings> {
        const { source, edited, snapshot, options } = request;
        this.assertActive();
        if (this.writeTimedOut) throw new Error('上次设置保存尚未确认，请重新加载插件后重试');
        if (!options.replace && !snapshot?.writable) {
            throw new Error('尚未成功加载设置，已阻止覆盖，请重新打开设置面板后重试');
        }
        const current = await this.read();
        if (options.expected && !equal(current, options.expected)) throw new SettingsConflictError();
        const merged = options.replace ? edited :
            mergeChanges(snapshot.baseline, edited, current || snapshot.baseline);
        if (!equal(current, merged)) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const result = await Promise.race([
                    this.plugin.saveData(SETTINGS_FILE, copy(merged)),
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(() => {
                            // SDK 请求无法取消；禁止后续写入，避免迟到的旧请求覆盖新请求。
                            this.writeTimedOut = true;
                            reject(new Error('设置保存超时，请重新加载插件后重试'));
                        }, REQUEST_TIMEOUT);
                    }),
                ]);
                if (result?.code !== 0) throw new Error('设置保存失败，未更新已保存的配置');
            } finally {
                clearTimeout(timer);
            }
        }
        this.assertActive();
        this.existingFileSeen = true;
        Object.assign(source, { [snapshotKey]: { baseline: copy(edited), writable: true } });
        return this.view(merged);
    }
}
