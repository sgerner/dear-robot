<script lang="ts">
	let {
		class: className = $bindable(""),
		children
	}: {
		class?: string;
		children?: import("svelte").Snippet;
	} = $props();
</script>

<div class={`flex flex-col space-y-1.5 p-6 ${className}`}>
	{#if children}
		{@render children()}
	{/if}
</div>
