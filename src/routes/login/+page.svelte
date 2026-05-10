<script lang="ts">
  let { form } = $props();
  let passwordInput: HTMLInputElement | undefined;

  $effect(() => {
    if (typeof window !== 'undefined') passwordInput?.focus();
  });
</script>

<main class="grid min-h-screen place-items-center px-6">
  <form method="POST" class="glass w-full max-w-sm rounded-lg p-6">
    <p class="text-xs uppercase tracking-[0.2em] text-accent">Dear Robot</p>
    <h1 class="mt-3 text-2xl font-semibold text-white">Local access</h1>
    <label class="mt-6 block text-sm text-zinc-300" for="password">Password</label>
    <input
      bind:this={passwordInput}
      id="password"
      name="password"
      type="password"
      class="focus-ring mt-2 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-white"
    />
    {#if form?.message}
      <p class="mt-3 text-sm text-red-300">{form.message}</p>
    {/if}
    <button
      class="inline-flex items-center justify-center whitespace-nowrap font-medium ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] bg-primary/80 text-primary-foreground hover:bg-primary h-8 rounded-md px-3 text-xs"
    >
      Sign in
    </button>
  </form>
</main>
