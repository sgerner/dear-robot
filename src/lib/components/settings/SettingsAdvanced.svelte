<script lang="ts">
  import { Download, Upload } from 'lucide-svelte';
  import DictationButton from '$lib/components/DictationButton.svelte';

  let {
    cachePassphrase = $bindable(),
    cacheEncrypted,
    saveCacheEncryption,
    backups,
    backupPolicy,
    createBackupNow,
    refreshBackups,
    restoreBackupNow,
    auditSnapshot,
    loadAuditSnapshot,
    contactsImportCsv = $bindable(),
    exportContacts,
    importContacts,
    dictationTargetId,
    dictationActive,
    dictationUnavailable,
    dictationLevel,
    toggleDictation
  } = $props<{
    cachePassphrase: string;
    cacheEncrypted: boolean;
    saveCacheEncryption: () => void;
    backups: Array<{ id: string; createdAt: string }>;
    backupPolicy: { retentionDays: number; maxBackups: number } | null;
    createBackupNow: () => void | Promise<void>;
    refreshBackups: () => void | Promise<void>;
    restoreBackupNow: (_id: string) => void | Promise<void>;
    auditSnapshot: { actions: number; toolCalls: number; memoryEvents: number } | null;
    loadAuditSnapshot: () => void | Promise<void>;
    contactsImportCsv: string;
    exportContacts: () => void | Promise<void>;
    importContacts: () => void | Promise<void>;
    dictationTargetId: string | null;
    dictationActive: boolean;
    dictationUnavailable: boolean;
    dictationLevel: number;
    toggleDictation: (_targetId: string) => void | Promise<void>;
  }>();
</script>

<div class="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-5">
  <h3 class="font-medium">Encrypted Browser Cache</h3>
  <p class="mt-2 text-sm text-zinc-400">
    Optional client-side encryption for IndexedDB cache on shared devices. Use a local passphrase.
  </p>
  <div class="mt-3 flex flex-wrap items-center gap-2">
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm md:w-auto md:flex-1"
      placeholder="Cache passphrase (local browser only)"
      type="password"
      bind:value={cachePassphrase}
    />
    <button
      class="inline-flex items-center justify-center whitespace-nowrap font-medium ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] bg-primary/80 text-primary-foreground hover:bg-primary h-8 rounded-md px-3 text-xs"
      onclick={saveCacheEncryption}>Save</button
    >
  </div>
  <p class="mt-2 text-xs text-zinc-500">Status: {cacheEncrypted ? 'enabled' : 'disabled'}</p>
</div>

<div class="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-5">
  <h3 class="font-medium">Backups</h3>
  <p class="mt-2 text-sm text-zinc-400">
    Create and restore `/data` snapshots for disaster recovery. Restore rewrites current DB state.
  </p>
  {#if backupPolicy}
    <p class="mt-1 text-xs text-zinc-500">
      Automatic lifecycle: keep backups for {backupPolicy.retentionDays} days, up to
      {backupPolicy.maxBackups} snapshots. Older backups are pruned automatically.
    </p>
  {/if}
  <div class="mt-3 flex flex-wrap gap-2">
    <button
      class="inline-flex items-center justify-center whitespace-nowrap font-medium ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] bg-primary/80 text-primary-foreground hover:bg-primary h-8 rounded-md px-3 text-xs"
      onclick={createBackupNow}>Create Backup</button
    >
    <button class="rounded-md border border-white/10 px-3 py-2 text-sm" onclick={refreshBackups}
      >Refresh</button
    >
  </div>
  <div class="mt-3 max-h-44 space-y-2 overflow-y-auto">
    {#if backups.length}
      {#each backups as backup (backup.id)}
        <div
          class="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2"
        >
          <p class="text-xs text-zinc-300">{new Date(backup.createdAt).toLocaleString()}</p>
          <button
            class="rounded border border-white/10 px-2 py-1 text-[11px] text-zinc-300"
            onclick={() => restoreBackupNow(backup.id)}>Restore</button
          >
        </div>
      {/each}
    {:else}
      <p class="text-xs text-zinc-500">No backups created yet.</p>
    {/if}
  </div>
</div>

<div class="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-5">
  <h3 class="font-medium">Admin Audit Snapshot</h3>
  <p class="mt-2 text-sm text-zinc-400">
    Quick visibility into executed actions, tool calls, and memory learning events.
  </p>
  <div class="mt-3 flex flex-wrap gap-2">
    <button class="rounded-md border border-white/10 px-3 py-2 text-sm" onclick={loadAuditSnapshot}
      >Load Snapshot</button
    >
  </div>
  {#if auditSnapshot}
    <div class="mt-3 grid gap-2 md:grid-cols-3">
      <div class="rounded-md border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
        Executed actions: {auditSnapshot.actions}
      </div>
      <div class="rounded-md border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
        Tool calls: {auditSnapshot.toolCalls}
      </div>
      <div class="rounded-md border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
        Memory events: {auditSnapshot.memoryEvents}
      </div>
    </div>
  {/if}
</div>

<div class="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-5">
  <h3 class="font-medium">Contacts Import/Export</h3>
  <p class="mt-2 text-sm text-zinc-400">
    Export copies CSV to clipboard. Import accepts <code>email,name</code> or
    <code>account_id,email,name</code> rows.
  </p>
  <div class="mt-3 flex flex-wrap gap-2">
    <button
      class="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm"
      onclick={exportContacts}><Download size={15} /> Export CSV</button
    >
    <button
      class="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm"
      onclick={importContacts}><Upload size={15} /> Import CSV</button
    >
  </div>
  <div class="relative mt-3">
    <textarea
      id="contacts-import-csv"
      class="min-h-28 w-full rounded-md border border-white/10 bg-black/30 p-3 pr-12 text-xs outline-none"
      placeholder="email,name&#10;person@example.com,Person Name"
      bind:value={contactsImportCsv}
    ></textarea>
    <div class="absolute right-2 top-2">
      <DictationButton
        targetId="contacts-import-csv"
        activeTargetId={dictationTargetId}
        recording={dictationActive}
        unavailable={dictationUnavailable}
        level={dictationLevel}
        onToggle={toggleDictation}
      />
    </div>
  </div>
</div>
