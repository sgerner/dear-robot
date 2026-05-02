<script lang="ts">
	import { cn } from "$lib/utils/cn";

	let {
		class: className = $bindable(""),
		children
	}: {
		class?: string;
		children?: import("svelte").Snippet;
	} = $props();
</script>

<h3 class={cn("text-2xl font-semibold leading-none tracking-tight", className)}>
	{#if children}
		{@render children()}
	{/if}
</h3>