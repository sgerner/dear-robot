<script lang="ts">
	let {
		class: className = $bindable(""),
		children
	}: {
		class?: string;
		children?: import("svelte").Snippet;
	} = $props();
</script>

<p class={`text-sm text-muted-foreground ${className}`}>
	{#if children}
		{@render children()}
	{/if}
</p>
