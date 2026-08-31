<script lang="ts">
  import { Play, Plus, Save, Trash2, X } from 'lucide-svelte';
  import { slide } from 'svelte/transition';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Switch from '$lib/components/ui/Switch.svelte';

  type Workflow = {
    id: number;
    name: string;
    description: string | null;
    enabled: boolean;
    triggerType: string;
    schedule: string | null;
    timezone: string;
    filters: Record<string, unknown>;
    planTemplate: Record<string, unknown>;
    approvalMode: string;
    dryRun: boolean;
    maxRunsPerHour: number;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    lastRunAt: string | null;
    nextRunAt: string | null;
  };

  let {
    workflows = [],
    csrfToken = '',
    messageId = null,
    onChanged = () => {},
    onStatus = (_value: string) => {}
  }: {
    workflows: Workflow[];
    csrfToken: string;
    messageId?: number | null;
    onChanged?: () => void | Promise<void>;
    onStatus?: (_value: string) => void;
  } = $props();

  let editingId = $state<number | null>(null);
  let formOpen = $state(false);
  let saving = $state(false);
  let form = $state({
    name: '',
    description: '',
    plan_template_json: '',
    enabled: false,
    trigger_type: 'manual',
    schedule: 'every 15m',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    senderContains: '',
    subjectContains: '',
    query: '',
    folderPath: '',
    unreadOnly: false,
    approval_mode: 'always',
    dry_run: true,
    max_runs_per_hour: 20,
    quiet_hours_start: '',
    quiet_hours_end: ''
  });

  function resetForm() {
    editingId = null;
    formOpen = false;
    form = {
      name: '',
      description: '',
      plan_template_json: '',
      enabled: false,
      trigger_type: 'manual',
      schedule: 'every 15m',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      senderContains: '',
      subjectContains: '',
      query: '',
      folderPath: '',
      unreadOnly: false,
      approval_mode: 'always',
      dry_run: true,
      max_runs_per_hour: 20,
      quiet_hours_start: '',
      quiet_hours_end: ''
    };
  }

  function editWorkflow(workflow: Workflow) {
    const filters = workflow.filters || {};
    editingId = workflow.id;
    formOpen = true;
    form = {
      name: workflow.name,
      description: workflow.description || '',
      plan_template_json:
        Object.keys(workflow.planTemplate || {}).length > 0
          ? JSON.stringify(workflow.planTemplate, null, 2)
          : '',
      enabled: workflow.enabled,
      trigger_type: workflow.triggerType,
      schedule: workflow.schedule || 'every 15m',
      timezone: workflow.timezone || 'UTC',
      senderContains: String(filters.senderContains || ''),
      subjectContains: String(filters.subjectContains || ''),
      query: String(filters.query || ''),
      folderPath: String(filters.folderPath || ''),
      unreadOnly: filters.unreadOnly === true,
      approval_mode: workflow.approvalMode,
      dry_run: workflow.dryRun,
      max_runs_per_hour: workflow.maxRunsPerHour,
      quiet_hours_start: workflow.quietHoursStart || '',
      quiet_hours_end: workflow.quietHoursEnd || ''
    };
  }

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        ...(init.headers || {})
      }
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  async function saveWorkflow() {
    if (!form.name.trim() || saving) return;
    saving = true;
    try {
      const filters = {
        ...(form.senderContains.trim() ? { senderContains: form.senderContains.trim() } : {}),
        ...(form.subjectContains.trim() ? { subjectContains: form.subjectContains.trim() } : {}),
        ...(form.query.trim() ? { query: form.query.trim() } : {}),
        ...(form.folderPath.trim() ? { folderPath: form.folderPath.trim() } : {}),
        ...(form.unreadOnly ? { unreadOnly: true } : {})
      };
      let planTemplate: Record<string, unknown> = {};
      if (form.plan_template_json.trim()) {
        try {
          const parsedTemplate = JSON.parse(form.plan_template_json);
          if (!parsedTemplate || typeof parsedTemplate !== 'object' || Array.isArray(parsedTemplate)) throw new Error('Plan template must be a JSON object');
          planTemplate = parsedTemplate;
        } catch (error) {
          onStatus(error instanceof Error ? error.message : 'Invalid plan template JSON');
          return;
        }
      }
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        enabled: form.enabled,
        trigger_type: form.trigger_type,
        schedule: form.trigger_type === 'schedule' ? form.schedule.trim() : null,
        timezone: form.timezone,
        filters,
        plan_template: planTemplate,
        approval_mode: form.approval_mode,
        dry_run: form.dry_run,
        max_runs_per_hour: Number(form.max_runs_per_hour) || 20,
        quiet_hours_start: form.quiet_hours_start || null,
        quiet_hours_end: form.quiet_hours_end || null
      };
      await request(editingId ? `/api/workflows/${editingId}` : '/api/workflows', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      });
      resetForm();
      onStatus('Workflow saved');
      await onChanged();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Workflow save failed');
    } finally {
      saving = false;
    }
  }

  async function toggleWorkflow(workflow: Workflow) {
    try {
      await request(`/api/workflows/${workflow.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !workflow.enabled })
      });
      onStatus(workflow.enabled ? 'Workflow paused' : 'Workflow enabled');
      await onChanged();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Workflow update failed');
    }
  }

  async function runWorkflow(workflow: Workflow) {
    try {
      await request(`/api/workflows/${workflow.id}/run`, {
        method: 'POST',
        body: JSON.stringify({ messageId })
      });
      onStatus('Workflow run created');
      await onChanged();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Workflow run failed');
    }
  }

  async function removeWorkflow(workflow: Workflow) {
    if (!confirm(`Delete workflow “${workflow.name}”?`)) return;
    try {
      await request(`/api/workflows/${workflow.id}`, { method: 'DELETE' });
      onStatus('Workflow deleted');
      await onChanged();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Workflow delete failed');
    }
  }
</script>

<section class="space-y-4" aria-labelledby="workflow-heading">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">Automation</p>
      <h3 id="workflow-heading" class="mt-1 text-lg font-semibold text-foreground">Workflows</h3>
      <p class="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
        Build durable, reviewable rules for new mail, schedules, and follow-up reminders. New rules start paused and in dry-run mode.
      </p>
    </div>
    <Button variant="default" size="sm" onclick={() => (formOpen = !formOpen)}>
      {#if formOpen}<X size={14} /> Close{:else}<Plus size={14} /> New workflow{/if}
    </Button>
  </div>

  {#if formOpen}
    <div transition:slide={{ duration: 180 }}>
      <Card class="p-4">
        <div class="grid gap-3 md:grid-cols-2">
        <label class="text-sm text-foreground md:col-span-2">Name<input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={form.name} placeholder="Invoice triage" /></label>
        <label class="text-sm text-foreground md:col-span-2">Description<textarea class="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={form.description} placeholder="Look up invoices and prepare a reviewed response"></textarea></label>
        <label class="text-sm text-foreground md:col-span-2">Plan template JSON <span class="text-xs text-muted-foreground">(optional; leave blank for AI planning)</span><textarea class="mt-1 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs" bind:value={form.plan_template_json} placeholder="Paste a validated JSON plan template"></textarea></label>
        <label class="text-sm text-foreground">Trigger<select class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={form.trigger_type}><option value="manual">Manual</option><option value="new_message">New message poll</option><option value="schedule">Schedule</option><option value="follow_up_due">Follow-up due</option><option value="webhook">Webhook</option></select></label>
        <label class="text-sm text-foreground">Schedule<input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50" bind:value={form.schedule} disabled={form.trigger_type !== 'schedule'} placeholder="every 15m" /></label>
        <label class="text-sm text-foreground">Sender contains<input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={form.senderContains} placeholder="billing@" /></label>
        <label class="text-sm text-foreground">Subject contains<input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={form.subjectContains} placeholder="invoice" /></label>
        <label class="text-sm text-foreground md:col-span-2">Message contains<input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={form.query} placeholder="refund, renewal, or customer name" /></label>
        <label class="text-sm text-foreground">Folder path<input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={form.folderPath} placeholder="INBOX" /></label>
        <label class="text-sm text-foreground">Timezone<input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={form.timezone} /></label>
        <div class="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground"><Switch bind:checked={form.unreadOnly} label="Unread only" /></div>
        <div class="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground"><Switch bind:checked={form.dry_run} label="Dry-run previews" /></div>
        <div class="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground"><Switch bind:checked={form.enabled} label="Enable after save" /></div>
        <label class="text-sm text-foreground">Approval mode<select class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={form.approval_mode}><option value="always">Always review</option><option value="risk_based">Risk based</option><option value="read_only_auto">Read-only auto</option></select></label>
        <label class="text-sm text-foreground">Runs per hour<input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" type="number" min="1" max="1000" bind:value={form.max_runs_per_hour} /></label>
        <label class="text-sm text-foreground">Quiet hours start<input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" type="time" bind:value={form.quiet_hours_start} /></label>
        <label class="text-sm text-foreground">Quiet hours end<input class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" type="time" bind:value={form.quiet_hours_end} /></label>
        </div>
        <div class="mt-4 flex justify-end gap-2"><Button variant="outline" size="sm" onclick={resetForm}>Cancel</Button><Button variant="default" size="sm" onclick={saveWorkflow} disabled={saving || !form.name.trim()}><Save size={13} /> {saving ? 'Saving…' : 'Save workflow'}</Button></div>
      </Card>
    </div>
  {/if}

  <div class="grid gap-3 lg:grid-cols-2">
    {#each workflows as workflow (workflow.id)}
      <Card class="p-4" hover>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0"><div class="flex items-center gap-2"><span class={`h-2 w-2 rounded-full ${workflow.enabled ? 'bg-primary animate-pulse' : 'bg-muted-foreground/50'}`}></span><h4 class="truncate font-medium text-foreground">{workflow.name}</h4></div><p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{workflow.description || 'No description'}</p></div>
          <Switch checked={workflow.enabled} label={workflow.enabled ? 'Enabled' : 'Paused'} onchange={() => toggleWorkflow(workflow)} />
        </div>
        <div class="mt-3 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground"><span class="rounded-full border border-border px-2 py-1">{workflow.triggerType.replaceAll('_', ' ')}</span><span class="rounded-full border border-border px-2 py-1">{workflow.dryRun ? 'dry run' : 'assistive'}</span><span class="rounded-full border border-border px-2 py-1">{workflow.approvalMode.replaceAll('_', ' ')}</span></div>
        <p class="mt-3 text-xs text-muted-foreground">{workflow.nextRunAt ? `Next run ${new Date(workflow.nextRunAt).toLocaleString()}` : 'Not scheduled'}</p>
        {#if workflow.triggerType === 'webhook'}
          <p class="mt-2 break-all rounded border border-border/60 bg-muted/20 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
            POST /api/workflows/{workflow.id}/webhook · Authorization: Bearer MCP token
          </p>
        {/if}
        <div class="mt-3 flex gap-2"><Button variant="default" size="sm" onclick={() => runWorkflow(workflow)}><Play size={13} /> Run</Button><Button variant="outline" size="sm" onclick={() => editWorkflow(workflow)}>Edit</Button><Button variant="ghost" size="sm" onclick={() => removeWorkflow(workflow)} title="Delete workflow" aria-label="Delete workflow"><Trash2 size={13} /></Button></div>
      </Card>
    {:else}
      <Card class="p-5 lg:col-span-2"><p class="text-sm text-muted-foreground">No workflows yet. Create one to turn repeated email work into a reviewable automation.</p></Card>
    {/each}
  </div>
</section>
