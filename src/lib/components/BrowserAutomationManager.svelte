<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  import {
    Check,
    CircleStop,
    Download,
    Globe2,
    KeyRound,
    LoaderCircle,
    Play,
    Plus,
    RefreshCw,
    Save,
    ShieldCheck,
    Trash2,
    Workflow
  } from 'lucide-svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Switch from '$lib/components/ui/Switch.svelte';

  type Profile = {
    id: number;
    name: string;
    startUrl: string;
    allowedHosts: string[];
    enabled: boolean;
    lastUsedAt: string | null;
  };
  type Action = Record<string, unknown> & { type?: string };
  type Recipe = {
    id: number;
    profileId: number;
    name: string;
    description: string | null;
    startUrl: string;
    actions: Action[];
    enabled: boolean;
    lastRunAt: string | null;
  };
  type Run = {
    id: number;
    recipeId: number | null;
    status: string;
    currentActionIndex: number;
    downloadPath: string | null;
    downloadFilename: string | null;
    errorMessage: string | null;
    createdAt: string;
    logs: Array<Record<string, unknown>>;
  };
  type FarinSettings = {
    host: string;
    companyId: string | null;
    enabled: boolean;
    hasApiKey: boolean;
    hasAutomationSecret: boolean;
    updatedAt: string | null;
  };

  let {
    csrfToken = '',
    onStatus = (_value: string) => {}
  }: {
    csrfToken?: string;
    onStatus?: (_value: string) => void;
  } = $props();

  let profiles = $state<Profile[]>([]);
  let recipes = $state<Recipe[]>([]);
  let runs = $state<Run[]>([]);
  let farin = $state<FarinSettings | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let recordingRunId = $state<number | null>(null);
  let expandedRecipeId = $state<number | null>(null);
  let editingActions = $state<Record<number, string>>({});
  let busyRecipeId = $state<number | null>(null);
  let profileForm = $state({ name: '', startUrl: '', allowedHosts: '', enabled: true });
  let recipeForm = $state({ profileId: '', name: '', startUrl: '', description: '' });
  let farinForm = $state({ host: 'https://farin.app', companyId: '', apiKey: '', automationSecret: '', enabled: false });

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
      const [profileResponse, recipeResponse, runResponse, farinResponse] = await Promise.all([
        fetch('/api/browser/profiles'),
        fetch('/api/browser/recipes'),
        fetch('/api/browser/runs?limit=20'),
        fetch('/api/farin/settings')
      ]);
      const [profileBody, recipeBody, runBody, farinBody] = await Promise.all([
        profileResponse.json(),
        recipeResponse.json(),
        runResponse.json(),
        farinResponse.json()
      ]);
      profiles = profileBody.profiles || [];
      recipes = recipeBody.recipes || [];
      runs = runBody.runs || [];
      farin = farinBody.settings || null;
      if (!recipeForm.profileId && profiles[0]) recipeForm.profileId = String(profiles[0].id);
      if (farin) farinForm = { ...farinForm, host: farin.host, companyId: farin.companyId || '', enabled: farin.enabled };
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Could not load browser automations');
    } finally {
      loading = false;
    }
  }

  async function createProfile() {
    if (!profileForm.name.trim() || !profileForm.startUrl.trim() || saving) return;
    saving = true;
    try {
      const result = await request('/api/browser/profiles', {
        method: 'POST',
        body: JSON.stringify({
          name: profileForm.name.trim(),
          startUrl: profileForm.startUrl.trim(),
          allowedHosts: profileForm.allowedHosts,
          enabled: profileForm.enabled
        })
      });
      profiles = [result.profile, ...profiles];
      recipeForm.profileId = String(result.profile.id);
      profileForm = { name: '', startUrl: '', allowedHosts: '', enabled: true };
      onStatus('Browser profile created.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Profile creation failed');
    } finally {
      saving = false;
    }
  }

  async function createRecipe() {
    const profile = profiles.find((item) => String(item.id) === recipeForm.profileId);
    if (!profile || !recipeForm.name.trim() || !recipeForm.startUrl.trim() || saving) return;
    saving = true;
    try {
      const result = await request('/api/browser/recipes', {
        method: 'POST',
        body: JSON.stringify({
          profileId: profile.id,
          name: recipeForm.name.trim(),
          description: recipeForm.description.trim() || null,
          startUrl: recipeForm.startUrl.trim(),
          actions: [],
          enabled: true
        })
      });
      recipes = [result.recipe, ...recipes];
      recipeForm = { ...recipeForm, name: '', description: '' };
      onStatus('Recipe saved. Start recording it to teach the agent.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Recipe creation failed');
    } finally {
      saving = false;
    }
  }

  async function startRecording(recipe: Recipe) {
    if (recordingRunId) return;
    try {
      const result = await request(`/api/browser/recipes/${recipe.id}/record`, {
        method: 'POST',
        body: JSON.stringify({ startUrl: recipe.startUrl })
      });
      recordingRunId = result.run.id;
      onStatus('A browser window is open. Log in, download the report, then stop recording here.');
      pollRun(result.run.id);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Could not open the recording browser');
    }
  }

  async function stopRecording() {
    if (!recordingRunId) return;
    const id = recordingRunId;
    try {
      const result = await request(`/api/browser/runs/${id}/stop`, {
        method: 'POST',
        body: JSON.stringify({ saveRecipe: true })
      });
      recordingRunId = null;
      onStatus(`Recipe recorded with ${result.recipe?.actions?.length || 0} safe actions. Passwords were never saved.`);
      await load();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Could not stop recording');
    }
  }

  async function pollRun(id: number) {
    const poll = async () => {
      try {
        const result = await request(`/api/browser/runs/${id}`);
        runs = [result.run, ...runs.filter((item) => item.id !== id)];
        if (!['recording', 'running'].includes(result.run.status)) {
          if (recordingRunId === id) recordingRunId = null;
          return true;
        }
      } catch {
        return true;
      }
      return false;
    };
    const interval = setInterval(async () => {
      if (await poll()) clearInterval(interval);
    }, 1000);
    await poll();
  }

  async function runRecipe(recipe: Recipe) {
    if (busyRecipeId) return;
    busyRecipeId = recipe.id;
    onStatus(`Running ${recipe.name} in its isolated browser profile…`);
    try {
      const result = await request(`/api/browser/recipes/${recipe.id}/run`, {
        method: 'POST',
        body: JSON.stringify({ headless: true, triggerType: 'manual' })
      });
      runs = [result.run, ...runs.filter((item) => item.id !== result.run.id)];
      onStatus(result.run.downloadFilename ? `Downloaded ${result.run.downloadFilename}. Review before uploading.` : `Recipe ${result.run.status}.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Recipe run failed');
    } finally {
      busyRecipeId = null;
      await load();
    }
  }

  async function uploadRun(run: Run) {
    if (!run.downloadPath || saving) return;
    saving = true;
    try {
      await request('/api/farin/upload', {
        method: 'POST',
        body: JSON.stringify({ filePath: run.downloadPath, filename: run.downloadFilename || undefined })
      });
      onStatus(`${run.downloadFilename || 'Report'} uploaded to Farin.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Farin upload failed');
    } finally {
      saving = false;
    }
  }

  async function saveFarin() {
    if (saving) return;
    saving = true;
    try {
      farin = (await request('/api/farin/settings', {
        method: 'POST',
        body: JSON.stringify({
          host: farinForm.host.trim(),
          companyId: farinForm.companyId.trim() || null,
          apiKey: farinForm.apiKey.trim() || undefined,
          automationSecret: farinForm.automationSecret.trim() || undefined,
          enabled: farinForm.enabled
        })
      })).settings;
      farinForm.apiKey = '';
      farinForm.automationSecret = '';
      onStatus('Farin settings encrypted and saved on the server.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Farin settings could not be saved');
    } finally {
      saving = false;
    }
  }

  async function saveActions(recipe: Recipe) {
    try {
      const parsed = JSON.parse(editingActions[recipe.id] || '[]');
      if (!Array.isArray(parsed)) throw new Error('Actions must be a JSON array');
      const result = await request(`/api/browser/recipes/${recipe.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ actions: parsed })
      });
      recipes = recipes.map((item) => (item.id === recipe.id ? result.recipe : item));
      onStatus('Recipe actions updated.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Recipe actions are invalid');
    }
  }

  async function createWeeklyWorkflow(recipe: Recipe) {
    try {
      const planTemplate = {
        summary: `Download ${recipe.name} and submit the report to Farin after review.`,
        complexity: 'advanced',
        requires_user_approval: true,
        final_reply_draft: null,
        max_turns: 8,
        steps: [
          {
            title: `Download ${recipe.name}`,
            kind: 'browser_recipe',
            details: 'Replay the saved browser recipe and wait for the report download.',
            tool_name: `browser_recipe:${recipe.id}`,
            tool_input: {},
            depends_on: [],
            condition: null,
            output_key: 'report',
            max_attempts: 2,
            retry_delay_ms: 2000,
            approval_reason: 'Review the authenticated browser download before sending it to Farin.',
            requires_approval: true,
            risk_level: 'medium'
          },
          {
            title: 'Upload report to Farin',
            kind: 'farin_upload',
            details: 'Upload the downloaded report to the configured Farin company.',
            tool_name: null,
            tool_input: {
              file_path: '{{outputs.report.downloadPath}}',
              filename: '{{outputs.report.downloadFilename}}'
            },
            depends_on: [1],
            condition: { path: 'steps.1.output.downloadPath', operator: 'exists' },
            output_key: 'farin',
            max_attempts: 2,
            retry_delay_ms: 2000,
            approval_reason: 'Uploading creates an external accounting document in Farin.',
            requires_approval: true,
            risk_level: 'high'
          }
        ]
      };
      await request('/api/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name: `Weekly ${recipe.name}`,
          description: 'Download a delivery report and queue a reviewed Farin upload.',
          enabled: false,
          trigger_type: 'schedule',
          schedule: 'every 7d',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          filters: {},
          plan_template: planTemplate,
          approval_mode: 'always',
          dry_run: true,
          max_runs_per_hour: 4
        })
      });
      onStatus('Weekly workflow created paused in dry-run mode. Review and enable it in Workflows.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Could not create weekly workflow');
    }
  }

  async function deleteRecipe(recipe: Recipe) {
    if (!confirm(`Delete “${recipe.name}” and its recorded actions?`)) return;
    try {
      await request(`/api/browser/recipes/${recipe.id}`, { method: 'DELETE' });
      recipes = recipes.filter((item) => item.id !== recipe.id);
      onStatus('Recipe deleted.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Recipe deletion failed');
    }
  }

  async function toggleRecipe(recipe: Recipe, enabled: boolean) {
    try {
      await request(`/api/browser/recipes/${recipe.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled })
      });
      recipes = recipes.map((item) => (item.id === recipe.id ? { ...item, enabled } : item));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Recipe update failed');
    }
  }

  function latestRun(recipeId: number) {
    return runs.find((run) => run.recipeId === recipeId);
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-5" aria-labelledby="browser-automation-heading">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="max-w-3xl">
      <div class="flex items-center gap-2 text-primary">
        <Globe2 size={17} />
        <p class="text-xs font-semibold uppercase tracking-[0.2em]">Browser automations</p>
      </div>
      <h3 id="browser-automation-heading" class="mt-2 text-xl font-semibold text-foreground">Teach the agent once, replay safely</h3>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">
        Dear Robot opens a separate Chromium profile on this server. Record a login and report download, then let a reviewed workflow repeat the steps. Credentials stay in the profile; password fields and arbitrary scripts are never recorded.
      </p>
    </div>
    <div class="flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-2 text-xs text-primary">
      <ShieldCheck size={14} /> Isolated · allowlisted · approval-gated
    </div>
  </div>

  {#if recordingRunId}
    <div class="rounded-xl border border-primary/40 bg-primary/10 p-4 shadow-[0_0_28px_color-mix(in_srgb,var(--color-primary)_12%,transparent)]" in:fly={{ y: -8, duration: 180 }}>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 rounded-full bg-primary/20 p-2 text-primary"><LoaderCircle size={16} class="animate-spin" /></div>
          <div><p class="font-medium text-foreground">Recording in the browser window</p><p class="mt-1 text-sm text-muted-foreground">Log in, navigate to the report, and download it. Stop when the file is saved.</p></div>
        </div>
        <Button variant="destructive" size="sm" onclick={stopRecording}><CircleStop size={14} /> Stop & save recipe</Button>
      </div>
    </div>
  {/if}

  <div class="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
    <Card class="p-4" glass={false}>
      <div class="flex items-center gap-2"><Plus size={16} class="text-primary" /><h4 class="font-medium text-foreground">1. Add a browser profile</h4></div>
      <p class="mt-1 text-xs leading-5 text-muted-foreground">A profile is a dedicated cookie jar. Use one per delivery provider or tenant.</p>
      <div class="mt-4 space-y-3">
        <label class="block text-sm text-foreground">Profile name<input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" bind:value={profileForm.name} placeholder="DoorDash reports" /></label>
        <label class="block text-sm text-foreground">Dashboard URL<input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" bind:value={profileForm.startUrl} placeholder="https://merchant.doordash.com" /></label>
        <label class="block text-sm text-foreground">Additional allowed hosts <span class="text-xs text-muted-foreground">(comma separated)</span><input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" bind:value={profileForm.allowedHosts} placeholder="identity.doordash.com" /></label>
        <div class="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2.5"><Switch bind:checked={profileForm.enabled} label="Profile enabled" /><span class="text-[11px] text-muted-foreground">HTTPS only</span></div>
        <Button class="w-full" size="sm" onclick={createProfile} disabled={saving || !profileForm.name.trim() || !profileForm.startUrl.trim()}><Plus size={14} /> Create profile</Button>
      </div>
    </Card>

    <Card class="p-4" glass={false}>
      <div class="flex items-center gap-2"><Workflow size={16} class="text-primary" /><h4 class="font-medium text-foreground">2. Capture a recipe</h4></div>
      <p class="mt-1 text-xs leading-5 text-muted-foreground">Create the shell, then record the real steps in a headed browser. A saved session means you usually log in only once.</p>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <label class="text-sm text-foreground">Profile<select class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" bind:value={recipeForm.profileId}><option value="">Choose profile…</option>{#each profiles as profile (profile.id)}<option value={profile.id}>{profile.name}</option>{/each}</select></label>
        <label class="text-sm text-foreground">Recipe name<input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" bind:value={recipeForm.name} placeholder="Download weekly payout CSV" /></label>
        <label class="text-sm text-foreground sm:col-span-2">Start URL<input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" bind:value={recipeForm.startUrl} placeholder="https://merchant.doordash.com/reports" /></label>
        <label class="text-sm text-foreground sm:col-span-2">Description<textarea class="mt-1 min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" bind:value={recipeForm.description} placeholder="Sign in, open payouts, choose the latest week, download CSV"></textarea></label>
      </div>
      <div class="mt-4 flex flex-wrap justify-end gap-2"><Button variant="outline" size="sm" onclick={createRecipe} disabled={saving || !recipeForm.profileId || !recipeForm.name.trim() || !recipeForm.startUrl.trim()}><Save size={14} /> Save recipe shell</Button></div>
    </Card>
  </div>

  <Card class="p-4" glass={false}>
    <div class="flex flex-wrap items-start justify-between gap-3"><div><div class="flex items-center gap-2"><KeyRound size={16} class="text-primary" /><h4 class="font-medium text-foreground">Farin destination</h4></div><p class="mt-1 text-xs leading-5 text-muted-foreground">The API key is encrypted server-side and never returned to the browser. Tenant CLI has no multipart file command, so uploads use Farin’s authenticated upload endpoint with the same tenant credentials.</p></div>{#if farin?.hasApiKey || farin?.hasAutomationSecret}<span class="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] text-primary"><Check size={12} class="mr-1 inline" /> Connected</span>{/if}</div>
    <div class="mt-4 grid gap-3 md:grid-cols-2">
      <label class="text-sm text-foreground">Farin host<input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" bind:value={farinForm.host} placeholder="https://farin.app" /></label>
      <label class="text-sm text-foreground">Company ID<input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" bind:value={farinForm.companyId} placeholder="company UUID" /></label>
      <label class="text-sm text-foreground">Tenant API key<input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" type="password" bind:value={farinForm.apiKey} placeholder={farin?.hasApiKey ? 'Saved · leave blank to keep' : 'wz_…'} autocomplete="new-password" /></label>
      <label class="text-sm text-foreground">Automation secret <span class="text-xs text-muted-foreground">(optional)</span><input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" type="password" bind:value={farinForm.automationSecret} placeholder={farin?.hasAutomationSecret ? 'Saved · leave blank to keep' : 'x-accounting-automation-secret'} autocomplete="new-password" /></label>
    </div>
    <div class="mt-4 flex flex-wrap items-center justify-between gap-3"><Switch bind:checked={farinForm.enabled} label="Enable Farin uploads" /><Button variant="outline" size="sm" onclick={saveFarin} disabled={saving}><Save size={14} /> Save encrypted settings</Button></div>
  </Card>

  <div class="space-y-3" aria-live="polite">
    <div class="flex items-center justify-between gap-3"><div><h4 class="font-medium text-foreground">Saved recipes</h4><p class="mt-1 text-xs text-muted-foreground">Run downloads manually first. Uploads always remain an explicit action or approved workflow step.</p></div><Button variant="ghost" size="sm" onclick={() => load()} disabled={loading}><RefreshCw size={14} class={loading ? 'animate-spin' : ''} /> Refresh</Button></div>
    {#if loading}<div class="grid gap-3 md:grid-cols-2"><div class="h-28 animate-pulse rounded-xl border border-border bg-muted/20"></div><div class="h-28 animate-pulse rounded-xl border border-border bg-muted/20"></div></div>
    {:else if recipes.length === 0}<div class="rounded-xl border border-dashed border-border bg-muted/10 px-4 py-8 text-center" in:fade><Globe2 size={22} class="mx-auto text-muted-foreground" /><p class="mt-2 text-sm text-foreground">No browser recipes yet.</p><p class="mt-1 text-xs text-muted-foreground">Add a profile and recipe shell above to get started.</p></div>
    {:else}<div class="grid gap-3 lg:grid-cols-2">{#each recipes as recipe (recipe.id)}
      {@const latest = latestRun(recipe.id)}
      <Card class="p-4" glass={false}>
        <div class="flex items-start justify-between gap-3"><div class="min-w-0"><div class="flex items-center gap-2"><span class="rounded-lg bg-primary/10 p-2 text-primary"><Globe2 size={15} /></span><div class="min-w-0"><h5 class="truncate font-medium text-foreground">{recipe.name}</h5><p class="truncate text-xs text-muted-foreground">{recipe.startUrl}</p></div></div></div><Switch checked={recipe.enabled} label={`${recipe.name} enabled`} onchange={(checked) => toggleRecipe(recipe, checked)} /></div>
        <p class="mt-3 line-clamp-2 text-sm leading-5 text-muted-foreground">{recipe.description || 'Recorded browser workflow'}</p>
        <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span class="rounded-full border border-border px-2 py-1">{recipe.actions.length} actions</span>{#if latest}<span class={`rounded-full border px-2 py-1 ${latest.status === 'completed' ? 'border-primary/30 text-primary' : latest.status === 'failed' ? 'border-destructive/30 text-destructive' : 'border-border'}`}>{latest.status}</span>{/if}{#if latest?.downloadFilename}<span class="flex max-w-full items-center gap-1 truncate"><Download size={12} /> {latest.downloadFilename}</span>{/if}</div>
        <div class="mt-4 flex flex-wrap gap-2"><Button size="sm" onclick={() => startRecording(recipe)} disabled={Boolean(recordingRunId)}><CircleStop size={14} /> Record</Button><Button variant="outline" size="sm" onclick={() => runRecipe(recipe)} disabled={busyRecipeId === recipe.id || Boolean(recordingRunId)}>{#if busyRecipeId === recipe.id}<LoaderCircle size={14} class="animate-spin" /> Running{:else}<Play size={14} /> Run download{/if}</Button>{#if latest?.downloadPath}<Button variant="secondary" size="sm" onclick={() => uploadRun(latest)} disabled={saving}><Download size={14} /> Upload to Farin</Button>{/if}<Button variant="ghost" size="sm" onclick={() => { expandedRecipeId = expandedRecipeId === recipe.id ? null : recipe.id; editingActions[recipe.id] = JSON.stringify(recipe.actions, null, 2); }}><Workflow size={14} /> Inspect</Button></div>
        {#if expandedRecipeId === recipe.id}<div class="mt-4 space-y-3 border-t border-border pt-4" transition:slide={{ duration: 160 }}><label class="block text-xs font-medium uppercase tracking-wider text-muted-foreground">Safe action recipe<textarea class="mt-2 min-h-44 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" bind:value={editingActions[recipe.id]}></textarea></label><div class="flex flex-wrap justify-between gap-2"><Button variant="destructive" size="sm" onclick={() => deleteRecipe(recipe)}><Trash2 size={13} /> Delete</Button><div class="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onclick={() => createWeeklyWorkflow(recipe)}><Workflow size={13} /> Create weekly workflow</Button><Button variant="outline" size="sm" onclick={() => saveActions(recipe)}><Save size={13} /> Save actions</Button></div></div></div>{/if}
      </Card>
    {/each}</div>{/if}
  </div>
</section>
