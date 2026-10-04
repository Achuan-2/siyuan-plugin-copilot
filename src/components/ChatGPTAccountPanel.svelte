<script lang="ts">
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import { getChatGPTClient, type ChatGPTAccount } from '../chatgpt/client';
    import { isChatGPTDesktop } from '../chatgpt/http';
    import { i18n } from '../utils/i18n';

    const desktop = isChatGPTDesktop();
    const dispatch = createEventDispatcher();
    let profiles: ChatGPTAccount[] = [];
    let activeId = '';
    let busy = false;
    let error = '';
    let loginController: AbortController | undefined;
    $: account = profiles.find(profile => profile.id === activeId);

    function refresh() {
        if (!desktop) return;
        const saved = getChatGPTClient().accounts();
        profiles = saved.profiles;
        activeId = saved.activeId || '';
    }

    async function perform(action: 'login' | 'add' | 'logout' | 'select' | 'usage', id?: string) {
        if (busy || !desktop) return;
        busy = true;
        error = '';
        try {
            const client = getChatGPTClient();
            if (action === 'login' || action === 'add') {
                loginController = new AbortController();
                await client.login(loginController.signal, action === 'login' ? activeId || undefined : undefined);
            } else if (action === 'logout') {
                if (!await client.logout()) error = i18n('chatgptRevocationPending');
            } else if (action === 'select') await client.selectAccount(id!);
            else await client.openUsage();
        } catch (failure) {
            if (!loginController?.signal.aborted) error = failure instanceof Error ? failure.message : String(failure);
        } finally {
            loginController = undefined;
            busy = false;
            try {
                refresh();
                if (action !== 'usage') dispatch('accountChange', {
                    connected: !!profiles.find(profile => profile.id === activeId)?.sharing,
                });
            } catch (failure) { error = failure.message; }
        }
    }

    onMount(() => { try { refresh(); } catch (failure) { error = failure.message; } });
    onDestroy(() => loginController?.abort());
</script>

<div class="chatgpt-account">
    <strong>{i18n('chatgptAccountTitle')}</strong>
    <p class="b3-label__text">{desktop ? i18n('chatgptAccountHint') : i18n('chatgptDesktopOnly')}</p>
    {#if profiles.length}
        <select class="b3-select" value={activeId} disabled={busy}
            aria-label={i18n('chatgptAccountTitle')}
            on:change={event => perform('select', event.currentTarget.value)}>
            {#if !activeId}<option value="" disabled>{i18n('chatgptSelectAccount')}</option>{/if}
            {#each profiles as profile}
                <option value={profile.id}>{profile.email || profile.name || i18n('chatgptSavedAccount')} · {profile.id.slice(-8)}</option>
            {/each}
        </select>
    {/if}
    <span class="b3-label__text">{account?.connected
        ? account.sharing ? i18n('chatgptConnected') : i18n('chatgptPermissionRequired')
        : i18n('chatgptNotConnected')}</span>
    <div class="account-actions">
        <button class="b3-button" disabled={busy || !desktop} on:click={() => perform('login')}>
            {loginController ? i18n('chatgptWaitingLogin') : i18n('chatgptLogin')}
        </button>
        {#if loginController}
            <button class="b3-button b3-button--outline" on:click={() => loginController?.abort()}>{i18n('chatgptCancelLogin')}</button>
        {/if}
        {#if profiles.length}
            <button class="b3-button b3-button--outline" disabled={busy} on:click={() => perform('add')}>{i18n('chatgptAddAccount')}</button>
        {/if}
        {#if account?.connected}
            <button class="b3-button b3-button--outline" disabled={busy} on:click={() => perform('usage')}>{i18n('chatgptUsage')}</button>
            <button class="b3-button b3-button--outline" disabled={busy} on:click={() => perform('logout')}>{i18n('chatgptLogout')}</button>
        {/if}
    </div>
    {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
    .chatgpt-account { display: flex; flex-direction: column; gap: 10px; }
    .chatgpt-account p { margin: 0; }
    .account-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .error { color: var(--b3-theme-error); overflow-wrap: anywhere; }
</style>
