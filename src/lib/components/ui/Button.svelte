<script lang="ts">
	import type { Snippet } from 'svelte';

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

	/** Skeleton's preset utilities own the color, contrast, and hover states. */
	const variantClasses = {
		default: 'preset-filled-primary-500',
		destructive: 'preset-filled-error-500',
		outline: 'preset-outlined',
		secondary: 'preset-filled-secondary-500',
		ghost: 'preset-tonal',
		link: 'text-primary underline-offset-4 hover:underline',
		glow: 'btn-cinematic preset-filled-primary-500'
	};

	const sizeClasses = {
		default: 'btn-base',
		sm: 'btn-sm',
		lg: 'btn-lg',
		icon: 'btn-icon-base'
	};
</script>

<button
	{type}
	class={`btn ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
	{onclick}
	{disabled}
	{title}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</button>
