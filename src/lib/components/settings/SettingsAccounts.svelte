<script lang="ts">
  import { Plus, ChevronDown, ChevronRight, Folder } from 'lucide-svelte';
  import DictationButton from '$lib/components/DictationButton.svelte';
  import Switch from '$lib/components/ui/Switch.svelte';

  let {
    data,
    accountForm = $bindable(),
    googleOauthSettings = $bindable(),
    googleOauthHasSecret,
    googleOauthConnectedEmail,
    dictationTargetId,
    dictationActive,
    dictationUnavailable,
    dictationLevel,
    folderRoleOptions,
    saveFolderRole,
    toggleDictation,
    accountAction,
    addAccount,
    saveGoogleOauthSettings,
    startGoogleConnect
  } = $props<{
    data: any;
    accountForm: {
      email: string;
      host: string;
      port: number;
      username: string;
      password: string;
      smtpHost: string;
      smtpPort: number;
      smtpUsername: string;
      smtpPassword: string;
    };
    googleOauthSettings: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      scopes: string;
      isEnabled: boolean;
    };
    googleOauthHasSecret: boolean;
    googleOauthConnectedEmail: string;
    dictationTargetId: string | null;
    dictationActive: boolean;
    dictationUnavailable: boolean;
    dictationLevel: number;
    folderRoleOptions: Array<{ value: string; label: string }>;
    saveFolderRole: (_folderId: number, _role: any) => void | Promise<void>;
    toggleDictation: (_targetId: string) => void | Promise<void>;
    accountAction: (
      _id: number,
      _action: 'test' | 'enable' | 'disable' | 'delete'
    ) => void | Promise<void>;
    addAccount: () => void | Promise<void>;
    saveGoogleOauthSettings: () => void | Promise<void>;
    startGoogleConnect: () => void;
  }>();

  let expandedAccounts = $state<Record<number, boolean>>({});

  function toggleAccountFolders(accountId: number) {
    expandedAccounts[accountId] = !expandedAccounts[accountId];
  }
</script>

<div class="mt-6 space-y-4">
  <h3 class="text-sm font-medium text-zinc-300">Email Accounts</h3>
  {#each data.accounts as account (account.id)}
    <article class="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="font-medium">{account.email}</p>
          <p class="text-xs text-zinc-500">
            {account.host}:{account.port} -> {account.smtpHost}:{account.smtpPort}
          </p>
          <p class="mt-1 text-xs text-zinc-400">
            {account.syncStatus}{account.lastSyncAt
              ? ` · ${new Date(account.lastSyncAt).toLocaleString()}`
              : ''} · {account.authType === 'oauth_gmail' ? 'gmail oauth' : 'password auth'}
          </p>
        </div>
        <span class="rounded-full border border-white/10 px-2 py-1 text-xs"
          >{account.isEnabled ? 'enabled' : 'disabled'}</span
        >
      </div>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
        <div class="flex flex-wrap gap-2">
          <button
            class="rounded-md border border-white/10 px-2 py-1 text-xs transition-colors hover:bg-white/5"
            onclick={() => accountAction(account.id, 'test')}>Test</button
          >
          <button
            class="rounded-md border border-white/10 px-2 py-1 text-xs transition-colors hover:bg-white/5"
            onclick={() => accountAction(account.id, account.isEnabled ? 'disable' : 'enable')}
            >{account.isEnabled ? 'Disable' : 'Enable'}</button
          >
          <button
            class="rounded-md border border-red-400/30 px-2 py-1 text-xs text-red-200 transition-colors hover:bg-red-400/10"
            onclick={() => accountAction(account.id, 'delete')}>Remove</button
          >
        </div>

        <button
          class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
          onclick={() => toggleAccountFolders(account.id)}
        >
          <Folder size={14} />
          <span>{data.folders.filter((f: any) => f.accountId === account.id).length} Folders</span>
          {#if expandedAccounts[account.id]}
            <ChevronDown size={14} />
          {:else}
            <ChevronRight size={14} />
          {/if}
        </button>
      </div>

      {#if expandedAccounts[account.id]}
        <div class="mt-3 space-y-2 border-t border-white/5 pt-3">
          <div class="flex items-center justify-between">
            <h4 class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Folder Role Mapping</h4>
            <p class="text-[10px] text-zinc-600 italic">Overrides IMAP discovery</p>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            {#each data.folders.filter((f: any) => f.accountId === account.id) as folder (folder.id)}
              <div class="flex items-center justify-between gap-3 rounded-md border border-white/5 bg-black/10 px-2 py-1.5">
                <div class="min-w-0">
                  <span class="block truncate text-[11px] font-medium text-zinc-300">{folder.path}</span>
                  <span class="text-[10px] text-zinc-500">{folder.total} messages</span>
                </div>
                <select
                  class="w-28 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] text-zinc-200 outline-none transition-colors duration-150 focus:border-accent/50"
                  value={folder.role || ''}
                  onchange={(event) =>
                    saveFolderRole(folder.id, (event.currentTarget as HTMLSelectElement).value)}
                >
                  {#each folderRoleOptions as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </div>
            {/each}
          </div>
        </div>
      {/if}
      </article>
      {/each}
  <form
    class="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3"
    onsubmit={(event) => {
      event.preventDefault();
      addAccount();
    }}
  >
    <h3 class="text-sm font-medium">Add IMAP/SMTP</h3>
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="Email"
      bind:value={accountForm.email}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="IMAP host"
      bind:value={accountForm.host}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="IMAP username"
      bind:value={accountForm.username}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="IMAP password"
      type="password"
      bind:value={accountForm.password}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="SMTP host"
      bind:value={accountForm.smtpHost}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="SMTP username"
      bind:value={accountForm.smtpUsername}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="SMTP password"
      type="password"
      bind:value={accountForm.smtpPassword}
    />
    <button
      class="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-black"
      ><Plus size={16} /> Add account</button
    >
  </form>
  <section class="space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
    <h3 class="text-sm font-medium">Connect Gmail (Google OAuth)</h3>
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="Google OAuth Client ID"
      bind:value={googleOauthSettings.clientId}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder={googleOauthHasSecret
        ? 'Client secret (leave blank to rotate)'
        : 'Google OAuth Client Secret'}
      type="password"
      bind:value={googleOauthSettings.clientSecret}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="Redirect URI"
      bind:value={googleOauthSettings.redirectUri}
    />
    <div class="relative">
      <textarea
        id="google-oauth-scopes"
        class="min-h-20 w-full rounded-md border border-white/10 bg-black/30 p-3 pr-12 text-xs outline-none"
        placeholder="One scope per line"
        bind:value={googleOauthSettings.scopes}
      ></textarea>
      <div class="absolute right-2 top-2">
        <DictationButton
          targetId="google-oauth-scopes"
          activeTargetId={dictationTargetId}
          recording={dictationActive}
          unavailable={dictationUnavailable}
          level={dictationLevel}
          onToggle={toggleDictation}
        />
      </div>
    </div>
    <Switch bind:checked={googleOauthSettings.isEnabled} label="Enabled" />
    <div class="flex flex-wrap gap-2">
      <button
        class="rounded-md border border-white/10 px-3 py-2 text-xs"
        onclick={saveGoogleOauthSettings}>Save OAuth Settings</button
      >
      <button
        class="rounded-md bg-accent px-3 py-2 text-xs font-medium text-black"
        onclick={startGoogleConnect}>Connect Gmail Account</button
      >
    </div>
    {#if googleOauthConnectedEmail}
      <p class="text-xs text-accent">Connected: {googleOauthConnectedEmail}</p>
    {/if}
  </section>
</div>
