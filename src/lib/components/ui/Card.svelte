<script lang="ts">
	import { cn } from "$lib/utils/cn";

	let { 
		class: className = $bindable(""), 
		children,
		hover = false,
		glass = true
	}: {
		class?: string;
		children?: import("svelte").Snippet;
		hover?: boolean;
		glass?: boolean;
	} = $props();
</script>

<div class={cn(
	"rounded-xl text-card-foreground overflow-hidden transition-all duration-300",
	glass && "glass-card",
	!glass && "bg-card border border-border/60 shadow-lg",
	hover && "card-hover cursor-pointer",
	className
)}>
	{#if children}
		{@render children()}
	{/if}
</div>
