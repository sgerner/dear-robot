<script lang="ts">
	import { cn } from "$lib/utils/cn";

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

<div data-value={value} data-state="active" class={cn("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}>
	{#if children}
		{@render children()}
	{/if}
</div>