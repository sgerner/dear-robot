<script lang="ts">
  import { Bot, Loader2, Paperclip, Send, X, Sparkles, FileText, ChevronDown } from 'lucide-svelte';
  import { slide, fade } from 'svelte/transition';
  import DictationButton from '$lib/components/DictationButton.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';

  let {
    data,
    compose = $bindable(),
    composeMode,
    composeEditorMode = $bindable(),
    composeHtml = $bindable(),
    composeAiPrompt = $bindable(),
    isGeneratingCompose,
    dictationTargetId,
    dictationActive,
    dictationUnavailable,
    dictationLevel,
    toggleDictation,
    onAttachFiles,
    removeAttachment,
    generateComposeBody,
    saveDraft,
    sendCompose,
    onClose
  } = $props<{
    data: any;
    compose: any;
    composeMode: string;
    composeEditorMode: 'plain' | 'rich';
    composeHtml: string;
    composeAiPrompt: string;
    isGeneratingCompose: boolean;
    dictationTargetId: string | null;
    dictationActive: boolean;
    dictationUnavailable: boolean;
    dictationLevel: number;
    toggleDictation: (_targetId: string) => void | Promise<void>;
    onAttachFiles: (_event: Event) => void | Promise<void>;
    removeAttachment: (_index: number) => void;
    generateComposeBody: () => void | Promise<void>;
    saveDraft: () => void | Promise<void>;
    sendCompose: () => void | Promise<void>;
    onClose: () => void;
  }>();

  function getModeLabel(mode: string) {
    return mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
</script>

<!-- Backdrop -->
<button
  class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
  aria-label="Close compose"
  transition:fade={{ duration: 150 }}
  onclick={onClose}
></button>

<section
  class="fixed bottom-0 right-0 z-50 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-popover shadow-2xl md:bottom-6 md:right-6 md:w-[min(700px,calc(100vw-3rem))] md:rounded-2xl"
  transition:slide={{ y: 20, duration: 250 }}
>
  <!-- Header -->
  <header class="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
    <div class="flex items-center gap-3">
      <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Sparkles size={16} />
      </div>
      <div>
        <p class="text-xs font-medium text-muted-foreground">AI Compose</p>
        <h2 class="text-sm font-semibold capitalize text-foreground">{getModeLabel(composeMode)}</h2>
      </div>
    </div>
    <button 
      class="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" 
      title="Close" 
      onclick={onClose}
    >
      <X size={18} />
    </button>
  </header>

  <form
    class="flex min-h-0 flex-1 flex-col overflow-hidden"
    onsubmit={(event) => {
      event.preventDefault();
      sendCompose();
    }}
  >
    <!-- Recipients & Subject -->
    <div class="space-y-2 border-b border-border/60 bg-muted/20 p-4">
      <!-- Account Select -->
      <select
        class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        bind:value={compose.accountId}
      >
        {#each data.accounts as account (account.id)}
          <option value={account.id}>{account.email}</option>
        {/each}
      </select>

      <!-- To -->
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">To</span>
        <input
          class="h-9 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          list="contact-options"
          placeholder="recipient@example.com"
          bind:value={compose.to}
        />
      </div>

      <!-- Cc/Bcc -->
      <div class="grid grid-cols-2 gap-2">
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">Cc</span>
          <input
            class="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            list="contact-options"
            bind:value={compose.cc}
          />
        </div>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">Bcc</span>
          <input
            class="h-9 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            bind:value={compose.bcc}
          />
        </div>
      </div>

      <!-- Subject -->
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">Subject</span>
        <input
          class="h-9 w-full rounded-md border border-input bg-background pl-14 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          placeholder="Message subject..."
          bind:value={compose.subject}
        />
      </div>

      <datalist id="contact-options">
        {#each data.contacts as contact (contact.id)}
          <option value={contact.name ? `${contact.name} <${contact.email}>` : contact.email}></option>
        {/each}
      </datalist>

      <!-- Toolbar -->
      <div class="flex flex-wrap items-center gap-2 pt-1">
        <div class="flex rounded-md border border-border p-0.5 bg-background">
          <button
            type="button"
            class={`rounded-sm px-3 py-1 text-xs font-medium transition-all ${
              composeEditorMode === 'plain' 
                ? 'bg-primary text-primary-foreground shadow-sm' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onclick={() => (composeEditorMode = 'plain')}
          >
            Plain
          </button>
          <button
            type="button"
            class={`rounded-sm px-3 py-1 text-xs font-medium transition-all ${
              composeEditorMode === 'rich' 
                ? 'bg-primary text-primary-foreground shadow-sm' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onclick={() => (composeEditorMode = 'rich')}
          >
            Rich
          </button>
        </div>

        <label
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
        >
          <Paperclip size={14} />
          <span>Attach</span>
          <input class="hidden" type="file" multiple onchange={onAttachFiles} />
        </label>

        {#if compose.draftId}
          <span class="text-xs text-muted-foreground">Draft #{compose.draftId}</span>
        {/if}
      </div>

      <!-- Attachments -->
      {#if compose.attachments.length}
        <div class="rounded-lg border border-border/60 bg-background p-2.5" transition:slide={{ duration: 200 }}>
          <p class="mb-2 text-xs font-medium text-muted-foreground">Attachments</p>
          <div class="flex flex-wrap gap-2">
            {#each compose.attachments as attachment, idx (`${attachment.filename}-${idx}`)}
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted hover:border-destructive/30 group"
                onclick={() => removeAttachment(idx)}
              >
                <Paperclip size={12} class="text-muted-foreground" />
                <span class="max-w-[120px] truncate">{attachment.filename}</span>
                <span class="text-destructive opacity-0 group-hover:opacity-100 transition-opacity">Remove</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- AI Helper -->
    <div class="border-b border-border/60 bg-primary/[0.02] p-3">
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <Bot size={16} class="text-primary" />
          <span class="text-xs font-medium text-muted-foreground">AI Helper</span>
        </div>
        <div class="flex gap-2">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <input
              id="compose-ai-prompt"
              class="min-w-0 flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              placeholder="Describe the draft you want..."
              bind:value={composeAiPrompt}
              onkeydown={(event) =>
                event.key === 'Enter' &&
                !event.shiftKey &&
                (event.preventDefault(), generateComposeBody())}
            />
            <DictationButton
              targetId="compose-ai-prompt"
              activeTargetId={dictationTargetId}
              recording={dictationActive}
              unavailable={dictationUnavailable}
              level={dictationLevel}
              onToggle={toggleDictation}
            />
          </div>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 shadow-sm"
            onclick={generateComposeBody}
            disabled={isGeneratingCompose || !composeAiPrompt.trim()}
          >
            {#if isGeneratingCompose}
              <Loader2 size={14} class="animate-spin" />
            {:else}
              <Sparkles size={14} />
            {/if}
            Generate
          </button>
        </div>
      </div>
    </div>

    <!-- Body Editor -->
    <div class="relative flex-1 min-h-0 bg-background">
      {#if composeEditorMode === 'rich'}
        <textarea
          id="compose-html-body"
          class="h-full w-full resize-none bg-background p-4 pr-12 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Write your message..."
          bind:value={composeHtml}
        ></textarea>
      {:else}
        <textarea
          id="compose-body"
          class="h-full w-full resize-none bg-background p-4 pr-12 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Write your message..."
          bind:value={compose.body}
        ></textarea>
      {/if}
      <div class="absolute right-3 top-3">
        <DictationButton
          targetId={composeEditorMode === 'rich' ? 'compose-html-body' : 'compose-body'}
          activeTargetId={dictationTargetId}
          recording={dictationActive}
          unavailable={dictationUnavailable}
          level={dictationLevel}
          onToggle={toggleDictation}
        />
      </div>
    </div>

    <!-- Footer -->
    <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3">
      <p class="text-xs text-muted-foreground">Autosaves while editing · Offline sends queued</p>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" data-testid="save-draft" onclick={saveDraft}>
          Save Draft
        </Button>
        <Button variant="outline" size="sm" onclick={onClose}>
          Cancel
        </Button>
        <Button variant="default" size="sm" data-testid="send-compose" onclick={sendCompose}>
          <Send size={14} class="mr-1.5" /> Send
        </Button>
      </div>
    </footer>
  </form>
</section>
