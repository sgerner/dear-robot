<script lang="ts">
	let {
		class: className = $bindable(''),
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

<div class={`card overflow-hidden text-card-foreground transition-all duration-200 ${glass ? 'bg-card/80 backdrop-blur-xl' : 'bg-card'} border border-border shadow-sm ${hover ? 'cursor-pointer hover:shadow-md' : ''} ${className}`}>
	{#if children}
		{@render children()}
	{/if}
</div>
