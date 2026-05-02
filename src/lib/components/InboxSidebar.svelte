<script lang="ts">
  import { Search, FolderOpen, Keyboard, ChevronDown, X, Inbox, Mail, Star, Clock } from 'lucide-svelte';
  import { slide } from 'svelte/transition';
  import Button from '$lib/components/ui/Button.svelte';
  import ScrollArea from '$lib/components/ui/ScrollArea.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';

  let {
    view = 'inbox',
    search = $bindable(''),
    accountFilter = $bindable(''),
    accounts = [],
    folders = [],
    query = {},
    foldersExpanded = $bindable(false),
    showShortcutHelp = $bindable(false),
    isInboxView,
    setQuickView,
    applySearch,
    scheduleSearch,
    searchInput,
    selectFolder
  }: {
    view: string;
    search: string;
    accountFilter: string;
    accounts: any[];
    folders: any[];
    query: any;
    foldersExpanded: boolean;
    showShortcutHelp: boolean;
    isInboxView: (v: string) => boolean;
    setQuickView: (v: any) => void;
    applySearch: (opts?: any) => void;
    scheduleSearch: () => void;
    searchInput: HTMLInputElement | undefined;
    selectFolder: (accountId: number, path: string) => void;
  } = $props();

  const views = [
    { id: 'inbox', label: 'All', icon: Inbox },
    { id: 'unread', label: 'Unread', icon: Mail },
    { id: 'starred', label: 'Starred', icon: Star },
    { id: 'pending', label: 'Pending', icon: Clock }
  ];

  function folderGroups() {
    const groups = new Map<
      number,
      { accountId: number; accountEmail: string; folders: typeof folders }
    >();
    for (const folder of folders) {
      if (!groups.has(folder.accountId)) {
        groups.set(folder.accountId, { accountId: folder.accountId, accountEmail: folder.accountEmail, folders: [] });
      }
      groups.get(folder.accountId)?.folders.push(folder);
    }
    return Array.from(groups.values()).sort((a, b) => a.accountEmail.localeCompare(b.accountEmail));
  }

  function getUnreadCount(viewId: string) {
    // This could be computed from data in a real implementation
    return null;
  }
</script>

