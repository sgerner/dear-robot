<script lang="ts">
  import ScrollArea from '$lib/components/ui/ScrollArea.svelte';
  import MessageRow from '$lib/components/MessageRow.svelte';
  import { flip } from 'svelte/animate';
  import { fade, fly, slide } from 'svelte/transition';

  let {
    messages = [],
    selectedId = null,
    selectedConversationKey = null,
    openMessageIds = new Set<number>(),
    swiping = null,
    swipeSettings,
    view = 'inbox',
    swipeLabel,
    swipeActionForDelta,
    startSwipe,
    updateSwipe,
    finishSwipe,
    cancelSwipe,
    onToggleMessage,
    riskClass,
    quickActionIds = [],
    quickActionMeta,
    runQuickAction,
    moveSelected,
    folders = [],
    selectMessage,
    dictationTargetId = null,
    dictationActive = false,
    dictationUnavailable = false,
    dictationLevel = 0,
    toggleDictation,
    executeSuggestion,
    saveEdit,
    rejectSuggestion,
    regenerate,
    generateSuggestion,
    recordMessageOutcome,
    createTaskPlan,
    approveTask,
    executeTask,
    openBrowserAutomation,
    isMobileViewport = false
  }: {
    messages: any[];
    selectedId: number | null;
    selectedConversationKey: string | null;
    openMessageIds: Set<number>;
    swiping: any;
    swipeSettings: any;
    view: string;
    swipeLabel: (_id: any) => string;
    swipeActionForDelta: (_delta: number) => any;
    startSwipe: (_e: PointerEvent, _id: number) => void;
    updateSwipe: (_e: PointerEvent) => void;
    finishSwipe: (_e: PointerEvent, _id: number) => Promise<void>;
    cancelSwipe: () => void;
    onToggleMessage: (_id: number) => void;
    riskClass: (_risk: string | null | undefined) => string;
    quickActionIds: string[];
    quickActionMeta: (_id: any) => any;
    runQuickAction: (_id: any, _msgId?: number) => void | Promise<void>;
    moveSelected: (_path: string) => void | Promise<void>;
    folders: any[];
    selectMessage: (_id: number) => void | Promise<void>;
    dictationTargetId: string | null;
    dictationActive: boolean;
    dictationUnavailable: boolean;
    dictationLevel: number;
    toggleDictation: (_id: string) => void | Promise<void>;
    executeSuggestion: () => void | Promise<void>;
    saveEdit: () => void | Promise<void>;
    rejectSuggestion: () => void | Promise<void>;
    regenerate: () => void | Promise<void>;
    generateSuggestion: (_id: number) => void | Promise<void>;
    recordMessageOutcome: (_type: 'resolved' | 'needs_followup' | 'bad_draft' | 'wrong_action') => void | Promise<void>;
    createTaskPlan: () => void | Promise<void>;
    approveTask: (_id: number, _stepId?: number | null) => void | Promise<void>;
    executeTask: (_id: number) => void | Promise<void>;
    openBrowserAutomation: (_messageId: number) => void | Promise<void>;
    isMobileViewport: boolean;
  } = $props();
</script>

<ScrollArea class="flex-1 min-h-0 scrollbar-thin">
  {#each messages as message (message.id)}
    <div
      class="mx-2 border-b border-border/25 py-0.5 last:border-b-0"
      animate:flip={{ duration: 200 }}
      in:fly={{ y: 6, duration: 180 }}
      out:slide={{ duration: 200 }}
    >
      <MessageRow
      {message}
      {selectedId}
      {selectedConversationKey}
      open={isMobileViewport && (openMessageIds.has(message.id) || selectedConversationKey === message.conversationKey)}
      onToggle={onToggleMessage}
      {view}
      {swiping}
      {swipeSettings}
      {swipeLabel}
      {swipeActionForDelta}
      {startSwipe}
      {updateSwipe}
      {finishSwipe}
      {cancelSwipe}
      {riskClass}
      {quickActionIds}
      {quickActionMeta}
      {runQuickAction}
      {moveSelected}
      {folders}
      {selectMessage}
      {dictationTargetId}
      {dictationActive}
      {dictationUnavailable}
      {dictationLevel}
      {toggleDictation}
      {executeSuggestion}
      {saveEdit}
      {rejectSuggestion}
      {regenerate}
      {generateSuggestion}
      {recordMessageOutcome}
      {createTaskPlan}
      {approveTask}
      {executeTask}
      {openBrowserAutomation}
    />
    </div>
  {/each}

  {#if messages.length === 0}
    <div class="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground" in:fade={{ duration: 180 }}>
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted/30">
        <svg
          class="h-5 w-5 text-muted-foreground"
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

  {#if isMobileViewport && messages.length > 0}
    <!-- Keep the last expanded message clear of the fixed mobile action bar. -->
    <div class="h-24 shrink-0" aria-hidden="true"></div>
  {/if}
</ScrollArea>
