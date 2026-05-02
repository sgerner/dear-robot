<script lang="ts">
  import {
    Reply, ReplyAll, Forward, Archive, Trash2, ShieldAlert, Eye, EyeOff, Star,
    Send, RefreshCw, Bot, Paperclip, ChevronDown, CheckCircle2, XCircle, 
    MessageSquare, Sparkles, FileText, MoreHorizontal
  } from 'lucide-svelte';
  import { slide, fade } from 'svelte/transition';
  import Button from '$lib/components/ui/Button.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import ScrollArea from '$lib/components/ui/ScrollArea.svelte';
  import DictationButton from '$lib/components/DictationButton.svelte';

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
    riskClass,
    approveTask,
    rejectTask,
    executeTask
  }: {
    selected: any;
    view: string;
    quickActionIds: string[];
    quickActionMeta: (id: any) => any;
    runQuickAction: (id: any, msgId?: number) => void | Promise<void>;
    moveSelected: (path: string) => void | Promise<void>;
    folders: any[];
    bodyMode: string;
    draftText: string;
    regenNote: string;
    taskNote: string;
    dictationTargetId: string | null;
    dictationActive: boolean;
    dictationUnavailable: boolean;
    dictationLevel: number;
    toggleDictation: (id: string) => void | Promise<void>;
    executeSuggestion: () => void | Promise<void>;
    saveEdit: () => void | Promise<void>;
    rejectSuggestion: () => void | Promise<void>;
    regenerate: () => void | Promise<void>;
    generateSuggestion: (id: number) => void | Promise<void>;
    recordMessageOutcome: (type: 'resolved' | 'needs_followup' | 'bad_draft' | 'wrong_action') => void | Promise<void>;
    createTaskPlan: () => void | Promise<void>;
    selectMessage: (id: number) => void | Promise<void>;
    riskClass: (risk: string | null | undefined) => string;
    approveTask: (id: number, stepId?: number | null) => void | Promise<void>;
    rejectTask: (id: number) => void | Promise<void>;
    executeTask: (id: number) => void | Promise<void>;
  } = $props();

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

  function formatActionLabel(id: string) {
    return quickActionMeta(id)?.label || id;
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', 
      hour: 'numeric', minute: '2-digit'
    });
  }
</script>

