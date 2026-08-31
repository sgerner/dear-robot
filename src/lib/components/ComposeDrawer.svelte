<script lang="ts">
  import { Bot, Loader2, Paperclip, Send, X, Sparkles } from 'lucide-svelte';
  import { slide, fade } from 'svelte/transition';
  import DictationButton from '$lib/components/DictationButton.svelte';
  import Button from '$lib/components/ui/Button.svelte';

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

  let showCc = $state(false);
  let showBcc = $state(false);

  function getModeLabel(mode: string) {
    return mode.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }

  // Auto-show Cc/Bcc if they have content
  $effect(() => {
    if (compose.cc && !showCc) showCc = true;
    if (compose.bcc && !showBcc) showBcc = true;
  });
</script>

<!-- Backdrop -->
<button
  class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
  aria-label="Close compose"
  transition:fade={{ duration: 150 }}
  onclick={onClose}
></button>

<dialog
  open
  aria-modal="true"
  aria-labelledby="compose-dialog-title"
  tabindex="-1"
  onkeydown={(event) => event.key === 'Escape' && onClose()}
  class="m-0 p-0 text-foreground fixed bottom-0 right-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden border-t border-border bg-background shadow-2xl lg:bottom-4 lg:left-1/2 lg:h-full lg:max-h-[92vh] lg:-translate-x-1/2 lg:right-auto lg:w-[min(840px,calc(100vw-2rem))] lg:border"
  transition:slide={{ duration: 200 }}
