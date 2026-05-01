<script lang="ts">
  import { browser, dev } from '$app/environment';
  import { onMount } from 'svelte';
  import '../lib/styles.css';
  let { children } = $props();

  onMount(() => {
    if (!browser || !dev) return;
    void (async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      } catch {
        // Ignore cleanup failures in dev.
      }
      try {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      } catch {
        // Ignore cleanup failures in dev.
      }
    })();
  });
</script>

{@render children()}
