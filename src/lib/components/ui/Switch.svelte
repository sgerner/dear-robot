<script lang="ts">
  import { Switch as SkeletonSwitch } from '@skeletonlabs/skeleton-svelte';

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
    onchange?: (_checked: boolean) => void;
    class?: string;
  }>();

  function handleCheckedChange(details: { checked: boolean }) {
    checked = details.checked;
    onchange?.(checked);
  }
</script>

<SkeletonSwitch
  {checked}
  {disabled}
  aria-label={label}
  onCheckedChange={handleCheckedChange}
  class={`inline-flex cursor-pointer items-center gap-3 text-xs text-muted-foreground transition-colors hover:text-foreground ${className}`}
>
  <SkeletonSwitch.Control
    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-muted ring-1 ring-primary/50 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_0_15px_var(--color-primary)]/30"
  >
    <SkeletonSwitch.Thumb
      class="pointer-events-none block h-3.5 w-3.5 translate-x-1 rounded-full bg-white shadow-sm transition-transform duration-300 ease-in-out data-[state=checked]:translate-x-[1.125rem]"
    />
  </SkeletonSwitch.Control>
  {#if label}
    <SkeletonSwitch.Label class="select-none font-medium leading-none">{label}</SkeletonSwitch.Label>
  {/if}
  <SkeletonSwitch.HiddenInput />
</SkeletonSwitch>
