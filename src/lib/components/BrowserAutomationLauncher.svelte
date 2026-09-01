<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { fade, fly, scale, slide } from 'svelte/transition';
  import {
    CalendarClock,
    Check,
    CircleStop,
    Download,
    Globe2,
    KeyRound,
    LoaderCircle,
    RefreshCw,
    ShieldCheck,
    X
  } from 'lucide-svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Switch from '$lib/components/ui/Switch.svelte';

  type Message = {
    id: number;
    subject: string;
    from: string;
    bodyText?: string | null;
  };
  type Run = {
    id: number;
    status: string;
    downloadFilename?: string | null;
    downloadPath?: string | null;
    errorMessage?: string | null;
  };

  let {
    message,
    csrfToken = '',
    onStatus = (_value: string) => {},
    onChanged = () => {},
    onClosed = () => {},
    onReview = () => {}
  }: {
    message: Message | null;
    csrfToken?: string;
    onStatus?: (_value: string) => void;
    onChanged?: () => void | Promise<void>;
    onClosed?: () => void;
    onReview?: () => void | Promise<void>;
  } = $props();

  let open = $state(false);
  let phase = $state<'idle' | 'loading' | 'ready' | 'recording' | 'completed'>('idle');
  let links = $state<string[]>([]);
  let startUrl = $state('');
  let name = $state('');
  let username = $state('');
  let password = $state('');
  let repeatWeekly = $state(true);
  let enableWorkflow = $state(false);
  let run = $state<Run | null>(null);
  let profileId = $state<number | null>(null);
  let recipeId = $state<number | null>(null);
  let workflow = $state<{ name: string; enabled: boolean } | null>(null);
  let errorMessage = $state('');
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let bridgeAvailable = $state(false);
  let bridgeChecked = $state(false);
  let serverFallbackAvailable = $state(false);
  let recordingMode = $state<'client' | 'server'>('client');
  let clientSessionId = $state('');
  let clientActions = $state<Array<Record<string, unknown>>>([]);
  let clientDownloadFilename = $state('');
  let bridgeTimeout: ReturnType<typeof setTimeout> | null = null;

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

  function reset() {
    phase = 'idle';
    links = [];
    startUrl = '';
    name = '';
    username = '';
    password = '';
    repeatWeekly = true;
    enableWorkflow = false;
    run = null;
    profileId = null;
    recipeId = null;
    workflow = null;
    errorMessage = '';
    recordingMode = 'client';
    clientSessionId = '';
    clientActions = [];
    clientDownloadFilename = '';
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function bridgeMessage(event: MessageEvent) {
    if (event.source !== window || event.data?.source !== 'dear-robot-browser-bridge') return;
    if (event.data.type === 'READY') {
      bridgeAvailable = true;
      bridgeChecked = true;
      if (bridgeTimeout) clearTimeout(bridgeTimeout);
      bridgeTimeout = null;
      return;
    }
    if (event.data.type !== 'BRIDGE_EVENT' || event.data.sessionId !== clientSessionId) return;
    const bridgeEvent = event.data.event || {};
    if (bridgeEvent.type === 'STARTED') {
      onStatus('Your browser is ready. Complete the sign-in and report download there.');
    } else if (bridgeEvent.type === 'ACTION' && bridgeEvent.action) {
      clientActions = [...clientActions, bridgeEvent.action].slice(-100);
      if (bridgeEvent.action.type === 'download' && bridgeEvent.downloadFilename) {
        clientDownloadFilename = String(bridgeEvent.downloadFilename);
      }
    } else if (bridgeEvent.type === 'ERROR') {
      errorMessage = String(bridgeEvent.message || 'The browser bridge stopped unexpectedly.');
      onStatus(errorMessage);
    }
  }

  function pingBridge() {
    bridgeChecked = false;
    if (bridgeTimeout) clearTimeout(bridgeTimeout);
    window.postMessage({ source: 'dear-robot-app', type: 'PING' }, '*');
    bridgeTimeout = setTimeout(() => {
      bridgeChecked = true;
      bridgeTimeout = null;
    }, 450);
  }

  async function openLauncher() {
    if (!message) return;
    reset();
    open = true;
    phase = 'loading';
    try {
      const result = await request(`/api/messages/${message.id}/browser-automation`, { method: 'GET' });
      links = result.links || [];
      const existing = result.automation;
      startUrl = existing?.recipe?.startUrl || links[0] || '';
      name = existing?.recipe?.name || `Download ${message.subject}`.slice(0, 120);
      phase = 'ready';
    } catch (error) {
      phase = 'ready';
      errorMessage = error instanceof Error ? error.message : 'Could not inspect this email';
    }
  }

  async function startServerBrowser() {
    if (!message || !startUrl.trim()) {
      errorMessage = 'Paste the dashboard URL from the email to continue.';
      return;
    }
    phase = 'loading';
    errorMessage = '';
    try {
      const result = await request(`/api/messages/${message.id}/browser-automation`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'start',
          startUrl: startUrl.trim(),
          name: name.trim() || undefined,
          username: username.trim() || undefined,
          password: password || undefined
        })
      });
      run = result.run;
      profileId = result.profile?.id || null;
      recipeId = result.recipe?.id || null;
      phase = 'recording';
      recordingMode = 'server';
      onStatus('Secure browser opened. Sign in if needed, download the report, then return here.');
      pollRun(result.run.id);
    } catch (error) {
      phase = 'ready';
      errorMessage = error instanceof Error ? error.message : 'Could not open the guided browser';
    }
  }

  async function startClientBrowser() {
    if (!message || !startUrl.trim()) {
      errorMessage = 'Paste the dashboard URL from the email to continue.';
      return;
    }
    phase = 'loading';
    errorMessage = '';
    clientActions = [];
    clientDownloadFilename = '';
    clientSessionId = globalThis.crypto?.randomUUID?.() || `dear-robot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const result = await request(`/api/messages/${message.id}/browser-automation`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'start_client',
          startUrl: startUrl.trim(),
          name: name.trim() || undefined,
          username: username.trim() || undefined,
          password: password || undefined
        })
      });
      run = result.run;
      profileId = result.profile?.id || null;
      recipeId = result.recipe?.id || null;
      recordingMode = 'client';
      phase = 'recording';
      window.postMessage(
        {
          source: 'dear-robot-app',
          type: 'START_RECORDING',
          sessionId: clientSessionId,
          startUrl: startUrl.trim()
        },
        '*'
      );
      onStatus('Your browser opened in a new tab. Complete the report there, then return here.');
    } catch (error) {
      phase = 'ready';
      errorMessage = error instanceof Error ? error.message : 'Could not start browser recording';
    }
  }

  async function startGuidedBrowser() {
    if (bridgeAvailable) return startClientBrowser();
    if (!serverFallbackAvailable) {
      errorMessage = 'Install the browser bridge to record on this device.';
      return;
    }
    return startServerBrowser();
  }

  async function pollRun(id: number) {
    if (pollTimer) clearInterval(pollTimer);
    const poll = async () => {
      try {
        const result = await request(`/api/browser/runs/${id}`);
        run = result.run;
        if (!['recording', 'running'].includes(result.run.status)) {
          if (pollTimer) clearInterval(pollTimer);
          pollTimer = null;
        }
      } catch {
        // Keep the guided session visible if the browser is temporarily unavailable.
      }
    };
    pollTimer = setInterval(() => void poll(), 1200);
    await poll();
  }

  async function finishGuidedBrowser() {
    if (!message || !run || !profileId || !recipeId) return;
    phase = 'loading';
    errorMessage = '';
    try {
      if (recordingMode === 'client') {
        window.postMessage(
          { source: 'dear-robot-app', type: 'STOP_RECORDING', sessionId: clientSessionId },
          '*'
        );
        // Let the bridge forward the final blur/click event before persisting
        // the action list captured in this page.
        await new Promise((resolve) => setTimeout(resolve, 250));
        const result = await request(`/api/messages/${message.id}/browser-automation`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'complete_client',
            runId: run.id,
            profileId,
            recipeId,
            actions: clientActions,
            downloadFilename: clientDownloadFilename || undefined,
            username: username.trim() || undefined,
            password: password || undefined,
            createWorkflow: repeatWeekly,
            enableWorkflow,
            schedule: 'every 7d',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          })
        });
        run = result.run;
        workflow = result.workflow;
        password = '';
        phase = 'completed';
        onStatus(
          workflow
            ? `${workflow.name} is ready in paused dry-run mode.`
            : 'Report automation saved.'
        );
        await onChanged();
        return;
      }
      const result = await request(`/api/messages/${message.id}/browser-automation`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'complete',
          runId: run.id,
          profileId,
          recipeId,
          username: username.trim() || undefined,
          password: password || undefined,
          createWorkflow: repeatWeekly,
          enableWorkflow,
          schedule: 'every 7d',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        })
      });
      run = result.run;
      workflow = result.workflow;
      password = '';
      phase = 'completed';
      onStatus(
        workflow
          ? `${workflow.name} is ready in paused dry-run mode.`
          : 'Report automation saved.'
      );
      await onChanged();
    } catch (error) {
      phase = 'recording';
      errorMessage = error instanceof Error ? error.message : 'Could not save this automation';
    }
  }

  async function cancelGuidedBrowser() {
    if (!run) return closeLauncher();
    if (recordingMode === 'client') {
      window.postMessage(
        { source: 'dear-robot-app', type: 'STOP_RECORDING', sessionId: clientSessionId },
        '*'
      );
    }
    try {
      await request(`/api/browser/runs/${run.id}/cancel`, { method: 'POST', body: '{}' });
    } catch {
      // Closing the dialog is still safe if the browser already exited.
    }
    onStatus('Guided browser setup cancelled.');
    closeLauncher();
  }

  function closeLauncher() {
    if (phase === 'recording') return;
    open = false;
    reset();
    onClosed();
  }

  onMount(() => {
    serverFallbackAvailable = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
    window.addEventListener('message', bridgeMessage);
    pingBridge();
    if (message) void openLauncher();
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (bridgeTimeout) clearTimeout(bridgeTimeout);
    window.removeEventListener('message', bridgeMessage);
  });
</script>

{#if open && message}
  <div
    class="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
    role="presentation"
    transition:fade={{ duration: 150 }}
    onclick={closeLauncher}
    onkeydown={(event) => event.key === 'Escape' && closeLauncher()}
  >
    <div
      class="max-h-[min(760px,calc(100dvh-2rem))] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="browser-automation-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
      in:scale={{ duration: 180, start: 0.96 }}
    >
      <div class="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div class="flex min-w-0 items-start gap-3">
          <div class="rounded-xl bg-primary/10 p-2.5 text-primary"><Globe2 size={18} /></div>
          <div class="min-w-0">
            <h2 id="browser-automation-title" class="text-base font-semibold text-foreground">Automate this email</h2>
            <p class="mt-1 truncate text-xs text-muted-foreground">{message.subject}</p>
          </div>
        </div>
        {#if phase !== 'recording'}
          <button class="touch-target rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close automation setup" title="Close" onclick={closeLauncher}><X size={16} /></button>
        {/if}
      </div>

      <div class="space-y-5 p-5">
        {#if phase === 'loading'}
          <div class="flex flex-col items-center gap-3 py-12 text-center" in:fade={{ duration: 120 }}>
            <LoaderCircle size={24} class="animate-spin text-primary" />
            <p class="text-sm text-muted-foreground">Preparing your guided setup…</p>
          </div>
        {:else if phase === 'ready'}
          <div class="space-y-4" in:fly={{ y: 8, duration: 160 }}>
            <div class="rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
              <div class="flex items-start gap-2">
                <ShieldCheck size={16} class="mt-0.5 shrink-0 text-primary" />
                <div>
                  <p class="text-sm font-medium text-foreground">One guided setup</p>
                  <p class="mt-1 text-xs leading-5 text-muted-foreground">Dear Robot creates the secure profile and recipe for you. You only need to complete the report once.</p>
                </div>
              </div>
            </div>

            {#if !bridgeChecked}
              <div class="flex items-center gap-2 rounded-lg border border-border bg-muted/10 px-3 py-2 text-xs text-muted-foreground" in:fade={{ duration: 120 }}>
                <LoaderCircle size={13} class="animate-spin" /> Checking for the browser bridge…
              </div>
            {:else if bridgeAvailable}
              <div class="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-xs text-primary" in:fade={{ duration: 120 }}>
                <Globe2 size={13} /> Browser bridge connected · recording will happen in your browser
              </div>
            {:else}
              <div class="space-y-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2.5 text-xs text-amber-100" in:fade={{ duration: 120 }}>
                <p class="font-medium">Install the browser bridge to record on this device.</p>
                <p class="leading-5 text-amber-100/70">{serverFallbackAvailable ? 'Without it, Dear Robot can only open a server-side window on this computer.' : 'This app is running remotely, so a client browser bridge is required.'}</p>
                <div class="flex flex-wrap gap-x-3 gap-y-1">
                  <a class="inline-flex items-center font-medium text-amber-200 underline decoration-amber-200/40 underline-offset-2 hover:text-amber-100" href="/browser-bridge/dear-robot-browser-bridge.zip" download>Download bridge</a>
                  <a class="inline-flex items-center font-medium text-amber-200 underline decoration-amber-200/40 underline-offset-2 hover:text-amber-100" href="/browser-bridge/README.md" target="_blank" rel="noreferrer">Install instructions</a>
                </div>
              </div>
            {/if}

            {#if links.length > 0}
              <div class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Link from the email</p>
                <div class="space-y-1.5">
                  {#each links.slice(0, 5) as link (link)}
                    <button class={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${startUrl === link ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-background/50 text-muted-foreground hover:border-primary/30 hover:text-foreground'}`} onclick={() => (startUrl = link)}>
                      <span class="min-w-0 flex-1 truncate">{link}</span>
                      {#if startUrl === link}<Check size={13} class="shrink-0 text-primary" />{/if}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            <label class="block text-sm text-foreground">Dashboard URL <span class="text-xs text-muted-foreground">(edit if the email link is indirect)</span>
              <input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" bind:value={startUrl} placeholder="https://dashboard.example.com/reports" autocomplete="url" />
            </label>
            <label class="block text-sm text-foreground">Automation name <span class="text-xs text-muted-foreground">(optional)</span>
              <input class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" bind:value={name} placeholder="Weekly delivery report" />
            </label>

            <div class="rounded-xl border border-border bg-muted/10 p-3">
              <div class="flex items-center gap-2"><KeyRound size={15} class="text-primary" /><p class="text-sm font-medium text-foreground">Server login (optional)</p></div>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">Save credentials once so the server can renew an expired session. Leave blank for SSO or manual MFA.</p>
              <div class="mt-3 grid gap-2 sm:grid-cols-2">
                <input class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" autocomplete="username" placeholder="Email or username" bind:value={username} />
                <input class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" autocomplete="new-password" type="password" placeholder="Password" bind:value={password} />
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/10 px-3 py-2.5">
              <div class="flex items-center gap-2"><CalendarClock size={15} class="text-primary" /><div><p class="text-sm font-medium text-foreground">Repeat weekly</p><p class="text-xs text-muted-foreground">Starts paused in dry-run mode</p></div></div>
              <Switch bind:checked={repeatWeekly} label="Repeat this report weekly" />
            </div>
            {#if repeatWeekly}
              <div class="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/10 px-3 py-2.5">
                <div><p class="text-sm font-medium text-foreground">Enable after setup</p><p class="text-xs text-muted-foreground">Keep off until you verify one test run</p></div>
                <Switch bind:checked={enableWorkflow} label="Enable weekly workflow automatically" />
              </div>
            {/if}
            {#if errorMessage}<p class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{errorMessage}</p>{/if}
            <div class="flex flex-wrap gap-2">
              <Button class="min-w-0 flex-1" onclick={startGuidedBrowser} disabled={!startUrl.trim() || !bridgeChecked || (!bridgeAvailable && !serverFallbackAvailable)}>
                <Globe2 size={15} /> {bridgeAvailable ? 'Record in my browser' : serverFallbackAvailable ? 'Open local browser window' : 'Install bridge to continue'}
              </Button>
              {#if !bridgeAvailable}<Button variant="outline" size="sm" onclick={pingBridge} title="Check for the browser bridge" aria-label="Check for the browser bridge"><RefreshCw size={15} /></Button>{/if}
            </div>
          </div>
        {:else if phase === 'recording'}
          <div class="space-y-4" in:fly={{ y: 8, duration: 160 }}>
            <div class="rounded-xl border border-primary/30 bg-primary/[0.06] p-4">
              <div class="flex items-start gap-3">
                <div class="mt-0.5 rounded-full bg-primary/15 p-2 text-primary"><LoaderCircle size={17} class="animate-spin" /></div>
                <div>
                  <p class="text-sm font-semibold text-foreground">Finish the report {recordingMode === 'client' ? 'in your browser' : 'in the browser window'}</p>
                  <p class="mt-1 text-sm leading-6 text-muted-foreground">Sign in if asked, open the latest report, and download it. When the file is saved, return here and click Done.</p>
                </div>
              </div>
            </div>
            <ol class="space-y-2 text-xs text-muted-foreground">
              <li class="flex gap-2"><span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">1</span><span>Complete sign-in or MFA in the report browser tab.</span></li>
              <li class="flex gap-2"><span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">2</span><span>Navigate to the report and download the file.</span></li>
              <li class="flex gap-2"><span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">3</span><span>Return here and save the automation.</span></li>
            </ol>
            {#if recordingMode === 'client'}<p class="rounded-lg border border-border bg-muted/10 px-3 py-2 text-xs text-muted-foreground" transition:slide={{ duration: 140 }}>Captured {clientActions.length} step{clientActions.length === 1 ? '' : 's'}{#if clientDownloadFilename} · {clientDownloadFilename}{/if}</p>{/if}
            {#if run?.downloadFilename}<div class="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary" transition:slide={{ duration: 140 }}><Download size={14} /> Downloaded {run.downloadFilename}</div>{/if}
            {#if errorMessage}<p class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{errorMessage}</p>{/if}
            <div class="flex flex-wrap justify-end gap-2"><Button variant="ghost" size="sm" onclick={cancelGuidedBrowser}><CircleStop size={14} /> Cancel</Button><Button size="sm" onclick={finishGuidedBrowser}><Check size={14} /> Done — save automation</Button></div>
          </div>
        {:else if phase === 'completed'}
          <div class="space-y-4 text-center" in:fly={{ y: 8, duration: 160 }}>
            <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary"><Check size={28} /></div>
            <div><p class="text-base font-semibold text-foreground">Automation saved</p><p class="mt-1 text-sm leading-6 text-muted-foreground">The safe browser steps are now stored on the server. {#if workflow}Your weekly workflow is paused until you enable it in Operations.{/if}</p></div>
            {#if run?.downloadFilename}<div class="mx-auto inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary"><Download size={14} /> {run.downloadFilename}</div>{/if}
            <div class="flex items-center justify-center gap-2"><Button variant="outline" size="sm" onclick={closeLauncher}>Close</Button><Button size="sm" onclick={() => { closeLauncher(); void onReview(); }}>Review in Operations</Button></div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
