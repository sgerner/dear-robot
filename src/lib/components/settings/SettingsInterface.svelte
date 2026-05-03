<script lang="ts">
  import Switch from '$lib/components/ui/Switch.svelte';
  import { themeStore, type Theme } from '$lib/client/theme';

  let {
    quickActionCatalog,
    quickActionIds,
    resetInterfacePreferences,
    setQuickActionEnabled,
    moveQuickAction,
    swipeSettings,
    swipeActionCatalog,
    updateSwipeSetting,
    folderGroups,
    saveFolderRole,
    folderRoleOptions
  } = $props<{
    quickActionCatalog: Array<{ id: string; label: string; tone?: 'danger' | 'accent' }>;
    quickActionIds: string[];
    resetInterfacePreferences: () => void;
    setQuickActionEnabled: (_actionId: any, _enabled: boolean) => void;
    moveQuickAction: (_actionId: any, _direction: -1 | 1) => void;
    swipeSettings: Record<string, string>;
    swipeActionCatalog: Array<{ id: string; label: string }>;
    updateSwipeSetting: (
      _key: 'leftShort' | 'leftLong' | 'rightShort' | 'rightLong',
      _action: any
    ) => void;
    folderGroups: Array<{ accountId: number; accountEmail: string; folders: Array<any> }>;
    saveFolderRole: (_folderId: number, _role: any) => void | Promise<void>;
    folderRoleOptions: Array<{ value: string; label: string }>;
  }>();

  const themes: Array<{ id: Theme; label: string; colors: string[] }> = [
    { id: 'cinematic-dark', label: 'Cinematic Dark', colors: ['#0d0f14', '#00ffd2', '#1a1d23'] },
    { id: 'midnight-glow', label: 'Midnight Glow', colors: ['#08050a', '#ff00ff', '#120a15'] },
    { id: 'nordic-frost', label: 'Nordic Frost', colors: ['#1a1f2b', '#8ecae6', '#242a38'] },
    { id: 'sunset-mirage', label: 'Sunset Mirage', colors: ['#1a0f26', '#ff9f1c', '#2d1b40'] },
    { id: 'forest-haven', label: 'Forest Haven', colors: ['#0f1a14', '#70e000', '#1b2d24'] },
    { id: 'solarized-light', label: 'Solarized Light', colors: ['#fdf6e3', '#268bd2', '#eee8d5'] },
    { id: 'boi-butter', label: 'boi butter', colors: ['#2b1f0a', '#ff1493', '#ffcc33'] },
    { id: 'daddy-please', label: 'daddy please', colors: ['#050505', '#8b0000', '#2a2a2a'] },
    { id: 'himbo-juice', label: 'himbo juice', colors: ['#1a0a2e', '#00e5ff', '#ff00ff'] }
  ];
</script>

