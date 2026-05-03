<script lang="ts">
  let {
    checked = $bindable(false),
    label,
    disabled = false,
    onchange,
    class: className = ''
  } = $props<{
    checked?: boolean;
    label?: string;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
    class?: string;
  }>();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<label
  class="inline-flex cursor-pointer items-center gap-3 text-xs text-muted-foreground transition-colors hover:text-foreground {disabled
    ? 'opacity-50 cursor-not-allowed'
    : ''} {className}"
>
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    {disabled}
    onclick={toggle}
    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background {checked
      ? 'bg-primary ring-1 ring-primary/50 shadow-[0_0_15px_var(--color-primary)]/30'
      : 'bg-muted ring-1 ring-primary/50'}"
  >
    <span
      class="pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-300 ease-in-out {checked
        ? 'translate-x-[1.125rem]'
        : 'translate-x-1'}"
    ></span>
  </button>
  {#if label}
    <span class="select-none font-medium leading-none">{label}</span>
  {/if}
</label>
