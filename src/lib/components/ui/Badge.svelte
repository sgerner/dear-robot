<script lang="ts">
	import { cn } from "$lib/utils/cn";

	let {
		variant = "default",
		class: className = $bindable(""),
		children
	}: {
		variant?: "default" | "secondary" | "destructive" | "outline";
		class?: string;
		children?: import("svelte").Snippet;
	} = $props();

	const variantClasses = {
		default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
		secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
		destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
		outline: "text-foreground border border-input hover:bg-accent hover:text-accent-foreground"
	};
</script>

<span class={cn(
	"inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
	variantClasses[variant], 
	className
)}>
	{#if children}
		{@render children()}
	{/if}
</span>
