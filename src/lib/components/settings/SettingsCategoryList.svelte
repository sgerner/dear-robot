<script lang="ts">
  import { fly } from 'svelte/transition';

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
      class={`touch-target w-full rounded-lg px-3 py-3 text-left transition-all duration-200 hover:translate-x-0.5 ${selected === category.key ? 'bg-primary/10 text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
      aria-current={selected === category.key ? 'page' : undefined}
      in:fly={{ y: 8, duration: 180, delay: 35 * categories.indexOf(category) }}
      onclick={() => onSelect(category.key)}
    >
      <p class="text-sm font-medium">{category.label}</p>
      <p class="mt-0.5 text-xs text-muted-foreground">{category.detail}</p>
    </button>
  {/each}
</div>
