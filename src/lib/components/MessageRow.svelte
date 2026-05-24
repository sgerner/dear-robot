<script lang="ts">
  import {
    Star,
    Archive,
    Trash2,
    ShieldAlert,
    Eye,
    EyeOff,
    Send,
    Paperclip,
    ChevronDown,
    Sparkles,
    Sun,
    Moon,
    Reply,
    ReplyAll,
    Forward
  } from 'lucide-svelte';
  import { slide, fade } from 'svelte/transition';
  import Button from '$lib/components/ui/Button.svelte';
  import DictationButton from '$lib/components/DictationButton.svelte';
  import { formatPlainText } from '$lib/utils/format';
  import { getCache, upsertCache } from '$lib/client/local-cache';

  let {
    message,
    selectedId,
    selectedConversationKey = null,
    open = false,
    onToggle,
    view: _view = 'inbox',
    swiping,
    swipeSettings,
    swipeLabel,
    swipeActionForDelta,
    startSwipe,
    updateSwipe,
    finishSwipe,
    cancelSwipe,
    riskClass: _riskClass,
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
    regenerate: _regenerate,
    generateSuggestion,
    recordMessageOutcome: _recordMessageOutcome,
    createTaskPlan: _createTaskPlan,
    approveTask: _approveTask,
    executeTask: _executeTask
  }: {
    message: any;
    selectedId: number | null;
    selectedConversationKey: string | null;
    open: boolean;
    onToggle: (_id: number) => void;
    view: string;
    swiping: any;
    swipeSettings: any;
    swipeLabel: (_id: any) => string;
    swipeActionForDelta: (_delta: number) => any;
    startSwipe: (_e: PointerEvent, _id: number) => void;
    updateSwipe: (_e: PointerEvent) => void;
    finishSwipe: (_e: PointerEvent, _id: number) => Promise<void>;
    cancelSwipe: () => void;
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
  } = $props();

  let detail = $state<any>(null);
  let detailLoading = $state(false);
  let bodyMode = $state<'text' | 'html'>('text');
  let emailTheme = $state<'light' | 'dark'>('dark');
  let draftText = $state('');
  let visibleThreadLimit = $state(5);

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

  function formatDate(date: string, timeOnly = false) {
    const d = new Date(date);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const isThisYear = d.getFullYear() === now.getFullYear();

    if (timeOnly && isToday) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    if (isToday) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    if (isThisYear) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
  }

  function fullFormatDate(date: string) {
    return new Date(date).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  async function loadDetail() {
    if (detail || detailLoading) return;
    detailLoading = true;
    try {
      // 1. Try local cache first
      const cached = await getCache('message_details', message.id);
      if (cached && cached.message) {
        detail = cached;
        if (detail.message?.safeBodyHtml) bodyMode = 'html';
        detailLoading = false;
        return;
      }

      // 2. Fallback to network
      const res = await fetch(`/api/messages/${message.id}`);
      if (res.ok) {
        const data = await res.json();
        detail = data;
        if (data.message?.safeBodyHtml) bodyMode = 'html';
        
        // 3. Save to cache for next time
        void upsertCache('message_details', [{ id: message.id, ...data }]);
      }
    } catch {
      // detail unavailable
    } finally {
      detailLoading = false;
    }
  }

  $effect(() => {
    if (open) void loadDetail();
  });

  function handleRowClick(e: Event) {
    const target = e.target as HTMLElement;
    if (target.closest('button, select, textarea, input, a, details, summary')) return;
    onToggle(message.id);
  }
</script>

<div
  data-testid="message-row"
  class="relative overflow-hidden rounded-md"
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

  <!-- Message row wrapper -->
  <div
    data-row-click
    class={`block w-full text-left transition-all duration-150 ${
      selectedConversationKey === message.conversationKey || selectedId === message.id
        ? 'bg-primary/[0.06] border-l-2 border-l-primary'
        : 'border-l-2 border-l-transparent hover:bg-muted/30'
    }`}
    style={`transform: translateX(${swiping?.id === message.id ? swiping.deltaX : 0}px)`}
    onpointerdown={(e) => startSwipe(e, message.id)}
    onpointermove={updateSwipe}
    onpointerup={(e) => finishSwipe(e, message.id)}
    onpointercancel={cancelSwipe}
    onclick={handleRowClick}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle(message.id);
      }
    }}
    role="button"
    tabindex="0"
  >
    <!-- Preview header (always visible, unified with body when open) -->
    <div class="px-3 py-2 min-w-0 {open ? 'pb-1' : ''}">
      <!-- Line 1: From + inline badge + date + toggles -->
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
            class="shrink-0 text-xs uppercase tracking-wider px-1.5 py-0.5 font-medium {message.riskLevel ===
            'high'
              ? 'bg-destructive/15 text-destructive'
              : message.riskLevel === 'medium'
                ? 'bg-muted/50 text-muted-foreground'
                : 'bg-primary/15 text-primary'}"
          >
            {message.recommendedAction}
          </span>
        {/if}

        {#if open && detail?.message?.safeBodyHtml}
          <div class="shrink-0 flex items-center gap-1">
            <!-- Light/Dark toggle -->
            <div class="flex border border-border/40 p-0.5 bg-background">
              <button
                class={`px-1.5 py-0.5 transition-all duration-150 ${
                  emailTheme === 'dark'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onclick={() => { emailTheme = 'dark'; }}
                title="Dark Mode"
              >
                <Moon size={11} />
              </button>
              <button
                class={`px-1.5 py-0.5 transition-all duration-150 ${
                  emailTheme === 'light'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onclick={() => { emailTheme = 'light'; }}
                title="Light Mode"
              >
                <Sun size={11} />
              </button>
            </div>
            <!-- HTML/Plain toggle -->
            <div class="flex border border-border/40 p-0.5 bg-background text-xs">
              <button
                class={`px-1.5 py-0.5 transition-all duration-150 ${
                  bodyMode === 'html'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onclick={() => { bodyMode = 'html'; }}
              >
                H
              </button>
              <button
                class={`px-1.5 py-0.5 transition-all duration-150 ${
                  bodyMode === 'text'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onclick={() => { bodyMode = 'text'; }}
              >
                P
              </button>
            </div>
          </div>
        {/if}

        <time
          class="shrink-0 text-xs tabular-nums tracking-tight {message.isRead
            ? 'text-muted-foreground'
            : 'text-muted-foreground'}"
        >
          {open && detail?.message?.date
            ? fullFormatDate(detail.message.date)
            : formatDate(message.date)}
        </time>
      </div>

      <!-- Line 2: Subject -->
      <p
        class={`truncate text-sm leading-tight ${message.isRead ? 'text-muted-foreground' : 'font-medium text-foreground'}`}
      >
        {message.subject}
        {#if message.conversationCount > 1}
          <span class="ml-2 inline-flex items-center rounded-full border border-border/50 bg-muted/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {message.conversationCount} msgs
          </span>
        {/if}
      </p>

      <!-- Line 3: Snippet (hidden when open) -->
      {#if !open}
        <div class="truncate text-xs leading-tight text-muted-foreground mt-0.5">
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html formatPlainText(message.snippet)}        </div>
      {/if}
    </div>

    <!-- Expanded body -->
    {#if open}
      <div class="px-3 pb-3" transition:slide={{ duration: 200 }}>
        {#if detailLoading}
          <div class="py-4 text-xs text-muted-foreground">Loading...</div>
        {:else if detail}
          <!-- Body content -->
          {#if bodyMode === 'html' && detail.message?.safeBodyHtml}
            <div class="overflow-x-auto w-full {emailTheme === 'dark' ? 'email-dark' : ''}">
              <article class="email-html text-sm leading-7 text-foreground max-w-none w-full pb-3">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html detail.message.safeBodyHtml}
              </article>
            </div>
          {:else}
            <div class="whitespace-pre-wrap font-sans text-sm leading-7 text-foreground pb-3">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html formatPlainText(detail.message?.bodyText || '')}
            </div>
          {/if}

          <!-- Attachments -->
          {#if detail.attachments?.length}
            <div class="pb-3">
              <details>
                <summary class="flex cursor-pointer list-none items-center gap-2 text-xs text-foreground">
                  <Paperclip size={13} class="text-muted-foreground" />
                  <span class="font-medium">Attachments</span>
                  <span class="text-xs uppercase tracking-wider px-1.5 py-0.5 bg-muted text-muted-foreground">
                    {detail.attachments.length}
                  </span>
                  <ChevronDown size={12} class="text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div class="mt-2 flex flex-wrap gap-2">
                  {#each detail.attachments as attachment (attachment.id)}
                    <a
                      class="inline-flex items-center gap-2 bg-muted px-3 py-1.5 text-xs text-foreground hover:bg-muted/40 transition-colors"
                      href={`/api/messages/${detail.message.id}/attachments/${attachment.id}`}
                    >
                      <Paperclip size={11} />
                      <span class="max-w-[150px] truncate">{attachment.filename}</span>
                      <span class="text-muted-foreground">
                        {Math.max(1, Math.round((attachment.sizeBytes || 0) / 1024))}KB
                      </span>
                    </a>
                  {/each}
                </div>
              </details>
            </div>
          {/if}

          <!-- Thread -->
          {#if detail.thread?.length > 1}
            <div class="pb-3">
              <div class="space-y-1.5">
                {#each [...detail.thread].reverse().slice(0, visibleThreadLimit) as item (item.id)}
                  <button
                    class={`w-full p-2 text-left transition-all duration-150 ${
                      item.id === detail.message.id
                        ? 'bg-primary/[0.04] border-l-2 border-primary/30'
                        : 'bg-muted/20 border-l-2 border-transparent hover:bg-muted/40'
                    }`}
                    onclick={() => { selectMessage(item.id); }}
                  >
                    <div class="flex items-center justify-between gap-2 mb-0.5">
                      <p class="truncate text-xs font-medium text-foreground">{item.from}</p>
                      <time class="shrink-0 text-xs text-muted-foreground">{formatDate(item.date)}</time>
                    </div>
                    <p class="truncate text-xs text-muted-foreground">{item.subject}</p>
                  </button>
                {/each}
                {#if detail.thread.length > visibleThreadLimit}
                  <button
                    class="w-full py-2 text-center text-xs text-primary hover:text-primary transition-colors"
                    onclick={() => { visibleThreadLimit += 5; }}
                  >
                    + More ({detail.thread.length - visibleThreadLimit} remaining)
                  </button>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Quick Actions Toolbar -->
          <div class="flex flex-wrap items-center gap-1 pb-3">
            {#each quickActionIds as actionId (actionId)}
              {@const Icon = actionIcons[actionId]}
              {@const meta = quickActionMeta(actionId)}
              <Button
                variant={meta?.tone === 'danger'
                  ? 'destructive'
                  : meta?.tone === 'accent'
                    ? 'default'
                    : 'outline'}
                size="sm"
                data-testid={`quick-action-${actionId.replace(/_/g, '-')}`}
                onclick={() => { runQuickAction(actionId, message.id); }}
              >
                {#if actionId === 'toggle_read'}
                  {#if message.isRead}<EyeOff size={13} />{:else}<Eye size={13} />{/if}
                {:else if Icon}
                  <Icon size={13} />
                {/if}
                <span class="ml-1 text-xs">{meta?.label || actionId}</span>
              </Button>
            {/each}

            <div class="h-5 w-px bg-border mx-0.5"></div>

            <select
              class="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
              onchange={(e) => { moveSelected(e.currentTarget.value); }}
            >
              <option value="">Move to...</option>
              {#each folders.filter((f: any) => f.accountId === message.accountId) as folder (folder.id)}
                <option value={folder.path}>{folder.path}</option>
              {/each}
            </select>
          </div>

          <!-- AI Panel (only for URL-selected message) -->
          {#if selectedId === message.id && detail.suggestion}
            <div class="bg-primary/10 border-l-2 border-primary/20">
              <div class="p-3">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <Sparkles size={13} class="text-primary shrink-0 mt-0.5" />
                    <h3 class="font-semibold text-sm text-foreground">{detail.suggestion.category}</h3>
                  </div>
                  <div class="flex gap-1.5 shrink-0">
                    <span class="text-xs uppercase tracking-wider px-1.5 py-0.5 font-medium bg-primary/15 text-primary">
                      {detail.suggestion.recommendedAction}
                    </span>
                    <span class="text-xs uppercase tracking-wider px-1.5 py-0.5 font-medium {detail.suggestion.riskLevel === 'high' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'}">
                      {detail.suggestion.riskLevel}
                    </span>
                  </div>
                </div>
                <div class="mt-1 text-xs text-muted-foreground leading-relaxed">
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  {@html formatPlainText(detail.suggestion.reasoningSummary)}
                </div>

                {#if detail.suggestion.targetFolder || detail.suggestion.delegateInstructions}
                  <div class="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {#if detail.suggestion.targetFolder}
                      <span>&rarr; {detail.suggestion.targetFolder}</span>
                    {/if}
                    {#if detail.suggestion.delegateInstructions}
                      <span>&#8601; {detail.suggestion.delegateInstructions}</span>
                    {/if}
                  </div>
                {/if}
              </div>

              <!-- Draft Reply -->
              {#if detail.suggestion.draftReply || ['reply', 'forward'].includes(detail.suggestion.recommendedAction)}
                <div class="px-3 pb-3">
                  <div class="relative">
                    <textarea
                      id={`draft-reply-${message.id}`}
                      class="min-h-24 w-full resize-y bg-muted border border-border/40 p-2.5 pr-10 text-xs leading-relaxed outline-none placeholder:text-muted-foreground focus:border-primary/40 transition-all"
                      placeholder="Draft reply..."
                      bind:value={draftText}
                    ></textarea>
                    <div class="absolute right-1.5 top-1.5">
                      <DictationButton
                        targetId={`draft-reply-${message.id}`}
                        activeTargetId={dictationTargetId}
                        recording={dictationActive}
                        unavailable={dictationUnavailable}
                        level={dictationLevel}
                        onToggle={toggleDictation}
                      />
                    </div>
                  </div>
                </div>
              {/if}

              <!-- Action Row -->
              <div class="px-3 pb-3 flex flex-wrap items-center gap-1.5">
                <Button variant="default" size="sm" onclick={() => executeSuggestion()}>
                  <Send size={12} class="mr-1" /> Execute
                </Button>
                <Button variant="outline" size="sm" onclick={() => saveEdit()}>Save</Button>
                <Button variant="outline" size="sm" onclick={() => rejectSuggestion()}>Reject</Button>
              </div>
            </div>
          {:else if selectedId === message.id && !detail.suggestion}
            <div class="pb-3" transition:fade={{ duration: 150 }}>
              <Button variant="outline" size="sm" onclick={() => generateSuggestion(message.id)}>
                <Sparkles size={12} class="mr-1" /> Generate Suggestion
              </Button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>
