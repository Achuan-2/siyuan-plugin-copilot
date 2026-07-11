<script lang="ts">
    export let content: string;

    interface TodoItem {
        status: 'completed' | 'in_progress' | 'cancelled' | 'pending';
        content: string;
        icon: string;
        className: string;
    }

    function parseTodoList(text: string): TodoItem[] {
        if (!text) return [];
        const items: TodoItem[] = [];
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('- [x]')) {
                items.push({
                    status: 'completed',
                    content: trimmed.substring(5).trim(),
                    icon: '#iconCheck',
                    className: 'todo-card__item--completed',
                });
            } else if (trimmed.startsWith('- [/]')) {
                items.push({
                    status: 'in_progress',
                    content: trimmed.substring(5).trim(),
                    icon: '#iconRefresh',
                    className: 'todo-card__item--in-progress',
                });
            } else if (trimmed.startsWith('- [-]')) {
                items.push({
                    status: 'cancelled',
                    content: trimmed.substring(5).trim(),
                    icon: '#iconCloseRound',
                    className: 'todo-card__item--cancelled',
                });
            } else if (trimmed.startsWith('- [ ]')) {
                items.push({
                    status: 'pending',
                    content: trimmed.substring(5).trim(),
                    icon: '#iconUncheck',
                    className: 'todo-card__item--pending',
                });
            }
        }
        return items;
    }

    $: todos = parseTodoList(content);
    const title =
        (typeof window !== 'undefined' &&
            (window as any).siyuan?.languages?.agentTodoList) ||
        'Todo List';
</script>

{#if todos.length > 0}
    <div class="todo-card">
        <div class="todo-card__header">
            <svg
                class="todo-card__icon"
                style="width: 14px; height: 14px; fill: currentColor;"
            >
                <use xlink:href="#iconList"></use>
            </svg>
            <span class="todo-card__title">{title}</span>
        </div>
        <div class="todo-card__items">
            {#each todos as todo (todo.content + todo.status)}
                <div class="todo-card__item {todo.className}">
                    <svg
                        class="todo-card__status"
                        style="width: 14px; height: 14px; fill: currentColor;"
                    >
                        <use xlink:href={todo.icon}></use>
                    </svg>
                    <span class="todo-card__content">{todo.content}</span>
                </div>
            {/each}
        </div>
    </div>
{/if}

<style lang="scss">
    .todo-card {
        margin-top: 8px;
        padding: 10px 12px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        box-shadow: 0 0 0 1px var(--b3-border-color);

        &__header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        }

        &__icon {
            flex-shrink: 0;
            color: var(--b3-theme-primary);
        }

        &__title {
            font-size: 14px;
        }

        &__items {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        &__item {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            font-size: 13px;
            line-height: 1.5;
            color: var(--b3-theme-on-surface);
        }

        &__status {
            flex-shrink: 0;
            margin-top: 2px;
        }

        &__content {
            word-break: break-word;
        }

        &__item--completed {
            color: var(--b3-theme-on-surface-light);
            text-decoration: line-through;
        }

        &__item--in-progress {
            color: var(--b3-theme-primary);
        }

        &__item--cancelled {
            color: var(--b3-theme-on-surface-light);
            text-decoration: line-through;
            opacity: 0.7;
        }
    }
</style>