<div class="flex h-full flex-col">
  <!-- Header Section -->
  <div class="space-y-3 p-4 pb-3">
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-semibold text-foreground tracking-tight">Triage</h1>
    </div>

    {#if isInboxView(view)}
      <!-- Search -->
      <div class="flex items-center gap-2">
        <div class="relative flex-1">
          <Search size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            bind:this={searchInput}
            class="h-9 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring transition-all"
            placeholder="Search mail..."
            bind:value={search}
            oninput={scheduleSearch}
            onkeydown={(e) => e.key === 'Enter' && applySearch({ clearMessage: true })}
          />
          {#if search}
            <button
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              onclick={() => { search = ''; applySearch({ clearMessage: true }); }}
            >
              <X size={14} />
            </button>
          {/if}
        </div>
        <button
          class="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          class:bg-muted={showShortcutHelp}
          class:text-foreground={showShortcutHelp}
          title={showShortcutHelp ? 'Hide shortcuts' : 'Show shortcuts (?)'}
          onclick={() => (showShortcutHelp = !showShortcutHelp)}
        >
          <Keyboard size={14} />
        </button>
      </div>

      <!-- Account Filter -->
      <select
        class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-muted-foreground outline-none focus:ring-1 focus:ring-ring transition-all"
        bind:value={accountFilter}
        onchange={() => applySearch({ clearMessage: true })}
      >
        <option value="">All accounts</option>
        {#each accounts as account (account.id)}
          <option value={String(account.id)}>{account.email}</option>
        {/each}
      </select>

      <!-- View Tabs -->
      <div class="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
        {#each views as v (v.id)}
          {@const Icon = v.icon}
          <button
            class={`
              flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 px-2 text-xs font-medium
              transition-all duration-200
              ${view === v.id 
                ? 'bg-background text-foreground shadow-sm' 
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }
            `}
            onclick={() => setQuickView(v.id)}
          >
            <Icon size={14} />
            <span>{v.label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Shortcuts Help -->
  {#if isInboxView(view) && showShortcutHelp}
    <div 
      class="mx-4 mb-3 rounded-lg border border-border/60 bg-muted/30 p-3"
      transition:slide={{ duration: 200 }}
    >
      <div class="flex items-center gap-2 text-foreground mb-2">
        <Keyboard size={14} class="text-primary" />
        <span class="font-semibold text-sm">Keyboard Shortcuts</span>
      </div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div class="flex items-center gap-2">
          <kbd class="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">/</kbd>
          <span class="text-muted-foreground">Search</span>
        </div>
        <div class="flex items-center gap-2">
          <kbd class="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">c</kbd>
          <span class="text-muted-foreground">Compose</span>
        </div>
        <div class="flex items-center gap-2">
          <kbd class="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">j</kbd>
          <span class="text-muted-foreground">Next message</span>
        </div>
        <div class="flex items-center gap-2">
          <kbd class="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">k</kbd>
          <span class="text-muted-foreground">Previous</span>
        </div>
        <div class="flex items-center gap-2">
          <kbd class="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">r</kbd>
          <span class="text-muted-foreground">Reply</span>
        </div>
        <div class="flex items-center gap-2">
          <kbd class="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">s</kbd>
          <span class="text-muted-foreground">Star</span>
        </div>
        <div class="flex items-center gap-2">
          <kbd class="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">e</kbd>
          <span class="text-muted-foreground">Archive</span>
        </div>
        <div class="flex items-center gap-2">
          <kbd class="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">#</kbd>
          <span class="text-muted-foreground">Trash</span>
        </div>
      </div>
    </div>
  {/if}

  <!-- Folders Section -->
  {#if isInboxView(view)}
    <div class="px-4">
      <button
        class="flex w-full items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
        onclick={() => (foldersExpanded = !foldersExpanded)}
      >
        <span class="flex items-center gap-2">
          <FolderOpen size={14} />
          <span class="font-medium">Folders</span>
        </span>
        <span class="flex items-center gap-1.5">
          {#if !foldersExpanded}
            <Badge variant="outline" class="text-[10px] h-5">{folders.length}</Badge>
          {/if}
          <ChevronDown size={14} class="transition-transform duration-200 {foldersExpanded ? 'rotate-180' : ''}" />
        </span>
      </button>
    </div>
    
    {#if foldersExpanded}
      <ScrollArea class="flex-1 px-4 pt-2 scrollbar-thin">
        <div class="space-y-2 pb-4">
          {#each folderGroups() as group (group.accountId)}
            <div class="rounded-lg border border-border/60 bg-muted/20 p-2">
              <p class="truncate px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                {group.accountEmail}
              </p>
              <div class="mt-1 space-y-0.5">
                {#each group.folders as folder (folder.id)}
                  <button
                    class={`
                      flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs
                      transition-colors duration-150
                      ${query?.folder === folder.path && String(query?.accountId || '') === String(folder.accountId) 
                        ? 'bg-primary/10 text-primary font-medium' 
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }
                    `}
                    onclick={() => selectFolder(folder.accountId, folder.path)}
                  >
                    <span class="truncate">{folder.path}</span>
                    <span class="shrink-0 text-[10px] tabular-nums">
                      {#if folder.unread}
                        <span class="text-primary font-medium">{folder.unread}</span>
                        <span class="text-muted-foreground/60">/{folder.total}</span>
                      {:else}
                        <span class="text-muted-foreground/60">{folder.total}</span>
                      {/if}
                    </span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </ScrollArea>
    {:else}
      <div class="flex-1"></div>
    {/if}
  {:else}
    <div class="flex-1"></div>
  {/if}
</div>


