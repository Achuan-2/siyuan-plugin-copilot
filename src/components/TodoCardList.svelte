<script lang="ts">
    import TodoCard from './TodoCard.svelte';

    export let contents: string[] = [];
    export let className: string = '';
</script>

{#if contents.length > 0}
    <div class="todo-card-list {className}">
        {#each contents as content (content)}
            <TodoCard {content} />
        {/each}
    </div>
{/if}

<style lang="scss">
    .todo-card-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
</style>
