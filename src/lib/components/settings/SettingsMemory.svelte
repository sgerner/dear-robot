<script lang="ts">
  import DictationButton from '$lib/components/DictationButton.svelte';

  let {
    data,
    memoryAssistantPrompt = $bindable(),
    coreProfileText = $bindable(),
    memoryAdvancedMode = $bindable(),
    memoryText = $bindable(),
    skillsText = $bindable(),
    dictationTargetId,
    dictationActive,
    dictationUnavailable,
    dictationLevel,
    toggleDictation,
    applyMemoryAssistant,
    saveCoreProfile,
    saveSkills,
    resetSkills,
    setAdvancedMemoryMode,
    saveMemory,
    resetMemory,
    removeMemoryRule
  } = $props<{
    data: any;
    memoryAssistantPrompt: string;
    coreProfileText: string;
    memoryAdvancedMode: boolean;
    memoryText: string;
    skillsText: string;
    dictationTargetId: string | null;
    dictationActive: boolean;
    dictationUnavailable: boolean;
    dictationLevel: number;
    toggleDictation: (targetId: string) => void | Promise<void>;
    applyMemoryAssistant: () => void | Promise<void>;
    saveCoreProfile: () => void | Promise<void>;
    saveSkills: () => void | Promise<void>;
    resetSkills: () => void | Promise<void>;
    setAdvancedMemoryMode: (enabled: boolean) => void | Promise<void>;
    saveMemory: () => void | Promise<void>;
    resetMemory: () => void | Promise<void>;
    removeMemoryRule: (id: number) => void | Promise<void>;
  }>();
</script>

<div class="mt-6 space-y-4">
  <h3 class="text-xl font-semibold">Memory</h3>
  <div class="rounded-lg border border-white/10 bg-white/[0.03] p-4">
    <p class="text-sm font-medium">Memory Assistant</p>
    <p class="mt-1 text-xs text-zinc-500">Describe how memory should change. The assistant will update profile and rules for you.</p>
    <div class="mt-3 flex gap-2">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <input id="memory-assistant-prompt" class="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Example: prioritize short replies for wholesale quotes and keep greetings warm" bind:value={memoryAssistantPrompt} />
        <DictationButton targetId="memory-assistant-prompt" activeTargetId={dictationTargetId} recording={dictationActive} unavailable={dictationUnavailable} level={dictationLevel} onToggle={toggleDictation} />
      </div>
      <button class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black" onclick={applyMemoryAssistant}>Apply</button>
    </div>
  </div>
  <div class="relative">
    <textarea id="memory-core-profile" class="min-h-40 w-full resize-y rounded-lg border border-white/10 bg-black/40 p-3 pr-12 text-sm leading-6 outline-none" bind:value={coreProfileText}></textarea>
    <div class="absolute right-2 top-2">
      <DictationButton targetId="memory-core-profile" activeTargetId={dictationTargetId} recording={dictationActive} unavailable={dictationUnavailable} level={dictationLevel} onToggle={toggleDictation} />
    </div>
  </div>
  <div class="flex gap-2">
    <button class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black" onclick={saveCoreProfile}>Save Core Profile</button>
    <label class="inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-zinc-300">
      <input type="checkbox" bind:checked={memoryAdvancedMode} onchange={(event) => setAdvancedMemoryMode((event.currentTarget as HTMLInputElement).checked)} />
      Advanced mode
    </label>
  </div>
  <div class="rounded-lg border border-white/10 bg-white/[0.03] p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium">skills.md</p>
        <p class="mt-1 text-xs text-zinc-500">Reusable playbooks and concise memory hints. Keep this short so it stays cheap to inject into prompts.</p>
      </div>
      <span class="rounded-full border border-white/10 px-2 py-1 text-[11px] text-zinc-500">/data/skills.md</span>
    </div>
    <div class="relative mt-3">
      <textarea id="memory-skills" class="min-h-32 w-full resize-y rounded-lg border border-white/10 bg-black/40 p-3 pr-12 text-sm leading-6 outline-none" bind:value={skillsText}></textarea>
      <div class="absolute right-2 top-2">
        <DictationButton targetId="memory-skills" activeTargetId={dictationTargetId} recording={dictationActive} unavailable={dictationUnavailable} level={dictationLevel} onToggle={toggleDictation} />
      </div>
    </div>
    <div class="mt-3 flex gap-2">
      <button class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black" onclick={saveSkills}>Save Skills</button>
      <button class="rounded-md border border-white/10 px-3 py-2 text-sm" onclick={resetSkills}>Reset Default</button>
    </div>
  </div>
  {#if memoryAdvancedMode}
    <div class="relative">
      <textarea id="memory-advanced" class="min-h-36 w-full rounded-lg border border-white/10 bg-black/40 p-3 pr-12 font-mono text-xs leading-6 outline-none" bind:value={memoryText}></textarea>
      <div class="absolute right-2 top-2">
        <DictationButton targetId="memory-advanced" activeTargetId={dictationTargetId} recording={dictationActive} unavailable={dictationUnavailable} level={dictationLevel} onToggle={toggleDictation} />
      </div>
    </div>
    <div class="flex gap-2">
      <button class="rounded-md border border-white/10 px-3 py-2 text-sm" onclick={saveMemory}>Save Memory File</button>
      <button class="rounded-md border border-white/10 px-3 py-2 text-sm" onclick={resetMemory}>Reset Default</button>
    </div>
  {/if}
  <div class="grid gap-4 md:grid-cols-2">
    <div class="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <p class="text-sm font-medium">Learned Rules</p>
      <div class="mt-3 space-y-2">
        {#each data.memoryOverview?.rules || [] as rule (rule.id)}
          <article class="rounded-md border border-white/10 bg-black/20 p-2">
            <p class="text-xs text-zinc-300">{rule.ruleText}</p>
            <p class="mt-1 text-[11px] text-zinc-500">{rule.scope} · conf {Number(rule.confidence).toFixed(2)} · used {rule.usageCount}x</p>
            <button class="mt-2 rounded border border-white/10 px-2 py-1 text-[11px] text-zinc-400" onclick={() => removeMemoryRule(rule.id)}>Disable</button>
          </article>
        {/each}
      </div>
    </div>
    <div class="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <p class="text-sm font-medium">Recent Memory Events</p>
      <div class="mt-3 space-y-2">
        {#each data.memoryOverview?.events || [] as event (event.id)}
          <article class="rounded-md border border-white/10 bg-black/20 p-2">
            <p class="text-xs text-zinc-300">{event.eventType}</p>
            <p class="mt-1 text-[11px] text-zinc-500">{new Date(event.createdAt).toLocaleString()}</p>
          </article>
        {/each}
      </div>
    </div>
  </div>
  <div class="rounded-lg border border-white/10 bg-white/[0.03] p-4">
    <p class="text-sm font-medium">Top Learned Examples</p>
    <div class="mt-3 space-y-2">
      {#each data.memoryOverview?.examples || [] as example (example.id)}
        <article class="rounded-md border border-white/10 bg-black/20 p-2">
          <p class="text-[11px] text-zinc-500">{example.scope} · score {Number(example.score).toFixed(2)}</p>
          <p class="mt-1 text-xs text-zinc-400 line-clamp-2">Before: {example.beforeText}</p>
          <p class="mt-1 text-xs text-zinc-300 line-clamp-2">After: {example.afterText}</p>
        </article>
      {/each}
    </div>
  </div>
</div>
