<script lang="ts">
  import {
    Archive,
    Eye,
    EyeOff,
    Forward,
    MoreHorizontal,
    Reply,
    ReplyAll,
    ShieldAlert,
    Star,
    Trash2,
    X
  } from 'lucide-svelte';
  import { fade, fly } from 'svelte/transition';

  let {
    selectedMessage,
    visibleActionIds,
    overflowActionIds,
    quickActionMeta,
    runQuickAction,
    quickActionOverflowOpen = $bindable()
  } = $props<{
    selectedMessage: { isRead?: boolean } | null;
    visibleActionIds: string[];
    overflowActionIds: string[];
    quickActionButtonClass: (_actionId: any, _compact?: boolean) => string;
    quickActionMeta: (_actionId: any) => { label: string } | undefined;
    runQuickAction: (_actionId: any) => void | Promise<void>;
    quickActionOverflowOpen: boolean;
  }>();

  const actionIcons: Record<string, any> = {
    reply: Reply,
    reply_all: ReplyAll,
    forward: Forward,
    archive: Archive,
    delete: Trash2,
    spam: ShieldAlert,
    toggle_read: Eye,
    star: Star
  };
</script>

<!-- Backdrop for overflow menu -->
{#if quickActionOverflowOpen && overflowActionIds.length}
  <button
    class="fixed inset-0 z-40 bg-black/40 lg:hidden"
    aria-label="Close menu"
    transition:fade={{ duration: 150 }}
    onclick={() => (quickActionOverflowOpen = false)}
  ></button>
{/if}

<!-- Mobile Quick Actions Bar -->
<nav
  class="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur-md lg:hidden safe-area-pb"
  style="padding-bottom: env(safe-area-inset-bottom, 0px);"
>
  <div
    class="flex items-center gap-1 px-2 py-2"
    style={`display: grid; grid-template-columns: repeat(${visibleActionIds.length + (overflowActionIds.length ? 1 : 0)}, minmax(0, 1fr));`}
  >
    {#each visibleActionIds as actionId (actionId)}
      {@const Icon = actionIcons[actionId]}
      {@const meta = quickActionMeta(actionId)}
      <button
        class={`
          touch-target group relative flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1
          transition-all duration-200 active:scale-95
          ${
            meta?.tone === 'danger'
              ? 'text-destructive hover:bg-destructive/10'
              : meta?.tone === 'accent'
                ? 'text-primary hover:bg-primary/10'
                : 'text-foreground hover:bg-muted'
          }
        `}
        aria-label={meta?.label}
        title={meta?.label}
        onclick={() => runQuickAction(actionId)}
      >
        {#if actionId === 'toggle_read'}
          {#if selectedMessage?.isRead}
            <EyeOff size={20} />
          {:else}
            <Eye size={20} />
          {/if}
        {:else if Icon}
          <Icon size={20} />
        {/if}
        <span class="quick-action-label max-w-full text-center text-[10px] font-medium leading-tight line-clamp-2">{meta?.label}</span>
      </button>
    {/each}

    {#if overflowActionIds.length}
      <div class="relative">
        <button
          class={`
            touch-target flex w-full flex-col items-center justify-center gap-1 rounded-lg py-2 px-1
            transition-all duration-200 active:scale-95
            ${quickActionOverflowOpen ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'}
          `}
          aria-label="More actions"
          title="More actions"
          onclick={() => (quickActionOverflowOpen = !quickActionOverflowOpen)}
        >
          {#if quickActionOverflowOpen}
            <X size={20} />
          {:else}
            <MoreHorizontal size={20} />
          {/if}
          <span class="quick-action-label quick-action-more-label text-[10px] font-medium leading-tight">More</span>
        </button>

        <!-- Overflow Menu -->
        {#if quickActionOverflowOpen}
          <div
            class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 min-w-[160px] overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
            transition:fly={{ y: 10, duration: 200 }}
          >
            <div class="p-1.5">
              {#each overflowActionIds as actionId (actionId)}
                {@const Icon = actionIcons[actionId]}
                {@const meta = quickActionMeta(actionId)}
                <button
                  class={`
                    flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm
                    transition-colors duration-150
                    ${
                      meta?.tone === 'danger'
                        ? 'text-destructive hover:bg-destructive/10'
                        : 'text-foreground hover:bg-muted'
                    }
                  `}
                  onclick={() => {
                    quickActionOverflowOpen = false;
                    runQuickAction(actionId);
                  }}
                >
                  {#if actionId === 'toggle_read'}
                    <Eye size={16} />
                  {:else if Icon}
                    <Icon size={16} />
                  {/if}
                  <span class="font-medium">{meta?.label}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</nav>

<style>
  .safe-area-pb {
    padding-bottom: max(env(safe-area-inset-bottom, 0px), 8px);
  }

  @media (max-width: 359px) {
    .quick-action-label {
      display: none;
    }
  }
</style>
