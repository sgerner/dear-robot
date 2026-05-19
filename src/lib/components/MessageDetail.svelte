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
    MessageSquare,
    Sparkles,
    FileText,
    ThumbsUp,
    Sun,
    Moon
  } from 'lucide-svelte';
  import { slide, fade } from 'svelte/transition';
  import Button from '$lib/components/ui/Button.svelte';
  import ScrollArea from '$lib/components/ui/ScrollArea.svelte';
  import DictationButton from '$lib/components/DictationButton.svelte';
  import { formatPlainText } from '$lib/utils/format';

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
    executeTask
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
    riskClass: (_risk: string | null | undefined) => string;
    approveTask: (_id: number, _stepId?: number | null) => void | Promise<void>;
    rejectTask: (_id: number) => void | Promise<void>;
    executeTask: (_id: number) => void | Promise<void>;
  } = $props();

  let emailTheme = $state<'light' | 'dark'>('dark');
  let visibleThreadLimit = $state(5);
  let openMessageIds = $state(new Set<number>());

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
    if (item?.bodyHtml) return 'html';
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
</script>

{#if selected && !['settings', 'operations'].includes(view)}
  <ScrollArea class="h-[calc(100dvh-3.5rem)] md:h-screen scrollbar-thin">
    <article class="mx-auto max-w-4xl p-4 md:p-6 lg:p-8">
      <!-- Header -->
      <header class="pb-5">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span
            class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-2 py-0.5 bg-muted"
          >
            {selected.account?.email}
          </span>
          <span
            class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-2 py-0.5 bg-muted"
          >
            {selected.message.folderPath}
          </span>
        </div>

        <h2 class="text-xl font-semibold tracking-tight text-foreground md:text-2xl leading-tight">
          {selected.message.subject}
        </h2>

        <div class="mt-3 flex items-center gap-2 text-sm">
          <time class="text-muted-foreground">{formatDate(selected.message.date)}</time>
        </div>
      </header>

      <!-- Quick Actions Toolbar -->
      <div class="sticky top-0 z-10 hidden flex-wrap items-center gap-1.5 py-3 md:flex">
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
            onclick={() => runQuickAction(actionId)}
          >
            {#if actionId === 'toggle_read'}
              {#if selected.message.isRead}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
            {:else if Icon}
              <Icon size={14} />
            {/if}
            <span class="ml-1.5">{meta?.label || actionId}</span>
          </Button>
        {/each}

        <div class="h-6 w-px bg-border mx-1"></div>

        <select
          class="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
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
                      <span class="text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-primary/15 text-primary font-medium">
                        Selected
                      </span>
                    {/if}
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <time class="text-[11px] text-muted-foreground">
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
                  <div class="mt-1.5 line-clamp-2 text-xs text-muted-foreground/80 leading-relaxed">
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html formatPlainText(item.bodyText)}
                  </div>
                {/if}
              </button>

              <!-- Expanded body -->
              {#if isMessageOpen(item.id)}
                <div class="px-3 pb-3" transition:slide={{ duration: 200 }}>
                  <!-- Toggles bar -->
                  {#if item.bodyHtml}
                    <div class="flex items-center justify-end gap-1 mb-2">
                      <div class="flex border border-border/40 p-0.5 bg-background">
                        <button
                          class={`px-1.5 py-0.5 transition-all duration-150 ${
                            getMessageEmailTheme(item.id) === 'dark'
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          onclick={() => setMessageEmailTheme(item.id, 'dark')}
                          title="Dark Mode"
                        >
                          <Moon size={11} />
                        </button>
                        <button
                          class={`px-1.5 py-0.5 transition-all duration-150 ${
                            getMessageEmailTheme(item.id) === 'light'
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          onclick={() => setMessageEmailTheme(item.id, 'light')}
                          title="Light Mode"
                        >
                          <Sun size={11} />
                        </button>
                      </div>
                      <div class="flex border border-border/40 p-0.5 bg-background text-[11px]">
                        <button
                          class={`px-1.5 py-0.5 transition-all duration-150 ${
                            getMessageBodyMode(item.id) === 'html'
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          onclick={() => setMessageBodyMode(item.id, 'html')}
                        >
                          H
                        </button>
                        <button
                          class={`px-1.5 py-0.5 transition-all duration-150 ${
                            getMessageBodyMode(item.id) === 'text'
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          onclick={() => setMessageBodyMode(item.id, 'text')}
                        >
                          P
                        </button>
                      </div>
                    </div>
                  {/if}

                  <!-- Body content -->
                  {#if getMessageBodyMode(item.id) === 'html' && item.bodyHtml}
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
                          <span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-muted text-muted-foreground">
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
              class="w-full py-2 text-center text-xs text-primary hover:text-primary/80 transition-colors"
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
                <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Message
                </p>
              </div>
              <div class="flex items-center gap-3">
                <!-- Email Theme Toggle -->
                <div class="flex border border-border/40 p-0.5 text-xs bg-background">
                  <button
                    class={`px-2 py-1 transition-all duration-150 ${
                      emailTheme === 'dark'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onclick={() => (emailTheme = 'dark')}
                    title="Dark Mode"
                  >
                    <Moon size={12} />
                  </button>
                  <button
                    class={`px-2 py-1 transition-all duration-150 ${
                      emailTheme === 'light'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onclick={() => (emailTheme = 'light')}
                    title="Light Mode"
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

      <!-- AI Panel -->
      {#if selected.suggestion}
        <section
          class="mt-5 bg-primary/10 border-l-2 border-primary/20"
          data-testid="ai-action-card"
          transition:slide={{ duration: 200 }}
        >
          <!-- Suggestion Header -->
          <div class="p-4 md:p-5 pb-0">
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-2 min-w-0">
                <Sparkles size={14} class="text-primary shrink-0 mt-0.5" />
                <h3 class="font-semibold text-foreground">{selected.suggestion.category}</h3>
              </div>
              <div class="flex gap-2 shrink-0">
                <span
                  class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 font-medium bg-primary/15 text-primary"
                >
                  {selected.suggestion.recommendedAction}
                </span>
                <span
                  class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 font-medium {selected
                    .suggestion.riskLevel === 'high'
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-muted text-muted-foreground'}"
                >
                  {selected.suggestion.riskLevel}
                </span>
              </div>
            </div>
            <div class="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html formatPlainText(selected.suggestion.reasoningSummary)}
            </div>

            {#if selected.suggestion.targetFolder || selected.suggestion.delegateInstructions}
              <div class="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                {#if selected.suggestion.targetFolder}
                  <span>→ {selected.suggestion.targetFolder}</span>
                {/if}
                {#if selected.suggestion.delegateInstructions}
                  <span>↳ {selected.suggestion.delegateInstructions}</span>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Draft Reply -->
          {#if selected.suggestion.draftReply || ['reply', 'forward'].includes(selected.suggestion.recommendedAction)}
            <div class="px-4 md:px-5">
              <div class="relative">
                <textarea
                  id="draft-reply"
                  data-testid="draft-reply"
                  class="min-h-28 w-full resize-y bg-muted border border-border/40 p-3 pr-12 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:border-primary/40 transition-all"
                  placeholder="Draft reply..."
                  bind:value={draftText}
                ></textarea>
                <div class="absolute right-2 top-2">
                  <DictationButton
                    targetId="draft-reply"
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
          <div class="px-4 md:px-5 mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="default"
              size="sm"
              data-testid="execute-suggestion"
              onclick={executeSuggestion}
            >
              <Send size={13} class="mr-1" /> Execute
            </Button>
            <Button variant="outline" size="sm" onclick={saveEdit}>Save</Button>
            <Button variant="outline" size="sm" onclick={rejectSuggestion}>Reject</Button>
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <input
                id="regen-note"
                class="min-w-0 flex-1 h-8 bg-muted border border-border/40 px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/40"
                placeholder="Tweak..."
                bind:value={regenNote}
              />
              <Button variant="outline" size="sm" onclick={regenerate}>
                <RefreshCw size={13} />
              </Button>
            </div>
          </div>

          <!-- Feedback Row -->
          <div class="px-4 md:px-5 mt-4 pb-4 md:pb-5">
            <div class="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <ThumbsUp size={12} />
              <span class="uppercase tracking-wider font-medium">Feedback</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <Button
                variant="outline"
                size="sm"
                class="h-7 text-xs px-2.5"
                onclick={() => recordMessageOutcome('resolved')}
              >
                Resolved
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="h-7 text-xs px-2.5"
                onclick={() => recordMessageOutcome('needs_followup')}
              >
                Follow-up
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="h-7 text-xs px-2.5"
                onclick={() => recordMessageOutcome('bad_draft')}
              >
                Bad Draft
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="h-7 text-xs px-2.5"
                onclick={() => recordMessageOutcome('wrong_action')}
              >
                Wrong Action
              </Button>
            </div>
          </div>

          <!-- Task Plan (nested within AI panel) -->
          <div class="border-t border-border/20 px-4 md:px-5 pb-4">
            <div class="flex items-center justify-between gap-2 mb-3">
              <div class="flex items-center gap-2">
                <Bot size={13} class="text-primary" />
                <span
                  class="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest"
                  >Task Plan</span
                >
              </div>
              <Button
                variant="outline"
                size="sm"
                class="h-7 text-xs"
                data-testid="plan-task"
                onclick={createTaskPlan}
              >
                <Sparkles size={11} class="mr-1" /> Plan
              </Button>
            </div>

            <input
              id="task-note"
              class="w-full h-8 bg-muted border border-border/40 px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/40 mb-3"
              placeholder="Add a note..."
              bind:value={taskNote}
            />

            {#if selected.tasks?.length}
              <div class="space-y-2">
                {#each selected.tasks as task (task.run.id)}
                  <div class="bg-background/40 p-2.5">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="min-w-0 flex-1">
                        <p class="text-sm font-medium text-foreground">{task.run.summary}</p>
                        <p class="text-xs text-muted-foreground">
                          {task.run.status} · {task.run.complexity}
                        </p>
                      </div>
                      <div class="flex gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          class="h-7 text-xs px-2"
                          data-testid="approve-task"
                          onclick={() => approveTask(task.run.id)}>Approve</Button
                        >
                        <Button
                          variant="outline"
                          size="sm"
                          class="h-7 text-xs px-2"
                          data-testid="reject-task"
                          onclick={() => rejectTask(task.run.id)}>Reject</Button
                        >
                        <Button
                          variant="outline"
                          size="sm"
                          class="h-7 text-xs px-2"
                          data-testid="execute-task"
                          onclick={() => executeTask(task.run.id)}>Exec</Button
                        >
                      </div>
                    </div>
                    {#if task.steps?.length}
                      <div class="mt-2 space-y-1">
                        {#each task.steps as step (step.id)}
                          <div
                            class="bg-background/60 px-2.5 py-1.5 flex items-center justify-between gap-2"
                          >
                            <div class="text-xs text-foreground">
                              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                              {@html formatPlainText(step.title)}
                            </div>
                            <span
                              class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 {step.riskLevel ===
                              'high'
                                ? 'bg-destructive/15 text-destructive'
                                : 'bg-primary/15 text-primary'}">{step.status}</span
                            >
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-xs text-muted-foreground/60 italic">No tasks yet.</p>
            {/if}
          </div>
        </section>
      {:else}
        <div class="mt-5" transition:fade={{ duration: 150 }}>
          <Button
            variant="outline"
            size="sm"
            onclick={() => generateSuggestion(selected?.message?.id ?? 0)}
          >
            <Sparkles size={13} class="mr-1" /> Generate Suggestion
          </Button>
        </div>
      {/if}
    </article>
  </ScrollArea>
{:else if view === 'operations' || view === 'settings'}
  <div class="hidden md:block"></div>
{:else}
  <div class="grid h-full place-items-center text-muted-foreground">
    <div class="flex flex-col items-center gap-3">
      <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
        <svg
          class="h-8 w-8 text-muted-foreground/40"
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
