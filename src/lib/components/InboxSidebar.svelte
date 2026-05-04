<script lang="ts">
  import {
    Search,
    FolderOpen,
    Keyboard,
    ChevronDown,
    X,
    Inbox,
    Mail,
    Star,
    Clock,
    UserCircle,
    Check
  } from 'lucide-svelte';
  import { slide, fade, scale } from 'svelte/transition';
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
    searchInput = $bindable(),
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

  let showAccountPicker = $state(false);

  const views = [
    { id: 'inbox', label: 'All', icon: Inbox },
    { id: 'unread', label: 'Unread', icon: Mail },
    { id: 'starred', label: 'Starred', icon: Star },
    { id: 'pending', label: 'Pending', icon: Clock }
  ];

  const currentAccountLabel = $derived(
    accountFilter 
      ? (accounts.find((a: any) => String(a.id) === accountFilter)?.email.split('@')[0] || 'Unknown') 
      : 'All'
  );

  function selectAccount(id: string) {
    accountFilter = id;
    showAccountPicker = false;
    applySearch({ clearMessage: true });
  }

  function folderGroups() {
    const groups = new Map<
      number,
      { accountId: number; accountEmail: string; folders: typeof folders }
    >();
    for (const folder of folders) {
      if (!groups.has(folder.accountId)) {
        groups.set(folder.accountId, {
          accountId: folder.accountId,
          accountEmail: folder.accountEmail,
          folders: []
        });
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

<div class="flex flex-col h-full relative">
  <!-- Account Picker Modal -->
  {#if showAccountPicker}
    <div 
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      transition:fade={{ duration: 150 }}
      onclick={() => (showAccountPicker = false)}
    >
      <div 
        class="w-full max-w-[280px] rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        transition:scale={{ duration: 200, start: 0.95 }}
        onclick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between border-b border-border/60 px-4 py-3 bg-muted/30">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Switch Account</h2>
          <button 
            class="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            onclick={() => (showAccountPicker = false)}
          >
            <X size={14} />
          </button>
        </div>
        
        <div class="p-2 space-y-1 max-h-[400px] overflow-y-auto scrollbar-thin">
          <button
            class={`
              flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-all
              ${!accountFilter ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-muted-foreground'}
            `}
            onclick={() => selectAccount('')}
          >
            <span class="flex items-center gap-2">
              <Inbox size={14} />
              All Accounts
            </span>
            {#if !accountFilter}
              <Check size={14} />
            {/if}
          </button>
          
          {#each accounts as account (account.id)}
            <button
              class={`
                flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-all
                ${accountFilter === String(account.id) ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-muted-foreground'}
              `}
              onclick={() => selectAccount(String(account.id))}
            >
              <span class="flex items-center gap-2 truncate">
                <UserCircle size={14} />
                <span class="truncate">{account.email}</span>
              </span>
              {#if accountFilter === String(account.id)}
                <Check size={14} />
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Compact Header Section -->
  <div class="space-y-1.5 p-2 bg-background/50 backdrop-blur-sm">
    {#if isInboxView(view)}
      <!-- Row 1: Account Filter & Search & Help -->
      <div class="flex items-center gap-1.5">
        <button
          class="flex h-8 min-w-[70px] max-w-[100px] items-center justify-between gap-1.5 rounded-md border border-input bg-muted/30 px-2 text-[11px] font-medium text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground active:scale-95"
          onclick={() => (showAccountPicker = true)}
          title="Switch Account"
        >
          <span class="truncate">{currentAccountLabel}</span>
          <ChevronDown size={10} class="shrink-0 text-muted-foreground/60" />
        </button>

        <div class="relative flex-1">
          <Search
            size={13}
            class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            bind:this={searchInput}
            class="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring transition-all"
            placeholder="Search mail..."
            bind:value={search}
            oninput={scheduleSearch}
            onkeydown={(e) => e.key === 'Enter' && applySearch({ clearMessage: true })}
          />
          {#if search}
            <button
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              onclick={() => {
                search = '';
                applySearch({ clearMessage: true });
              }}
            >
              <X size={12} />
            </button>
          {/if}
        </div>
        
        <button
          class="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          class:bg-muted={showShortcutHelp}
          class:text-foreground={showShortcutHelp}
          title={showShortcutHelp ? 'Hide shortcuts' : 'Show shortcuts (?)'}
          onclick={() => (showShortcutHelp = !showShortcutHelp)}
        >
          <Keyboard size={14} />
        </button>
      </div>

      <!-- Row 2: View Tabs & Folders Toggle -->
      <div class="flex items-center gap-1.5">
        <div class="flex flex-1 items-center gap-0.5 rounded-lg border border-border/40 bg-muted/20 p-0.5">
          {#each views as v (v.id)}
            {@const Icon = v.icon}
            <button
              class={`
                flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 px-1.5 text-[10px] font-medium
                transition-all duration-200
                ${
                  view === v.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
                }
              `}
              onclick={() => setQuickView(v.id)}
            >
              <Icon size={12} />
              <span class="hidden sm:inline">{v.label}</span>
            </button>
          {/each}
        </div>

        <button
          class={`
            flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2 text-[10px] font-medium transition-all
            ${foldersExpanded ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted/10 text-muted-foreground hover:bg-muted/30'}
          `}
          onclick={() => (foldersExpanded = !foldersExpanded)}
        >
          <FolderOpen size={12} />
          <span class="hidden sm:inline">Folders</span>
          {#if !foldersExpanded}
            <Badge variant="outline" class="text-[9px] h-3.5 px-1 min-w-0 border-current/20">{folders.length}</Badge>
          {/if}
          <ChevronDown
            size={12}
            class="transition-transform duration-200 {foldersExpanded ? 'rotate-180' : ''}"
          />
        </button>
      </div>
    {/if}
  </div>

  <!-- Shortcuts Help -->
  {#if isInboxView(view) && showShortcutHelp}
    <div
      class="mx-2 mt-2 rounded-lg border border-border/60 bg-muted/30 p-2"
      transition:slide={{ duration: 200 }}
    >
      <div class="flex items-center gap-2 text-foreground mb-1.5">
        <Keyboard size={13} class="text-primary" />
        <span class="font-semibold text-[11px]">Keyboard Shortcuts</span>
      </div>
      <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        <div class="flex items-center gap-1.5">
          <kbd class="rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px]">/</kbd>
          <span class="text-muted-foreground">Search</span>
        </div>
        <div class="flex items-center gap-1.5">
          <kbd class="rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px]">c</kbd>
          <span class="text-muted-foreground">Compose</span>
        </div>
        <div class="flex items-center gap-1.5">
          <kbd class="rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px]">j</kbd>
          <span class="text-muted-foreground">Next</span>
        </div>
        <div class="flex items-center gap-1.5">
          <kbd class="rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px]">k</kbd>
          <span class="text-muted-foreground">Prev</span>
        </div>
        <div class="flex items-center gap-1.5">
          <kbd class="rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px]">r</kbd>
          <span class="text-muted-foreground">Reply</span>
        </div>
        <div class="flex items-center gap-1.5">
          <kbd class="rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px]">a</kbd>
          <span class="text-muted-foreground">Archive</span>
        </div>
        <div class="flex items-center gap-1.5">
          <kbd class="rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px]">s</kbd>
          <span class="text-muted-foreground">Star</span>
        </div>
      </div>
    </div>
  {/if}

  <!-- Folders Section -->
  {#if isInboxView(view) && foldersExpanded}
    <div class="border-b border-border/40" transition:slide={{ duration: 200 }}>
      <ScrollArea class="max-h-[300px] px-2 py-2 scrollbar-thin">
        <div class="space-y-1.5">
          {#each folderGroups() as group (group.accountId)}
            <div class="rounded-lg border border-border/60 bg-muted/10 p-1.5">
              <p class="truncate px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                {group.accountEmail}
              </p>
              <div class="mt-1 space-y-0.5">
                {#each group.folders as folder (folder.id)}
                  <button
                    class={`
                      flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px]
                      transition-colors duration-150
                      ${
                        query?.folder === folder.path &&
                        String(query?.accountId || '') === String(folder.accountId)
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
                        <span class="text-muted-foreground/40">/{folder.total}</span>
                      {:else}
                        <span class="text-muted-foreground/40">{folder.total}</span>
                      {/if}
                    </span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </ScrollArea>
    </div>
  {/if}
</div>
