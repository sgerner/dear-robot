<script lang="ts">
  import {
    ArrowLeft,
    ArrowRight,
    ChevronUp,
    ChevronDown,
    Archive,
    Trash2,
    AlertCircle,
    MailOpen,
    Star,
    MinusCircle
  } from 'lucide-svelte';
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
    <div class="mt-4 overflow-hidden rounded-md border border-white/10 bg-black/10 divide-y divide-white/5">
      {#each quickActionCatalog as action (action.id)}
        <div
          class="flex flex-wrap items-center justify-between gap-3 p-3 hover:bg-white/[0.02] transition-colors"
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
                class="flex h-7 w-7 items-center justify-center rounded border border-white/10 text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] disabled:opacity-30"
                onclick={() => moveQuickAction(action.id, -1)}
                disabled={quickActionIds.indexOf(action.id) === 0}
                title="Move Up"
              >
                <ChevronUp size={14} />
              </button>
              <button
                class="flex h-7 w-7 items-center justify-center rounded border border-white/10 text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] disabled:opacity-30"
                onclick={() => moveQuickAction(action.id, 1)}
                disabled={quickActionIds.indexOf(action.id) === quickActionIds.length - 1}
                title="Move Down"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="rounded-lg border border-white/10 bg-white/[0.03] p-5">
    <div class="flex items-center gap-2">
      <h3 class="font-medium">Mobile Swipe Gestures</h3>
      <div class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">Mobile Only</div>
    </div>
    <p class="mt-1 text-sm text-zinc-400">
      Configure actions triggered by swiping messages. Previews show the background color and depth.
    </p>

    <div class="mt-8 space-y-10">
      <!-- Swipe Right Section -->
      <div class="space-y-4">
        <div class="flex items-center gap-2 border-b border-white/5 pb-2">
          <div class="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-primary">
            <ArrowRight size={14} />
          </div>
          <span class="text-xs font-semibold uppercase tracking-wider text-zinc-300">Swipe Right (Reveals Left Side)</span>
        </div>

        <div class="grid gap-6 md:grid-cols-2">
          {#each [{ key: 'rightShort', label: 'Short Swipe', shift: 40 }, { key: 'rightLong', label: 'Long Swipe', shift: 120 }] as gesture}
            <div class="space-y-3">
              <div class="flex items-center justify-between text-xs">
                <span class="font-medium text-zinc-400">{gesture.label}</span>
                <select
                  class="rounded border border-white/10 bg-black/40 px-2 py-1 text-zinc-200 outline-none focus:border-primary/50"
                  value={swipeSettings[gesture.key]}
                  onchange={(event) => updateSwipeSetting(gesture.key as any, (event.currentTarget as HTMLSelectElement).value)}
                >
                  {#each swipeActionCatalog as action (action.id)}
                    <option value={action.id}>{action.label}</option>
                  {/each}
                </select>
              </div>

              <!-- Visual Preview -->
              <div class="relative h-16 w-full overflow-hidden rounded-md border border-white/10 bg-black/20">
                <!-- Background (Revealed) -->
                <div class="absolute inset-y-0 left-0 flex w-full items-center gap-3 bg-primary/15 px-4 text-primary">
                  {#if swipeSettings[gesture.key] === 'archive'}<Archive size={18} />
                  {:else if swipeSettings[gesture.key] === 'delete'}<Trash2 size={18} />
                  {:else if swipeSettings[gesture.key] === 'spam'}<AlertCircle size={18} />
                  {:else if swipeSettings[gesture.key] === 'toggle_read'}<MailOpen size={18} />
                  {:else if swipeSettings[gesture.key] === 'star'}<Star size={18} />
                  {:else}<MinusCircle size={18} />
                  {/if}
                  <span class="text-xs font-bold uppercase tracking-tight">
                    {swipeActionCatalog.find((a: any) => a.id === swipeSettings[gesture.key])?.label}
                  </span>
                </div>
                <!-- Message Card (Shifted) -->
                <div
                  class="absolute inset-0 flex items-center border-l-2 border-primary bg-zinc-900 px-4 transition-transform duration-300 shadow-2xl"
                  style="transform: translateX({gesture.shift}px)"
                >
                  <div class="space-y-1.5 opacity-40">
                    <div class="h-2 w-24 rounded-full bg-white/20"></div>
                    <div class="h-1.5 w-40 rounded-full bg-white/10"></div>
                  </div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Swipe Left Section -->
      <div class="space-y-4">
        <div class="flex items-center gap-2 border-b border-white/5 pb-2">
          <div class="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/20 text-destructive">
            <ArrowLeft size={14} />
          </div>
          <span class="text-xs font-semibold uppercase tracking-wider text-zinc-300">Swipe Left (Reveals Right Side)</span>
        </div>

        <div class="grid gap-6 md:grid-cols-2">
          {#each [{ key: 'leftShort', label: 'Short Swipe', shift: -40 }, { key: 'leftLong', label: 'Long Swipe', shift: -120 }] as gesture}
            <div class="space-y-3">
              <div class="flex items-center justify-between text-xs">
                <span class="font-medium text-zinc-400">{gesture.label}</span>
                <select
                  class="rounded border border-white/10 bg-black/40 px-2 py-1 text-zinc-200 outline-none focus:border-destructive/50"
                  value={swipeSettings[gesture.key]}
                  onchange={(event) => updateSwipeSetting(gesture.key as any, (event.currentTarget as HTMLSelectElement).value)}
                >
                  {#each swipeActionCatalog as action (action.id)}
                    <option value={action.id}>{action.label}</option>
                  {/each}
                </select>
              </div>

              <!-- Visual Preview -->
              <div class="relative h-16 w-full overflow-hidden rounded-md border border-white/10 bg-black/20">
                <!-- Background (Revealed) -->
                <div class="absolute inset-y-0 right-0 flex w-full items-center justify-end gap-3 bg-destructive/15 px-4 text-destructive">
                  <span class="text-xs font-bold uppercase tracking-tight">
                    {swipeActionCatalog.find((a: any) => a.id === swipeSettings[gesture.key])?.label}
                  </span>
                  {#if swipeSettings[gesture.key] === 'archive'}<Archive size={18} />
                  {:else if swipeSettings[gesture.key] === 'delete'}<Trash2 size={18} />
                  {:else if swipeSettings[gesture.key] === 'spam'}<AlertCircle size={18} />
                  {:else if swipeSettings[gesture.key] === 'toggle_read'}<MailOpen size={18} />
                  {:else if swipeSettings[gesture.key] === 'star'}<Star size={18} />
                  {:else}<MinusCircle size={18} />
                  {/if}
                </div>
                <!-- Message Card (Shifted) -->
                <div
                  class="absolute inset-0 flex items-center border-r-2 border-destructive bg-zinc-900 px-4 transition-transform duration-300 shadow-2xl"
                  style="transform: translateX({gesture.shift}px)"
                >
                  <div class="flex w-full flex-col items-end space-y-1.5 opacity-40">
                    <div class="h-2 w-24 rounded-full bg-white/20"></div>
                    <div class="h-1.5 w-40 rounded-full bg-white/10"></div>
                  </div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </section>

</div>
