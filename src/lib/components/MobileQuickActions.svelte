<script lang="ts">
  import {
    Archive,
    Eye,
    EyeOff,
    Forward,
    MoreVertical,
    Reply,
    ReplyAll,
    ShieldAlert,
    Star,
    Trash2
  } from 'lucide-svelte';

  let {
    selectedMessage,
    visibleActionIds,
    overflowActionIds,
    quickActionButtonClass,
    quickActionMeta,
    runQuickAction,
    quickActionOverflowOpen = $bindable()
  } = $props<{
    selectedMessage: { isRead?: boolean } | null;
    visibleActionIds: string[];
    overflowActionIds: string[];
    quickActionButtonClass: (actionId: any, compact?: boolean) => string;
    quickActionMeta: (actionId: any) => { label: string } | undefined;
    runQuickAction: (actionId: any) => void | Promise<void>;
    quickActionOverflowOpen: boolean;
  }>();

  function iconFor(actionId: string, size = 16) {
    return { actionId, size };
  }
</script>

<nav
  class="fixed bottom-0 left-0 right-0 z-30 grid gap-1 border-t border-white/10 bg-black/95 px-2 py-2 backdrop-blur-md md:hidden"
  style={`grid-template-columns: repeat(${visibleActionIds.length + (overflowActionIds.length ? 1 : 0)}, minmax(0, 1fr));`}
>
  {#each visibleActionIds as actionId (actionId)}
    <button
      class={quickActionButtonClass(actionId, true)}
      aria-label={quickActionMeta(actionId)?.label}
      title={quickActionMeta(actionId)?.label}
      onclick={() => runQuickAction(actionId)}
    >
      {#if actionId === 'reply'}<Reply size={16} />
      {:else if actionId === 'reply_all'}<ReplyAll size={16} />
      {:else if actionId === 'forward'}<Forward size={16} />
      {:else if actionId === 'archive'}<Archive size={16} />
      {:else if actionId === 'delete'}<Trash2 size={16} />
      {:else if actionId === 'spam'}<ShieldAlert size={16} />
      {:else if actionId === 'toggle_read'}
        {#if selectedMessage?.isRead}<EyeOff size={16} />{:else}<Eye size={16} />{/if}
      {:else if actionId === 'star'}<Star size={16} />{/if}
    </button>
  {/each}
  {#if overflowActionIds.length}
    <div class="relative">
      <button
        class="grid w-full place-items-center rounded-md border border-white/10 bg-white/[0.03] p-2 text-zinc-200 transition-all duration-150 active:scale-95"
        aria-label="More actions"
        title="More actions"
        onclick={() => (quickActionOverflowOpen = !quickActionOverflowOpen)}
      >
        <MoreVertical size={16} />
      </button>
      {#if quickActionOverflowOpen}
        <div
          class="absolute bottom-12 right-0 min-w-40 overflow-hidden rounded-lg border border-white/10 bg-zinc-950 p-1 shadow-2xl shadow-black/60"
        >
          {#each overflowActionIds as actionId (actionId)}
            <button
              class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-zinc-200 transition-colors duration-150 hover:bg-white/[0.08]"
              onclick={() => runQuickAction(actionId)}
            >
              {#if actionId === 'reply'}<Reply size={14} />
              {:else if actionId === 'reply_all'}<ReplyAll size={14} />
              {:else if actionId === 'forward'}<Forward size={14} />
              {:else if actionId === 'archive'}<Archive size={14} />
              {:else if actionId === 'delete'}<Trash2 size={14} />
              {:else if actionId === 'spam'}<ShieldAlert size={14} />
              {:else if actionId === 'toggle_read'}<Eye size={14} />
              {:else if actionId === 'star'}<Star size={14} />{/if}
              {quickActionMeta(actionId)?.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</nav>
