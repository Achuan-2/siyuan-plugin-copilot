import { writable } from 'svelte/store';
import type { Writable } from 'svelte/store';

// 创建一个可写的 store 来存储设置
export const settingsStore: Writable<any> = writable({});
export const PLUGIN_DATA_CHANGED_EVENT = 'copilot-data-changed';

// 更新设置的辅助函数
export function updateSettings(newSettings: any) {
    settingsStore.set(newSettings);
}

// 获取当前设置的辅助函数
export function getSettings(): Promise<any> {
    return new Promise((resolve) => {
        const unsubscribe = settingsStore.subscribe((value) => {
            resolve(value);
            unsubscribe();
        });
    });
}
