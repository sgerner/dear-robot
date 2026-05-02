<script lang="ts">
  import { Star, Archive, Trash2 } from 'lucide-svelte';
  import { flip } from 'svelte/animate';
  import Badge from '$lib/components/ui/Badge.svelte';
  import ScrollArea from '$lib/components/ui/ScrollArea.svelte';

  let {
    messages = [],
    selectedId = null,
    swiping = null,
    swipeSettings,
    view = 'inbox',
    swipeLabel,
    swipeActionForDelta,
    startSwipe,
    updateSwipe,
    finishSwipe,
    cancelSwipe,
    selectMessage,
    riskClass
  }: {
    messages: any[];
    selectedId: number | null;
    swiping: any;
    swipeSettings: any;
    view: string;
    swipeLabel: (id: any) => string;
    swipeActionForDelta: (delta: number) => any;
    startSwipe: (e: PointerEvent, id: number) => void;
    updateSwipe: (e: PointerEvent) => void;
    finishSwipe: (e: PointerEvent, id: number) => Promise<void>;
    cancelSwipe: () => void;
    selectMessage: (id: number) => Promise<void>;
    riskClass: (risk: string | null | undefined) => string;
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

<ScrollArea class="h-[calc(100vh-2rem)] md:h-full scrollbar-thin">
  {#each messages as message (message.id)}
    <div
      class="relative overflow-hidden border-b border-border/40 last:border-b-0"
      animate:flip={{ duration: 200 }}
    >
      <!-- Swipe left background (archive) -->
      <div
        class="absolute inset-y-0 left-0 flex w-32 items-center gap-2 bg-primary/10 px-4 text-xs font-medium text-primary transition-opacity duration-150"
        style={`opacity: ${swiping?.id === message.id && swiping.deltaX > 0 ? Math.min(1, Math.abs(swiping.deltaX) / 100) : 0}`}
      >
        <Archive size={14} />
        <span>{swipeLabel(swiping?.id === message.id && swiping.deltaX > 0 ? swipeActionForDelta(swiping.deltaX) : swipeSettings.rightShort)}</span>
      </div>
      
      <!-- Swipe right background (delete/trash) -->
      <div
        class="absolute inset-y-0 right-0 flex w-32 items-center justify-end gap-2 bg-destructive/10 px-4 text-xs font-medium text-destructive transition-opacity duration-150"
        style={`opacity: ${swiping?.id === message.id && swiping.deltaX < 0 ? Math.min(1, Math.abs(swiping.deltaX) / 100) : 0}`}
      >
        <span>{swipeLabel(swiping?.id === message.id && swiping.deltaX < 0 ? swipeActionForDelta(swiping.deltaX) : swipeSettings.leftShort)}</span>
        <Trash2 size={14} />
      </div>
      
      <!-- Message row -->
      <button
        data-testid="message-row"
        class={`group relative flex w-full touch-pan-y text-left transition-all duration-150 ${
          selectedId === message.id 
            ? 'bg-primary/[0.06] border-l-2 border-l-primary' 
            : 'border-l-2 border-l-transparent hover:bg-muted/40'
        }`}
        style={`transform: translateX(${swiping?.id === message.id ? swiping.deltaX : 0}px)`}
        onpointerdown={(e) => startSwipe(e, message.id)}
        onpointermove={updateSwipe}
        onpointerup={(e) => finishSwipe(e, message.id)}
        onpointercancel={cancelSwipe}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMessage(message.id); } }}
      >
        <div class="flex flex-1 items-start gap-3 px-4 py-3.5">
          <!-- Read/unread indicator + star -->
          <div class="mt-0.5 flex shrink-0 flex-col items-center gap-1.5">
            <div class={`
              h-2 w-2 rounded-full transition-all duration-200
              ${message.isRead 
                ? 'bg-transparent border border-muted-foreground/25' 
                : 'bg-primary shadow-[0_0_6px_rgba(0,0,0,0.3)]'
              }
            `}></div>
            {#if message.isFlagged}
              <Star size={12} class="fill-primary text-primary" />
            {/if}
          </div>
          
          <!-- Content -->
          <div class="min-w-0 flex-1">
            <!-- From and date row -->
            <div class="flex items-baseline justify-between gap-2">
              <p class={`truncate text-sm ${message.isRead ? 'text-muted-foreground font-normal' : 'font-semibold text-foreground'}`}>
                {message.from}
              </p>
              <time class="shrink-0 text-[11px] tabular-nums tracking-tight {message.isRead ? 'text-muted-foreground/70' : 'text-muted-foreground'}">
                {formatDate(message.date)}
              </time>
            </div>
            
            <!-- Subject -->
            <p class={`mt-0.5 truncate text-sm leading-snug ${message.isRead ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>
              {message.subject}
            </p>
            
            <!-- Snippet -->
            <p class="mt-0.5 truncate text-xs leading-relaxed text-muted-foreground/80">
              {message.snippet}
            </p>
            
            <!-- Action badge -->
            {#if message.suggestionStatus}
              <div class="mt-2">
                <Badge 
                  variant={message.riskLevel === 'high' ? 'destructive' : message.riskLevel === 'medium' ? 'secondary' : 'default'} 
                  class="text-[10px] font-medium"
                >
                  {message.recommendedAction}
                </Badge>
              </div>
            {/if}
          </div>
        </div>
      </button>
    </div>
  {/each}
  
  {#if messages.length === 0}
    <div class="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
      <div class="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
        <svg class="h-6 w-6 text-muted-foreground/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <p class="text-sm">No messages</p>
    </div>
  {/if}
</ScrollArea>
