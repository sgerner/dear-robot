<script lang="ts">
  import { Bot, Loader2, Paperclip, Send, X } from 'lucide-svelte';
  import DictationButton from '$lib/components/DictationButton.svelte';

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
    toggleDictation: (targetId: string) => void | Promise<void>;
    onAttachFiles: (event: Event) => void | Promise<void>;
    removeAttachment: (index: number) => void;
    generateComposeBody: () => void | Promise<void>;
    saveDraft: () => void | Promise<void>;
    sendCompose: () => void | Promise<void>;
    onClose: () => void;
  }>();
</script>

<section
  class="fixed bottom-4 right-4 z-40 flex max-h-[86vh] w-[min(720px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-white/10 bg-zinc-950 shadow-2xl shadow-black/60"
>
  <header class="flex items-center justify-between border-b border-white/10 px-4 py-3">
    <div>
      <p class="text-xs uppercase tracking-[0.18em] text-accent">AI-ready compose</p>
      <h2 class="text-sm font-semibold capitalize">{composeMode.replace('_', ' ')}</h2>
    </div>
    <button class="rounded-md p-2 text-zinc-400 hover:bg-white/10" title="Close" onclick={onClose}>
      <X size={18} />
    </button>
  </header>
  <form
    class="flex min-h-0 flex-1 flex-col"
    onsubmit={(event) => {
      event.preventDefault();
      sendCompose();
    }}
  >
    <div class="grid gap-2 border-b border-white/10 p-4">
      <select
        class="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none"
        bind:value={compose.accountId}
      >
        {#each data.accounts as account (account.id)}
          <option value={account.id}>{account.email}</option>
        {/each}
      </select>
      <input
        class="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none"
        list="contact-options"
        placeholder="To"
        bind:value={compose.to}
      />
      <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
        <input
          class="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none"
          list="contact-options"
          placeholder="Cc"
          bind:value={compose.cc}
        />
        <input
          class="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none"
          list="contact-options"
          placeholder="Bcc"
          bind:value={compose.bcc}
        />
      </div>
      <input
        class="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none"
        placeholder="Subject"
        bind:value={compose.subject}
      />
      <datalist id="contact-options">
        {#each data.contacts as contact (contact.id)}
          <option value={contact.name ? `${contact.name} <${contact.email}>` : contact.email}
          ></option>
        {/each}
      </datalist>
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex rounded-md border border-white/10 p-1 text-xs">
          <button
            type="button"
            class={`rounded px-2 py-1 ${composeEditorMode === 'plain' ? 'bg-accent text-black' : 'text-zinc-400'}`}
            onclick={() => (composeEditorMode = 'plain')}>Plain</button
          >
          <button
            type="button"
            class={`rounded px-2 py-1 ${composeEditorMode === 'rich' ? 'bg-accent text-black' : 'text-zinc-400'}`}
            onclick={() => (composeEditorMode = 'rich')}>Rich</button
          >
        </div>
        <label
          class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300"
        >
          <Paperclip size={13} />
          <span>Attach</span>
          <input class="hidden" type="file" multiple onchange={onAttachFiles} />
        </label>
        {#if compose.draftId}
          <span class="text-xs text-zinc-500">Draft #{compose.draftId}</span>
        {/if}
      </div>
      {#if compose.attachments.length}
        <div class="rounded-md border border-white/10 bg-black/20 p-2">
          <p class="mb-2 text-xs text-zinc-500">Attachments</p>
          <div class="flex flex-wrap gap-2">
            {#each compose.attachments as attachment, idx (`${attachment.filename}-${idx}`)}
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-200"
                onclick={() => removeAttachment(idx)}
              >
                <Paperclip size={12} />
                <span>{attachment.filename}</span>
                <span class="text-zinc-500">Remove</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
    <div class="border-b border-white/10 p-3">
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <Bot size={16} class="text-accent" />
          <span class="text-xs text-zinc-400">AI Helper</span>
        </div>
        <div class="flex gap-2">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <input
              id="compose-ai-prompt"
              class="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none"
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
            class="flex items-center gap-1 rounded-md bg-accent/20 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/30 disabled:opacity-50"
            onclick={generateComposeBody}
            disabled={isGeneratingCompose || !composeAiPrompt.trim()}
          >
            {#if isGeneratingCompose}
              <Loader2 size={14} class="animate-spin" />
            {:else}
              <Bot size={14} />
            {/if}
            Generate
          </button>
        </div>
      </div>
    </div>
    {#if composeEditorMode === 'rich'}
      <div class="relative min-h-0 flex-1">
        <textarea
          id="compose-html-body"
          class="min-h-0 h-full w-full resize-none bg-black/30 p-4 pr-12 text-sm leading-6 text-zinc-100 outline-none"
          placeholder="Write rich HTML body..."
          bind:value={composeHtml}
        ></textarea>
        <div class="absolute right-2 top-2">
          <DictationButton
            targetId="compose-html-body"
            activeTargetId={dictationTargetId}
            recording={dictationActive}
            unavailable={dictationUnavailable}
            level={dictationLevel}
            onToggle={toggleDictation}
          />
        </div>
      </div>
    {:else}
      <div class="relative min-h-0 flex-1">
        <textarea
          id="compose-body"
          class="min-h-0 h-full w-full resize-none bg-black/30 p-4 pr-12 text-sm leading-6 text-zinc-100 outline-none"
          placeholder="Write the message..."
          bind:value={compose.body}
        ></textarea>
        <div class="absolute right-2 top-2">
          <DictationButton
            targetId="compose-body"
            activeTargetId={dictationTargetId}
            recording={dictationActive}
            unavailable={dictationUnavailable}
            level={dictationLevel}
            onToggle={toggleDictation}
          />
        </div>
      </div>
    {/if}
    <footer
      class="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3"
    >
      <p class="text-xs text-zinc-500">Autosaves while editing. Offline sends are queued.</p>
      <div class="flex gap-2">
        <button
          data-testid="save-draft"
          type="button"
          class="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300"
          onclick={saveDraft}>Save Draft</button
        >
        <button
          type="button"
          class="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300"
          onclick={onClose}>Cancel</button
        >
        <button
          data-testid="send-compose"
          class="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-black"
          ><Send size={16} /> Send</button
        >
      </div>
    </footer>
  </form>
</section>
