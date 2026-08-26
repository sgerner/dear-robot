<script lang="ts">

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
		default: 'preset-filled-primary-500',
		secondary: 'preset-filled-secondary-500',
		destructive: 'preset-filled-error-500',
		outline: 'preset-outlined'
	};
</script>

<span class={`badge ${variantClasses[variant]} ${className}`}>
	{#if children}
		{@render children()}
	{/if}
</span>
