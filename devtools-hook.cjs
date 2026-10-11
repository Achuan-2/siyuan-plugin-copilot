"use strict";

// 必须由 remote.require 在主进程加载，preventDefault 才能同步阻止菜单快捷键。
const { webContents } = require("electron");

function isDevToolsHotkey(input) {
    if (!input || (input.key?.toLowerCase() !== "i" && input.code !== "KeyI")) return false;
    return (input.control && input.shift && !input.alt && !input.meta)
        || (input.meta && input.alt && !input.control && !input.shift);
}

// 每个插件实例单独持有挂钩，卸载一个思源窗口不会拆掉其他窗口的监听。
function createDevToolsHooks() {
    const guests = new Map();
    const hosts = new Map();

    function onInput(event, input, host) {
        if (!host || host.isDestroyed() || !isDevToolsHotkey(input)) return;
        // 重复 keyDown 也必须拦截，避免长按时回落到 Electron 菜单加速键。
        if (input.type !== "keyDown") return;
        event.preventDefault();
        if (input.isAutoRepeat) return;
        const binding = hosts.get(host.id);
        const now = Date.now();
        if (!binding || now < binding.toggleAfter) return;
        binding.toggleAfter = now + 80;
        for (const { guest } of guests.values()) {
            if (guest.hostWebContents === host && !guest.isDestroyed() && guest.isDevToolsOpened()) {
                guest.closeDevTools();
            }
        }
        host.toggleDevTools();
    }

    function bindHost(host) {
        let binding = hosts.get(host.id);
        if (binding) return binding;
        const inputListener = (event, input) => onInput(event, input, host);
        binding = { host, ids: new Set(), toggleAfter: 0, inputListener, devTools: null };
        const bindDevTools = () => {
            if (binding.devTools && !binding.devTools.isDestroyed()) {
                binding.devTools.removeListener("before-input-event", inputListener);
            }
            binding.devTools = host.devToolsWebContents;
            if (binding.devTools && !binding.devTools.isDestroyed()) {
                binding.devTools.on("before-input-event", inputListener);
            }
        };
        binding.openedListener = bindDevTools;
        binding.closedListener = () => {
            if (binding.devTools && !binding.devTools.isDestroyed()) {
                binding.devTools.removeListener("before-input-event", inputListener);
            }
            binding.devTools = null;
        };
        binding.destroyedListener = () => {
            for (const id of [...binding.ids]) unhook(id);
        };
        hosts.set(host.id, binding);
        host.on("before-input-event", inputListener);
        host.on("devtools-opened", bindDevTools);
        host.on("devtools-closed", binding.closedListener);
        host.once("destroyed", binding.destroyedListener);
        bindDevTools();
        return binding;
    }

    function unbindHost(binding) {
        const { host } = binding;
        host.removeListener("before-input-event", binding.inputListener);
        host.removeListener("devtools-opened", binding.openedListener);
        host.removeListener("devtools-closed", binding.closedListener);
        host.removeListener("destroyed", binding.destroyedListener);
        binding.closedListener();
        hosts.delete(host.id);
    }

    function hook(id) {
        if (guests.has(id)) return true;
        const guest = webContents.fromId(id);
        const host = guest?.hostWebContents;
        if (!guest || guest.isDestroyed() || !host || host.isDestroyed()) return false;
        const binding = bindHost(host);
        const inputListener = (event, input) => onInput(event, input, host);
        const openedListener = () => {
            if (!guest.isDestroyed() && guest.isDevToolsOpened()) guest.closeDevTools();
            if (!host.isDestroyed() && !host.isDevToolsOpened()) host.openDevTools();
        };
        const destroyedListener = () => unhook(id);
        guests.set(id, { guest, host, inputListener, openedListener, destroyedListener });
        binding.ids.add(id);
        guest.on("before-input-event", inputListener);
        guest.on("devtools-opened", openedListener);
        guest.once("destroyed", destroyedListener);
        return true;
    }

    function unhook(id) {
        const item = guests.get(id);
        if (!item) return;
        guests.delete(id);
        item.guest.removeListener("before-input-event", item.inputListener);
        item.guest.removeListener("devtools-opened", item.openedListener);
        item.guest.removeListener("destroyed", item.destroyedListener);
        const binding = hosts.get(item.host.id);
        if (binding) {
            binding.ids.delete(id);
            if (binding.ids.size === 0) unbindHost(binding);
        }
    }

    function unhookAll() {
        for (const id of [...guests.keys()]) unhook(id);
    }

    return { hook, unhook, unhookAll };
}

module.exports = { createDevToolsHooks };
