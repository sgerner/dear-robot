<script lang="ts">
  import { Star, Archive, Trash2 } from 'lucide-svelte';
  import { flip } from 'svelte/animate';
  import ScrollArea from '$lib/components/ui/ScrollArea.svelte';

  let {
    messages = [],
    selectedId = null,
    swiping = null,
    swipeSettings,
    view: _view = 'inbox',
    swipeLabel,
    swipeActionForDelta,
    startSwipe,
    updateSwipe,
    finishSwipe,
    cancelSwipe,
    selectMessage,
    riskClass: _riskClass
  }: {
    messages: any[];
    selectedId: number | null;
    swiping: any;
    swipeSettings: any;
    view: string;
    swipeLabel: (_id: any) => string;
    swipeActionForDelta: (_delta: number) => any;
    startSwipe: (_e: PointerEvent, _id: number) => void;
    updateSwipe: (_e: PointerEvent) => void;
    finishSwipe: (_e: PointerEvent, _id: number) => Promise<void>;
    cancelSwipe: () => void;
    selectMessage: (_id: number) => Promise<void>;
    riskClass: (_risk: string | null | undefined) => string;
  } = $props();

  function formatDate(date: string) {
    const d = new Date(date);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const isThisYear = d.getFullYear() === now.getFullYear();

    if (isToday) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    if (isThisYear) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
  }
</script>

<ScrollArea class="flex-1 min-h-0 scrollbar-thin">
  {#each messages as message (message.id)}
    <div
      class="relative overflow-hidden border-b border-border/30 last:border-b-0"
      animate:flip={{ duration: 200 }}
    >
      <!-- Swipe left background (archive) -->
      <div
        class="absolute inset-y-0 left-0 flex w-28 items-center gap-2 bg-primary/10 px-4 text-xs font-medium text-primary transition-opacity duration-150"
        style={`opacity: ${swiping?.id === message.id && swiping.deltaX > 0 ? Math.min(1, Math.abs(swiping.deltaX) / 100) : 0}`}
      >
        <Archive size={14} />
        <span
          >{swipeLabel(
            swiping?.id === message.id && swiping.deltaX > 0
              ? swipeActionForDelta(swiping.deltaX)
              : swipeSettings.rightShort
          )}</span
        >
      </div>

      <!-- Swipe right background (delete/trash) -->
      <div
        class="absolute inset-y-0 right-0 flex w-28 items-center justify-end gap-2 bg-destructive/10 px-4 text-xs font-medium text-destructive transition-opacity duration-150"
        style={`opacity: ${swiping?.id === message.id && swiping.deltaX < 0 ? Math.min(1, Math.abs(swiping.deltaX) / 100) : 0}`}
      >
        <span
          >{swipeLabel(
            swiping?.id === message.id && swiping.deltaX < 0
              ? swipeActionForDelta(swiping.deltaX)
              : swipeSettings.leftShort
          )}</span
        >
        <Trash2 size={14} />
      </div>

      <!-- Message row -->
      <button
        data-testid="message-row"
        class={`group relative block w-full touch-pan-y text-left transition-all duration-150 ${
          selectedId === message.id
            ? 'bg-primary/[0.06] border-l-2 border-l-primary'
            : 'border-l-2 border-l-transparent hover:bg-muted/30'
        }`}
        style={`transform: translateX(${swiping?.id === message.id ? swiping.deltaX : 0}px)`}
        onpointerdown={(e) => startSwipe(e, message.id)}
        onpointermove={updateSwipe}
        onpointerup={(e) => finishSwipe(e, message.id)}
        onpointercancel={cancelSwipe}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectMessage(message.id);
          }
        }}
      >
        <div class="px-3 py-2 min-w-0 space-y-1">
          <!-- Line 1: From + inline badge + date -->
          <div class="flex items-center gap-2 min-w-0">
            <p
              class={`truncate text-sm flex-1 min-w-0 ${message.isRead ? 'text-muted-foreground font-normal' : 'font-semibold text-foreground'}`}
            >
              {#if message.isFlagged}
                <Star size={12} class="inline fill-primary text-primary mr-1 -mt-0.5" />
              {/if}
              {message.from}
            </p>

            {#if message.suggestionStatus}
              <span
                class="shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 font-medium {message.riskLevel ===
                'high'
                  ? 'bg-destructive/15 text-destructive'
                  : message.riskLevel === 'medium'
                    ? 'bg-muted/50 text-muted-foreground'
                    : 'bg-primary/15 text-primary'}"
              >
                {message.recommendedAction}
              </span>
            {/if}

            <time
              class="shrink-0 text-[11px] tabular-nums tracking-tight {message.isRead
                ? 'text-muted-foreground/60'
                : 'text-muted-foreground'}"
            >
              {formatDate(message.date)}
            </time>
          </div>

          <!-- Line 2: Subject -->
          <p
            class={`truncate text-sm leading-tight ${message.isRead ? 'text-muted-foreground' : 'font-medium text-foreground'}`}
          >
            {message.subject}
          </p>

          <!-- Line 3: Snippet -->
          <p class="truncate text-xs leading-tight text-muted-foreground/70 mt-0.5">
            {message.snippet}
          </p>
        </div>
      </button>
    </div>
  {/each}

  {#if messages.length === 0}
    <div class="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
      <div class="h-10 w-10 bg-muted/30 flex items-center justify-center">
        <svg
          class="h-5 w-5 text-muted-foreground/40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path
            d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <p class="text-sm">No messages</p>
    </div>
  {/if}
</ScrollArea>
