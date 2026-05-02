<script lang="ts">
	import { cn } from "$lib/utils/cn";
	import type { Snippet } from "svelte";

	type Props = {
		variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "glow";
		size?: "default" | "sm" | "lg" | "icon";
		class?: string;
		children?: Snippet;
		onclick?: () => void;
		disabled?: boolean;
		title?: string;
		type?: "button" | "submit" | "reset";
		[key: string]: unknown;
	};

	let { 
		variant = "default", 
		size = "default", 
		class: className = "", 
		children, 
		onclick, 
		disabled,
		title,
		type = "button",
		...restProps 
	}: Props = $props();

	const variantClasses = {
		default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20 border border-primary/50",
		destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-lg shadow-destructive/20 border border-destructive/50",
		outline: "border border-border/60 bg-background/50 backdrop-blur-sm hover:bg-accent hover:text-accent-foreground hover:border-primary/30",
		secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/60",
		ghost: "hover:bg-accent hover:text-accent-foreground",
		link: "text-primary underline-offset-4 hover:underline",
		glow: "btn-cinematic text-primary-foreground"
	};

	const sizeClasses = {
		default: "h-9 px-4 py-2",
		sm: "h-8 rounded-md px-3 text-xs",
		lg: "h-10 rounded-md px-6",
		icon: "h-9 w-9"
	};
</script>

<button
	{type}
	class={cn(
		"inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]",
		variantClasses[variant],
		sizeClasses[size],
		className
	)}
	{onclick}
	{disabled}
	{title}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</button>
