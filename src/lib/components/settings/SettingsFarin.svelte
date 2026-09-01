<script lang="ts">
  import { onMount } from 'svelte';
  import { Check, KeyRound, Save } from 'lucide-svelte';
  import { fade } from 'svelte/transition';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Switch from '$lib/components/ui/Switch.svelte';

  type FarinSettings = {
    host: string;
    companyId: string | null;
    enabled: boolean;
    hasApiKey: boolean;
    hasAutomationSecret: boolean;
  };

  let {
    csrfToken = '',
    onStatus = (_value: string) => {}
  }: {
    csrfToken?: string;
    onStatus?: (_value: string) => void;
  } = $props();

  let settings = $state<FarinSettings | null>(null);
  let form = $state({
    host: 'https://farin.app',
    companyId: '',
    apiKey: '',
    automationSecret: '',
    enabled: false
  });
  let loading = $state(true);
  let saving = $state(false);

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        ...(init.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
    return body;
  }

  async function load() {
    loading = true;
    try {
      settings = (await request('/api/farin/settings')).settings;
      if (settings) {
        form.host = settings.host;
        form.companyId = settings.companyId || '';
        form.enabled = settings.enabled;
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Could not load Farin settings');
    } finally {
      loading = false;
    }
  }

  async function save() {
    if (saving) return;
    saving = true;
    try {
      settings = (await request('/api/farin/settings', {
        method: 'POST',
        body: JSON.stringify({
          host: form.host.trim(),
          companyId: form.companyId.trim() || null,
          apiKey: form.apiKey.trim() || undefined,
          automationSecret: form.automationSecret.trim() || undefined,
          enabled: form.enabled
        })
      })).settings;
      form.apiKey = '';
      form.automationSecret = '';
      onStatus('Farin settings encrypted and saved on the server.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Farin settings could not be saved');
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<div in:fade={{ duration: 180 }}>
<Card class="p-5" glass={false}>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div class="flex items-center gap-2">
        <KeyRound size={16} class="text-primary" />
        <h3 class="font-medium text-foreground">Farin destination</h3>
      </div>
      <p class="mt-1 text-sm leading-6 text-muted-foreground">
        Optional server connection for reviewed report uploads. Browser automations are started from
        an email; this is only the destination they can upload to.
      </p>
    </div>
    {#if settings?.hasApiKey || settings?.hasAutomationSecret}
      <span class="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] text-primary">
        <Check size={12} class="mr-1 inline" /> Connected
      </span>
    {/if}
  </div>

  {#if loading}
    <div class="mt-4 h-24 animate-pulse rounded-lg border border-border bg-muted/20" aria-label="Loading Farin settings"></div>
  {:else}
    <div class="mt-4 grid gap-3 md:grid-cols-2">
      <label class="text-sm text-foreground">
        Farin host
        <input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" bind:value={form.host} placeholder="https://farin.app" />
      </label>
      <label class="text-sm text-foreground">
        Company ID
        <input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" bind:value={form.companyId} placeholder="company UUID" />
      </label>
      <label class="text-sm text-foreground">
        Tenant API key
        <input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" type="password" bind:value={form.apiKey} placeholder={settings?.hasApiKey ? 'Saved · leave blank to keep' : 'wz_…'} autocomplete="new-password" />
      </label>
      <label class="text-sm text-foreground">
        Automation secret <span class="text-xs text-muted-foreground">(optional)</span>
        <input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" type="password" bind:value={form.automationSecret} placeholder={settings?.hasAutomationSecret ? 'Saved · leave blank to keep' : 'x-accounting-automation-secret'} autocomplete="new-password" />
      </label>
    </div>
    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <Switch bind:checked={form.enabled} label="Enable Farin uploads" />
      <Button variant="outline" size="sm" onclick={save} disabled={saving}>
        <Save size={14} /> {saving ? 'Saving…' : 'Save encrypted settings'}
      </Button>
    </div>
  {/if}
</Card>
</div>
