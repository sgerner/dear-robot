<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { Mic, Search, Zap, Check, Loader2 } from 'lucide-svelte';
  import Switch from '$lib/components/ui/Switch.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import type { ModelsDevProvider, ModelsDevModel } from '$lib/server/ai/modelsdev';

  let {
    data,
    coreAiProfileKeys,
    aiProfileForms = $bindable(),
    profileMode = $bindable(),
    profileEnvValues = $bindable(),
    aiProfileRecommendations,
    modelsDevProviders,
    loadModelsDevCatalog,
    selectCatalogProviderForProfile,
    selectedCatalogModels,
    selectedCatalogProvider,
    requiredEnvVars,
    setProfileMode,
    testAiProfile,
    saveAiProfile,
    modelsDevLoading,
    audioProviderId = $bindable(),
    audioModelId = $bindable(),
    audioApiKey = $bindable(),
    audioProvider,
    audioModels,
    selectAudioProvider,
    saveAudioDictationProfile
  } = $props<{
    data: any;
    coreAiProfileKeys: readonly string[];
    aiProfileForms: Record<string, any>;
    profileMode: Record<string, 'catalog' | 'manual'>;
    profileEnvValues: Record<string, Record<string, string>>;
    aiProfileRecommendations: Record<string, string[]>;
    modelsDevProviders: Array<ModelsDevProvider>;
    loadModelsDevCatalog: () => void | Promise<void>;
    selectCatalogProviderForProfile: (_profile: any, _input: string) => void;
    selectedCatalogModels: (_profile: any) => Array<ModelsDevModel>;
    selectedCatalogProvider: (_profile: any) => ModelsDevProvider | null | undefined;
    requiredEnvVars: (_profile: any) => string[];
    setProfileMode: (_profile: any, _mode: 'catalog' | 'manual') => void;
    testAiProfile: (_profile: any) => void | Promise<void>;
    saveAiProfile: (_profile: any) => void | Promise<void>;
    modelsDevLoading: boolean;
    audioProviderId: string;
    audioModelId: string;
    audioApiKey: string;
    audioProvider: () => any;
    audioModels: () => Array<{ id: string; label: string; blurb?: string }>;
    selectAudioProvider: (_providerId: string) => void;
    saveAudioDictationProfile: () => void | Promise<void>;
  }>();

  let searchQueries = $state<Record<string, string>>({});

  type ButtonState = 'idle' | 'loading' | 'success' | 'error';
  let testStates = $state<Record<string, ButtonState>>({});
  let testErrors = $state<Record<string, string>>({});
  let saveStates = $state<Record<string, ButtonState>>({});
  let audioTestState = $state<ButtonState>('idle');
  let audioTestError = $state<string>('');
  let audioSaveState = $state<ButtonState>('idle');

  const allModels = $derived(
    modelsDevProviders.flatMap((p: ModelsDevProvider) =>
      p.models.map((m: ModelsDevModel) => ({ ...m, provider: p }))
    )
  );

  function getFilteredModels(profileKey: string) {
    const query = searchQueries[profileKey] || '';
    if (query.length < 2) return [];
    return allModels
      .filter(
        (m: ModelsDevModel & { provider: ModelsDevProvider }) =>
          m.label.toLowerCase().includes(query.toLowerCase()) ||
          m.id.toLowerCase().includes(query.toLowerCase()) ||
          m.provider.name.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 8);
  }

  function selectModel(profileKey: string, model: any) {
    selectCatalogProviderForProfile(profileKey, model.provider.id);
    aiProfileForms[profileKey].model = model.id;
    searchQueries[profileKey] = '';

    // Initialize env vars if not present
    const envVars = model.provider.env || [];
    if (!profileEnvValues[profileKey]) profileEnvValues[profileKey] = {};
    envVars.forEach((ev: string) => {
      if (!profileEnvValues[profileKey][ev]) {
        profileEnvValues[profileKey][ev] = '';
      }
    });
  }

  async function handleTest(profileKey: string) {
    testStates[profileKey] = 'loading';
    testErrors[profileKey] = '';
    try {
      await testAiProfile(profileKey);
      testStates[profileKey] = 'success';
    } catch (err: any) {
      testStates[profileKey] = 'error';
      testErrors[profileKey] = err.message || 'Test failed';
    } finally {
      if (testStates[profileKey] === 'success') {
        setTimeout(() => {
          testStates[profileKey] = 'idle';
        }, 3000);
      }
    }
  }

  async function handleSave(profileKey: string) {
    saveStates[profileKey] = 'loading';
    testErrors[profileKey] = ''; // clear test errors
    try {
      await saveAiProfile(profileKey);
      saveStates[profileKey] = 'success';
      // Optimistically update UI: mark credentials as present
      aiProfileForms[profileKey].hasApiKey = true;
      // Clear local password inputs so they don't linger in the DOM
      aiProfileForms[profileKey].apiKey = '';
      const envKeys = requiredEnvVars(profileKey);
      for (const key of envKeys) {
        if (profileEnvValues[profileKey]) {
          profileEnvValues[profileKey][key] = '';
        }
      }
    } catch (err: any) {
      saveStates[profileKey] = 'error';
      testErrors[profileKey] = err.message || 'Save failed';
    } finally {
      if (saveStates[profileKey] === 'success' || saveStates[profileKey] === 'error') {
        setTimeout(() => {
          saveStates[profileKey] = 'idle';
        }, 3000);
      }
    }
  }

  async function handleAudioTest() {
    audioTestState = 'loading';
    audioTestError = '';
    try {
      await testAiProfile('audio');
      audioTestState = 'success';
    } catch (err: any) {
      audioTestState = 'error';
      audioTestError = err.message || 'Test failed';
    } finally {
      if (audioTestState === 'success') {
        setTimeout(() => {
          audioTestState = 'idle';
        }, 3000);
      }
    }
  }

  async function handleAudioSave() {
    audioSaveState = 'loading';
    audioTestError = '';
    try {
      await saveAudioDictationProfile();
      audioSaveState = 'success';
      audioApiKey = '';
    } catch (err: any) {
      audioSaveState = 'error';
      audioTestError = err.message || 'Save failed';
    } finally {
      if (audioSaveState === 'success' || audioSaveState === 'error') {
        setTimeout(() => { audioSaveState = 'idle'; }, 3000);
      }
    }
  }
