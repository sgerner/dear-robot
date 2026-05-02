<script lang="ts">
	import { cn } from "$lib/utils/cn";
	import type { Snippet } from "svelte";

	let {
		class: className = $bindable(""),
		content,
	}: {
		class?: string;
		content: Snippet;
	} = $props();
</script>

<div class={cn("relative group", className)}>
	{@render content()}
</div>