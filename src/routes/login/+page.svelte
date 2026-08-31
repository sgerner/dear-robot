<script lang="ts">
  import { fade, fly } from 'svelte/transition';

  let { form } = $props();
  let passwordInput: HTMLInputElement | undefined;

  $effect(() => {
    if (typeof window !== 'undefined') passwordInput?.focus();
  });
</script>

<main class="grid min-h-[100dvh] place-items-center px-4 py-8 sm:px-6">
  <form
    method="POST"
    class="glass-card w-full max-w-sm rounded-2xl p-6 sm:p-8"
    aria-describedby={form?.message ? 'login-error' : undefined}
    in:fly={{ y: 16, duration: 280 }}
  >
    <p class="text-xs font-medium uppercase tracking-[0.2em] text-primary">Dear Robot</p>
    <h1 class="mt-3 text-2xl font-semibold tracking-tight text-foreground">Local access</h1>
    <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
      Sign in to your private, local mailbox workspace.
    </p>
    <label class="mt-6 block text-sm font-medium text-foreground" for="password">Password</label>
    <input
      bind:this={passwordInput}
      id="password"
      name="password"
      type="password"
      required
      autocomplete="current-password"
      class="focus-ring mt-2 h-11 w-full rounded-lg border border-input bg-background/70 px-3 text-foreground"
    />
    {#if form?.message}
      <p id="login-error" class="mt-3 text-sm text-destructive" role="alert" aria-live="assertive" transition:fade>
        {form.message}
      </p>
    {/if}
    <button
      type="submit"
      class="mt-5 inline-flex h-11 w-full items-center justify-center whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0"
    >
      Sign in
    </button>
  </form>
</main>