</script>

<div class="mx-auto max-w-4xl pb-20 animate-fade-in">
  <!-- Page Header -->
  <div class="mb-8">
    <div class="flex items-center gap-3">
      <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Zap size={18} />
      </div>
      <div>
        <h2 class="text-xl font-semibold tracking-tight text-foreground">AI & Model Registry</h2>
        <p class="text-sm text-muted-foreground">
          Configure model profiles for dear-robot, fallbacks, and advanced reasoning.
        </p>
      </div>
    </div>
  </div>

  <div class="space-y-6">
    {#each coreAiProfileKeys as profileKey (profileKey)}
      {@const profile = aiProfileForms[profileKey]}
      {@const currentProvider = selectedCatalogProvider(profileKey)}
      {@const currentModel = currentProvider?.models.find(
        (m: ModelsDevModel) => m.id === profile?.model
      )}

      <div
        class="overflow-hidden transition-all duration-300 card-hover {profile?.isEnabled
          ? 'ai-card'
          : 'glass-card'}"
        in:fly={{ y: 12, duration: 250, delay: 50 * coreAiProfileKeys.indexOf(profileKey) }}
      >
        <!-- Profile Header -->
        <div class="p-5 md:p-6 flex flex-wrap items-start justify-between gap-4">
          <div class="flex items-center gap-3">
            <div
              class="h-10 w-10 flex items-center justify-center rounded-lg bg-primary border border-border/60 shrink-0"
            >
              <img
                src="https://models.dev/logos/{profile?.provider}.svg"
                alt=""
                class="h-6 w-6 opacity-80"
                onerror={(e) =>
                  ((e.currentTarget as HTMLImageElement).src =
                    'https://models.dev/logos/default.svg')}
              />
            </div>
            <div>
              <h4 class="text-sm font-bold uppercase tracking-widest text-foreground">
                {profile?.label}
              </h4>
              <div class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{profile?.provider}</span>
                <span class="text-border">•</span>
                <span class="font-mono opacity-70">{profile?.model}</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3">
            {#if profile?.isEnabled}
              <span
                class="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-primary"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"></span>
                Active
              </span>
            {/if}
            {#if profile}
              <Switch bind:checked={profile.isEnabled} label="Active" />
            {/if}
          </div>
        </div>

        <!-- Mode Toggle -->
        <div class="px-5 md:px-6 pb-2">
          {#if profile}
            <div
              class="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit border border-border/40"
            >
            <button
              class="px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 {profileMode[
                profileKey
              ] === 'catalog'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => setProfileMode(profileKey, 'catalog')}
            >
              Model Registry
            </button>
            <button
              class="px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 {profileMode[
                profileKey
              ] === 'manual'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => setProfileMode(profileKey, 'manual')}
            >
              Manual Setup
            </button>
            </div>
            {/if}
            </div>
        <!-- Content -->
        <div class="px-5 md:px-6 pb-6 space-y-5">
          {#if profile}
            {#if profileMode[profileKey] === 'catalog'}
            <div class="space-y-4">
              <!-- Search -->
              <div class="relative">
                <span
                  class="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2"
                  >Search Model Registry</span
                >
                <div class="relative group">
                  <input
                    type="text"
                    class="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none placeholder:text-muted-foreground/60"
                    placeholder="e.g. gpt-4o, claude-3.5-sonnet, deepseek-v3..."
                    bind:value={searchQueries[profileKey]}
                    onfocus={loadModelsDevCatalog}
                  />
                  <div
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 group-focus-within:text-muted-foreground transition-colors"
                  >
                    <Search size={16} />
                  </div>
                </div>

                {#if getFilteredModels(profileKey).length > 0}
                  <div
                    class="absolute left-0 right-0 top-full z-50 mt-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-2xl backdrop-blur-xl scrollbar-thin"
                    in:fade={{ duration: 150 }}
                  >
                    {#each getFilteredModels(profileKey) as m (`${m.provider.id}-${m.id}`)}
                      <button
                        class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all hover:bg-muted active:scale-[0.98]"
                        onclick={() => selectModel(profileKey, m)}
                      >
                        <img
                          src="https://models.dev/logos/{m.provider.id}.svg"
                          alt=""
                          class="h-6 w-6 rounded-sm bg-muted p-1 border border-border/40"
                          onerror={(e) =>
                            ((e.currentTarget as HTMLImageElement).src =
                              'https://models.dev/logos/default.svg')}
                        />
                        <div class="flex-1 min-w-0">
                          <div class="text-sm font-semibold text-foreground truncate">
                            {m.label}
                          </div>
                          <div class="text-[10px] text-muted-foreground truncate">
                            {m.provider.name} • {m.id}
                          </div>
                        </div>
                        <div class="text-right shrink-0">
                          <span class="text-[10px] font-mono text-muted-foreground/60"
                            >{Math.round(m.contextWindow / 1000)}k ctx</span
                          >
                        </div>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>

              <!-- Model Details -->
              {#if currentModel}
                <div
                  class="flex flex-wrap items-center gap-2 py-2"
                  in:fly={{ y: 8, duration: 250 }}
                >
                  <Badge
                    variant="outline"
                    class="text-[10px] uppercase tracking-tighter border-border/60 text-muted-foreground"
                    >{currentModel.contextWindow.toLocaleString()} tokens</Badge
                  >
                  {#if currentModel.reasoning}<Badge
                      variant="outline"
                      class="text-[10px] uppercase tracking-tighter border-primary/30 text-primary bg-primary/5"
                      >Reasoning</Badge
                    >{/if}
                  {#if currentModel.toolCall}<Badge
                      variant="outline"
                      class="text-[10px] uppercase tracking-tighter border-secondary/30 text-secondary-foreground"
                      >Tool Use</Badge
                    >{/if}
                  <span class="text-[10px] text-muted-foreground/60 ml-auto font-mono"
                    >${currentModel.inputPrice}/1M tokens</span
                  >
                </div>
              {/if}

              <!-- Inputs -->
              <div class="grid gap-4">
                <div class="grid gap-4 md:grid-cols-2">
                  <label class="block">
                    <span
                      class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block"
                      >Base URL</span
                    >
                    <input
                      class="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none placeholder:text-muted-foreground/60"
                      placeholder={currentProvider?.api || 'https://...'}
                      bind:value={profile.baseUrl}
                    />
                  </label>
                  <label class="block">
                    <span
                      class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block"
                      >Model Identifier</span
                    >
                    <input
                      class="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none placeholder:text-muted-foreground/60"
                      placeholder="e.g. gpt-4"
                      bind:value={profile.model}
                    />
                  </label>
                </div>

                <div class="space-y-3">
                  <span
                    class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block"
                    >Authentication Credentials</span
                  >
                  <div class="grid gap-3">
                    {#each requiredEnvVars(profileKey) as envKey (envKey)}
                      <label class="relative">
                        <span
                          class="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground/50 pointer-events-none uppercase"
                          >{envKey}</span
                        >
                        {#if profileEnvValues[profileKey]}
                          <input
                            class="w-full rounded-lg border border-input bg-background pl-24 pr-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none placeholder:text-muted-foreground/60"
                            placeholder="Required"
                            type="password"
                            bind:value={profileEnvValues[profileKey][envKey]}
                          />
                        {/if}
                      </label>
                    {/each}
                    {#if requiredEnvVars(profileKey).length === 0}
                      <p class="text-xs italic text-muted-foreground/60">
                        No specific environment variables required for this provider.
                      </p>
                    {/if}
                  </div>
                </div>

                <div class="pt-2">
                  <div class="flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5">
                    <div class="space-y-0.5">
                      <span class="text-xs font-bold text-foreground">Cloudflare Worker Proxy</span>
                      <p class="text-[10px] text-muted-foreground">Relay requests to bypass IP blocking (e.g. for Gemini on VPS)</p>
                    </div>
                    <Switch bind:checked={profile.proxyEnabled} label="Proxy" />
                  </div>
                  {#if profile.proxyEnabled}
                    <div class="mt-3" in:fly={{ y: -8, duration: 200 }}>
                      <label class="block">
                        <span class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block">Proxy URL</span>
                        <input
                          class="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none placeholder:text-muted-foreground/60"
                          placeholder="https://your-worker.your-subdomain.workers.dev"
                          bind:value={profile.proxyUrl}
                        />
                      </label>
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {:else}
            <div class="grid gap-4 md:grid-cols-2">
              <label class="block">
                <span
                  class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block"
                  >Provider Label</span
                >
                <input
                  class="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none placeholder:text-muted-foreground/60"
                  placeholder="Custom Provider"
                  bind:value={profile.provider}
                />
              </label>
              <label class="block">
                <span
                  class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block"
                  >Base URL</span
                >
                <input
                  class="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none placeholder:text-muted-foreground/60"
                  placeholder="https://api.example.com/v1"
                  bind:value={profile.baseUrl}
                />
              </label>
              <label class="block">
                <span
                  class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block"
                  >Model ID</span
                >
                <input
                  class="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none placeholder:text-muted-foreground/60"
                  placeholder="model-x"
                  bind:value={profile.model}
                />
              </label>
              <label class="block">
                <span
                  class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block"
                  >API Key</span
                >
                <input
                  class="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none placeholder:text-muted-foreground/60"
                  placeholder="sk-..."
                  type="password"
                  bind:value={profile.apiKey}
                />
              </label>
              <div class="col-span-full pt-2">
                <div class="flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5">
                  <div class="space-y-0.5">
                    <span class="text-xs font-bold text-foreground">Cloudflare Worker Proxy</span>
                    <p class="text-[10px] text-muted-foreground">Relay requests to bypass IP blocking (e.g. for Gemini on VPS)</p>
                  </div>
                  <Switch bind:checked={profile.proxyEnabled} label="Proxy" />
                </div>
                {#if profile.proxyEnabled}
                  <div class="mt-3" in:fly={{ y: -8, duration: 200 }}>
                    <label class="block">
                      <span class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block">Proxy URL</span>
                      <input
                        class="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none placeholder:text-muted-foreground/60"
                        placeholder="https://your-worker.your-subdomain.workers.dev"
                        bind:value={profile.proxyUrl}
                      />
                    </label>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Footer -->
          <div
            class="flex flex-wrap items-center justify-between gap-4 pt-5 border-t border-border/40"
          >
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <div
                class="h-2 w-2 rounded-full {profile?.hasApiKey
                  ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                  : 'bg-muted-foreground/30'}"
              ></div>
              {#if (saveStates[profileKey] ?? 'idle') === 'success'}
                <span in:fade class="text-emerald-400 font-medium">Profile saved</span>
              {:else}
                {profile?.hasApiKey ? 'Encrypted credentials saved' : 'No saved credentials'}
              {/if}
            </div>
            <div class="flex flex-col items-end gap-1.5">
              <div class="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  class="h-8 text-[11px] border-border/60 hover:bg-muted min-w-[8rem]"
                  onclick={() => handleTest(profileKey)}
                  disabled={(testStates[profileKey] ?? 'idle') === 'loading'}
                >
                  {#if (testStates[profileKey] ?? 'idle') === 'loading'}
                    <Loader2 size={13} class="animate-spin mr-1.5" />
                    Testing…
                  {:else if (testStates[profileKey] ?? 'idle') === 'success'}
                    <Check size={13} class="mr-1.5 text-emerald-400" />
                    Connected
                  {:else if (testStates[profileKey] ?? 'idle') === 'error'}
                    <Zap size={13} class="mr-1.5 text-destructive" />
                    Failed
                  {:else}
                    Test Connection
                  {/if}
                </Button>
                <Button
                  variant="glow"
                  size="sm"
                  class="h-8 text-[11px] font-bold px-4 min-w-[7rem]"
                  onclick={() => handleSave(profileKey)}
                  disabled={(saveStates[profileKey] ?? 'idle') === 'loading'}
                >
                  {#if (saveStates[profileKey] ?? 'idle') === 'loading'}
                    <Loader2 size={13} class="animate-spin mr-1.5" />
                    Saving…
                  {:else if (saveStates[profileKey] ?? 'idle') === 'success'}
                    <Check size={13} class="mr-1.5" />
                    Saved
                  {:else}
                    Save Profile
                  {/if}
                </Button>
              </div>
              {#if ((testStates[profileKey] ?? 'idle') === 'error' || (saveStates[profileKey] ?? 'idle') === 'error') && testErrors[profileKey]}
                <p
                  class="text-[10px] text-destructive font-medium animate-in fade-in slide-in-from-top-1 max-w-[240px] text-right leading-tight"
                  transition:fade
                >
                  {testErrors[profileKey]}
                </p>
              {/if}
            </div>
          </div>
          {/if}
        </div>
      </div>
    {/each}

    <!-- Dictation Provider -->
    <div
      class="glass-card card-hover border border-primary/50 overflow-hidden transition-all duration-300"
      in:fly={{ y: 12, duration: 250, delay: 200 }}
    >
      <div class="p-5 md:p-6 flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-center gap-3">
          <div
            class="h-10 w-10 flex items-center justify-center rounded-lg bg-muted border border-border/60 text-muted-foreground shrink-0"
          >
            <Mic size={20} />
          </div>
          <div>
            <p class="text-sm font-bold uppercase tracking-widest text-foreground">
              Dictation Provider
            </p>
            <p class="text-[11px] text-muted-foreground mt-0.5">
              {audioProvider()?.label || audioProviderId} · {audioModelId}
            </p>
          </div>
        </div>
        <Badge variant="secondary" class="text-[10px] font-bold uppercase tracking-widest"
          >Audio Profile</Badge
        >
      </div>

      <div class="px-5 md:px-6 pb-6 space-y-5">
        <div class="grid gap-4 md:grid-cols-2">
          <label class="block">
            <span
              class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block"
              >STT Engine</span
            >
            <select
              class="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none appearance-none"
              bind:value={audioProviderId}
              onchange={(event) =>
                selectAudioProvider((event.currentTarget as HTMLSelectElement).value)}
            >
              {#each data.speechProviders.filter((provider: any) => !provider.hiddenByDefault) as provider (provider.id)}
                <option value={provider.id}
                  >{provider.label}{provider.recommended ? ' (Recommended)' : ''}</option
                >
              {/each}
            </select>
          </label>
          <label class="block">
            <span
              class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block"
              >Acoustic Model</span
            >
            <select
              class="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none appearance-none"
              bind:value={audioModelId}
            >
              {#each audioModels() as model (model.id)}
                <option value={model.id}>{model.label}</option>
              {/each}
            </select>
          </label>
        </div>

        <div
          class="text-xs text-muted-foreground leading-relaxed bg-muted/30 rounded-lg p-4 border border-border/40"
        >
          {audioModels().find(
            (model: { id: string; label: string; blurb?: string }) => model.id === audioModelId
          )?.blurb || 'Select a model to view details.'}
          {#if audioProvider()?.docsUrl || audioProvider()?.signupUrl}
            <div class="mt-3 flex flex-wrap gap-2 text-[10px] uppercase font-bold tracking-widest">
              {#if audioProvider()?.docsUrl}
                <a
                  class="rounded-md border border-border/60 px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  href={audioProvider()?.docsUrl}
                  target="_blank"
                  rel="noreferrer">Documentation</a
                >
              {/if}
              {#if audioProvider()?.signupUrl}
                <a
                  class="rounded-md border border-border/60 px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  href={audioProvider()?.signupUrl}
                  target="_blank"
                  rel="noreferrer">Manage Access</a
                >
              {/if}
            </div>
          {/if}
        </div>

        {#if audioProvider()?.authType !== 'none'}
          <div>
            <span
              class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block"
              >API Key</span
            >
            <input
              class="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground transition-all focus:border-ring focus:ring-1 focus:ring-ring outline-none placeholder:text-muted-foreground/60"
              type="password"
              placeholder="Leave blank to keep current key"
              bind:value={audioApiKey}
            />
          </div>
        {:else}
          <div class="rounded-lg bg-primary/5 border border-primary/10 p-3 text-xs text-primary/80">
            Native browser fallback requires no authentication key.
          </div>
        {/if}

        <div class="flex flex-col gap-2 pt-2">
          <div class="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              class="h-9 text-[11px] border-border/60 hover:bg-muted min-w-[8.5rem]"
              onclick={handleAudioTest}
              disabled={audioTestState === 'loading'}
            >
              {#if audioTestState === 'loading'}
                <Loader2 size={13} class="animate-spin mr-1.5" />
                Testing…
              {:else if audioTestState === 'success'}
                <Check size={13} class="mr-1.5 text-emerald-400" />
                Connected
              {:else if audioTestState === 'error'}
                <Zap size={13} class="mr-1.5 text-destructive" />
                Failed
              {:else}
                Test Input Source
              {/if}
            </Button>
            <Button
              variant="glow"
              size="sm"
              class="h-9 text-[11px] font-bold px-4 min-w-[8rem]"
              onclick={handleAudioSave}
              disabled={audioSaveState === 'loading'}
            >
              {#if audioSaveState === 'loading'}
                <Loader2 size={13} class="animate-spin mr-1.5" />
                Saving…
              {:else if audioSaveState === 'success'}
                <Check size={13} class="mr-1.5" />
                Saved
              {:else}
                Update Audio Profile
              {/if}
            </Button>
          </div>
          {#if (audioTestState === 'error' || audioSaveState === 'error') && audioTestError}
            <p
              class="text-[10px] text-destructive font-medium animate-in fade-in slide-in-from-top-1 max-w-[400px] leading-tight"
              transition:fade
            >
              {audioTestError}
            </p>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  :global(.text-accent) {
    color: var(--color-primary-400);
  }
  :global(.bg-accent) {
    background-color: var(--color-primary-500);
  }
</style>
