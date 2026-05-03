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
	"rounded-md text-card-foreground overflow-hidden transition-all duration-200",
	glass && "bg-card border border-border shadow-sm",
	!glass && "bg-card border border-border shadow-sm",
	hover && "hover:shadow-md cursor-pointer",
	className
)}>
	{#if children}
		{@render children()}
	{/if}
</div>
