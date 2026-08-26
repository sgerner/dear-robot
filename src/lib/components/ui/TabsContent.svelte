<script lang="ts">
	import { Tabs as SkeletonTabs } from '@skeletonlabs/skeleton-svelte';

	let {
		value,
		class: className = $bindable(""),
		children
	}: {
		value: string;
		class?: string;
		children?: import("svelte").Snippet;
	} = $props();
</script>

<SkeletonTabs.Content
	{value}
	class={`mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className}`}
>
	{#if children}
		{@render children()}
	{/if}
</SkeletonTabs.Content>
