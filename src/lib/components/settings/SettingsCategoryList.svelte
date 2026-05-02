<script lang="ts">
  let {
    categories,
    selected,
    onSelect
  }: {
    categories: Array<{ key: string; label: string; detail: string }>;
    selected: string;
    onSelect: (category: string) => void;
  } = $props();
</script>

<div class="mt-6 space-y-2">
  {#each categories as category (category.key)}
    <button
      class={`w-full rounded-lg border px-3 py-3 text-left transition-all duration-150 hover:-translate-y-0.5 ${selected === category.key ? 'border-accent/40 bg-accent/10 text-accent shadow-sm shadow-accent/10' : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'}`}
      onclick={() => onSelect(category.key)}
    >
      <p class="text-sm font-medium">{category.label}</p>
      <p class="mt-1 text-xs text-zinc-500">{category.detail}</p>
    </button>
  {/each}
</div>
