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

<button
	class={cn("inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm", className)}
	data-value={value}
	data-state="active"
>
	{#if children}
		{@render children()}
	{/if}
</button>