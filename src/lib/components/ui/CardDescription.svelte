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

<p class={cn("text-sm text-muted-foreground", className)}>
	{#if children}
		{@render children()}
	{/if}
</p>