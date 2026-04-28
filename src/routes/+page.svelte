<script lang="ts">
  import {
    Check,
    ChevronLeft,
    Clock3,
    Inbox,
    Loader2,
    Mail,
    Plus,
    RefreshCw,
    Search,
    Send,
    Settings,
    Shield
  } from 'lucide-svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { fade, fly } from 'svelte/transition';

  let { data } = $props();
  let view = $state('inbox');
  let isLoading = $state(false);
  let search = $state('');
  let accountFilter = $state<string>('');
  let accountForm = $state({
    email: '',
    host: '',
    port: 993,
    username: '',
    password: '',
    smtpHost: '',
    smtpPort: 465,
    smtpUsername: '',
    smtpPassword: ''
  });
  let draftText = $state('');
  let regenNote = $state('');
  let memoryText = $state('');
  let webhookTarget = $state('');
  let status = $state('');
  let bodyMode = $state<'text' | 'html'>('text');
  let searchInput: HTMLInputElement | undefined;

  $effect(() => {
    view = data.query?.view || 'inbox';
    search = data.query?.q || '';
    accountFilter = data.query?.accountId ? String(data.query.accountId) : '';
    draftText = data.selected?.suggestion?.draftReply || '';
    memoryText = data.memory;
    bodyMode = data.selected?.message?.safeBodyHtml ? 'html' : 'text';
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.getAttribute('contenteditable') === 'true';
      if (!typing && event.key === '/') {
        event.preventDefault();
        searchInput?.focus();
        return;
      }
      if (typing) return;
      if (!['inbox', 'pending'].includes(view)) return;
      const selectedId = data.selected?.message?.id ?? data.messages[0]?.id;
      const index = data.messages.findIndex((message: { id: number }) => message.id === selectedId);
      if (event.key === 'j') {
        const next = data.messages[Math.min(index + 1, data.messages.length - 1)];
        if (next) void selectMessage(next.id);
      } else if (event.key === 'k') {
        const prev = data.messages[Math.max(index - 1, 0)];
        if (prev) void selectMessage(prev.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  async function api(path: string, options: RequestInit = {}) {
    isLoading = true;
    try {
      const response = await fetch(path, {
        ...options,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': data.csrfToken,
          ...(options.headers || {})
        }
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    } finally {
      isLoading = false;
    }
  }

  async function selectMessage(id: number) {
    isLoading = true;
    try {
      const params = new URLSearchParams(location.search);
      params.set('message', String(id));
      if (view !== 'inbox') params.set('view', view);
      if (search) params.set('q', search);
      if (accountFilter) params.set('accountId', accountFilter);
      await goto(`/?${params.toString()}`, { keepFocus: true });
    } finally {
      isLoading = false;
    }
  }

  async function deselectMessage() {
    isLoading = true;
    try {
      const params = new URLSearchParams(location.search);
      params.delete('message');
      await goto(`/?${params.toString()}`);
    } finally {
      isLoading = false;
    }
  }

  async function applySearch() {
    isLoading = true;
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (view !== 'inbox') params.set('view', view);
      if (accountFilter) params.set('accountId', accountFilter);
      await goto(`/?${params.toString()}`);
    } finally {
      isLoading = false;
    }
  }

  async function executeSuggestion() {
    if (!data.selected?.suggestion) return;
    status = 'Executing...';
    await api(`/api/suggestions/${data.selected.suggestion.id}/execute`, { method: 'POST', body: '{}' });
    status = 'Executed';
    await invalidateAll();
  }

  async function saveEdit() {
    if (!data.selected?.suggestion) return;
    status = 'Saving edit...';
    await api(`/api/suggestions/${data.selected.suggestion.id}/edit`, {
      method: 'POST',
      body: JSON.stringify({ draft_reply: draftText || null })
    });
    status = 'Saved';
    await invalidateAll();
  }

  async function rejectSuggestion() {
    if (!data.selected?.suggestion) return;
    await api(`/api/suggestions/${data.selected.suggestion.id}/reject`, { method: 'POST', body: '{}' });
    await invalidateAll();
  }

  async function regenerate() {
    if (!data.selected?.message) return;
    status = 'Regenerating...';
    await api(`/api/messages/${data.selected.message.id}/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ note: regenNote })
    });
    regenNote = '';
    status = 'Regenerated';
    await invalidateAll();
  }

  async function generateSuggestion(messageId: number) {
    await api(`/api/messages/${messageId}/suggest`, { method: 'POST', body: '{}' });
    await invalidateAll();
  }

  async function addAccount() {
    status = 'Adding account...';
    await api('/api/accounts', { method: 'POST', body: JSON.stringify(accountForm) });
    accountForm = {
      email: '',
      host: '',
      port: 993,
      username: '',
      password: '',
      smtpHost: '',
      smtpPort: 465,
      smtpUsername: '',
      smtpPassword: ''
    };
    status = 'Account added';
    await invalidateAll();
  }

  async function accountAction(id: number, action: 'test' | 'enable' | 'disable' | 'delete') {
    status = `${action} account...`;
    if (action === 'delete') await api(`/api/accounts/${id}`, { method: 'DELETE' });
    else await api(`/api/accounts/${id}/${action}`, { method: 'POST', body: '{}' });
    status = `Account ${action} complete`;
    await invalidateAll();
  }

  async function saveMemory() {
    await api('/api/memory', { method: 'POST', body: JSON.stringify({ markdown: memoryText }) });
    status = 'Memory saved';
    await invalidateAll();
  }

  async function resetMemory() {
    isLoading = true;
    try {
      const response = await fetch('/api/memory');
      const json = await response.json();
      memoryText = json.defaultMarkdown;
    } finally {
      isLoading = false;
    }
  }

  async function addWebhook() {
    await api('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'delegate', targetUrl: webhookTarget })
    });
    webhookTarget = '';
    status = 'Webhook added';
  }

  function riskClass(risk: string | null | undefined) {
    if (risk === 'high') return 'border-red-400/40 bg-red-400/10 text-red-200';
    if (risk === 'medium') return 'border-amber-300/40 bg-amber-300/10 text-amber-100';
    return 'border-accent-line bg-accent-soft text-accent';
  }
</script>

<svelte:head>
  <title>Triage</title>
</svelte:head>

<main class="relative grid h-screen grid-cols-1 md:grid-cols-[76px_minmax(320px,430px)_1fr] overflow-hidden text-zinc-100">
  {#if isLoading}
    <div class="fixed left-0 right-0 top-0 z-50 h-1 bg-accent/20" transition:fade>
      <div class="h-full bg-accent animate-pulse" style="width: 30%"></div>
    </div>
    <div class="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-full border border-accent/20 bg-black/80 px-3 py-1.5 text-xs text-accent backdrop-blur-md" transition:fade>
      <Loader2 size={14} class="animate-spin" />
      <span>Working...</span>
    </div>
  {/if}

  <!-- Desktop Sidebar -->
  <nav class="glass z-10 hidden flex-col items-center gap-3 border-y-0 border-l-0 px-3 py-4 md:flex">
    <div class="mb-4 grid h-10 w-10 place-items-center rounded-md bg-accent text-black">
      <Mail size={20} />
    </div>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'inbox' ? 'bg-white/10' : ''}`} title="Inbox" onclick={() => (view = 'inbox')}>
      <Inbox size={20} />
    </button>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'pending' ? 'bg-white/10' : ''}`} title="Pending" onclick={() => { view = 'pending'; goto('/?view=pending'); }}>
      <Clock3 size={20} />
    </button>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'executed' ? 'bg-white/10' : ''}`} title="Executed" onclick={() => { view = 'executed'; goto('/?view=executed'); }}>
      <Check size={20} />
    </button>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'accounts' ? 'bg-white/10' : ''}`} title="Accounts" onclick={() => (view = 'accounts')}>
      <Settings size={20} />
    </button>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'memory' ? 'bg-white/10' : ''}`} title="Memory" onclick={() => (view = 'memory')}>
      <Shield size={20} />
    </button>
  </nav>

  <!-- Mobile Bottom Rail -->
  <nav class="glass fixed bottom-0 left-0 right-0 z-20 flex h-16 items-center justify-around border-x-0 border-b-0 px-2 md:hidden">
    <button class={`flex flex-col items-center gap-1 p-2 text-zinc-300 ${view === 'inbox' ? 'text-accent' : ''}`} onclick={() => { view = 'inbox'; deselectMessage(); }}>
      <Inbox size={20} />
      <span class="text-[10px]">Inbox</span>
    </button>
    <button class={`flex flex-col items-center gap-1 p-2 text-zinc-300 ${view === 'pending' ? 'text-accent' : ''}`} onclick={() => { view = 'pending'; deselectMessage(); goto('/?view=pending'); }}>
      <Clock3 size={20} />
      <span class="text-[10px]">Pending</span>
    </button>
    <button class={`flex flex-col items-center gap-1 p-2 text-zinc-300 ${view === 'executed' ? 'text-accent' : ''}`} onclick={() => { view = 'executed'; deselectMessage(); goto('/?view=executed'); }}>
      <Check size={20} />
      <span class="text-[10px]">Done</span>
    </button>
    <button class={`flex flex-col items-center gap-1 p-2 text-zinc-300 ${view === 'accounts' ? 'text-accent' : ''}`} onclick={() => { view = 'accounts'; deselectMessage(); }}>
      <Settings size={20} />
      <span class="text-[10px]">Config</span>
    </button>
    <button class={`flex flex-col items-center gap-1 p-2 text-zinc-300 ${view === 'memory' ? 'text-accent' : ''}`} onclick={() => { view = 'memory'; deselectMessage(); }}>
      <Shield size={20} />
      <span class="text-[10px]">Memory</span>
    </button>
  </nav>

  <section class={`border-r border-white/10 bg-black/30 pb-16 md:pb-0 ${data.query.messageId ? 'hidden md:block' : 'block'}`}>
    <div class="border-b border-white/10 p-4">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-semibold">Triage</h1>
        <span class="rounded-full border border-accent-line bg-accent-soft px-2 py-1 text-xs text-accent">review-first</span>
      </div>
      <div class="mt-4 flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2">
        <Search size={16} class="text-zinc-500" />
        <input
          bind:this={searchInput}
          class="w-full bg-transparent text-sm outline-none"
          placeholder="Search mail..."
          bind:value={search}
          onkeydown={(event) => event.key === 'Enter' && applySearch()}
        />
      </div>
      <div class="mt-2 grid grid-cols-[1fr_auto] gap-2">
        <select
          class="w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-xs text-zinc-300 outline-none"
          bind:value={accountFilter}
          onchange={applySearch}
        >
          <option value="">All accounts</option>
          {#each data.accounts as account (account.id)}
            <option value={String(account.id)}>{account.email}</option>
          {/each}
        </select>
        <button class="rounded-md border border-white/10 px-2 py-2 text-xs text-zinc-400" onclick={applySearch}>Apply</button>
      </div>
      <p class="mt-2 text-[11px] text-zinc-500">Shortcut: <kbd class="rounded border border-white/10 px-1 py-0.5">/</kbd> search, <kbd class="rounded border border-white/10 px-1 py-0.5">j</kbd>/<kbd class="rounded border border-white/10 px-1 py-0.5">k</kbd> move selection</p>
      {#if status}
        <p class="mt-3 text-xs text-accent">{status}</p>
      {/if}
    </div>

    {#if view === 'accounts'}
      <div class="space-y-4 overflow-y-auto p-4" in:fade={{ duration: 150 }}>
        <h2 class="text-sm font-medium text-zinc-300">Email Accounts</h2>
        {#each data.accounts as account (account.id)}
          <article class="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-medium">{account.email}</p>
                <p class="text-xs text-zinc-500">{account.host}:{account.port} -> {account.smtpHost}:{account.smtpPort}</p>
                <p class="mt-1 text-xs text-zinc-400">{account.syncStatus}{account.lastSyncAt ? ` · ${new Date(account.lastSyncAt).toLocaleString()}` : ''}</p>
              </div>
              <span class="rounded-full border border-white/10 px-2 py-1 text-xs">{account.isEnabled ? 'enabled' : 'disabled'}</span>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button class="rounded-md border border-white/10 px-2 py-1 text-xs" onclick={() => accountAction(account.id, 'test')}>Test</button>
              <button class="rounded-md border border-white/10 px-2 py-1 text-xs" onclick={() => accountAction(account.id, account.isEnabled ? 'disable' : 'enable')}>{account.isEnabled ? 'Disable' : 'Enable'}</button>
              <button class="rounded-md border border-red-400/30 px-2 py-1 text-xs text-red-200" onclick={() => accountAction(account.id, 'delete')}>Remove</button>
            </div>
          </article>
        {/each}
        <form class="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3" onsubmit={(event) => { event.preventDefault(); addAccount(); }}>
          <h3 class="text-sm font-medium">Add IMAP/SMTP</h3>
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Email" bind:value={accountForm.email} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="IMAP host" bind:value={accountForm.host} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="IMAP username" bind:value={accountForm.username} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="IMAP password" type="password" bind:value={accountForm.password} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="SMTP host" bind:value={accountForm.smtpHost} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="SMTP username" bind:value={accountForm.smtpUsername} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="SMTP password" type="password" bind:value={accountForm.smtpPassword} />
          <button class="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-black"><Plus size={16} /> Add account</button>
        </form>
      </div>
    {:else if view === 'memory'}
      <div class="flex h-[calc(100vh-108px)] flex-col p-4" in:fade={{ duration: 150 }}>
        <h2 class="text-sm font-medium text-zinc-300">AGENT_INSTRUCTIONS.md</h2>
        <p class="mt-1 text-xs text-zinc-500">These instructions are included in every AI triage prompt.</p>
        <textarea class="mt-4 min-h-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-sm leading-6 outline-none" bind:value={memoryText}></textarea>
        <div class="mt-3 flex gap-2">
          <button class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black" onclick={saveMemory}>Save</button>
          <button class="rounded-md border border-white/10 px-3 py-2 text-sm" onclick={resetMemory}>Reset</button>
        </div>
      </div>
    {:else}
      <div class="h-[calc(100vh-108px)] overflow-y-auto" in:fade={{ duration: 150 }}>
        {#each data.messages as message (message.id)}
          <button
            class={`block w-full border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/[0.04] ${data.selected?.message?.id === message.id ? 'bg-white/[0.06]' : ''}`}
            onclick={() => selectMessage(message.id)}
          >
            <div class="flex items-center justify-between gap-3">
              <p class="truncate text-sm font-medium">{message.from}</p>
              <time class="shrink-0 text-xs text-zinc-500">{new Date(message.date).toLocaleDateString()}</time>
            </div>
            <p class="mt-1 truncate text-sm text-zinc-200">{message.subject}</p>
            <p class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{message.snippet}</p>
            <div class="mt-2 flex items-center gap-2">
              <span class="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-400">{message.accountEmail}</span>
              {#if message.suggestionStatus}
                <span class={`rounded-full border px-2 py-0.5 text-[11px] ${riskClass(message.riskLevel)}`}>{message.recommendedAction}</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <section class={`min-w-0 overflow-y-auto pb-20 md:pb-0 ${data.query.messageId || view === 'executed' || view === 'accounts' || view === 'memory' ? 'block' : 'hidden md:block'}`}>
    {#if data.query.messageId && data.selected}
      <div class="sticky top-0 z-10 flex border-b border-white/10 bg-black/80 p-2 backdrop-blur-md md:hidden">
        <button class="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-zinc-300" onclick={deselectMessage}>
          <ChevronLeft size={20} />
          <span>Back</span>
        </button>
      </div>

      <article class="mx-auto max-w-5xl p-4 md:p-8" in:fade={{ duration: 150 }}>
        <header class="border-b border-white/10 pb-6">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full border border-white/10 px-2 py-1 text-xs text-zinc-400">{data.selected.account?.email}</span>
            <span class="rounded-full border border-white/10 px-2 py-1 text-xs text-zinc-400">{data.selected.message.folderPath}</span>
          </div>
          <h2 class="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">{data.selected.message.subject}</h2>
          <p class="mt-3 text-sm text-zinc-400">From {data.selected.message.from} to {data.selected.message.to} · {new Date(data.selected.message.date).toLocaleString()}</p>
        </header>

        <section class="prose prose-invert mt-8 max-w-none rounded-lg border border-white/10 bg-white/[0.03] p-4 md:p-6">
          {#if data.selected.message.safeBodyHtml}
            <div class="mb-4 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
              <p class="text-xs uppercase tracking-[0.18em] text-zinc-500">Message Body</p>
              <div class="flex items-center gap-2 rounded-md border border-white/10 p-1 text-xs">
                <button
                  class={`rounded px-2 py-1 ${bodyMode === 'html' ? 'bg-accent text-black' : 'text-zinc-400'}`}
                  onclick={() => (bodyMode = 'html')}
                >HTML</button>
                <button
                  class={`rounded px-2 py-1 ${bodyMode === 'text' ? 'bg-accent text-black' : 'text-zinc-400'}`}
                  onclick={() => (bodyMode = 'text')}
                >Text</button>
              </div>
            </div>
          {/if}
          {#if bodyMode === 'html' && data.selected.message.safeBodyHtml}
            <article class="email-html overflow-x-auto text-sm leading-7 text-zinc-200">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html data.selected.message.safeBodyHtml}
            </article>
          {:else}
            <pre class="whitespace-pre-wrap font-sans text-sm leading-7 text-zinc-200">{data.selected.message.bodyText}</pre>
          {/if}
        </section>

        {#if data.selected.suggestion}
          <section class={`mt-8 rounded-lg border p-4 md:p-5 ${riskClass(data.selected.suggestion.riskLevel)}`} data-testid="ai-action-card" in:fly={{ y: 20, duration: 300, delay: 100 }}>
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p class="text-xs uppercase tracking-[0.18em] opacity-80">AI Action Card</p>
                <h3 class="mt-2 text-xl font-semibold">{data.selected.suggestion.category}</h3>
                <p class="mt-2 text-sm opacity-90">{data.selected.suggestion.reasoningSummary}</p>
              </div>
              <div class="flex flex-wrap gap-2 text-xs">
                <span class="rounded-full border border-current/20 px-2 py-1">{data.selected.suggestion.recommendedAction}</span>
                <span class="rounded-full border border-current/20 px-2 py-1">{Math.round(data.selected.suggestion.confidence * 100)}%</span>
                <span class="rounded-full border border-current/20 px-2 py-1">{data.selected.suggestion.riskLevel} risk</span>
              </div>
            </div>
            {#if data.selected.suggestion.targetFolder}
              <p class="mt-4 text-sm">Target folder: {data.selected.suggestion.targetFolder}</p>
            {/if}
            {#if data.selected.suggestion.delegateInstructions}
              <p class="mt-4 text-sm">Delegate: {data.selected.suggestion.delegateInstructions}</p>
            {/if}
            {#if data.selected.suggestion.draftReply || ['reply', 'forward'].includes(data.selected.suggestion.recommendedAction)}
              <label class="mt-5 block text-sm font-medium" for="draft">Draft</label>
              <textarea id="draft" data-testid="draft-reply" class="mt-2 min-h-44 w-full resize-y rounded-md border border-current/20 bg-black/30 p-3 text-sm text-white outline-none" bind:value={draftText}></textarea>
            {/if}
            <div class="mt-5 flex flex-wrap items-center gap-2">
              <button data-testid="execute-suggestion" class="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-black" onclick={executeSuggestion}><Send size={16} /> Execute</button>
              <button class="rounded-md border border-current/20 px-3 py-2 text-sm" onclick={saveEdit}>Save Edit</button>
              <button class="rounded-md border border-current/20 px-3 py-2 text-sm" onclick={rejectSuggestion}>Reject</button>
              <div class="mt-2 flex w-full flex-wrap gap-2 md:mt-0 md:w-auto md:flex-1">
                 <input class="min-w-0 flex-1 rounded-md border border-current/20 bg-black/30 px-3 py-2 text-sm text-white" placeholder="Tweak this suggestion..." bind:value={regenNote} />
                 <button class="flex items-center gap-2 rounded-md border border-current/20 px-3 py-2 text-sm" onclick={regenerate}><RefreshCw size={16} /> Regenerate</button>
              </div>
            </div>
          </section>
        {:else}
          <div in:fade>
            <button class="mt-6 rounded-md bg-accent px-3 py-2 text-sm font-medium text-black" onclick={() => generateSuggestion(data.selected?.message.id ?? 0)}>Generate suggestion</button>
          </div>
        {/if}
      </article>
    {:else if view === 'executed'}
      <div class="mx-auto max-w-4xl p-8" in:fade={{ duration: 150 }}>
        <h2 class="text-2xl font-semibold">Executed Actions</h2>
        <div class="mt-6 space-y-3">
          {#each data.executed as action (action.id)}
            <article class="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <p class="font-medium">{action.actionType}</p>
              <p class="text-sm text-zinc-500">{action.status} · {new Date(action.createdAt).toLocaleString()}</p>
              <pre class="mt-3 overflow-auto rounded-md bg-black/30 p-3 text-xs text-zinc-400">{action.detailsJson}</pre>
            </article>
          {/each}
        </div>
      </div>
    {:else if view === 'accounts'}
      <div class="mx-auto max-w-3xl p-8" in:fade={{ duration: 150 }}>
        <h2 class="text-2xl font-semibold">Configuration</h2>
        <p class="mt-2 text-zinc-400">Passwords are encrypted at rest and are never displayed after saving.</p>
        <div class="mt-8 rounded-lg border border-white/10 bg-white/[0.03] p-5">
          <h3 class="font-medium">AI Providers</h3>
          <p class="mt-2 text-sm text-zinc-400">DeepSeek is the primary provider via <code>AI_PROVIDER</code>, <code>AI_MODEL</code>, <code>AI_BASE_URL</code>, and <code>AI_API_KEY</code>. Gemini fallback uses <code>AI_FALLBACK_MODEL</code> and related fallback env vars.</p>
        </div>
        <form class="mt-4 flex gap-2" onsubmit={(event) => { event.preventDefault(); addWebhook(); }}>
          <input class="flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Delegate webhook URL" bind:value={webhookTarget} />
          <button class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black">Add webhook</button>
        </form>
      </div>
    {:else if view === 'memory'}
      <div class="mx-auto max-w-3xl p-8" in:fade={{ duration: 150 }}>
        <h2 class="text-2xl font-semibold">Living Memory</h2>
        <p class="mt-3 text-zinc-400">The editor on the left writes to <code>/data/AGENT_INSTRUCTIONS.md</code>. New suggestions use the latest saved version.</p>
      </div>
    {:else}
      <div class="grid h-full place-items-center text-zinc-500" in:fade>No message selected</div>
    {/if}
  </section>
</main>
