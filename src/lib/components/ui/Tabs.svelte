<script lang="ts">
	import { Tabs as SkeletonTabs } from '@skeletonlabs/skeleton-svelte';

	let {
		value = $bindable(''),
		class: className = $bindable(''),
		children
	}: {
		value?: string;
		class?: string;
		children?: import("svelte").Snippet;
	} = $props();
</script>

<SkeletonTabs
	value={value}
	onValueChange={(details: { value: string }) => (value = details.value)}
	class={`space-y-2 ${className}`}
>
	{#if children}
		{@render children()}
	{/if}
</SkeletonTabs>
