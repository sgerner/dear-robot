<script lang="ts">
  import {
    Reply,
    ReplyAll,
    Forward,
    Archive,
    Trash2,
    ShieldAlert,
    Eye,
    EyeOff,
    Star,
    Send,
    RefreshCw,
    Bot,
    Paperclip,
    ChevronDown,
    Sparkles,
    FileText,
    ThumbsUp,
    Sun,
    Moon,
    ThumbsDown,
    CheckCircle2,
    XCircle,
    Play,
    Pause,
    Pencil,
    WandSparkles,
  } from 'lucide-svelte';
  import { slide, fade } from 'svelte/transition';
  import Button from '$lib/components/ui/Button.svelte';
  import ScrollArea from '$lib/components/ui/ScrollArea.svelte';
  import DictationButton from '$lib/components/DictationButton.svelte';
  import { formatActionLabel, formatPlainText } from '$lib/utils/format';

  let {
    selected,
    view,
    quickActionIds = [],
    quickActionMeta,
    runQuickAction,
    moveSelected,
    folders = [],
    bodyMode = $bindable('text'),
    draftText = $bindable(''),
    regenNote = $bindable(''),
    taskNote = $bindable(''),
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
    selectMessage,
    approveTask,
    rejectTask,
    executeTask: _executeTask,
    cancelTask,
    resumeTask,
    retryTaskStep,
    editTaskStep,
    runAgentLoop,
    resumeAgentLoop,
    cancelAgentLoop,
    agentLoopPrompt = $bindable(''),
    agentLoopResult = null,
    agentLoopBusy = false
  }: {
    selected: any;
    view: string;
    quickActionIds: string[];
    quickActionMeta: (_id: any) => any;
    runQuickAction: (_id: any, _msgId?: number) => void | Promise<void>;
    moveSelected: (_path: string) => void | Promise<void>;
    folders: any[];
    bodyMode: string;
    draftText: string;
    regenNote: string;
    taskNote: string;
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
    recordMessageOutcome: (
      _type: 'resolved' | 'needs_followup' | 'bad_draft' | 'wrong_action'
    ) => void | Promise<void>;
    createTaskPlan: () => void | Promise<void>;
    selectMessage: (_id: number) => void | Promise<void>;
    riskClass?: (_risk: string | null | undefined) => string;
    approveTask: (_id: number, _stepId?: number | null) => void | Promise<void>;
    rejectTask: (_id: number) => void | Promise<void>;
    executeTask: (_id: number) => void | Promise<void>;
    cancelTask: (_id: number) => void | Promise<void>;
    resumeTask: (_id: number) => void | Promise<void>;
    retryTaskStep: (_id: number, _stepId: number) => void | Promise<void>;
    editTaskStep: (
      _id: number,
      _stepId: number,
      _input: { title?: string; details?: string }
    ) => void | Promise<void>;
    runAgentLoop: (_prompt: string) => void | Promise<void>;
    resumeAgentLoop: (_sessionId: number, _toolNames: string[]) => void | Promise<void>;
    cancelAgentLoop: (_sessionId: number) => void | Promise<void>;
    agentLoopPrompt: string;
    agentLoopResult: any;
    agentLoopBusy: boolean;
  } = $props();

  let isGenerating = $state(false);
  let emailTheme = $state<'light' | 'dark'>('dark');
  let editingStepId = $state<number | null>(null);
  let editingStepTitle = $state('');
  let editingStepDetails = $state('');

  function beginStepEdit(step: { id: number; title: string; details: string }) {
    editingStepId = step.id;
    editingStepTitle = step.title;
    editingStepDetails = step.details;
  }

  function cancelStepEdit() {
    editingStepId = null;
    editingStepTitle = '';
    editingStepDetails = '';
  }

  async function saveStepEdit(runId: number, stepId: number) {
    if (!editingStepTitle.trim() || !editingStepDetails.trim()) return;
    await editTaskStep(runId, stepId, {
      title: editingStepTitle.trim(),
      details: editingStepDetails.trim()
    });
    cancelStepEdit();
  }

  async function handleGenerateSuggestion() {
    if (isGenerating) return;
    isGenerating = true;
    try {
      await generateSuggestion(selected?.message?.id ?? 0);
    } finally {
      isGenerating = false;
    }
  }

  let visibleThreadLimit = $state(5);
  let openMessageIds = $state(new Set<number>());
  let lastConversationKey = $state<string | null>(null);

  const perMessageBodyMode = $state<Record<number, 'text' | 'html'>>({});
  const perMessageEmailTheme = $state<Record<number, 'light' | 'dark'>>({});

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

  function formatDate(date: string) {
    return new Date(date).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function getMessageBodyMode(id: number): 'text' | 'html' {
    if (perMessageBodyMode[id]) return perMessageBodyMode[id];
    const item = getThreadItem(id);
    if (item?.safeBodyHtml || item?.bodyHtml) return 'html';
    return 'text';
  }

  function setMessageBodyMode(id: number, mode: 'text' | 'html') {
    perMessageBodyMode[id] = mode;
  }

  function getMessageEmailTheme(id: number): 'light' | 'dark' {
    return perMessageEmailTheme[id] || 'dark';
  }

  function setMessageEmailTheme(id: number, theme: 'light' | 'dark') {
    perMessageEmailTheme[id] = theme;
  }

  function getThreadItem(id: number) {
    if (selected?.message?.id === id) return selected.message;
    return selected?.thread?.find((item: any) => item.id === id);
  }

  function toggleMessageOpen(id: number) {
    const next = new Set(openMessageIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    openMessageIds = next;
  }

  function isMessageOpen(id: number) {
    return openMessageIds.has(id);
  }

  $effect(() => {
    const conversationKey = selected?.conversationKey || null;
    if (conversationKey === lastConversationKey) return;
    lastConversationKey = conversationKey;

    if (!selected?.thread?.length || selected.thread.length <= 1) {
      openMessageIds = new Set();
      return;
    }

    const rootId = selected.thread[0]?.id;
    openMessageIds = rootId ? new Set([rootId]) : new Set();
  });
</script>

{#if selected && !['settings', 'operations'].includes(view)}
  <div class="flex h-full flex-col overflow-hidden xl:flex-row" in:fade={{ duration: 180 }}>
    <ScrollArea class="flex-1 h-[calc(100dvh-3.5rem)] lg:h-screen scrollbar-thin">
      <article class="mx-auto max-w-4xl p-4 md:p-6 lg:p-8">
        <!-- AI Panel (Small/Medium screens - Top placement) -->
        <div class="xl:hidden mb-6">
          {#if selected.suggestion}
            <div class="suggestion-container" transition:slide={{ duration: 200 }}>
              {@render aiPanelSnippet(false)}
            </div>
          {:else}
            <div class="suggestion-container" transition:fade={{ duration: 150 }}>
              {@render generateButtonSnippet()}
            </div>
          {/if}
        </div>

        <!-- Header -->
        <header class="pb-5">
          <div class="flex flex-wrap items-center gap-2 mb-3">
            <span
              class="text-xs uppercase tracking-wider text-muted-foreground font-medium px-2 py-0.5 bg-muted"
            >
              {selected.account?.email}
            </span>
            <span
              class="text-xs uppercase tracking-wider text-muted-foreground font-medium px-2 py-0.5 bg-muted"
            >
              {selected.message.folderPath}
            </span>
          </div>

          <h2 class="break-words text-xl font-semibold leading-tight tracking-tight text-foreground md:text-2xl">
            {selected.message.subject}
          </h2>

          {#if selected.thread?.length > 1}
            <div class="mt-2">
              <span class="inline-flex items-center rounded-full border border-border/50 bg-muted/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {selected.thread.length} messages
              </span>
            </div>
          {/if}

          <div class="mt-3 flex items-center gap-2 text-sm">
            <time class="text-muted-foreground">{formatDate(selected.message.date)}</time>
          </div>
        </header>

        <!-- Quick Actions Toolbar -->
        <div class="sticky top-0 z-10 hidden flex-nowrap items-center gap-1.5 overflow-x-auto rounded-lg border border-border/50 bg-background/85 px-2 py-2.5 shadow-sm backdrop-blur-md scrollbar-thin lg:flex">
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
              class="shrink-0"
              aria-label={meta?.label || actionId}
              title={meta?.label || actionId}
              data-testid={`quick-action-${actionId.replace(/_/g, '-')}`}
              onclick={() => runQuickAction(actionId)}
            >
              {#if actionId === 'toggle_read'}
                {#if selected.message.isRead}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
              {:else if Icon}
                <Icon size={14} />
              {/if}
              <span class="sr-only 2xl:not-sr-only 2xl:ml-1.5">{meta?.label || actionId}</span>
            </Button>
          {/each}

          <div class="h-6 w-px shrink-0 bg-border mx-1"></div>

          <select
            class="h-8 shrink-0 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            aria-label="Move message to folder"
            onchange={(e) => moveSelected(e.currentTarget.value)}
          >
            <option value="">Move to...</option>
            {#each folders.filter((f: any) => f.accountId === selected?.message?.accountId) as folder (folder.id)}
              <option value={folder.path}>{folder.path}</option>
            {/each}
          </select>
        </div>

        <!-- Thread/Conversation Section -->
        {#if selected.thread?.length > 1}
          <section class="mt-5 space-y-3" transition:slide={{ duration: 200 }}>
            {#each [...selected.thread].reverse().slice(0, visibleThreadLimit) as item (item.id)}
              <div
                class={`rounded-lg border transition-all duration-150 ${
                  item.id === selected.message.id
                    ? 'border-primary/30 bg-primary/[0.04]'
                    : 'border-border/40 bg-muted/10 hover:bg-muted/20'
                }`}
              >
                <!-- Message header (always visible, clickable to expand) -->
                <button
                  class="w-full p-3 text-left"
                  onclick={() => {
                    if (item.id !== selected.message.id) selectMessage(item.id);
                    toggleMessageOpen(item.id);
                  }}
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <p class="truncate text-sm font-medium text-foreground">{item.from}</p>
                      {#if item.id === selected.message.id}
                        <span class="text-xs uppercase tracking-wider px-1.5 py-0.5 bg-primary/15 text-primary font-medium">
                          Selected
                        </span>
                      {/if}
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <time class="text-xs text-muted-foreground">
                        {new Date(item.date).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit'
                        })}
                      </time>
                      <ChevronDown
                        size={14}
                        class="text-muted-foreground transition-transform duration-200 {isMessageOpen(item.id) ? 'rotate-180' : ''}"
                      />
                    </div>
                  </div>
                  <p class="truncate text-xs text-muted-foreground mt-0.5">{item.subject}</p>
                  {#if !isMessageOpen(item.id)}
                    <div class="mt-1.5 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                      {@html formatPlainText(item.bodyText)}
                    </div>
                  {/if}
                </button>

                <!-- Expanded body -->
                {#if isMessageOpen(item.id)}
                  <div class="px-3 pb-3" transition:slide={{ duration: 200 }}>
                    <!-- Toggles bar -->
                    {#if item.safeBodyHtml || item.bodyHtml}
                      <div class="flex items-center justify-end gap-1 mb-2">
                        <div class="flex border border-border/40 p-0.5 bg-background">
                          <button
                              class={`min-h-10 min-w-10 px-1.5 py-0.5 transition-all duration-150 lg:min-h-7 lg:min-w-7 ${
                              getMessageEmailTheme(item.id) === 'dark'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onclick={() => setMessageEmailTheme(item.id, 'dark')}
                            title="Dark Mode"
                            aria-label="Use dark email theme"
                            aria-pressed={getMessageEmailTheme(item.id) === 'dark'}
                          >
                            <Moon size={11} />
                          </button>
                          <button
                              class={`min-h-10 min-w-10 px-1.5 py-0.5 transition-all duration-150 lg:min-h-7 lg:min-w-7 ${
                              getMessageEmailTheme(item.id) === 'light'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onclick={() => setMessageEmailTheme(item.id, 'light')}
                            title="Light Mode"
                            aria-label="Use light email theme"
                            aria-pressed={getMessageEmailTheme(item.id) === 'light'}
                          >
                            <Sun size={11} />
                          </button>
                        </div>
                        <div class="flex border border-border/40 p-0.5 bg-background text-xs">
                          <button
                            class={`min-h-10 min-w-10 px-1.5 py-0.5 transition-all duration-150 lg:min-h-7 lg:min-w-7 ${
                              getMessageBodyMode(item.id) === 'html'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onclick={() => setMessageBodyMode(item.id, 'html')}
                            title="Show formatted HTML"
                            aria-label="Show formatted HTML"
                            aria-pressed={getMessageBodyMode(item.id) === 'html'}
                          >
                            H
                          </button>
                          <button
                            class={`min-h-10 min-w-10 px-1.5 py-0.5 transition-all duration-150 lg:min-h-7 lg:min-w-7 ${
                              getMessageBodyMode(item.id) === 'text'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onclick={() => setMessageBodyMode(item.id, 'text')}
                            title="Show plain text"
                            aria-label="Show plain text"
                            aria-pressed={getMessageBodyMode(item.id) === 'text'}
                          >
                            P
                          </button>
                        </div>
                      </div>
                    {/if}

                    <!-- Body content -->
                    {#if getMessageBodyMode(item.id) === 'html' && (item.safeBodyHtml || item.bodyHtml)}
                      <div class="overflow-x-auto w-full {getMessageEmailTheme(item.id) === 'dark' ? 'email-dark' : ''}">
                        <article class="email-html text-sm leading-7 text-foreground max-w-none w-full">
                          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                          {@html item.safeBodyHtml ?? item.bodyHtml}
                        </article>
                      </div>
                    {:else}
                      <div class="whitespace-pre-wrap font-sans text-sm leading-7 text-foreground">
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        {@html formatPlainText(item.bodyText)}
                      </div>
                    {/if}

                    <!-- Attachments for this message -->
                    {#if item.id === selected.message.id && selected.attachments?.length}
                      <div class="mt-3">
                        <details>
                          <summary class="flex cursor-pointer list-none items-center gap-2 text-xs text-foreground">
                            <Paperclip size={13} class="text-muted-foreground" />
                            <span class="font-medium">Attachments</span>
                            <span class="text-xs uppercase tracking-wider px-1.5 py-0.5 bg-muted text-muted-foreground">
                              {selected.attachments.length}
                            </span>
                            <ChevronDown size={12} class="text-muted-foreground transition-transform group-open:rotate-180" />
                          </summary>
                          <div class="mt-2 flex flex-wrap gap-2">
                            {#each selected.attachments as attachment (attachment.id)}
                              <a
                                class="inline-flex items-center gap-2 bg-muted px-3 py-1.5 text-xs text-foreground hover:bg-muted/40 transition-colors"
                                href={`/api/messages/${selected.message.id}/attachments/${attachment.id}`}
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
                  </div>
                {/if}
              </div>
            {/each}
            {#if selected.thread.length > visibleThreadLimit}
              <button
                class="w-full py-2 text-center text-xs text-primary hover:text-primary transition-colors"
                onclick={() => { visibleThreadLimit += 5; }}
              >
                + More ({selected.thread.length - visibleThreadLimit} remaining)
              </button>
            {/if}
          </section>
        {:else}
          <!-- Single message: show body directly -->
          <section
            class="mt-5 py-4 bg-muted/10 border-primary/25 border"
            transition:slide={{ duration: 200 }}
          >
            {#if selected.message.safeBodyHtml}
              <div class="flex items-center justify-between pb-3 px-4 md:px-5">
                <div class="flex items-center gap-2">
                  <FileText size={14} class="text-muted-foreground" />
                  <p class="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                    Message
                  </p>
                </div>
                <div class="flex items-center gap-3">
                  <!-- Email Theme Toggle -->
                  <div class="flex border border-border/40 p-0.5 text-xs bg-background">
                    <button
                      class={`min-h-10 min-w-10 px-2 py-1 transition-all duration-150 lg:min-h-7 lg:min-w-7 ${
                        emailTheme === 'dark'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onclick={() => (emailTheme = 'dark')}
                      title="Dark Mode"
                      aria-label="Use dark email theme"
                      aria-pressed={emailTheme === 'dark'}
                    >
                      <Moon size={12} />
                    </button>
                    <button
                      class={`min-h-10 min-w-10 px-2 py-1 transition-all duration-150 lg:min-h-7 lg:min-w-7 ${
                        emailTheme === 'light'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onclick={() => (emailTheme = 'light')}
                      title="Light Mode"
                      aria-label="Use light email theme"
                      aria-pressed={emailTheme === 'light'}
                    >
                      <Sun size={12} />
                    </button>
                  </div>

                  <!-- HTML/Plain Toggle -->
                  <div class="flex border border-border/40 p-0.5 text-xs bg-background">
                    <button
                      class={`px-3 py-1 transition-all duration-150 ${
                        bodyMode === 'html'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onclick={() => (bodyMode = 'html')}
                      title="Show formatted HTML"
                      aria-label="Show formatted HTML"
                      aria-pressed={bodyMode === 'html'}
                    >
                      HTML
                    </button>
                    <button
                      class={`px-3 py-1 transition-all duration-150 ${
                        bodyMode === 'text'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onclick={() => (bodyMode = 'text')}
                      title="Show plain text"
                      aria-label="Show plain text"
                      aria-pressed={bodyMode === 'text'}
                    >
                      Plain
                    </button>
                  </div>
                </div>
              </div>
            {/if}

            {#if bodyMode === 'html' && selected.message.safeBodyHtml}
              <div class="overflow-x-auto w-full {emailTheme === 'dark' ? 'email-dark' : ''}">
                <article class="email-html text-sm leading-7 text-foreground max-w-none w-full">
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  {@html selected.message.safeBodyHtml}
                </article>
              </div>
            {:else}
              <div class="whitespace-pre-wrap font-sans text-sm leading-7 text-foreground px-4 md:px-5">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html formatPlainText(selected.message.bodyText)}
              </div>
            {/if}
          </section>
        {/if}
      </article>
    </ScrollArea>

    <!-- AI Side Panel (Large Screens Only) -->
    <aside class="hidden xl:block w-[400px] border-l border-border bg-muted/5 scrollbar-thin overflow-y-auto">
      <div class="p-6">
        <div class="flex items-center gap-2 mb-6">
          <Bot size={18} class="text-primary" />
          <h2 class="text-sm font-bold uppercase tracking-widest text-foreground">AI Intelligence</h2>
        </div>

        {#if selected.suggestion}
          <div transition:slide={{ duration: 200 }}>
            {@render aiPanelSnippet(true)}
          </div>
        {:else}
          <div transition:fade={{ duration: 150 }}>
            {@render generateButtonSnippet()}
          </div>
        {/if}
      </div>
    </aside>
  </div>
{:else if view === 'operations' || view === 'settings'}
  <div class="hidden lg:block"></div>
{:else}
  <div class="grid h-full place-items-center text-muted-foreground" in:fade={{ duration: 180 }}>
    <div class="flex flex-col items-center gap-3">
      <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
        <svg
          class="h-8 w-8 text-muted-foreground"
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
      <p class="text-sm">Select a message to view details</p>
    </div>
  </div>
{/if}

{#snippet generateButtonSnippet()}
  <div class="suggestion-placeholder group relative overflow-hidden rounded-xl border-2 border-dashed border-primary/20 bg-primary/5 p-8 text-center transition-all hover:border-primary/40 hover:bg-primary/10">
    {#if isGenerating}
      <div class="flex flex-col items-center gap-4 py-4">
        <div class="relative">
          <div class="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
          <Sparkles size={20} class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary animate-pulse" />
        </div>
        <div class="space-y-2">
          <p class="text-sm font-semibold text-primary animate-pulse">Consulting AI Intelligence...</p>
          <div class="flex gap-1 justify-center">
            <div class="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]"></div>
            <div class="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]"></div>
            <div class="h-1.5 w-1.5 rounded-full bg-primary animate-bounce"></div>
          </div>
        </div>
      </div>
    {:else}
      <div class="flex flex-col items-center gap-4">
        <div class="rounded-full bg-primary/10 p-4 transition-transform group-hover:scale-110">
          <Sparkles size={24} class="text-primary" />
        </div>
        <div>
          <h3 class="text-sm font-bold text-foreground mb-1 uppercase tracking-wider">AI Suggestion</h3>
          <p class="text-xs text-muted-foreground mb-4">Let the agent analyze this message and draft a perfect response.</p>
          <Button
            variant="default"
            size="sm"
            class="neon-glow"
            onclick={handleGenerateSuggestion}
          >
            <Sparkles size={13} class="mr-1.5" /> Generate Intelligence
          </Button>
        </div>
      </div>
    {/if}
    
    <!-- Animated background shimmer -->
    <div class="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-[shimmer_2s_infinite] opacity-0 group-hover:opacity-100 transition-opacity"></div>
  </div>
{/snippet}

{#snippet aiPanelSnippet(withTestIds = false)}
  <div
    class="suggestion-card ai-card rounded-xl overflow-hidden border border-primary/30 shadow-2xl"
    data-testid={withTestIds ? 'ai-action-card' : undefined}
  >
    <!-- Suggestion Header -->
    <div class="p-4 bg-primary/5 border-b border-primary/10">
      <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div class="flex min-w-0 items-center gap-2">
          <Sparkles size={16} class="text-primary" />
          <h3 class="truncate font-bold text-sm text-foreground uppercase tracking-wider">{selected.suggestion.category}</h3>
        </div>
        <div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <div class="flex shrink-0 rounded-md border border-border/60 bg-background/40 p-0.5">
            <button class="touch-target rounded-md p-1 hover:bg-muted hover:text-primary transition-colors" onclick={() => recordMessageOutcome('resolved')} title="Perfect Outcome" aria-label="Mark suggestion as a perfect outcome">
              <ThumbsUp size={12} />
            </button>
            <button class="touch-target rounded-md p-1 hover:bg-muted hover:text-destructive transition-colors" onclick={() => recordMessageOutcome('bad_draft')} title="Needs Improvement" aria-label="Mark suggestion as needing improvement">
              <ThumbsDown size={12} />
            </button>
          </div>
          <div class="flex min-w-0 flex-wrap justify-end gap-1">
            <span class="max-w-full truncate rounded border border-primary/20 bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
              {formatActionLabel(selected.suggestion.recommendedAction)}
            </span>
            <span class="max-w-full truncate rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase {selected.suggestion.riskLevel === 'high' ? 'border-destructive/20 bg-destructive/20 text-destructive' : 'border-border bg-muted text-muted-foreground'}">
              {selected.suggestion.riskLevel}
            </span>
          </div>
        </div>
      </div>
      <div class="text-xs text-muted-foreground leading-relaxed italic">
        "{selected.suggestion.reasoningSummary}"
      </div>
    </div>

    <!-- Draft Reply -->
    {#if selected.suggestion.draftReply || ['reply', 'forward'].includes(selected.suggestion.recommendedAction)}
      <div class="p-4">
        <div class="relative group">
          <textarea
            id={withTestIds ? 'draft-reply' : 'draft-reply-mobile'}
            data-testid={withTestIds ? 'draft-reply' : undefined}
            class="min-h-32 w-full resize-y bg-background/50 border border-border/60 p-3 pr-10 text-sm leading-relaxed outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-lg transition-all"
            aria-label="Draft reply"
            placeholder="Drafting response..."
            bind:value={draftText}
          ></textarea>
          <div class="absolute right-2 top-2">
            <DictationButton
              targetId={withTestIds ? 'draft-reply' : 'draft-reply-mobile'}
              activeTargetId={dictationTargetId}
              recording={dictationActive}
              unavailable={dictationUnavailable}
              level={dictationLevel}
              onToggle={toggleDictation}
            />
          </div>
        </div>

        <!-- Compressed Action Row -->
        <div class="mt-4 flex flex-col gap-3">
          <!-- Main Actions -->
          <div class="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              class="flex-1 neon-glow h-8"
              data-testid={withTestIds ? 'execute-suggestion' : undefined}
              onclick={executeSuggestion}
            >
              <Send size={13} class="mr-1.5" /> Execute
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-11 w-11 p-0 lg:h-8 lg:w-8"
              onclick={saveEdit}
              title="Save changes"
              aria-label="Save"
            >
              <CheckCircle2 size={14} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-11 w-11 p-0 lg:h-8 lg:w-8"
              onclick={rejectSuggestion}
              title="Reject suggestion"
              aria-label="Reject suggestion"
            >
              <XCircle size={14} class="text-destructive" />
            </Button>
          </div>

          <!-- Tweak Input -->
          <div class="relative">
            <input
              id={withTestIds ? 'regen-note' : 'regen-note-mobile'}
              class="h-11 w-full rounded-md border border-border/60 bg-background/40 px-3 pr-12 text-xs outline-none focus:border-primary/50"
              aria-label="Tweak prompt"
              placeholder="Tweak prompt..."
              bind:value={regenNote}
            />
            <button 
              class="touch-target absolute right-0.5 top-1/2 -translate-y-1/2 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
              onclick={regenerate}
              title="Regenerate"
              aria-label="Regenerate suggestion"
            >
              <RefreshCw size={12} class={isGenerating ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Task Planner -->
    <div class="p-4 border-t border-border/40 bg-muted/5">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <Bot size={14} class="text-primary" />
          <span class="text-xs font-bold uppercase tracking-widest text-foreground">Task Engine</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="min-h-11 px-2 text-[10px] lg:h-8 lg:min-h-0"
          data-testid={withTestIds ? 'plan-task' : undefined}
          onclick={createTaskPlan}
        >
          <Sparkles size={10} class="mr-1" /> New Plan
        </Button>
      </div>

      <div class="relative mb-3">
        <input
          id={withTestIds ? 'task-note' : 'task-note-mobile'}
          data-testid={withTestIds ? 'task-note' : undefined}
          class="w-full min-h-11 lg:h-8 lg:min-h-0 bg-background/40 border border-border/60 px-2 text-xs outline-none focus:border-primary/50 rounded-md"
          aria-label="Task instructions"
          placeholder="Task instructions..."
          bind:value={taskNote}
        />
      </div>

      <div class="mb-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-3">
        <div class="mb-2 flex items-center gap-2">
          <WandSparkles size={13} class="text-primary" />
          <span class="text-[10px] font-semibold uppercase tracking-widest text-primary">Agent loop</span>
          <span class="ml-auto text-[10px] text-muted-foreground">read-only until approved</span>
        </div>
        <div class="flex gap-2">
          <input
            class="min-h-10 min-w-0 flex-1 rounded-md border border-border/60 bg-background/60 px-2.5 text-xs outline-none transition-colors focus:border-primary/50 lg:min-h-8"
            placeholder="Ask the agent to investigate…"
            aria-label="Agent loop prompt"
            bind:value={agentLoopPrompt}
            onkeydown={(event) => event.key === 'Enter' && runAgentLoop(agentLoopPrompt)}
          />
          <Button
            variant="default"
            size="sm"
            class="min-h-10 shrink-0 px-2.5 text-[10px] lg:min-h-8"
            onclick={() => runAgentLoop(agentLoopPrompt)}
            disabled={agentLoopBusy || !agentLoopPrompt.trim()}
          >
            {#if agentLoopBusy}<span class="animate-pulse">Working…</span>{:else}<WandSparkles size={11} /> Run{/if}
          </Button>
        </div>
        {#if agentLoopResult}
          <div class="mt-2 rounded-md border border-border/50 bg-background/50 p-2" transition:slide={{ duration: 160 }}>
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{agentLoopResult.status}</span>
              {#if agentLoopResult.turns}<span class="text-[10px] text-muted-foreground">{agentLoopResult.turns} turn(s)</span>{/if}
            </div>
            {#if agentLoopResult.content}<p class="mt-1 whitespace-pre-wrap text-xs leading-5 text-foreground">{agentLoopResult.content}</p>{/if}
            {#if agentLoopResult.pendingApprovals?.length}
              <div class="mt-2 space-y-2">
                <p class="text-[10px] text-amber-400">Paused before write-capable actions. Approve each tool explicitly to continue.</p>
                <div class="flex flex-wrap gap-1.5">
                  {#each agentLoopResult.pendingApprovals as call (call.id)}
                    <Button variant="outline" size="sm" class="min-h-7 px-2 text-[10px]" onclick={() => resumeAgentLoop(agentLoopResult.sessionId, [call.name])}>
                      <CheckCircle2 size={10} /> Approve {call.name}
                    </Button>
                  {/each}
                  <Button variant="ghost" size="sm" class="min-h-7 px-2 text-[10px]" onclick={() => cancelAgentLoop(agentLoopResult.sessionId)}>
                    <XCircle size={10} /> Cancel loop
                  </Button>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      {#if selected.tasks?.length}
        <div class="space-y-2">
          {#each selected.tasks as task (task.run.id)}
            <div class="bg-background/40 rounded-lg p-3 border border-border/40">
              <div class="flex items-start justify-between gap-2 mb-2">
                <div class="min-w-0">
                  <p class="text-xs font-bold text-foreground truncate">{task.run.summary}</p>
                  <p class="text-[10px] text-muted-foreground uppercase tracking-tighter">
                    {task.run.status} • {task.run.complexity}
                  </p>
                </div>
                <div class="flex gap-1">
                  {#if !['completed', 'rejected', 'cancelled'].includes(task.run.status) && task.steps?.some((step: { status: string }) => ['approved', 'running'].includes(step.status))}
                    <button
                      class="touch-target rounded-md p-1 hover:bg-muted hover:text-primary transition-colors"
                      onclick={() => _executeTask(task.run.id)}
                      title="Execute task"
                      aria-label="Execute task"
                      data-testid={withTestIds ? 'execute-task' : undefined}
                    >
                      <Send size={12} />
                    </button>
                  {/if}
                  {#if ['needs_approval', 'planned'].includes(task.run.status)}
                    <button class="touch-target rounded-md p-1 hover:bg-muted hover:text-primary transition-colors" onclick={() => approveTask(task.run.id)} title="Approve all steps" aria-label="Approve all task steps" data-testid={withTestIds ? 'approve-task' : undefined}>
                      <CheckCircle2 size={12} />
                    </button>
                  {/if}
                  {#if task.run.status === 'failed'}
                    <button class="touch-target rounded-md p-1 hover:bg-muted hover:text-primary transition-colors" onclick={() => resumeTask(task.run.id)} title="Resume workflow" aria-label="Resume workflow">
                      <Play size={12} />
                    </button>
                  {:else if ['planned', 'needs_approval', 'running'].includes(task.run.status)}
                    <button class="touch-target rounded-md p-1 hover:bg-muted hover:text-destructive transition-colors" onclick={() => cancelTask(task.run.id)} title="Cancel workflow" aria-label="Cancel workflow">
                      <Pause size={12} />
                    </button>
                  {/if}
                  {#if !['completed', 'rejected', 'cancelled'].includes(task.run.status)}
                    <button class="touch-target rounded-md p-1 hover:bg-muted hover:text-destructive transition-colors" onclick={() => rejectTask(task.run.id)} title="Reject workflow" aria-label="Reject workflow">
                      <XCircle size={12} />
                    </button>
                  {/if}
                </div>
              </div>
              {#if task.steps?.length}
                <div class="space-y-1">
                  {#each task.steps as step, stepIndex (step.id)}
                    <div class="rounded bg-background/20 px-2 py-1.5 text-[10px]" transition:slide={{ duration: 140 }}>
                      {#if editingStepId === step.id}
                        <div class="space-y-2" transition:fade={{ duration: 120 }}>
                          <input
                            class="h-8 w-full rounded border border-border/60 bg-background/70 px-2 text-[10px] outline-none focus:border-primary/60"
                            aria-label={`Edit step ${stepIndex + 1} title`}
                            bind:value={editingStepTitle}
                          />
                          <textarea
                            class="min-h-16 w-full resize-y rounded border border-border/60 bg-background/70 px-2 py-1.5 text-[10px] leading-4 outline-none focus:border-primary/60"
                            aria-label={`Edit step ${stepIndex + 1} details`}
                            bind:value={editingStepDetails}
                          ></textarea>
                          <div class="flex justify-end gap-1.5">
                            <Button variant="ghost" size="sm" class="h-7 px-2 text-[10px]" onclick={cancelStepEdit}>Cancel</Button>
                            <Button variant="default" size="sm" class="h-7 px-2 text-[10px]" onclick={() => saveStepEdit(task.run.id, step.id)} disabled={!editingStepTitle.trim() || !editingStepDetails.trim()}>
                              <CheckCircle2 size={10} /> Save
                            </Button>
                          </div>
                        </div>
                      {:else}
                        <div class="flex items-center justify-between gap-2">
                          <span class="min-w-0 truncate text-muted-foreground">{stepIndex + 1}. {step.title}</span>
                          <div class="flex shrink-0 items-center gap-1.5">
                            <span class="font-bold {step.status === 'completed' ? 'text-primary' : step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}">{step.status}</span>
                            {#if !['completed', 'rejected', 'cancelled', 'running'].includes(task.run.status)}
                              <button class="touch-target rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary" onclick={() => beginStepEdit(step)} title="Edit step" aria-label={`Edit step ${stepIndex + 1}`}>
                                <Pencil size={10} />
                              </button>
                            {/if}
                          </div>
                        </div>
                        {#if step.approvalReason && step.status === 'pending'}<p class="mt-1 text-[9px] text-amber-400">{step.approvalReason}</p>{/if}
                        {#if step.output}<pre class="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[9px] leading-4 text-muted-foreground">{JSON.stringify(step.output, null, 2)}</pre>{/if}
                        {#if step.errorMessage}
                          <div class="mt-1 flex items-center justify-between gap-2">
                            <p class="line-clamp-2 text-[9px] text-destructive">{step.errorMessage}</p>
                            {#if step.status === 'failed'}<button class="shrink-0 text-[9px] text-primary hover:underline" onclick={() => retryTaskStep(task.run.id, step.id)}>Retry</button>{/if}
                          </div>
                        {/if}
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-[10px] text-muted-foreground italic text-center py-2">No background tasks active.</p>
      {/if}
    </div>
  </div>
{/snippet}

<style>
  @keyframes shimmer {
    100% {
      transform: translateX(100%);
    }
  }

  .suggestion-container {
    max-width: 600px;
    margin: 0 auto;
  }
</style>
