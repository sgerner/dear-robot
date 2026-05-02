<script lang="ts">
  let {
    categories,
    selected,
    onSelect
  }: {
    categories: Array<{ key: string; label: string; detail: string }>;
    selected: string;
    onSelect: (_category: string) => void;
  } = $props();
</script>

<div class="mt-6 space-y-1">
  {#each categories as category (category.key)}
    <button
      class={`w-full rounded-lg px-3 py-3 text-left transition-colors ${selected === category.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
      onclick={() => onSelect(category.key)}
    >
      <p class="text-sm font-medium">{category.label}</p>
      <p class="mt-0.5 text-xs text-muted-foreground">{category.detail}</p>
    </button>
  {/each}
</div>
