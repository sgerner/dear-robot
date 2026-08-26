<script lang="ts">
	let {
		class: className = $bindable(""),
		children
	}: {
		class?: string;
		children?: import("svelte").Snippet;
	} = $props();
</script>

<div class={`p-6 pt-0 ${className}`}>
	{#if children}
		{@render children()}
	{/if}
</div>