>
  <!-- Header -->
  <header class="flex items-center justify-between border-b border-border px-4 py-2.5 shrink-0">
    <div class="flex items-center gap-2.5">
      <Sparkles size={15} class="text-primary" />
      <h2 id="compose-dialog-title" class="text-sm font-semibold text-foreground">{getModeLabel(composeMode)}</h2>
      {#if compose.draftId}
        <span class="text-xs text-muted-foreground">#{compose.draftId}</span>
      {/if}
    </div>
    <button
      class="touch-target rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title="Close"
      aria-label="Close compose"
      onclick={onClose}
    >
      <X size={16} />
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
    <div class="shrink-0 space-y-0 border-b border-border">
      <!-- Account + To row -->
      <div class="flex items-center gap-0 border-b border-border">
        <select
          class="h-10 shrink-0 border-r border-border bg-transparent px-3 text-xs text-muted-foreground outline-none hover:text-foreground cursor-pointer"
          aria-label="Sending account"
          bind:value={compose.accountId}
        >
          {#each data.accounts as account (account.id)}
            <option value={account.id}>{account.email}</option>
          {/each}
        </select>
        <div class="relative flex-1 min-w-0">
          <span
            class="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >To</span
          >
          <input
            class="h-10 w-full bg-transparent pl-8 pr-20 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="To"
            list="contact-options"
            placeholder="recipient@..."
            bind:value={compose.to}
          />
          <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button
              type="button"
              class="touch-target text-xs font-medium uppercase tracking-wider px-1.5 py-0.5 text-muted-foreground hover:text-foreground transition-colors {showCc
                ? 'text-primary'
                : ''}"
              onclick={() => (showCc = !showCc)}
            >
              Cc
            </button>
            <button
              type="button"
              class="touch-target text-xs font-medium uppercase tracking-wider px-1.5 py-0.5 text-muted-foreground hover:text-foreground transition-colors {showBcc
                ? 'text-primary'
                : ''}"
              onclick={() => (showBcc = !showBcc)}
            >
              Bcc
            </button>
          </div>
        </div>
      </div>

      <!-- Cc (expandable) -->
      {#if showCc}
        <div class="relative border-b border-border" transition:slide={{ duration: 150 }}>
          <span
            class="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >Cc</span
          >
          <input
            class="h-10 w-full bg-transparent pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Cc"
            list="contact-options"
            placeholder="Add cc..."
            bind:value={compose.cc}
          />
        </div>
      {/if}

      <!-- Bcc (expandable) -->
      {#if showBcc}
        <div class="relative border-b border-border" transition:slide={{ duration: 150 }}>
          <span
            class="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >Bcc</span
          >
          <input
            class="h-10 w-full bg-transparent pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Bcc"
            placeholder="Add bcc..."
            bind:value={compose.bcc}
          />
        </div>
      {/if}

      <!-- Subject -->
      <div class="relative">
        <input
          class="h-10 w-full bg-transparent px-3 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground placeholder:font-normal"
          aria-label="Subject"
          placeholder="Subject"
          bind:value={compose.subject}
        />
      </div>

      <datalist id="contact-options">
        {#each data.contacts as contact (contact.id)}
          <option value={contact.name ? `${contact.name} <${contact.email}>` : contact.email}
          ></option>
        {/each}
      </datalist>
    </div>

    <!-- Toolbar -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
      <div class="flex border border-border p-0.5">
        <button
          type="button"
          class={`touch-target px-2 py-0.5 text-xs font-medium transition-colors ${
            composeEditorMode === 'plain'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onclick={() => (composeEditorMode = 'plain')}
        >
          Plain
        </button>
        <button
          type="button"
          class={`touch-target px-2 py-0.5 text-xs font-medium transition-colors ${
            composeEditorMode === 'rich'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onclick={() => (composeEditorMode = 'rich')}
        >
          Rich
        </button>
      </div>

      <label
        class="touch-target inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Paperclip size={12} />
        <span>Attach</span>
        <input class="hidden" type="file" multiple onchange={onAttachFiles} />
      </label>

      {#if compose.attachments.length}
        <span class="text-xs text-muted-foreground">{compose.attachments.length} attached</span>
      {/if}
    </div>

    <!-- Attachments (if any) -->
    {#if compose.attachments.length}
      <div
        class="shrink-0 flex flex-wrap gap-1.5 px-3 py-1.5 border-b border-border bg-muted/20"
        transition:slide={{ duration: 150 }}
      >
        {#each compose.attachments as attachment, idx (`${attachment.filename}-${idx}`)}
          <button
            type="button"
            class="inline-flex min-h-10 items-center gap-1.5 bg-background border border-border px-2 py-0.5 text-xs text-foreground transition-colors hover:border-destructive/50 group"
            aria-label={`${attachment.filename} Remove`}
            onclick={() => removeAttachment(idx)}
          >
            <Paperclip size={10} class="text-muted-foreground" />
            <span class="max-w-[100px] truncate">{attachment.filename}</span>
            <X
              size={10}
              class="text-muted-foreground group-hover:text-destructive transition-colors"
            />
          </button>
        {/each}
      </div>
    {/if}

    <!-- AI Helper -->
    <div class="shrink-0 border-b border-border bg-muted/10 px-3 py-2">
      <div class="flex items-center gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <Bot size={13} class="text-primary shrink-0" />
          <input
            id="compose-ai-prompt"
            class="min-w-0 flex-1 h-7 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Ask AI to write"
            placeholder="Ask AI to write..."
            bind:value={composeAiPrompt}
            onkeydown={(event) =>
              event.key === 'Enter' &&
              !event.shiftKey &&
              (event.preventDefault(), generateComposeBody())}
          />
        </div>
        <DictationButton
          targetId="compose-ai-prompt"
          activeTargetId={dictationTargetId}
          recording={dictationActive}
          unavailable={dictationUnavailable}
          level={dictationLevel}
          onToggle={toggleDictation}
        />
        <button
          type="button"
          class="touch-target flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          onclick={generateComposeBody}
          disabled={isGeneratingCompose || !composeAiPrompt.trim()}
        >
          {#if isGeneratingCompose}
            <Loader2 size={12} class="animate-spin" />
          {:else}
            <Sparkles size={12} />
          {/if}
          Generate
        </button>
      </div>
    </div>

    <!-- Body Editor -->
    <div class="relative flex-1 min-h-0">
      {#if composeEditorMode === 'rich'}
        <textarea
          id="compose-html-body"
          class="h-full w-full resize-none bg-background p-3 pr-10 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          aria-label="Message body (rich text)"
          placeholder="Write your message..."
          bind:value={composeHtml}
        ></textarea>
      {:else}
        <textarea
          id="compose-body"
          class="h-full w-full resize-none bg-background p-3 pr-10 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          aria-label="Message body"
          placeholder="Write your message..."
          bind:value={compose.body}
        ></textarea>
      {/if}
      <div class="absolute right-2 top-2">
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
    <footer
      class="flex shrink-0 flex-col items-stretch gap-2 border-t border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
      style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px));"
    >
      <p class="text-xs text-muted-foreground">Autosaves · Offline queue</p>
      <div class="flex w-full gap-2 sm:w-auto">
        <Button
          variant="outline"
          size="sm"
          class="touch-target flex-1 text-xs sm:flex-none"
          data-testid="save-draft"
          onclick={saveDraft}
        >
          Save
        </Button>
        <Button variant="outline" size="sm" class="touch-target flex-1 text-xs sm:flex-none" onclick={onClose}>Cancel</Button>
        <Button
          variant="default"
          size="sm"
          class="touch-target flex-1 text-xs sm:flex-none"
          data-testid="send-compose"
          onclick={sendCompose}
        >
          <Send size={12} class="mr-1" /> Send
        </Button>
      </div>
    </footer>
  </form>
</dialog>
