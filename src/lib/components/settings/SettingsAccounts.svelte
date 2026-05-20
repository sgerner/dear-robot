<script lang="ts">
  import { fade } from 'svelte/transition';
  import {
    Plus,
    ChevronDown,
    ChevronRight,
    Folder,
    Sparkles,
    Loader2,
    Check,
    Copy,
    X
  } from 'lucide-svelte';
  import Switch from '$lib/components/ui/Switch.svelte';

  let {
    data,
    accountForm = $bindable(),
    googleOauthSettings = $bindable(),
    googleOauthHasSecret,
    googleOauthConnectedEmail,
    copyToClipboard,
    folderRoleOptions,
    saveFolderRole,
    accountAction,
    addAccount,
    testNewAccount,
    discoverAccountSettings,
    saveGoogleOauthSettings,
    startGoogleConnect,
    accountAddState = 'idle',
    accountAddError = '',
    accountTestState = 'idle',
    accountTestError = '',
    accountDiscoverState = 'idle',
    accountDiscoverError = ''
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
      isEnabled: boolean;
    };
    googleOauthHasSecret: boolean;
    googleOauthConnectedEmail: string;
    copyToClipboard: (_value: string, _label?: string) => void | Promise<void>;
    folderRoleOptions: Array<{ value: string; label: string }>;
    saveFolderRole: (_folderId: number, _role: any) => void | Promise<void>;
    accountAction: (
      _id: number,
      _action: 'test' | 'enable' | 'disable' | 'delete'
    ) => void | Promise<void>;
    addAccount: () => void | Promise<void>;
    testNewAccount: () => void | Promise<void>;
    discoverAccountSettings: () => void | Promise<void>;
    saveGoogleOauthSettings: () => void | Promise<void>;
    startGoogleConnect: () => void;
    accountAddState?: 'idle' | 'loading' | 'success' | 'error';
    accountAddError?: string;
    accountTestState?: 'idle' | 'loading' | 'success' | 'error';
    accountTestError?: string;
    accountDiscoverState?: 'idle' | 'loading' | 'success' | 'error';
    accountDiscoverError?: string;
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
            <h4 class="text-xs font-semibold uppercase tracking-wider text-zinc-500">Folder Role Mapping</h4>
            <p class="text-xs text-zinc-600 italic">Overrides IMAP discovery</p>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            {#each data.folders.filter((f: any) => f.accountId === account.id) as folder (folder.id)}
              <div class="flex items-center justify-between gap-3 rounded-md border border-white/5 bg-black/10 px-2 py-1.5">
                <div class="min-w-0">
                  <span class="block truncate text-xs font-medium text-zinc-300">{folder.path}</span>
                  <span class="text-xs text-zinc-500">{folder.total} messages</span>
                </div>
                <select
                  class="w-28 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200 outline-none transition-colors duration-150 focus:border-accent/50"
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
    class="space-y-4 rounded-lg border border-white/10 bg-white/[0.03] p-4"
    onsubmit={(event) => {
      event.preventDefault();
      addAccount();
    }}
  >
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium">Add IMAP/SMTP Account</h3>
      <div class="flex flex-col items-end gap-2">
        <div class="flex gap-2">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5 disabled:opacity-50"
            onclick={testNewAccount}
            disabled={accountTestState === 'loading'}
          >
            {#if accountTestState === 'loading'}
              <Loader2 size={13} class="animate-spin" />
              Testing…
            {:else if accountTestState === 'success'}
              <Check size={13} class="text-emerald-400" />
              Connected
            {:else if accountTestState === 'error'}
              <X size={13} class="text-red-400" />
              Failed
            {:else}
              Test Connection
            {/if}
          </button>
          <button
            type="submit"
            class="btn-cinematic flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            disabled={accountAddState === 'loading'}
          >
            {#if accountAddState === 'loading'}
              <Loader2 size={13} class="animate-spin" />
              Adding…
            {:else if accountAddState === 'success'}
              <Check size={13} />
              Added
            {:else}
              <Plus size={14} />
              Add Account
            {/if}
          </button>
        </div>
        {#if accountTestState === 'error' && accountTestError}
          <p class="text-xs text-red-400 font-medium max-w-[240px] text-right leading-tight" transition:fade>{accountTestError}</p>
        {/if}
        {#if accountAddState === 'error' && accountAddError}
          <p class="text-xs text-red-400 font-medium max-w-[240px] text-right leading-tight" transition:fade>{accountAddError}</p>
        {/if}
      </div>
    </div>

    <div class="space-y-3">
      <div>
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500" for="account-email">
          Account Email
        </label>
        <div class="flex gap-2">
          <input
            id="account-email"
            class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-accent/50"
            placeholder="e.g. user@example.com"
            bind:value={accountForm.email}
          />
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
            onclick={discoverAccountSettings}
            disabled={!accountForm.email || !accountForm.email.includes('@') || accountDiscoverState === 'loading'}
            title="Autodiscover settings"
          >
            {#if accountDiscoverState === 'loading'}
              <Loader2 size={14} class="animate-spin text-primary" />
              <span>Discovering…</span>
            {:else if accountDiscoverState === 'success'}
              <Check size={14} class="text-emerald-400" />
              <span>Discovered</span>
            {:else if accountDiscoverState === 'error'}
              <X size={14} class="text-red-400" />
              <span>Failed</span>
            {:else}
              <Sparkles size={14} class="text-primary" />
              <span>Discover</span>
            {/if}
          </button>
        </div>
        {#if accountDiscoverState === 'error' && accountDiscoverError}
          <p class="text-xs text-red-400 font-medium leading-tight" transition:fade>{accountDiscoverError}</p>
        {/if}
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <!-- IMAP Section -->
        <div class="space-y-2 rounded-md border border-white/5 bg-black/20 p-3">
          <h4 class="text-xs font-bold uppercase tracking-widest text-zinc-400">IMAP (Incoming)</h4>
          <div class="space-y-2">
            <div class="grid grid-cols-4 gap-2">
              <div class="col-span-3">
                <input
                  class="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm outline-none focus:border-accent/50"
                  placeholder="IMAP Host"
                  bind:value={accountForm.host}
                />
              </div>
              <input
                type="number"
                class="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm outline-none focus:border-accent/50"
                placeholder="Port"
                bind:value={accountForm.port}
              />
            </div>
            <input
              class="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm outline-none focus:border-accent/50"
              placeholder="IMAP Username"
              bind:value={accountForm.username}
            />
            <input
              class="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm outline-none focus:border-accent/50"
              placeholder="IMAP Password"
              type="password"
              bind:value={accountForm.password}
            />
          </div>
        </div>

        <!-- SMTP Section -->
        <div class="space-y-2 rounded-md border border-white/5 bg-black/20 p-3">
          <h4 class="text-xs font-bold uppercase tracking-widest text-zinc-400">SMTP (Outgoing)</h4>
          <div class="space-y-2">
            <div class="grid grid-cols-4 gap-2">
              <div class="col-span-3">
                <input
                  class="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm outline-none focus:border-accent/50"
                  placeholder="SMTP Host"
                  bind:value={accountForm.smtpHost}
                />
              </div>
              <input
                type="number"
                class="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm outline-none focus:border-accent/50"
                placeholder="Port"
                bind:value={accountForm.smtpPort}
              />
            </div>
            <input
              class="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm outline-none focus:border-accent/50"
              placeholder="SMTP Username"
              bind:value={accountForm.smtpUsername}
            />
            <input
              class="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm outline-none focus:border-accent/50"
              placeholder="SMTP Password"
              type="password"
              bind:value={accountForm.smtpPassword}
            />
          </div>
        </div>
      </div>
    </div>
  </form>
  <section class="space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
    <div class="space-y-1">
      <h3 class="text-sm font-medium">Connect Gmail (Google OAuth)</h3>
      <p class="text-xs text-zinc-400">
        Google App Passwords are not enough for this flow. Create an OAuth client in Google Cloud,
        then paste the client ID and secret here.
      </p>
    </div>
    <div class="space-y-2 rounded-md border border-sky-400/20 bg-sky-400/5 p-3 text-xs text-zinc-300">
      <p class="font-medium text-sky-100">Setup steps</p>
      <ol class="list-decimal space-y-1 pl-4 text-zinc-300">
        <li>
          Create or select a Google Cloud project:
          <a
            class="text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:text-sky-200"
            href="https://console.cloud.google.com/projectcreate"
            target="_blank"
            rel="noreferrer">Google Cloud Console</a
          >
        </li>
        <li>
          Enable the Gmail API for that project:
          <a
            class="text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:text-sky-200"
            href="https://developers.google.com/workspace/gmail/api/quickstart/nodejs"
            target="_blank"
            rel="noreferrer">Gmail API quickstart</a
          >
        </li>
        <li>
          Configure the OAuth consent screen:
          <a
            class="text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:text-sky-200"
            href="https://developers.google.com/workspace/guides/configure-oauth-consent"
            target="_blank"
            rel="noreferrer">OAuth consent guide</a
          >
        </li>
        <li>
          Create an OAuth client ID:
          <a
            class="text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:text-sky-200"
            href="https://developers.google.com/workspace/guides/create-credentials"
            target="_blank"
            rel="noreferrer">Create credentials guide</a
          >
        </li>
        <li>
          Add this redirect URI to the OAuth client:
          <div class="mt-1 flex items-center gap-2 rounded border border-sky-400/15 bg-black/20 px-2 py-1">
            <code class="min-w-0 flex-1 break-all font-mono text-xs text-sky-100">
              {googleOauthSettings.redirectUri}
            </code>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-50"
              onclick={() => copyToClipboard(googleOauthSettings.redirectUri, 'Redirect URI')}
              disabled={!googleOauthSettings.redirectUri}
              aria-label="Copy redirect URI"
            >
              <Copy size={11} />
              Copy
            </button>
          </div>
        </li>
        <li>
          <span class="font-medium text-sky-100">Optional (for Realtime Sync):</span> Set up a Google Cloud Pub/Sub Topic and Push Subscription pointing to:
          <div class="mt-1 flex items-center gap-2 rounded border border-sky-400/15 bg-black/20 px-2 py-1">
            <code class="min-w-0 flex-1 break-all font-mono text-xs text-sky-100">
              {googleOauthSettings.redirectUri ? googleOauthSettings.redirectUri.replace('/api/accounts/google/callback', '/api/webhooks/google') : ''}
            </code>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-50"
              onclick={() => copyToClipboard(googleOauthSettings.redirectUri ? googleOauthSettings.redirectUri.replace('/api/accounts/google/callback', '/api/webhooks/google') : '', 'Webhook URL')}
              disabled={!googleOauthSettings.redirectUri}
              aria-label="Copy Webhook URL"
            >
              <Copy size={11} />
              Copy
            </button>
          </div>
          <p class="mt-1 text-xs text-zinc-400">
            Grant <code>gmail-api-push@system.gserviceaccount.com</code> the Publisher role on your Topic. Then configure your Gmail account to watch this Topic using the Gmail API. <br>
            <a href="https://developers.google.com/gmail/api/guides/push" target="_blank" class="text-sky-300 hover:text-sky-200 underline">Read the full guide here</a>. Without this, Gmail falls back to a 5-minute poll.
          </p>
        </li>
      </ol>
      <p class="text-xs text-zinc-400">
        Use a <span class="font-medium text-zinc-200">Web application</span> OAuth client. If the
        app is still in testing, add your Google account as a test user in the consent screen.
      </p>
      <p class="text-xs text-zinc-400">
        The Gmail scopes are fixed by the app; you do not need to enter them manually.
      </p>
    </div>
    <div class="space-y-1">
      <label class="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-zinc-500">
        Client ID
        {#if googleOauthSettings.clientId}
          <span class="flex items-center gap-1 normal-case tracking-normal text-emerald-400/80">
            <Check size={10} /> Saved
          </span>
        {/if}
      </label>
      <input
        class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm focus:border-accent/50 focus:outline-none"
        placeholder="Enter Google OAuth Client ID"
        bind:value={googleOauthSettings.clientId}
      />
    </div>

    <div class="space-y-1">
      <label class="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-zinc-500">
        Client Secret
        {#if googleOauthHasSecret}
          <span class="flex items-center gap-1 normal-case tracking-normal text-emerald-400/80">
            <Check size={10} /> Saved
          </span>
        {/if}
      </label>
      <input
        class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm focus:border-accent/50 focus:outline-none"
        placeholder={googleOauthHasSecret
          ? '••••••••••••••••'
          : 'Enter Google OAuth Client Secret'}
        type="password"
        bind:value={googleOauthSettings.clientSecret}
      />
    </div>
    <Switch bind:checked={googleOauthSettings.isEnabled} label="Enabled" />
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded-md border border-white/10 px-3 py-2 text-xs transition-colors hover:bg-white/5"
        onclick={saveGoogleOauthSettings}>Save OAuth Settings</button
      >
      <button
        type="button"
        class="btn-cinematic rounded-md px-3 py-2 text-xs font-semibold text-primary-foreground"
        onclick={startGoogleConnect}>Connect Gmail Account</button
      >
    </div>
    {#if googleOauthConnectedEmail}
      <p class="text-xs text-primary">Connected: {googleOauthConnectedEmail}</p>
    {/if}
  </section>
</div>
