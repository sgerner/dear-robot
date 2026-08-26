<script lang="ts">
	import { Tabs as SkeletonTabs } from '@skeletonlabs/skeleton-svelte';

	let {
		class: className = $bindable(""),
		children
	}: {
		class?: string;
		children?: import("svelte").Snippet;
	} = $props();
</script>

<SkeletonTabs.List class={`inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground ${className}`}>
	{#if children}
		{@render children()}
	{/if}
</SkeletonTabs.List>
