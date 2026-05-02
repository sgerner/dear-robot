<script lang="ts">
	import { cn } from "$lib/utils/cn";

	let {
		class: className = $bindable(""),
		children,
		...restProps
	}: {
		class?: string;
		children?: import("svelte").Snippet;
		[key: string]: unknown;
	} = $props();
</script>

<div class={cn("relative overflow-auto", className)} {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</div>