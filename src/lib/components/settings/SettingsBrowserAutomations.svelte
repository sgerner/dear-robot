<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  import {
    ChevronDown,
    ChevronUp,
    Globe2,
    KeyRound,
    LoaderCircle,
    Play,
    RefreshCw,
    Save,
    ShieldCheck,
    Trash2,
    X
  } from 'lucide-svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Switch from '$lib/components/ui/Switch.svelte';

  type Profile = {
    id: number;
    name: string;
    startUrl: string;
    allowedHosts: string[];
    enabled: boolean;
    hasUsername: boolean;
    hasPassword: boolean;
    lastUsedAt: string | null;
    updatedAt: string;
  };

  type Action = Record<string, unknown> & { type?: string };

  type Recipe = {
    id: number;
    profileId: number;
    sourceMessageId: number | null;
    name: string;
    description: string | null;
    startUrl: string;
    actions: Action[];
    enabled: boolean;
    lastRunAt: string | null;
    updatedAt: string;
  };

  type RunLog = Record<string, unknown> & { at?: string; event?: string };

  type Run = {
    id: number;
    recipeId: number | null;
    profileId: number | null;
    status: string;
    triggerType: string;
    currentActionIndex: number;
    downloadPath: string | null;
    downloadFilename: string | null;
    errorMessage: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    logs: RunLog[];
  };

  type ProfileDraft = {
    name: string;
    startUrl: string;
    allowedHosts: string;
    username: string;
    password: string;
    clearUsername: boolean;
    clearPassword: boolean;
    enabled: boolean;
  };

  type RecipeDraft = {
    profileId: string;
    name: string;
    description: string;
    startUrl: string;
    actionsJson: string;
    enabled: boolean;
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
  let loading = $state(true);
  let loadError = $state('');
  let editingProfileId = $state<number | null>(null);
  let profileDraft = $state<ProfileDraft | null>(null);
  let editingRecipeId = $state<number | null>(null);
  let recipeDraft = $state<RecipeDraft | null>(null);
  let expandedRunId = $state<number | null>(null);
  let savingProfileId = $state<number | null>(null);
  let savingRecipeId = $state<number | null>(null);
  let deletingProfileId = $state<number | null>(null);
  let deletingRecipeId = $state<number | null>(null);
  let runningRecipeId = $state<number | null>(null);
  let runPollTimer: ReturnType<typeof setInterval> | null = null;

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
    if (!response.ok) {
      throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
    }
    return body;
  }

  async function load() {
    loading = true;
    loadError = '';
    try {
      const [profileBody, recipeBody, runBody] = await Promise.all([
        request('/api/browser/profiles'),
        request('/api/browser/recipes'),
        request('/api/browser/runs?limit=30')
      ]);
      profiles = profileBody.profiles || [];
      recipes = recipeBody.recipes || [];
      runs = runBody.runs || [];
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Could not load browser automations';
      onStatus(loadError);
    } finally {
      loading = false;
    }
  }

  function profileFor(profileId: number | null) {
    return profiles.find((profile) => profile.id === profileId) || null;
  }

  function recipeFor(recipeId: number | null) {
    return recipes.find((recipe) => recipe.id === recipeId) || null;
  }

  function profileRecipeCount(profileId: number) {
    return recipes.filter((recipe) => recipe.profileId === profileId).length;
  }

  function formatDate(value: string | null | undefined) {
    if (!value) return 'Never';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function statusClasses(status: string) {
    if (status === 'completed') return 'border-primary/30 bg-primary/10 text-primary';
    if (status === 'failed' || status === 'needs_attention') {
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    }
    if (status === 'cancelled') return 'border-amber-400/30 bg-amber-400/10 text-amber-200';
    return 'border-border bg-muted/20 text-muted-foreground';
  }

  function startProfileEdit(profile: Profile) {
    editingProfileId = profile.id;
    profileDraft = {
      name: profile.name,
      startUrl: profile.startUrl,
      allowedHosts: profile.allowedHosts.join(', '),
      username: '',
      password: '',
      clearUsername: false,
      clearPassword: false,
      enabled: profile.enabled
    };
  }

  function cancelProfileEdit() {
    editingProfileId = null;
    profileDraft = null;
  }

  function updateProfileDraft<K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]) {
    if (!profileDraft) return;
    profileDraft = { ...profileDraft, [field]: value };
  }

  function clearProfileCredential(field: 'username' | 'password') {
    if (!profileDraft) return;
    const clearField = field === 'username' ? 'clearUsername' : 'clearPassword';
    profileDraft = { ...profileDraft, [field]: '', [clearField]: !profileDraft[clearField] };
  }

  function updateProfileCredential(field: 'username' | 'password', value: string) {
    if (!profileDraft) return;
    const clearField = field === 'username' ? 'clearUsername' : 'clearPassword';
    profileDraft = { ...profileDraft, [field]: value, [clearField]: false };
  }

  async function saveProfile(profile: Profile) {
    if (!profileDraft || savingProfileId) return;
    if (!profileDraft.name.trim() || !profileDraft.startUrl.trim()) {
      onStatus('A profile name and start URL are required.');
      return;
    }
    savingProfileId = profile.id;
    try {
      const input: Record<string, unknown> = {
        name: profileDraft.name.trim(),
        startUrl: profileDraft.startUrl.trim(),
        allowedHosts: profileDraft.allowedHosts
          .split(',')
          .map((host) => host.trim())
          .filter(Boolean),
        enabled: profileDraft.enabled
      };
      if (profileDraft.clearUsername) input.username = '';
      else if (profileDraft.username.trim()) input.username = profileDraft.username.trim();
      if (profileDraft.clearPassword) input.password = '';
      else if (profileDraft.password) input.password = profileDraft.password;

      const result = await request(`/api/browser/profiles/${profile.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input)
      });
      profiles = profiles.map((item) => (item.id === profile.id ? result.profile : item));
      cancelProfileEdit();
      onStatus('Browser profile updated. Credentials remain encrypted on the server.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Browser profile update failed');
    } finally {
      savingProfileId = null;
    }
  }

  async function toggleProfile(profile: Profile, enabled: boolean) {
    if (savingProfileId) return;
    savingProfileId = profile.id;
    try {
      const result = await request(`/api/browser/profiles/${profile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled })
      });
      profiles = profiles.map((item) => (item.id === profile.id ? result.profile : item));
      if (profileDraft && editingProfileId === profile.id) {
        profileDraft = { ...profileDraft, enabled };
      }
      onStatus(`Browser profile ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Browser profile update failed');
    } finally {
      savingProfileId = null;
    }
  }

  async function deleteProfile(profile: Profile) {
    if (!confirm(`Delete “${profile.name}” and its saved recipes?`)) return;
    deletingProfileId = profile.id;
    try {
      await request(`/api/browser/profiles/${profile.id}`, { method: 'DELETE' });
      profiles = profiles.filter((item) => item.id !== profile.id);
      recipes = recipes.filter((recipe) => recipe.profileId !== profile.id);
      if (editingProfileId === profile.id) cancelProfileEdit();
      onStatus('Browser profile and its recipes deleted.');
      await load();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Browser profile deletion failed');
    } finally {
      deletingProfileId = null;
    }
  }

  function startRecipeEdit(recipe: Recipe) {
    editingRecipeId = recipe.id;
    recipeDraft = {
      profileId: String(recipe.profileId),
      name: recipe.name,
      description: recipe.description || '',
      startUrl: recipe.startUrl,
      actionsJson: JSON.stringify(recipe.actions, null, 2),
      enabled: recipe.enabled
    };
  }

  function cancelRecipeEdit() {
    editingRecipeId = null;
    recipeDraft = null;
  }

  function updateRecipeDraft<K extends keyof RecipeDraft>(field: K, value: RecipeDraft[K]) {
    if (!recipeDraft) return;
    recipeDraft = { ...recipeDraft, [field]: value };
  }

  async function saveRecipe(recipe: Recipe) {
    if (!recipeDraft || savingRecipeId) return;
    let actions: unknown;
    try {
      actions = JSON.parse(recipeDraft.actionsJson || '[]');
    } catch {
      onStatus('Recipe actions must be valid JSON.');
      return;
    }
    if (!Array.isArray(actions)) {
      onStatus('Recipe actions must be a JSON array.');
      return;
    }
    const profileId = Number(recipeDraft.profileId);
    if (!profiles.some((profile) => profile.id === profileId)) {
      onStatus('Choose a valid browser profile for this recipe.');
      return;
    }
    if (!recipeDraft.name.trim() || !recipeDraft.startUrl.trim()) {
      onStatus('A recipe name and start URL are required.');
      return;
    }
    savingRecipeId = recipe.id;
    try {
      const result = await request(`/api/browser/recipes/${recipe.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          profileId,
          name: recipeDraft.name.trim(),
          description: recipeDraft.description.trim() || null,
          startUrl: recipeDraft.startUrl.trim(),
          actions,
          enabled: recipeDraft.enabled
        })
      });
      recipes = recipes.map((item) => (item.id === recipe.id ? result.recipe : item));
      cancelRecipeEdit();
      onStatus('Browser recipe details updated.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Browser recipe update failed');
    } finally {
      savingRecipeId = null;
    }
  }

  async function toggleRecipe(recipe: Recipe, enabled: boolean) {
    if (savingRecipeId) return;
    savingRecipeId = recipe.id;
    try {
      const result = await request(`/api/browser/recipes/${recipe.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled })
      });
      recipes = recipes.map((item) => (item.id === recipe.id ? result.recipe : item));
      if (recipeDraft && editingRecipeId === recipe.id) {
        recipeDraft = { ...recipeDraft, enabled };
      }
      onStatus(`Browser recipe ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Browser recipe update failed');
    } finally {
      savingRecipeId = null;
    }
  }

  async function deleteRecipe(recipe: Recipe) {
    if (!confirm(`Delete “${recipe.name}” and its recorded actions?`)) return;
    deletingRecipeId = recipe.id;
    try {
      await request(`/api/browser/recipes/${recipe.id}`, { method: 'DELETE' });
      recipes = recipes.filter((item) => item.id !== recipe.id);
      runs = runs.filter((run) => run.recipeId !== recipe.id);
      if (editingRecipeId === recipe.id) cancelRecipeEdit();
      onStatus('Browser recipe deleted.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Browser recipe deletion failed');
    } finally {
      deletingRecipeId = null;
    }
  }

  function updateRun(run: Run) {
    runs = [run, ...runs.filter((item) => item.id !== run.id)].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
  }

  function stopRunPolling() {
    if (runPollTimer) clearInterval(runPollTimer);
    runPollTimer = null;
  }

  async function pollRun(id: number) {
    stopRunPolling();
    const poll = async () => {
      try {
        const result = await request(`/api/browser/runs/${id}`);
        updateRun(result.run);
        if (!['recording', 'running'].includes(result.run.status)) {
          stopRunPolling();
          runningRecipeId = null;
          await load();
        }
      } catch {
        // Keep the last known run visible if a poll is temporarily unavailable.
      }
    };
    await poll();
    const currentRun = runs.find((run) => run.id === id);
    if (currentRun && ['recording', 'running'].includes(currentRun.status)) {
      runPollTimer = setInterval(() => void poll(), 1200);
    }
  }

  async function runRecipe(recipe: Recipe) {
    if (runningRecipeId || !recipe.enabled) return;
    runningRecipeId = recipe.id;
    try {
      const result = await request(`/api/browser/recipes/${recipe.id}/run`, {
        method: 'POST',
        body: JSON.stringify({ headless: true, triggerType: 'manual' })
      });
      updateRun(result.run);
      expandedRunId = result.run.id;
      onStatus(`Running ${recipe.name} in its isolated browser profile.`);
      void pollRun(result.run.id);
    } catch (error) {
      runningRecipeId = null;
      onStatus(error instanceof Error ? error.message : 'Browser recipe run failed');
    }
  }

  function runLogDetail(log: RunLog) {
    const detail = Object.entries(log)
      .filter(([key]) => key !== 'at' && key !== 'event')
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' · ');
    return [log.event || 'event', detail].filter(Boolean).join(' · ');
  }

  onMount(() => {
    void load();
  });

  onDestroy(() => {
    stopRunPolling();
  });
