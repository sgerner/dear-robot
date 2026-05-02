<script lang="ts">
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
    setQuickActionEnabled: (actionId: any, enabled: boolean) => void;
    moveQuickAction: (actionId: any, direction: -1 | 1) => void;
    swipeSettings: Record<string, string>;
    swipeActionCatalog: Array<{ id: string; label: string }>;
    updateSwipeSetting: (
      key: 'leftShort' | 'leftLong' | 'rightShort' | 'rightLong',
      action: any
    ) => void;
    folderGroups: Array<{ accountId: number; accountEmail: string; folders: Array<any> }>;
    saveFolderRole: (folderId: number, role: any) => void | Promise<void>;
    folderRoleOptions: Array<{ value: string; label: string }>;
  }>();
</script>

<div class="mt-6 space-y-4">
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
            <button
              type="button"
              class={`relative h-6 w-11 rounded-full transition-colors duration-200 ${quickActionIds.includes(action.id) ? 'bg-accent' : 'bg-zinc-700'}`}
              aria-pressed={quickActionIds.includes(action.id)}
              aria-label={`Toggle ${action.label}`}
              onclick={() => setQuickActionEnabled(action.id, !quickActionIds.includes(action.id))}
            >
              <span
                class={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform duration-200 ${quickActionIds.includes(action.id) ? 'translate-x-5' : 'translate-x-1'}`}
              ></span>
            </button>
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
