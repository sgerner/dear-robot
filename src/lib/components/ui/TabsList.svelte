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

<div class={cn("inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground", className)}>
	{#if children}
		{@render children()}
	{/if}
</div>