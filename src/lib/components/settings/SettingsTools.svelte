<script lang="ts">
  import { Copy } from 'lucide-svelte';
  import Switch from '$lib/components/ui/Switch.svelte';

  let {
    data,
    copyToClipboard,
    testAgentTool,
    toggleAgentTool,
    removeAgentTool,
    addAgentTool,
    saveToolSkills,
    saveToolConfig,
    obsidianSettings = $bindable(),
    saveObsidianSettings,
    installCliPackage,
    addWebhook,
    agentToolForm = $bindable(),
    cliInstallForm = $bindable(),
    webhookTarget = $bindable()
  } = $props<{
    data: any;
    copyToClipboard: (_value: string, _label?: string) => void | Promise<void>;
    testAgentTool: (_id: number) => void | Promise<void>;
    toggleAgentTool: (_id: number, _enabled: boolean) => void | Promise<void>;
    removeAgentTool: (_id: number) => void | Promise<void>;
    addAgentTool: () => void | Promise<void>;
    saveToolSkills: (_id: number, _skillsMarkdown: string) => Promise<any> | void;
    saveToolConfig: (
      _id: number,
      _input: { envJson: string; headersJson: string }
    ) => void | Promise<void>;
    obsidianSettings: {
      isEnabled: boolean;
      vaultPath: string;
      isMounted: boolean;
      isReadable: boolean;
      isWritable: boolean;
      resolvedVaultPath: string;
      statusLabel: string;
      statusMessage: string;
    };
    saveObsidianSettings: () => void | Promise<void>;
    installCliPackage: () => void | Promise<void>;
    addWebhook: () => void | Promise<void>;
    agentToolForm: {
      name: string;
      description: string;
      kind: string;
      endpoint: string;
      command: string;
      argsCsv: string;
      headersJson: string;
      envJson: string;
      readOnly: boolean;
      requireApprovalForWrite: boolean;
    };
    cliInstallForm: {
      manager: string;
      packageSpec: string;
      binaryName: string;
    };
    webhookTarget: string;
  }>();

  let toolSkillsDrafts = $state<Record<number, string>>({});
  let toolConfigDrafts = $state<Record<number, { envJson: string; headersJson: string }>>({});

  function toolSkillsValue(tool: { id: number; skillsMarkdown?: string | null }) {
    return toolSkillsDrafts[tool.id] ?? tool.skillsMarkdown ?? '';
  }

  async function persistToolSkills(tool: { id: number; skillsMarkdown?: string | null }) {
    const draft = toolSkillsValue(tool);
    const saved = await saveToolSkills(tool.id, draft);
    toolSkillsDrafts = {
      ...toolSkillsDrafts,
      [tool.id]: saved?.skillsMarkdown ?? draft
    };
  }

  function updateToolSkillsDraft(toolId: number, value: string) {
    toolSkillsDrafts = {
      ...toolSkillsDrafts,
      [toolId]: value
    };
  }

  function toolConfigValue(toolId: number) {
    return toolConfigDrafts[toolId] || { envJson: '', headersJson: '' };
  }

  function updateToolConfigDraft(toolId: number, field: 'envJson' | 'headersJson', value: string) {
    toolConfigDrafts = {
      ...toolConfigDrafts,
      [toolId]: {
        ...toolConfigValue(toolId),
        [field]: value
      }
    };
  }

  async function persistToolConfig(tool: { id: number }) {
    const draft = toolConfigValue(tool.id);
    await saveToolConfig(tool.id, draft);
    toolConfigDrafts = {
      ...toolConfigDrafts,
      [tool.id]: {
        envJson: '',
        headersJson: ''
      }
    };
  }
</script>

