<script lang="ts">
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
    modelsDevProviders: Array<{ id: string; name: string; doc: string | null }>;
    loadModelsDevCatalog: () => void | Promise<void>;
    selectCatalogProviderForProfile: (profile: any, input: string) => void;
    selectedCatalogModels: (profile: any) => Array<{ id: string; label: string }>;
    selectedCatalogProvider: (profile: any) => { doc?: string | null } | null | undefined;
    requiredEnvVars: (profile: any) => string[];
    setProfileMode: (profile: any, mode: 'catalog' | 'manual') => void;
    testAiProfile: (profile: any) => void | Promise<void>;
    saveAiProfile: (profile: any) => void | Promise<void>;
    modelsDevLoading: boolean;
    audioProviderId: string;
    audioModelId: string;
    audioApiKey: string;
    audioProvider: () => any;
    audioModels: () => Array<{ id: string; label: string; blurb?: string }>;
    selectAudioProvider: (providerId: string) => void;
    saveAudioDictationProfile: () => void | Promise<void>;
  }>();
</script>

<div class="mt-8 gap-4 max-w-3xl mx-auto">
  <div class="rounded-lg border border-white/10 bg-white/[0.03] p-4 md:p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="font-medium">AI Profiles</h3>
        <p class="mt-1 text-sm text-zinc-400">
          Primary, fallback, advanced planner, and audio models.
        </p>
      </div>
    </div>
    <div class="mt-4 space-y-3">
      {#each coreAiProfileKeys as profileKey (profileKey)}
        <article class="rounded-md border border-white/10 bg-black/20 p-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-sm font-medium">{aiProfileForms[profileKey].label}</p>
              <p class="text-xs text-zinc-500">
                {profileKey} · {aiProfileForms[profileKey].provider} · {aiProfileForms[profileKey]
                  .model}
              </p>
              <p class="mt-1 text-[11px] text-zinc-500">
                Recommended: {aiProfileRecommendations[profileKey].join(' · ')}
              </p>
            </div>
            <label
              class="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-300 hover:text-zinc-200"
            >
              <span
                class="relative inline-flex h-5 w-9 items-center rounded-full bg-zinc-700 transition-colors"
                class:bg-accent={aiProfileForms[profileKey].isEnabled}
              >
                <span
                  class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                  class:translate-x-5={aiProfileForms[profileKey].isEnabled}
                  class:translate-x-1={!aiProfileForms[profileKey].isEnabled}
                ></span>
                <input
                  type="checkbox"
                  class="sr-only"
                  bind:checked={aiProfileForms[profileKey].isEnabled}
                />
              </span>
              Enabled
            </label>
          </div>
          <div class="mt-3 flex items-center gap-2 text-xs">
            <button
              class={`rounded-md border px-2 py-1 ${profileMode[profileKey] === 'catalog' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-white/10 text-zinc-400'}`}
              onclick={() => setProfileMode(profileKey, 'catalog')}>Catalog</button
            >
            <button
              class={`rounded-md border px-2 py-1 ${profileMode[profileKey] === 'manual' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-white/10 text-zinc-400'}`}
              onclick={() => setProfileMode(profileKey, 'manual')}>Manual</button
            >
          </div>

          {#if profileMode[profileKey] === 'catalog'}
            <div class="mt-3 grid gap-2 md:grid-cols-2">
              <div>
                <input
                  list={`provider-options-${profileKey}`}
                  class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  placeholder="Search provider (DeepSeek recommended)"
                  bind:value={aiProfileForms[profileKey].provider}
                  onfocus={loadModelsDevCatalog}
                  onchange={(event) =>
                    selectCatalogProviderForProfile(
                      profileKey,
                      (event.currentTarget as HTMLInputElement).value
                    )}
                />
                <datalist id={`provider-options-${profileKey}`}>
                  {#each modelsDevProviders as provider (provider.id)}
                    <option value={provider.id}>{provider.name}</option>
                  {/each}
                </datalist>
              </div>
              <div>
                <input
                  list={`model-options-${profileKey}`}
                  class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  placeholder="Search model"
                  bind:value={aiProfileForms[profileKey].model}
                />
                <datalist id={`model-options-${profileKey}`}>
                  {#each selectedCatalogModels(profileKey) as model (model.id)}
                    <option value={model.id}>{model.label}</option>
                  {/each}
                </datalist>
              </div>
            </div>
            {#if selectedCatalogProvider(profileKey)?.doc}
              <p class="mt-2 text-xs text-zinc-500">
                Docs: <a
                  class="underline hover:text-zinc-300"
                  href={selectedCatalogProvider(profileKey)?.doc || '#'}
                  target="_blank"
                  rel="noreferrer">{selectedCatalogProvider(profileKey)?.doc}</a
                >
              </p>
            {/if}
            <div class="mt-2 grid gap-2">
              {#each requiredEnvVars(profileKey) as envKey (envKey)}
                <input
                  class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  placeholder={`${envKey} value`}
                  type="password"
                  value={profileEnvValues[profileKey]?.[envKey] || ''}
                  oninput={(event) => {
                    const value = (event.currentTarget as HTMLInputElement).value;
                    profileEnvValues = {
                      ...profileEnvValues,
                      [profileKey]: {
                        ...(profileEnvValues[profileKey] || {}),
                        [envKey]: value
                      }
                    };
                  }}
                />
              {/each}
            </div>
          {:else}
            <div class="mt-2 grid gap-2 md:grid-cols-2">
              <label class="block">
                <span class="text-xs text-zinc-500">Provider</span>
                <input
                  class="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  placeholder="Provider label"
                  bind:value={aiProfileForms[profileKey].provider}
                />
              </label>
              <label class="block">
                <span class="text-xs text-zinc-500">Base URL</span>
                <input
                  class="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  placeholder="OpenAI-compatible endpoint"
                  bind:value={aiProfileForms[profileKey].baseUrl}
                />
              </label>
              <label class="block">
                <span class="text-xs text-zinc-500">Model ID</span>
                <input
                  class="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  placeholder="Model identifier"
                  bind:value={aiProfileForms[profileKey].model}
                />
              </label>
              <label class="block">
                <span class="text-xs text-zinc-500">API Key / Bearer Token</span>
                <input
                  class="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  placeholder="Secret key"
                  type="password"
                  bind:value={aiProfileForms[profileKey].apiKey}
                />
              </label>
            </div>
          {/if}
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs text-zinc-500">
              {data.aiProfiles.find((item: { profile: string }) => item.profile === profileKey)
                ?.hasApiKey
                ? 'Saved key present'
                : 'No saved key'}
            </p>
            <div class="flex gap-2">
              {#if profileMode[profileKey] === 'catalog'}
                <button
                  class="rounded-md border border-white/10 px-3 py-2 text-xs"
                  onclick={loadModelsDevCatalog}
                  >{modelsDevLoading ? 'Loading...' : 'Refresh catalog'}</button
                >
              {/if}
              <button
                class="rounded-md border border-white/10 px-3 py-2 text-xs"
                onclick={() => testAiProfile(profileKey)}>Test</button
              >
              <button
                class="rounded-md bg-accent px-3 py-2 text-xs font-medium text-black"
                onclick={() => saveAiProfile(profileKey)}>Save</button
              >
            </div>
          </div>
        </article>
      {/each}
      <article class="rounded-md border border-white/10 bg-black/20 p-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-sm font-medium">Dictation Provider</p>
            <p class="text-xs text-zinc-500">
              audio · {audioProvider()?.label || audioProviderId} · {audioModelId}
            </p>
            <p class="mt-1 text-[11px] text-zinc-500">
              Recommended: {aiProfileRecommendations.audio.join(' · ')}
            </p>
          </div>
          <span class="rounded-full border border-white/10 px-2 py-1 text-[11px] text-zinc-400"
            >Audio profile</span
          >
        </div>
        <div class="mt-4 grid gap-3 md:grid-cols-2">
          <label class="block">
            <span class="text-xs text-zinc-500">Provider</span>
            <select
              class="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
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
            <span class="text-xs text-zinc-500">Model</span>
            <select
              class="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
              bind:value={audioModelId}
            >
              {#each audioModels() as model (model.id)}
                <option value={model.id}>{model.label}</option>
              {/each}
            </select>
          </label>
        </div>
        <div class="mt-3 rounded-md border border-white/10 bg-black/20 p-3">
          <p class="text-xs text-zinc-300">
            {audioModels().find(
              (model: { id: string; blurb?: string }) => model.id === audioModelId
            )?.blurb || 'Select a model to view details.'}
          </p>
          {#if audioProvider()?.docsUrl || audioProvider()?.signupUrl}
            <div class="mt-2 flex flex-wrap gap-2 text-xs">
              {#if audioProvider()?.docsUrl}
                <a
                  class="rounded border border-white/10 px-2 py-1 text-zinc-300 hover:bg-white/[0.06]"
                  href={audioProvider()?.docsUrl}
                  target="_blank"
                  rel="noreferrer">Docs</a
                >
              {/if}
              {#if audioProvider()?.signupUrl}
                <a
                  class="rounded border border-white/10 px-2 py-1 text-zinc-300 hover:bg-white/[0.06]"
                  href={audioProvider()?.signupUrl}
                  target="_blank"
                  rel="noreferrer">Pricing/Signup</a
                >
              {/if}
            </div>
          {/if}
        </div>
        {#if audioProvider()?.authType !== 'none'}
          <input
            class="mt-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            type="password"
            placeholder="API key (leave blank to keep saved key)"
            bind:value={audioApiKey}
          />
        {:else}
          <p
            class="mt-3 rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100"
          >
            Browser fallback requires no API key.
          </p>
        {/if}
        {#if audioProviderId === 'browser_web_speech'}
          <p class="mt-2 text-xs text-zinc-500">
            Browser dictation is not supported in Firefox and may vary by browser.
          </p>
        {/if}
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            class="rounded-md border border-white/10 px-3 py-2 text-xs"
            onclick={() => testAiProfile('audio')}>Test microphone / transcription</button
          >
          <button
            class="rounded-md bg-accent px-3 py-2 text-xs font-medium text-black"
            onclick={saveAudioDictationProfile}>Save dictation settings</button
          >
        </div>
      </article>
    </div>
  </div>
</div>