<div class="mt-6 space-y-4">
  <section class="rounded-lg border border-white/10 bg-white/[0.03] p-5">
    <h3 class="font-medium">Application Theme</h3>
    <p class="mt-1 text-sm text-zinc-400">
      Choose a visual style that matches your workflow.
    </p>
    <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {#each themes as theme (theme.id)}
        <button
          class="group relative flex flex-col overflow-hidden rounded-md border transition-all duration-200 { $themeStore === theme.id ? 'border-primary ring-2 ring-primary/20' : 'border-white/10 hover:border-white/20 bg-black/20' }"
          onclick={() => themeStore.setTheme(theme.id)}
        >
          <div class="flex h-12 w-full items-center justify-center" style="background: {theme.colors[0]}">
            <div class="flex gap-1">
              <div class="h-3 w-3 rounded-full" style="background: {theme.colors[1]}"></div>
              <div class="h-3 w-8 rounded-full" style="background: {theme.colors[2]}"></div>
            </div>
          </div>
          <div class="bg-black/40 px-3 py-2 text-left">
            <p class="text-xs font-medium text-zinc-200">{theme.label}</p>
          </div>
          {#if $themeStore === theme.id}
            <div class="absolute right-2 top-2 rounded-full bg-primary p-0.5 text-primary-foreground">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
          {/if}
        </button>
      {/each}
    </div>
  </section>

  <section class="rounded-lg border border-white/10 bg-white/[0.03] p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="font-medium">Quick Action Bar</h3>
        <p class="mt-1 text-sm text-zinc-400">
          Choose the actions shown on mobile and desktop message views. Mobile shows overflow behind
          the three-dot menu when the row is full.
        </p>
      </div>
      <button
        class="rounded-md border border-white/10 px-3 py-2 text-xs text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06]"
        onclick={resetInterfacePreferences}>Reset</button
      >
    </div>
    <div class="mt-4 space-y-2">
      {#each quickActionCatalog as action (action.id)}
        <div
          class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 p-3"
        >
          <div class="flex min-w-0 items-center gap-3">
            <Switch
              checked={quickActionIds.includes(action.id)}
              onchange={(checked) => setQuickActionEnabled(action.id, checked)}
            />
            <div>
              <p class="text-sm font-medium text-zinc-200">{action.label}</p>
              <p class="text-xs text-zinc-500">
                {quickActionIds.includes(action.id)
                  ? `Position ${quickActionIds.indexOf(action.id) + 1}`
                  : 'Hidden'}
              </p>
            </div>
          </div>
          {#if quickActionIds.includes(action.id)}
            <div class="flex gap-1">
              <button
                class="rounded border border-white/10 px-2 py-1 text-[11px] text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06]"
                onclick={() => moveQuickAction(action.id, -1)}>Up</button
              >
              <button
                class="rounded border border-white/10 px-2 py-1 text-[11px] text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06]"
                onclick={() => moveQuickAction(action.id, 1)}>Down</button
              >
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="rounded-lg border border-white/10 bg-white/[0.03] p-5">
    <h3 class="font-medium">Mobile Swipe Gestures</h3>
    <p class="mt-1 text-sm text-zinc-400">
      Short swipes trigger at about a thumb-width. Longer swipes use the second action.
    </p>
    <div class="mt-4 grid gap-3 md:grid-cols-2">
      {#each [{ key: 'leftShort', label: 'Short swipe left' }, { key: 'leftLong', label: 'Long swipe left' }, { key: 'rightShort', label: 'Short swipe right' }, { key: 'rightLong', label: 'Long swipe right' }] as gesture (gesture.key)}
        <label class="block rounded-md border border-white/10 bg-black/20 p-3">
          <span class="text-xs text-zinc-500">{gesture.label}</span>
          <select
            class="mt-2 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors duration-150 focus:border-accent/50"
            value={swipeSettings[gesture.key]}
            onchange={(event) =>
              updateSwipeSetting(gesture.key, (event.currentTarget as HTMLSelectElement).value)}
          >
            {#each swipeActionCatalog as action (action.id)}
              <option value={action.id}>{action.label}</option>
            {/each}
          </select>
        </label>
      {/each}
    </div>
  </section>

  <section class="rounded-lg border border-white/10 bg-white/[0.03] p-5">
    <h3 class="font-medium">Folder Role Mapping</h3>
    <p class="mt-1 text-sm text-zinc-400">
      IMAP and Gmail special-use folders are discovered during sync. Override roles here when a
      provider uses unusual names.
    </p>
    <div class="mt-4 space-y-3">
      {#each folderGroups as group (group.accountId)}
        <div class="rounded-md border border-white/10 bg-black/20 p-3">
          <div class="flex items-center justify-between gap-2">
            <p class="truncate text-sm font-medium text-zinc-200">{group.accountEmail}</p>
            <span class="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-500"
              >{group.folders.length} folders</span
            >
          </div>
          <div class="mt-3 grid gap-2 md:grid-cols-2">
            {#each group.folders as folder (folder.id)}
              <label
                class="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <span class="min-w-0">
                  <span class="block truncate text-xs text-zinc-300">{folder.path}</span>
                  <span class="text-[11px] text-zinc-500">{folder.total} messages</span>
                </span>
                <select
                  class="w-32 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200 outline-none transition-colors duration-150 focus:border-accent/50"
                  value={folder.role || ''}
                  onchange={(event) =>
                    saveFolderRole(folder.id, (event.currentTarget as HTMLSelectElement).value)}
                >
                  {#each folderRoleOptions as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </label>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </section>
</div>
