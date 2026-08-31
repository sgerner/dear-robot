<script lang="ts">
  import { browser, dev } from '$app/environment';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { themeStore } from '$lib/client/theme';
  import '../lib/styles.css';
  let { children } = $props();
  let serverReachable = true;
  let offlineProbeAbort: AbortController | null = null;
  let offlineProbeTimer: ReturnType<typeof setInterval> | null = null;
  let isOffline = $state(false);

  async function checkServerReachability() {
    if (!browser) return;
    if (!navigator.onLine) {
      serverReachable = false;
      isOffline = true;
      return;
    }
    offlineProbeAbort?.abort();
    const aborter = new AbortController();
    offlineProbeAbort = aborter;
    const timeout = setTimeout(() => aborter.abort(), 4000);
    try {
      const response = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: aborter.signal
      });
      serverReachable = response.ok;
    } catch {
      serverReachable = false;
    } finally {
      clearTimeout(timeout);
      if (offlineProbeAbort === aborter) offlineProbeAbort = null;
      isOffline = !serverReachable;
    }
  }

  function handleOffline() {
    serverReachable = false;
    isOffline = true;
  }

  function handleOnline() {
    void checkServerReachability();
  }

  onMount(() => {
    themeStore.init();
    if (!browser) return;

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleOnline);
    void checkServerReachability();
    offlineProbeTimer = setInterval(() => {
      void checkServerReachability();
    }, 30000);

    if (dev) {
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
    }

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleOnline);
      if (offlineProbeTimer) clearInterval(offlineProbeTimer);
      offlineProbeAbort?.abort();
    };
  });
</script>

{#if isOffline}
  <div
    class="pointer-events-none fixed right-4 top-4 z-50 flex items-center gap-2 rounded-full border border-zinc-700/70 bg-zinc-900/90 px-3 py-1 text-xs text-zinc-300 shadow-md backdrop-blur-sm transition-all"
    role="status"
    aria-live="polite"
    in:fade={{ duration: 180 }}
    out:fade={{ duration: 120 }}
  >
    <span class="size-2 rounded-full bg-amber-400"></span>
    <span>Offline mode</span>
  </div>
{/if}

{@render children()}
