<script lang="ts">
	import { Tooltip as SkeletonTooltip } from '@skeletonlabs/skeleton-svelte';
	import type { Snippet } from "svelte";

	let {
		class: className = $bindable(""),
		content,
		children,
	}: {
		class?: string;
		content: Snippet;
		children?: Snippet;
	} = $props();
</script>

<SkeletonTooltip>
	<SkeletonTooltip.Trigger class={`relative group ${className}`}>
		{#if children}{@render children()}{/if}
	</SkeletonTooltip.Trigger>
	<SkeletonTooltip.Content class="preset-filled-surface-950-50 rounded-base px-2 py-1 text-xs">
		{@render content()}
	</SkeletonTooltip.Content>
</SkeletonTooltip>