</script>

<section class="space-y-4" aria-labelledby="browser-automation-settings-heading" in:fade={{ duration: 180 }}>
  <div class="flex flex-wrap items-start justify-between gap-3" in:fly={{ y: 8, duration: 180 }}>
    <div class="max-w-3xl">
      <div class="flex items-center gap-2 text-primary">
        <Globe2 size={17} />
        <p class="text-xs font-semibold uppercase tracking-[0.2em]">Browser automations</p>
      </div>
      <h3 id="browser-automation-settings-heading" class="mt-2 text-xl font-semibold text-foreground">
        Manage saved report automations
      </h3>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">
        The inbox launcher is still the guided way to create a report automation. Use this compact
        view to maintain saved profiles, safe recipes, and recent runs.
      </p>
    </div>
    <div class="flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-2 text-xs text-primary">
      <ShieldCheck size={14} /> Encrypted · allowlisted
    </div>
  </div>

  {#if loadError}
    <div class="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
      <span>{loadError}</span>
      <Button variant="ghost" size="sm" onclick={() => void load()}>Retry</Button>
    </div>
  {/if}

  {#if loading}
    <div class="space-y-3" aria-live="polite">
      <div class="h-40 animate-pulse rounded-lg border border-border bg-muted/20"></div>
      <div class="h-48 animate-pulse rounded-lg border border-border bg-muted/20"></div>
    </div>
  {:else}
    <section class="surface-section rounded-lg p-4" aria-labelledby="saved-browser-profiles-heading" in:fly={{ y: 8, duration: 180, delay: 25 }}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <KeyRound size={16} class="text-primary" />
            <h4 id="saved-browser-profiles-heading" class="font-medium text-foreground">Saved browser profiles</h4>
            <span class="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{profiles.length}</span>
          </div>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">
            Cookie jars and encrypted credentials used by the saved recipes. Blank credential fields
            leave the current secret unchanged.
          </p>
        </div>
        <Button variant="ghost" size="sm" onclick={() => void load()} disabled={loading} title="Refresh browser profiles and runs">
          <RefreshCw size={14} class={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      {#if profiles.length === 0}
        <div class="mt-4 rounded-lg border border-dashed border-border bg-muted/10 px-4 py-7 text-center">
          <Globe2 size={21} class="mx-auto text-muted-foreground" />
          <p class="mt-2 text-sm text-foreground">No saved browser profiles.</p>
          <p class="mt-1 text-xs text-muted-foreground">Start from an email and choose “Automate this report”.</p>
        </div>
      {:else}
        <div class="mt-4 divide-y divide-border/60 rounded-lg border border-border/70 bg-background/20">
          {#each profiles as profile (profile.id)}
            <article class="p-3 first:rounded-t-lg last:rounded-b-lg hover:bg-muted/[0.04] transition-colors">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex min-w-0 items-start gap-3">
                  <div class="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary"><Globe2 size={15} /></div>
                  <div class="min-w-0">
                    <h5 class="truncate text-sm font-medium text-foreground">{profile.name}</h5>
                    <p class="truncate text-xs text-muted-foreground">{profile.startUrl}</p>
                    <p class="mt-1 text-[11px] text-muted-foreground">
                      {profileRecipeCount(profile.id)} {profileRecipeCount(profile.id) === 1 ? 'recipe' : 'recipes'}
                      · {profile.allowedHosts.length} allowed {profile.allowedHosts.length === 1 ? 'host' : 'hosts'}
                      {#if profile.hasUsername || profile.hasPassword}
                        · <span class="text-primary">saved credentials</span>
                      {/if}
                    </p>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <Switch checked={profile.enabled} label={`${profile.name} enabled`} onchange={(checked) => void toggleProfile(profile, checked)} />
                  <Button variant="outline" size="sm" onclick={() => (editingProfileId === profile.id ? cancelProfileEdit() : startProfileEdit(profile))} aria-expanded={editingProfileId === profile.id}>
                    {#if editingProfileId === profile.id}<X size={13} /> Close{:else}<KeyRound size={13} /> Edit profile{/if}
                  </Button>
                  <Button variant="destructive" size="sm" onclick={() => void deleteProfile(profile)} disabled={deletingProfileId === profile.id} aria-label={`Delete ${profile.name}`}>
                    {#if deletingProfileId === profile.id}<LoaderCircle size={13} class="animate-spin" />{:else}<Trash2 size={13} />{/if}
                  </Button>
                </div>
              </div>

              {#if editingProfileId === profile.id && profileDraft}
                <div class="mt-4 border-t border-border/60 pt-4" transition:slide={{ duration: 150 }}>
                  <div class="grid gap-3 md:grid-cols-2">
                    <label class="text-xs font-medium text-muted-foreground">Profile name
                      <input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" value={profileDraft.name} oninput={(event) => updateProfileDraft('name', (event.currentTarget as HTMLInputElement).value)} />
                    </label>
                    <label class="text-xs font-medium text-muted-foreground">Start URL
                      <input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" type="url" value={profileDraft.startUrl} oninput={(event) => updateProfileDraft('startUrl', (event.currentTarget as HTMLInputElement).value)} />
                    </label>
                    <label class="text-xs font-medium text-muted-foreground md:col-span-2">Allowed hosts <span class="font-normal">(comma-separated; the start host is always included)</span>
                      <input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" value={profileDraft.allowedHosts} oninput={(event) => updateProfileDraft('allowedHosts', (event.currentTarget as HTMLInputElement).value)} placeholder="dashboard.example.com, login.example.com" />
                    </label>
                  </div>

                  <div class="mt-4 rounded-lg border border-border bg-muted/[0.06] p-3">
                    <div class="flex items-center gap-2"><KeyRound size={14} class="text-primary" /><p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Encrypted credentials</p></div>
                    <p class="mt-1 text-[11px] leading-5 text-muted-foreground">Saved values are never returned to the browser. Enter a replacement, or clear one explicitly.</p>
                    <div class="mt-3 grid gap-2 md:grid-cols-2">
                      <div>
                        <label class="text-xs text-muted-foreground">Username
                          <input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" autocomplete="username" value={profileDraft.username} placeholder={profile.hasUsername ? 'Saved · leave blank to keep' : 'Email or username'} oninput={(event) => updateProfileCredential('username', (event.currentTarget as HTMLInputElement).value)} />
                        </label>
                        {#if profile.hasUsername}
                          <button type="button" class="mt-1 text-[11px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground" onclick={() => clearProfileCredential('username')}>
                            {profileDraft.clearUsername ? 'Undo clear username' : 'Clear saved username'}
                          </button>
                        {/if}
                      </div>
                      <div>
                        <label class="text-xs text-muted-foreground">Password
                          <input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" autocomplete="new-password" type="password" value={profileDraft.password} placeholder={profile.hasPassword ? 'Saved · leave blank to keep' : 'Password'} oninput={(event) => updateProfileCredential('password', (event.currentTarget as HTMLInputElement).value)} />
                        </label>
                        {#if profile.hasPassword}
                          <button type="button" class="mt-1 text-[11px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground" onclick={() => clearProfileCredential('password')}>
                            {profileDraft.clearPassword ? 'Undo clear password' : 'Clear saved password'}
                          </button>
                        {/if}
                      </div>
                    </div>
                  </div>

                  <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <Switch checked={profileDraft.enabled} label="Profile enabled" onchange={(checked) => updateProfileDraft('enabled', checked)} />
                    <div class="flex gap-2">
                      <Button variant="ghost" size="sm" onclick={cancelProfileEdit}>Cancel</Button>
                      <Button size="sm" onclick={() => void saveProfile(profile)} disabled={savingProfileId === profile.id}>
                        {#if savingProfileId === profile.id}<LoaderCircle size={13} class="animate-spin" /> Saving…{:else}<Save size={13} /> Save profile{/if}
                      </Button>
                    </div>
                  </div>
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="surface-section rounded-lg p-4" aria-labelledby="saved-browser-recipes-heading" in:fly={{ y: 8, duration: 180, delay: 55 }}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <ShieldCheck size={16} class="text-primary" />
            <h4 id="saved-browser-recipes-heading" class="font-medium text-foreground">Saved recipes</h4>
            <span class="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{recipes.length}</span>
          </div>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">
            Review or edit safe actions recorded by the email-first launcher. Recipe JSON never stores
            typed credential values.
          </p>
        </div>
        <span class="rounded-full border border-border bg-muted/10 px-2.5 py-1 text-[11px] text-muted-foreground">Creation stays in Inbox</span>
      </div>

      {#if recipes.length === 0}
        <div class="mt-4 rounded-lg border border-dashed border-border bg-muted/10 px-4 py-7 text-center">
          <ShieldCheck size={21} class="mx-auto text-muted-foreground" />
          <p class="mt-2 text-sm text-foreground">No saved recipes.</p>
          <p class="mt-1 text-xs text-muted-foreground">Open a report email to create one with the guided launcher.</p>
        </div>
      {:else}
        <div class="mt-4 divide-y divide-border/60 rounded-lg border border-border/70 bg-background/20">
          {#each recipes as recipe (recipe.id)}
            {@const profile = profileFor(recipe.profileId)}
            <article class="p-3 first:rounded-t-lg last:rounded-b-lg hover:bg-muted/[0.04] transition-colors">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <h5 class="truncate text-sm font-medium text-foreground">{recipe.name}</h5>
                    <span class={`rounded-full border px-2 py-0.5 text-[10px] ${recipe.enabled && profile?.enabled ? 'border-primary/30 text-primary' : 'border-amber-400/30 text-amber-200'}`}>
                      {recipe.enabled && profile?.enabled ? 'ready' : 'disabled'}
                    </span>
                  </div>
                  <p class="mt-1 truncate text-xs text-muted-foreground">{profile?.name || 'Deleted profile'} · {recipe.startUrl}</p>
                  <p class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{recipe.description || 'Recorded browser workflow'}</p>
                  <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span class="rounded-full border border-border px-2 py-0.5">{recipe.actions.length} actions</span>
                    <span>Last run {formatDate(recipe.lastRunAt)}</span>
                    {#if recipe.sourceMessageId}<span class="text-primary">Email guided</span>{/if}
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <Switch checked={recipe.enabled} label={`${recipe.name} enabled`} onchange={(checked) => void toggleRecipe(recipe, checked)} />
                  <Button variant="outline" size="sm" onclick={() => void runRecipe(recipe)} disabled={!recipe.enabled || !profile?.enabled || Boolean(runningRecipeId)}>
                    {#if runningRecipeId === recipe.id}<LoaderCircle size={13} class="animate-spin" /> Running{:else}<Play size={13} /> Run now{/if}
                  </Button>
                  <Button variant="outline" size="sm" onclick={() => (editingRecipeId === recipe.id ? cancelRecipeEdit() : startRecipeEdit(recipe))} aria-expanded={editingRecipeId === recipe.id}>
                    {#if editingRecipeId === recipe.id}<X size={13} /> Close{:else}<ChevronDown size={13} /> Edit recipe{/if}
                  </Button>
                  <Button variant="destructive" size="sm" onclick={() => void deleteRecipe(recipe)} disabled={deletingRecipeId === recipe.id} aria-label={`Delete ${recipe.name}`}>
                    {#if deletingRecipeId === recipe.id}<LoaderCircle size={13} class="animate-spin" />{:else}<Trash2 size={13} />{/if}
                  </Button>
                </div>
              </div>

              {#if editingRecipeId === recipe.id && recipeDraft}
                <div class="mt-4 border-t border-border/60 pt-4" transition:slide={{ duration: 150 }}>
                  <div class="grid gap-3 md:grid-cols-2">
                    <label class="text-xs font-medium text-muted-foreground">Profile
                      <select class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" value={recipeDraft.profileId} onchange={(event) => updateRecipeDraft('profileId', (event.currentTarget as HTMLSelectElement).value)}>
                        {#each profiles as option (option.id)}
                          <option value={option.id}>{option.name}{option.enabled ? '' : ' · disabled'}</option>
                        {/each}
                      </select>
                    </label>
                    <label class="text-xs font-medium text-muted-foreground">Recipe name
                      <input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" value={recipeDraft.name} oninput={(event) => updateRecipeDraft('name', (event.currentTarget as HTMLInputElement).value)} />
                    </label>
                    <label class="text-xs font-medium text-muted-foreground md:col-span-2">Start URL
                      <input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" type="url" value={recipeDraft.startUrl} oninput={(event) => updateRecipeDraft('startUrl', (event.currentTarget as HTMLInputElement).value)} />
                    </label>
                    <label class="text-xs font-medium text-muted-foreground md:col-span-2">Description
                      <textarea class="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" value={recipeDraft.description} oninput={(event) => updateRecipeDraft('description', (event.currentTarget as HTMLTextAreaElement).value)}></textarea>
                    </label>
                    <label class="text-xs font-medium text-muted-foreground md:col-span-2">Safe action recipe <span class="font-normal">(JSON array)</span>
                      <textarea class="mt-1 min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" value={recipeDraft.actionsJson} oninput={(event) => updateRecipeDraft('actionsJson', (event.currentTarget as HTMLTextAreaElement).value)}></textarea>
                    </label>
                  </div>
                  <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <Switch checked={recipeDraft.enabled} label="Recipe enabled" onchange={(checked) => updateRecipeDraft('enabled', checked)} />
                    <div class="flex gap-2">
                      <Button variant="ghost" size="sm" onclick={cancelRecipeEdit}>Cancel</Button>
                      <Button size="sm" onclick={() => void saveRecipe(recipe)} disabled={savingRecipeId === recipe.id}>
                        {#if savingRecipeId === recipe.id}<LoaderCircle size={13} class="animate-spin" /> Saving…{:else}<Save size={13} /> Save recipe{/if}
                      </Button>
                    </div>
                  </div>
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="surface-section rounded-lg p-4" aria-labelledby="recent-browser-runs-heading" in:fly={{ y: 8, duration: 180, delay: 85 }}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <RefreshCw size={16} class="text-primary" />
            <h4 id="recent-browser-runs-heading" class="font-medium text-foreground">Recent runs</h4>
            <span class="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{runs.length}</span>
          </div>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">Inspect status, downloads, errors, and the safe event log for the latest report attempts.</p>
        </div>
        <Button variant="ghost" size="sm" onclick={() => void load()}><RefreshCw size={14} /> Refresh runs</Button>
      </div>

      {#if runs.length === 0}
        <p class="mt-4 rounded-lg border border-dashed border-border bg-muted/10 px-4 py-7 text-center text-xs text-muted-foreground">No browser runs yet.</p>
      {:else}
        <div class="mt-4 divide-y divide-border/60 rounded-lg border border-border/70 bg-background/20">
          {#each runs.slice(0, 20) as run (run.id)}
            {@const recipe = recipeFor(run.recipeId)}
            <article class="p-3">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-foreground">{recipe?.name || `Recipe #${run.recipeId || 'deleted'}`}</p>
                  <p class="mt-1 text-[11px] text-muted-foreground">Run #{run.id} · {run.triggerType} · {formatDate(run.createdAt)}</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  {#if run.downloadFilename}<span class="max-w-48 truncate text-xs text-primary">{run.downloadFilename}</span>{/if}
                  <span class={`rounded-full border px-2 py-1 text-[11px] ${statusClasses(run.status)}`}>{run.status}</span>
                  <button type="button" class="touch-target rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`${expandedRunId === run.id ? 'Hide' : 'Inspect'} run ${run.id}`} aria-expanded={expandedRunId === run.id} onclick={() => (expandedRunId = expandedRunId === run.id ? null : run.id)}>
                    {#if expandedRunId === run.id}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
                  </button>
                </div>
              </div>
              {#if run.errorMessage}<p class="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive" role="alert">{run.errorMessage}</p>{/if}
              {#if expandedRunId === run.id}
                <div class="mt-3 space-y-2 border-t border-border/60 pt-3" transition:slide={{ duration: 150 }}>
                  <div class="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
                    <span>Started: {formatDate(run.startedAt)}</span>
                    <span>Finished: {formatDate(run.finishedAt)}</span>
                    <span>Step: {run.currentActionIndex}</span>
                  </div>
                  {#if run.logs.length}
                    <ol class="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border bg-background/50 p-2 font-mono text-[11px] text-muted-foreground">
                      {#each run.logs as log, index (`${run.id}-${index}`)}
                        <li class="flex gap-2"><span class="shrink-0 text-zinc-600">{formatDate(typeof log.at === 'string' ? log.at : null)}</span><span class="break-words">{runLogDetail(log)}</span></li>
                      {/each}
                    </ol>
                  {:else}
                    <p class="text-xs text-muted-foreground">No event log recorded.</p>
                  {/if}
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</section>