{#if selected && !['settings', 'operations'].includes(view)}
  <ScrollArea class="h-[calc(100dvh-3.5rem)] md:h-screen scrollbar-thin">
    <article class="mx-auto max-w-3xl p-4 md:p-6 lg:p-8">
      
      <!-- Header -->
      <header class="border-b border-border/60 pb-5">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <Badge variant="outline" class="text-[10px] font-normal">
            {selected.account?.email}
          </Badge>
          <Badge variant="outline" class="text-[10px] font-normal">
            {selected.message.folderPath}
          </Badge>
        </div>
        
        <h2 class="text-xl font-semibold tracking-tight text-foreground md:text-2xl leading-tight">
          {selected.message.subject}
        </h2>
        
        <div class="mt-3 flex items-center gap-2 text-sm">
          <span class="font-medium text-foreground">{selected.message.from}</span>
          <span class="text-muted-foreground/60">·</span>
          <time class="text-muted-foreground">{formatDate(selected.message.date)}</time>
        </div>
      </header>

      <!-- Quick Actions Toolbar -->
      <div class="sticky top-0 z-10 hidden flex-wrap items-center gap-1.5 border-b border-border/60 bg-background/95 py-3 backdrop-blur-sm md:flex">
        {#each quickActionIds as actionId (actionId)}
          {@const Icon = actionIcons[actionId]}
          {@const meta = quickActionMeta(actionId)}
          <Button
            variant={meta?.tone === 'danger' ? 'destructive' : meta?.tone === 'accent' ? 'default' : 'outline'}
            size="sm"
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

      <!-- AI Suggestion Section -->
      {#if selected.suggestion}
        <section class="mt-5" transition:slide={{ duration: 200 }}>
          <Card class="ai-card overflow-hidden" hover>
            <div class="p-4 md:p-5">
              <!-- Header -->
              <div class="flex items-center gap-2 mb-4">
                <div class={`
                  h-2 w-2 rounded-full 
                  ${selected.suggestion.riskLevel === 'high' ? 'bg-destructive' : 
                    selected.suggestion.riskLevel === 'medium' ? 'bg-yellow-500' : 'bg-primary'}
                `}></div>
                <Sparkles size={14} class="text-primary" />
                <p class="text-xs font-semibold text-primary uppercase tracking-wider">AI Suggested Action</p>
              </div>
              
              <!-- Category and reasoning -->
              <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-foreground text-lg">{selected.suggestion.category}</h3>
                  <p class="mt-1 text-sm text-muted-foreground leading-relaxed">{selected.suggestion.reasoningSummary}</p>
                </div>
                <div class="flex flex-wrap gap-2 shrink-0">
                  <Badge variant="default" class="text-[10px]">{selected.suggestion.recommendedAction}</Badge>
                  <Badge variant={selected.suggestion.riskLevel === 'high' ? 'destructive' : 'outline'} class="text-[10px]">
                    {selected.suggestion.riskLevel} risk
                  </Badge>
                </div>
              </div>
              
              <!-- Target/Delegate info -->
              {#if selected.suggestion.targetFolder}
                <div class="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <Archive size={14} />
                  <span>Target: <span class="text-foreground">{selected.suggestion.targetFolder}</span></span>
                </div>
              {/if}
              {#if selected.suggestion.delegateInstructions}
                <div class="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                  <MessageSquare size={14} />
                  <span>Delegate: <span class="text-foreground">{selected.suggestion.delegateInstructions}</span></span>
                </div>
              {/if}
              
              <!-- Draft reply -->
              {#if selected.suggestion.draftReply || ['reply', 'forward'].includes(selected.suggestion.recommendedAction)}
                <div class="mt-4">
                  <label class="block text-sm font-medium text-foreground mb-2" for="draft-reply">
                    Draft Reply
                  </label>
                  <div class="relative">
                    <textarea
                      id="draft-reply"
                      data-testid="draft-reply"
                      class="min-h-32 w-full resize-y rounded-md border border-input bg-background p-3 pr-12 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring transition-all"
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
              
              <!-- Action buttons -->
              <div class="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="default" size="sm" onclick={executeSuggestion}>
                  <Send size={14} class="mr-1.5" /> Execute
                </Button>
                <Button variant="outline" size="sm" onclick={saveEdit}>
                  <CheckCircle2 size={14} class="mr-1.5" /> Save Edit
                </Button>
                <Button variant="outline" size="sm" onclick={rejectSuggestion}>
                  <XCircle size={14} class="mr-1.5" /> Reject
                </Button>
                <div class="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    id="regen-note"
                    class="min-w-0 flex-1 h-8 rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                    placeholder="Tweak instructions..."
                    bind:value={regenNote}
                  />
                  <Button variant="outline" size="sm" onclick={regenerate}>
                    <RefreshCw size={14} class="mr-1.5" /> Regen
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </section>
      {:else}
        <div class="mt-5" transition:fade={{ duration: 150 }}>
          <Button variant="outline" size="sm" onclick={() => generateSuggestion(selected?.message?.id ?? 0)}>
            <Sparkles size={14} class="mr-1.5" /> Generate AI Suggestion
          </Button>
        </div>
      {/if}

      <!-- Outcome Learning Section -->
      <section class="mt-5" transition:slide={{ duration: 200 }}>
        <Card class="p-4" hover>
          <div class="flex items-center gap-2 mb-3">
            <CheckCircle2 size={14} class="text-muted-foreground" />
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Outcome Learning</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onclick={() => recordMessageOutcome('resolved')}>
              <CheckCircle2 size={13} class="mr-1" /> Resolved
            </Button>
            <Button variant="outline" size="sm" onclick={() => recordMessageOutcome('needs_followup')}>
              <MessageSquare size={13} class="mr-1" /> Needs Follow-up
            </Button>
            <Button variant="outline" size="sm" onclick={() => recordMessageOutcome('bad_draft')}>
              <FileText size={13} class="mr-1" /> Bad Draft
            </Button>
            <Button variant="outline" size="sm" onclick={() => recordMessageOutcome('wrong_action')}>
              <XCircle size={13} class="mr-1" /> Wrong Action
            </Button>
          </div>
        </Card>
      </section>

      <!-- Agent Task Plan Section -->
      <section class="mt-5" transition:slide={{ duration: 200 }}>
        <Card class="p-4" hover>
          <div class="flex items-center justify-between gap-2 mb-3">
            <div class="flex items-center gap-2">
              <Bot size={14} class="text-primary" />
              <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agent Task Plan</p>
            </div>
            <Button variant="outline" size="sm" onclick={createTaskPlan}>
              <Sparkles size={13} class="mr-1" /> Plan Task
            </Button>
          </div>
          
          <div class="flex items-center gap-2 mb-3">
            <input
              id="task-note"
              class="min-w-0 flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              placeholder="Add a note for the task..."
              bind:value={taskNote}
            />
          </div>
          
          {#if selected.tasks?.length}
            <div class="mt-3 space-y-3">
              {#each selected.tasks as task (task.run.id)}
                <div class="rounded-lg border border-border bg-background/50 p-3">
                  <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-foreground">{task.run.summary}</p>
                      <p class="text-xs text-muted-foreground">{task.run.status} · {task.run.complexity}</p>
                    </div>
                    <div class="flex gap-1.5 shrink-0">
                      <Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => approveTask(task.run.id)}>
                        Approve
                      </Button>
                      <Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => executeTask(task.run.id)}>
                        Execute
                      </Button>
                    </div>
                  </div>
                  
                  {#if task.steps?.length}
                    <div class="mt-2 space-y-1.5">
                      {#each task.steps as step (step.id)}
                        <div class="rounded-md border border-border/60 bg-background px-3 py-2">
                          <div class="flex items-center justify-between gap-2">
                            <p class="text-xs font-medium text-foreground">{step.title}</p>
                            <Badge variant={step.riskLevel === 'high' ? 'destructive' : 'default'} class="text-[10px]">
                              {step.status}
                            </Badge>
                          </div>
                          <p class="text-xs text-muted-foreground mt-0.5">{step.details}</p>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-xs text-muted-foreground italic">No task plan yet. Click "Plan Task" to generate one.</p>
          {/if}
        </Card>
      </section>

      <!-- Thread/Conversation Section -->
      {#if selected.thread?.length > 1}
        <section class="mt-5" transition:slide={{ duration: 200 }}>
          <Card class="p-4" hover>
            <div class="flex items-center gap-2 mb-3">
              <MessageSquare size={14} class="text-muted-foreground" />
              <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Conversation</p>
            </div>
            <div class="space-y-2">
              {#each selected.thread as item (item.id)}
                <button
                  class={`w-full rounded-lg border p-3 text-left transition-all duration-150 ${
                    item.id === selected.message.id 
                      ? 'border-primary/30 bg-primary/[0.04] ring-1 ring-primary/20' 
                      : 'border-border bg-background hover:bg-muted/30'
                  }`}
                  onclick={() => selectMessage(item.id)}
                >
                  <div class="flex items-center justify-between gap-2 mb-1">
                    <p class="truncate text-sm font-medium text-foreground">{item.from}</p>
                    <time class="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(item.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </time>
                  </div>
                  <p class="truncate text-xs text-muted-foreground">{item.subject}</p>
                  <p class="mt-1.5 line-clamp-2 text-xs text-muted-foreground/80 leading-relaxed">{item.bodyText}</p>
                </button>
              {/each}
            </div>
          </Card>
        </section>
      {/if}

      <!-- Message Body Section -->
      <section class="mt-5" transition:slide={{ duration: 200 }}>
        <Card class="p-4 md:p-5" hover>
          {#if selected.message.safeBodyHtml}
            <div class="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
              <div class="flex items-center gap-2">
                <FileText size={14} class="text-muted-foreground" />
                <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Message</p>
              </div>
              <div class="flex rounded-md border border-border p-0.5 text-xs bg-background">
                <button
                  class={`rounded-sm px-3 py-1 transition-all duration-150 ${
                    bodyMode === 'html' 
                      ? 'bg-primary text-primary-foreground shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onclick={() => (bodyMode = 'html')}
                >
                  HTML
                </button>
                <button
                  class={`rounded-sm px-3 py-1 transition-all duration-150 ${
                    bodyMode === 'text' 
                      ? 'bg-primary text-primary-foreground shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onclick={() => (bodyMode = 'text')}
                >
                  Plain Text
                </button>
              </div>
            </div>
          {/if}
          
          {#if bodyMode === 'html' && selected.message.safeBodyHtml}
            <article class="email-html text-sm leading-7 text-foreground prose prose-invert max-w-none">
              {@html selected.message.safeBodyHtml}
            </article>
          {:else}
            <pre class="whitespace-pre-wrap font-sans text-sm leading-7 text-foreground">{selected.message.bodyText}</pre>
          {/if}
        </Card>
      </section>

      <!-- Attachments Section -->
      {#if selected.attachments?.length}
        <section class="mt-5" transition:slide={{ duration: 200 }}>
          <Card class="p-4" hover>
            <details>
              <summary class="flex cursor-pointer list-none items-center justify-between gap-2 text-sm text-foreground">
                <span class="flex items-center gap-2">
                  <Paperclip size={14} class="text-muted-foreground" />
                  <span class="font-medium">Attachments</span>
                  <Badge variant="outline" class="text-[10px]">{selected.attachments.length}</Badge>
                </span>
                <ChevronDown size={14} class="text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div class="mt-3 flex flex-wrap gap-2">
                {#each selected.attachments as attachment (attachment.id)}
                  <a
                    class="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted transition-colors"
                    href={`/api/messages/${selected.message.id}/attachments/${attachment.id}`}
                  >
                    <Paperclip size={12} />
                    <span class="max-w-[150px] truncate">{attachment.filename}</span>
                    <span class="text-muted-foreground">
                      {Math.max(1, Math.round((attachment.sizeBytes || 0) / 1024))}KB
                    </span>
                  </a>
                {/each}
              </div>
            </details>
          </Card>
        </section>
      {/if}
    </article>
  </ScrollArea>
{:else if view === 'operations' || view === 'settings'}
  <div class="hidden md:block"></div>
{:else}
  <div class="grid h-full place-items-center text-muted-foreground">
    <div class="flex flex-col items-center gap-3">
      <div class="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center">
        <svg class="h-8 w-8 text-muted-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <p class="text-sm">Select a message to view details</p>
    </div>
  </div>
{/if}
