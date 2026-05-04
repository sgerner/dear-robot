<script lang="ts">
  import { Check, ChevronRight, Inbox, Plus, Settings, UserCircle, X } from 'lucide-svelte';
  import { fade, scale } from 'svelte/transition';
  import ScrollArea from './ui/ScrollArea.svelte';

  interface Account {
    id: number;
    email: string;
  }

  interface Folder {
    accountId: number;
    path: string;
    unread: number;
    total: number;
  }

  let {
    accounts = [],
    folders = [],
    accountFilter = $bindable(''),
    selectedFolder = $bindable(''),
    showAccountPicker = $bindable(false),
    onselect = () => {}
  } = $props<{
    accounts?: Account[];
    folders?: Folder[];
    accountFilter?: string;
    selectedFolder?: string;
    showAccountPicker?: boolean;
    onselect?: (_accountId: string, _path: string) => void;
  }>();

  function selectAccount(id: string) {
    accountFilter = id;
    showAccountPicker = false;
  }

  function selectFolder(accountId: number, path: string) {
    selectedFolder = `${accountId}:${path}`;
    onselect(String(accountId), path);
  }

  const groupedFolders = $derived(
    folders.reduce((acc: Record<number, Folder[]>, folder: Folder) => {
      if (!acc[folder.accountId]) acc[folder.accountId] = [];
      acc[folder.accountId].push(folder);
      return acc;
    }, {})
  );

  const displayedAccounts = $derived(
    accountFilter ? accounts.filter((a: Account) => String(a.id) === accountFilter) : accounts
  );
</script>

<div class="flex flex-col h-full relative">
  <!-- Account Picker Modal -->
  {#if showAccountPicker}
    <div 
      role="button"
      tabindex="-1"
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      transition:fade={{ duration: 150 }}
      onclick={() => (showAccountPicker = false)}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          showAccountPicker = false;
        }
      }}
    >
      <div 
        role="presentation"
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

  <!-- Sidebar Header -->
  <div class="p-4 flex items-center justify-between border-b border-border/40">
    <button 
      class="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-muted transition-colors group"
      onclick={() => (showAccountPicker = true)}
    >
      <div class="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
        <UserCircle size={20} />
      </div>
      <div class="flex flex-col items-start overflow-hidden">
        <span class="text-sm font-semibold truncate max-w-[120px]">
          {accountFilter ? accounts.find((a: Account) => String(a.id) === accountFilter)?.email.split('@')[0] : 'All Accounts'}
        </span>
        <span class="text-[10px] text-muted-foreground flex items-center gap-0.5">
          Switch <ChevronRight size={10} />
        </span>
      </div>
    </button>
    <button class="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
      <Plus size={20} />
    </button>
  </div>

  <!-- Navigation -->
  <div class="flex-1 overflow-hidden py-4">
    <ScrollArea class="h-full px-3">
      <div class="space-y-6">
        {#each displayedAccounts as account (account.id)}
          <div class="space-y-1">
            <h3 class="px-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 flex items-center justify-between">
              {account.email}
              {#if !accountFilter}
                <div class="h-1 w-1 rounded-full bg-primary/40"></div>
              {/if}
            </h3>
            
            <div class="space-y-0.5">
              {#each groupedFolders[account.id] || [] as folder (folder.path)}
                <button
                  class={`
                    flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-all duration-200
                    ${
                      selectedFolder === `${folder.accountId}:${folder.path}`
                        ? 'bg-primary/10 text-primary font-medium shadow-sm'
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

  <!-- Bottom Actions -->
  <div class="p-4 border-t border-border/40 bg-muted/20">
    <a 
      href="/settings" 
      class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all group"
    >
      <Settings size={18} class="group-hover:rotate-45 transition-transform duration-300" />
      Settings
    </a>
  </div>
</div>
