// 保留浮层的逻辑父节点，供嵌套浮层和“点击外部关闭”判断使用。
const floatingParents = new WeakMap<Node, HTMLElement>();

export function containsFloatingTarget(container: HTMLElement, target: Node): boolean {
    for (let current: Node | null = target; current; current = floatingParents.get(current) || current.parentNode) {
        if (current === container) return true;
    }
    return false;
}

/**
 * 将按视口定位的浮层挂到 body，避开平板侧栏和桌面浮动 Dock 的
 * transform、overflow 及层叠上下文。组件隐藏、切换会话时同步隐藏浮层。
 */
export function floatingLayer(node: HTMLElement) {
    const document = node.ownerDocument;
    const window = document.defaultView;
    let destroyed = false;
    let observer: MutationObserver | undefined;
    let placeholder: Comment | undefined;
    // 思源在 document 的点击处理器中收起浮动 Dock；浮层移出 Dock 后，
    // 内部点击仍属于插件操作，不能被宿主当作“点击空白处”。
    const stopHostClick = (event: MouseEvent) => event.stopPropagation();
    node.addEventListener('click', stopHostClick);

    // 等待 Svelte 挂载完整祖先链，包括嵌套组件的父容器。
    queueMicrotask(() => {
        if (destroyed || !node.parentElement || !window) return;

        const parent = node.parentElement;
        const ancestors: HTMLElement[] = [];
        for (let current: HTMLElement | null = parent; current; current = floatingParents.get(current) || current.parentElement) {
            ancestors.push(current);
        }
        const originalVisibility = node.style.visibility;
        const localZIndex = Number.parseInt(window.getComputedStyle(node).zIndex, 10) || 0;
        const sync = () => {
            let hidden = false;
            let hostZIndex = 0;
            for (const ancestor of ancestors) {
                const style = window.getComputedStyle(ancestor);
                hidden ||= style.display === 'none' || style.visibility === 'hidden' || ancestor.hidden;
                hostZIndex = Math.max(hostZIndex, Number.parseInt(style.zIndex, 10) || 0);
            }
            const visibility = hidden ? 'hidden' : originalVisibility;
            const zIndex = String(Math.max(1000, hostZIndex + 1) + localZIndex);
            if (node.style.visibility !== visibility) node.style.visibility = visibility;
            if (node.style.zIndex !== zIndex) node.style.zIndex = zIndex;
        };

        placeholder = document.createComment('copilot-floating-layer');
        parent.insertBefore(placeholder, node);
        floatingParents.set(node, parent);
        document.body.appendChild(node);
        sync();

        observer = new window.MutationObserver(sync);
        for (const ancestor of ancestors) {
            observer.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        }
        // Svelte 更新定位用的 style 属性时可能覆盖内联层级，及时补回。
        observer.observe(node, { attributes: true, attributeFilter: ['style'] });
    });

    return {
        destroy() {
            destroyed = true;
            observer?.disconnect();
            node.removeEventListener('click', stopHostClick);
            floatingParents.delete(node);
            node.remove();
            placeholder?.remove();
        },
    };
}
