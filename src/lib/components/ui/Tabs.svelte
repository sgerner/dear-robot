<script lang="ts">
	import { cn } from "$lib/utils/cn";

	let {
		value = $bindable(""),
		class: className = $bindable(""),
		children
	}: {
		value?: string;
		class?: string;
		children?: import("svelte").Snippet;
	} = $props();
</script>

<div class={cn("space-y-2", className)} data-value={value}>
	{#if children}
		{@render children()}
	{/if}
</div>