<div class="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-5">
  <h3 class="font-medium">Obsidian Vault</h3>
  <p class="mt-2 text-sm text-zinc-400">
    Optional mounted vault for durable notes and retrieval. Mount the same absolute path inside
    Docker, then enable it here so the agent can search, read, and write notes.
  </p>
  <div class="mt-3 grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="Vault path inside the container, e.g. /obsidian"
      bind:value={obsidianSettings.vaultPath}
    />
    <Switch bind:checked={obsidianSettings.isEnabled} label="Enabled" />
  </div>
  <div class="mt-3 rounded-md border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
    <p class="font-medium text-zinc-200">Status</p>
    <p class="mt-1">
      {obsidianSettings.statusLabel} · {obsidianSettings.statusMessage}
    </p>
    <p class="mt-1">
      Resolved path: <code>{obsidianSettings.resolvedVaultPath}</code>
    </p>
    {#if !obsidianSettings.isMounted || !obsidianSettings.isWritable}
      <p class="mt-1 text-amber-300">
        Mount the vault path in Docker before relying on this for durable notes.
      </p>
    {/if}
  </div>
  <div class="mt-3 flex flex-wrap items-center gap-2">
    <button
      class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black"
      onclick={saveObsidianSettings}>Save vault settings</button
    >
    <span class="text-xs text-zinc-500">
      Supported agent actions: list, search, read, write, append.
    </span>
  </div>
</div>

<div class="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-5">
  <h3 class="font-medium">Agent Tools (Bring Your Own)</h3>
  <p class="mt-2 text-sm text-zinc-400">
    Default mode is owner-trusted. Tools can run with full access for this instance. `skills.md`
    files are loaded only when the tool matters, which keeps prompts tighter.
  </p>
  <div class="mt-3 space-y-2">
    {#each data.tools as tool (tool.id)}
      <article class="rounded-md border border-white/10 bg-black/20 p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="text-sm font-medium">{tool.name}</p>
            <p class="text-xs text-zinc-500">
              {tool.kind} · {tool.readOnly ? 'read-only' : 'read/write'} · {tool.isEnabled
                ? 'enabled'
                : 'disabled'}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              class="rounded-md border border-white/10 px-2 py-1 text-xs"
              onclick={() => testAgentTool(tool.id)}>Test</button
            >
            <button
              class="rounded-md border border-white/10 px-2 py-1 text-xs"
              onclick={() => toggleAgentTool(tool.id, tool.isEnabled)}
              >{tool.isEnabled ? 'Disable' : 'Enable'}</button
            >
            <button
              class="rounded-md border border-red-400/30 px-2 py-1 text-xs text-red-200"
              onclick={() => removeAgentTool(tool.id)}>Remove</button
            >
          </div>
        </div>
        <details class="mt-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
          <summary
            class="cursor-pointer select-none text-xs uppercase tracking-[0.18em] text-zinc-500"
            >skills.md</summary
          >
          <p class="mt-2 text-xs text-zinc-500">
            Reusable playbook for this tool. Leave it blank to keep the tool generic.
          </p>
          <textarea
            class="mt-2 min-h-28 w-full rounded-md border border-white/10 bg-black/30 p-3 text-xs leading-6 outline-none"
            value={toolSkillsValue(tool)}
            oninput={(event) =>
              updateToolSkillsDraft(tool.id, (event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button
              class="rounded-md bg-accent px-2 py-1 text-xs font-medium text-black"
              onclick={() => persistToolSkills(tool)}>Save skills.md</button
            >
            <span class="text-[11px] text-zinc-500"
              >Stored at <code>/data/tool-skills/{tool.id}.md</code></span
            >
          </div>
        </details>
        <details class="mt-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
          <summary
            class="cursor-pointer select-none text-xs uppercase tracking-[0.18em] text-zinc-500"
            >Connection config</summary
          >
          <p class="mt-2 text-xs text-zinc-500">
            Put OAuth client IDs, redirect URIs, device-code values, refresh tokens, and other
            runtime secrets here. The app does not show saved secret values again, so leave a field
            blank if you want to keep the current secret unchanged.
          </p>
          <div class="mt-2 grid gap-2">
            <textarea
              class="min-h-28 w-full rounded-md border border-white/10 bg-black/30 p-3 text-xs leading-6 outline-none"
              placeholder="Env JSON, for example OPENCLAW_REDIRECT_URI and OPENCLAW_REFRESH_TOKEN"
              value={toolConfigValue(tool.id).envJson}
              oninput={(event) =>
                updateToolConfigDraft(
                  tool.id,
                  'envJson',
                  (event.currentTarget as HTMLTextAreaElement).value
                )}
            ></textarea>
            <textarea
              class="min-h-24 w-full rounded-md border border-white/10 bg-black/30 p-3 text-xs leading-6 outline-none"
              placeholder="Auth headers JSON, for example Authorization bearer values"
              value={toolConfigValue(tool.id).headersJson}
              oninput={(event) =>
                updateToolConfigDraft(
                  tool.id,
                  'headersJson',
                  (event.currentTarget as HTMLTextAreaElement).value
                )}
            ></textarea>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button
              class="rounded-md bg-accent px-2 py-1 text-xs font-medium text-black"
              onclick={() => persistToolConfig(tool)}>Save config</button
            >
            <span class="text-[11px] text-zinc-500"
              >Use this instead of SSH for OAuth values the CLI exposes as env vars.</span
            >
          </div>
        </details>
      </article>
    {/each}
  </div>
  <form
    class="mt-4 space-y-2"
    onsubmit={(event) => {
      event.preventDefault();
      addAgentTool();
    }}
  >
    <div class="grid gap-2 md:grid-cols-2">
      <input
        class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
        placeholder="Tool name"
        bind:value={agentToolForm.name}
      />
      <select
        class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
        bind:value={agentToolForm.kind}
      >
        <option value="mcp_http">MCP HTTP</option>
        <option value="cli">CLI</option>
      </select>
    </div>
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="Description"
      bind:value={agentToolForm.description}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="Endpoint URL (for MCP HTTP)"
      bind:value={agentToolForm.endpoint}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="Command (for CLI)"
      bind:value={agentToolForm.command}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="CLI args csv, e.g. -e,console.log(1)"
      bind:value={agentToolForm.argsCsv}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="Auth headers JSON map"
      bind:value={agentToolForm.headersJson}
    />
    <input
      class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="Env JSON map"
      bind:value={agentToolForm.envJson}
    />
    <div class="flex flex-wrap items-center gap-4">
      <Switch bind:checked={agentToolForm.readOnly} label="Read-only" />
      <Switch
        bind:checked={agentToolForm.requireApprovalForWrite}
        label="Require approval for writes"
      />
    </div>
    <button class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black">Add tool</button>
  </form>
</div>

<div class="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-5">
  <h3 class="font-medium">Install CLI Inside Container</h3>
  <p class="mt-2 text-sm text-zinc-400">
    Install a CLI package directly in this running instance, then reference its binary in a `cli`
    tool. Installs are persisted in `/data` manifest and re-applied automatically on startup.
  </p>
  <form
    class="mt-3 grid gap-2 md:grid-cols-4"
    onsubmit={(event) => {
      event.preventDefault();
      installCliPackage();
    }}
  >
    <select
      class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      bind:value={cliInstallForm.manager}
    >
      <option value="npm">npm</option>
      <option value="pnpm">pnpm</option>
      <option value="yarn">yarn</option>
      <option value="bun">bun</option>
      <option value="pipx">pipx</option>
      <option value="uv">uv</option>
    </select>
    <input
      class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm md:col-span-2"
      placeholder="Package spec (example: @openclaw/cli or stripe-cli)"
      bind:value={cliInstallForm.packageSpec}
    />
    <input
      class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
      placeholder="Binary (optional, e.g. openclaw)"
      bind:value={cliInstallForm.binaryName}
    />
    <button
      class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black md:col-span-4 md:justify-self-start"
      >Install CLI</button
    >
  </form>
  <p class="mt-2 text-xs text-zinc-500">
    Bootstrap log: <code>/data/cli-tools-bootstrap.log</code>
  </p>
  <div class="mt-3 rounded-md border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
    <p class="font-medium text-zinc-200">CLI secrets and OAuth</p>
    <p class="mt-1">
      Put API keys, bearer tokens, and other runtime secrets in the tool’s <code
        >Connection config</code
      >. For OAuth-based CLIs, this setup works if the tool supports a public redirect URI or a
      device-code / browser-based flow. Reverse proxying through nginx does not break OAuth by
      itself; what usually breaks is a localhost-only callback. If a CLI hardcodes localhost and
      cannot be configured, it will need a local helper, device-code auth, or manual token export.
    </p>
  </div>
</div>

<form
  class="mt-4 flex gap-2"
  onsubmit={(event) => {
    event.preventDefault();
    addWebhook();
  }}
>
  <input
    class="flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
    placeholder="Delegate webhook URL"
    bind:value={webhookTarget}
  />
  <button class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black">Add webhook</button>
</form>

<div class="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-5">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h3 class="font-medium">MCP Server</h3>
      <p class="mt-2 text-sm text-zinc-400">
        External agents can connect to this mailbox over the built-in MCP-compatible endpoint.
      </p>
    </div>
    <span class="rounded-full border border-white/10 px-2 py-1 text-[11px] text-zinc-400"
      >Bearer auth required</span
    >
  </div>
  <div class="mt-4 space-y-3">
    <div class="rounded-md border border-white/10 bg-black/20 p-3">
      <p class="text-xs uppercase tracking-[0.18em] text-zinc-500">Endpoint</p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <code class="rounded bg-black/40 px-2 py-1 text-xs text-zinc-200"
          >{data.mcp?.endpoint || data.mcp?.path || '/api/mcp/sse'}</code
        >
        <button
          class="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300"
          onclick={() =>
            copyToClipboard(data.mcp?.endpoint || data.mcp?.path || '/api/mcp/sse', 'MCP endpoint')}
        >
          <Copy size={12} />
          Copy
        </button>
      </div>
    </div>
    <div class="rounded-md border border-white/10 bg-black/20 p-3">
      <p class="text-xs uppercase tracking-[0.18em] text-zinc-500">Authorization Header</p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <code class="rounded bg-black/40 px-2 py-1 text-xs text-zinc-200"
          >{data.mcp?.authHeader || 'Authorization: Bearer <MCP_AUTH_TOKEN>'}</code
        >
        <button
          class="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300"
          onclick={() => copyToClipboard(data.mcp?.authHeader || '', 'Auth header')}
        >
          <Copy size={12} />
          Copy
        </button>
      </div>
    </div>
    <div class="rounded-md border border-white/10 bg-black/20 p-3">
      <p class="text-xs uppercase tracking-[0.18em] text-zinc-500">MCP Auth Token</p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <code class="rounded bg-black/40 px-2 py-1 text-xs text-zinc-200"
          >{data.mcp?.authToken || '(not configured)'}</code
        >
        <button
          class="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 disabled:opacity-40"
          onclick={() => copyToClipboard(data.mcp?.authToken || '', 'MCP token')}
          disabled={!data.mcp?.authToken}
        >
          <Copy size={12} />
          Copy
        </button>
      </div>
    </div>
    <div class="rounded-md border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
      <p class="font-medium text-zinc-300">Tool names</p>
      <p class="mt-1">
        search_emails, get_email_context, list_folders, move_message, set_read, set_flagged,
        generate_suggestion, regenerate_suggestion, execute_suggestion.
      </p>
    </div>
  </div>
</div>
