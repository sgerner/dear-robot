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

<div class={cn("p-6 pt-0", className)}>
	{#if children}
		{@render children()}
	{/if}
</div>