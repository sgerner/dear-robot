<script lang="ts">
  import {
    Bot,
    Check,
    CheckSquare2,
    ChevronLeft,
    Clock3,
    Download,
    Eye,
    EyeOff,
    FolderOpen,
    Forward,
    Inbox,
    Loader2,
    Mail,
    PenLine,
    Plus,
    RefreshCw,
    Reply,
    ReplyAll,
    Search,
    Send,
    Settings,
    Shield,
    Square,
    Star,
    Paperclip,
    Trash2,
    Upload,
    X
  } from 'lucide-svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { fade, fly } from 'svelte/transition';
  import { deleteOutbox, enqueueOutbox, listOutbox, putLocalDraft, replaceCache, setCacheMeta } from '$lib/client/local-cache';

  let { data } = $props();
  let view = $state('inbox');
  let isLoading = $state(false);
  let search = $state('');
  let accountFilter = $state<string>('');
  let accountForm = $state({
    email: '',
    host: '',
    port: 993,
    username: '',
    password: '',
    smtpHost: '',
    smtpPort: 465,
    smtpUsername: '',
    smtpPassword: ''
  });
  let draftText = $state('');
  let regenNote = $state('');
  let memoryText = $state('');
  let webhookTarget = $state('');
  let status = $state('');
  let taskNote = $state('');
  const aiProfileKeys = ['primary', 'fallback', 'advanced'] as const;
  function seedAiProfileForm(profile: 'primary' | 'fallback' | 'advanced') {
    const saved = data.aiProfiles?.find((item: { profile: string }) => item.profile === profile);
    const preset = data.aiPresets?.find((item: { id: string; provider: string }) => item.id === saved?.preset || item.provider === saved?.provider);
    const fallbackPreset = data.aiPresets?.find((item: { id: string }) => item.id === profile) || data.aiPresets?.[0];
    const chosen = preset || fallbackPreset;
    return {
      profile,
      label: saved?.label || chosen?.label || profile,
      provider: saved?.provider || chosen?.provider || '',
      transport: saved?.transport || chosen?.transport || 'openai_compatible',
      model: saved?.model || chosen?.defaultModel || '',
      baseUrl: saved?.baseUrl || chosen?.baseUrl || '',
      apiKey: '',
      preset: saved?.preset || chosen?.id || 'manual',
      isEnabled: saved?.isEnabled ?? true,
      notes: saved?.notes || chosen?.notes || ''
    };
  }
  let aiProfileForms = $state<Record<string, {
    profile: 'primary' | 'fallback' | 'advanced';
    label: string;
    provider: string;
    transport: 'openai_compatible' | 'anthropic';
    model: string;
    baseUrl: string;
    apiKey: string;
    preset: string;
    isEnabled: boolean;
    notes: string;
  }>>({});
  let agentToolForm = $state({
    name: '',
    description: '',
    kind: 'mcp_http',
    endpoint: '',
    command: '',
    argsCsv: '',
    headersJson: '',
    envJson: '',
    readOnly: false,
    requireApprovalForWrite: true
  });
  let bodyMode = $state<'text' | 'html'>('text');
  let searchInput: HTMLInputElement | undefined;
  let composeOpen = $state(false);
  let composeMode = $state<'compose' | 'reply' | 'reply_all' | 'forward'>('compose');
  let composeEditorMode = $state<'plain' | 'rich'>('plain');
  let composeHtml = $state('');
  let composeAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedMessageIds = $state<number[]>([]);
  let contactsImportCsv = $state('');
  let compose = $state({
    draftId: null as number | null,
    accountId: 0,
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    attachments: [] as Array<{ filename: string; contentType: string; contentBase64: string }>,
    sourceMessageId: null as number | null
  });

  type DraftView = {
    id: number;
    accountId: number | null;
    mode: 'compose' | 'reply' | 'reply_all' | 'forward';
    sourceMessageId: number | null;
    to: string;
    cc: string | null;
    bcc: string | null;
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    status: string;
    attachments: Array<{ filename: string; contentType?: string | null; contentBase64: string }>;
  };

  $effect(() => {
    view = data.query?.view || 'inbox';
    search = data.query?.q || '';
    accountFilter = data.query?.accountId ? String(data.query.accountId) : '';
    draftText = data.selected?.suggestion?.draftReply || '';
    memoryText = data.memory;
    bodyMode = data.selected?.message?.safeBodyHtml ? 'html' : 'text';
    if (!compose.accountId) compose.accountId = data.selected?.message?.accountId || data.accounts[0]?.id || 0;
    void replaceCache('messages', data.messages);
    void replaceCache('folders', data.folders);
    void replaceCache('contacts', data.contacts);
    void setCacheMeta('lastPageCacheAt', new Date().toISOString());
  });

  aiProfileForms = {
    primary: seedAiProfileForm('primary'),
    fallback: seedAiProfileForm('fallback'),
    advanced: seedAiProfileForm('advanced')
  } as typeof aiProfileForms;

  $effect(() => {
    if (!composeOpen) return;
    if (composeAutosaveTimer) clearTimeout(composeAutosaveTimer);
    composeAutosaveTimer = setTimeout(() => {
      void saveDraft();
    }, 900);
    return () => {
      if (composeAutosaveTimer) clearTimeout(composeAutosaveTimer);
    };
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.getAttribute('contenteditable') === 'true';
      if (!typing && event.key === '/') {
        event.preventDefault();
        searchInput?.focus();
        return;
      }
      if (typing) return;
      if (event.key === 'c') {
        event.preventDefault();
        openCompose('compose');
        return;
      }
      if (!['inbox', 'pending'].includes(view)) return;
      const selectedId = data.selected?.message?.id ?? data.messages[0]?.id;
      const index = data.messages.findIndex((message: { id: number }) => message.id === selectedId);
      if (event.key === 'j') {
        const next = data.messages[Math.min(index + 1, data.messages.length - 1)];
        if (next) void selectMessage(next.id);
      } else if (event.key === 'k') {
        const prev = data.messages[Math.max(index - 1, 0)];
        if (prev) void selectMessage(prev.id);
      }
    };
    const onOnline = () => void flushOutbox();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('online', onOnline);
    void flushOutbox();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('online', onOnline);
    };
  });

  async function api(path: string, options: RequestInit = {}) {
    isLoading = true;
    try {
      const response = await fetch(path, {
        ...options,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': data.csrfToken,
          ...(options.headers || {})
        }
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    } finally {
      isLoading = false;
    }
  }

  async function selectMessage(id: number) {
    isLoading = true;
    try {
      const params = new URLSearchParams(location.search);
      params.set('message', String(id));
      if (view !== 'inbox') params.set('view', view);
      if (search) params.set('q', search);
      if (accountFilter) params.set('accountId', accountFilter);
      if (data.query?.folder) params.set('folder', data.query.folder);
      await goto(`/?${params.toString()}`, { keepFocus: true });
    } finally {
      isLoading = false;
    }
  }

  async function deselectMessage() {
    isLoading = true;
    try {
      const params = new URLSearchParams(location.search);
      params.delete('message');
      await goto(`/?${params.toString()}`);
    } finally {
      isLoading = false;
    }
  }

  async function applySearch() {
    isLoading = true;
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (view !== 'inbox') params.set('view', view);
      if (accountFilter) params.set('accountId', accountFilter);
      if (data.query?.folder) params.set('folder', data.query.folder);
      await goto(`/?${params.toString()}`);
    } finally {
      isLoading = false;
    }
  }

  async function executeSuggestion() {
    if (!data.selected?.suggestion) return;
    status = 'Executing...';
    await api(`/api/suggestions/${data.selected.suggestion.id}/execute`, { method: 'POST', body: '{}' });
    status = 'Executed';
    await invalidateAll();
  }

  async function saveEdit() {
    if (!data.selected?.suggestion) return;
    status = 'Saving edit...';
    await api(`/api/suggestions/${data.selected.suggestion.id}/edit`, {
      method: 'POST',
      body: JSON.stringify({ draft_reply: draftText || null })
    });
    status = 'Saved';
    await invalidateAll();
  }

  async function rejectSuggestion() {
    if (!data.selected?.suggestion) return;
    await api(`/api/suggestions/${data.selected.suggestion.id}/reject`, { method: 'POST', body: '{}' });
    await invalidateAll();
  }

  async function regenerate() {
    if (!data.selected?.message) return;
    status = 'Regenerating...';
    await api(`/api/messages/${data.selected.message.id}/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ note: regenNote })
    });
    regenNote = '';
    status = 'Regenerated';
    await invalidateAll();
  }

  async function generateSuggestion(messageId: number) {
    await api(`/api/messages/${messageId}/suggest`, { method: 'POST', body: '{}' });
    await invalidateAll();
  }

  async function addAccount() {
    status = 'Adding account...';
    await api('/api/accounts', { method: 'POST', body: JSON.stringify(accountForm) });
    accountForm = {
      email: '',
      host: '',
      port: 993,
      username: '',
      password: '',
      smtpHost: '',
      smtpPort: 465,
      smtpUsername: '',
      smtpPassword: ''
    };
    status = 'Account added';
    await invalidateAll();
  }

  async function accountAction(id: number, action: 'test' | 'enable' | 'disable' | 'delete') {
    status = `${action} account...`;
    if (action === 'delete') await api(`/api/accounts/${id}`, { method: 'DELETE' });
    else await api(`/api/accounts/${id}/${action}`, { method: 'POST', body: '{}' });
    status = `Account ${action} complete`;
    await invalidateAll();
  }

  async function saveMemory() {
    await api('/api/memory', { method: 'POST', body: JSON.stringify({ markdown: memoryText }) });
    status = 'Memory saved';
    await invalidateAll();
  }

  async function resetMemory() {
    isLoading = true;
    try {
      const response = await fetch('/api/memory');
      const json = await response.json();
      memoryText = json.defaultMarkdown;
    } finally {
      isLoading = false;
    }
  }

  async function addWebhook() {
    await api('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'delegate', targetUrl: webhookTarget })
    });
    webhookTarget = '';
    status = 'Webhook added';
  }

  async function createTaskPlan() {
    if (!data.selected?.message) return;
    status = 'Planning task...';
    await api(`/api/messages/${data.selected.message.id}/plan`, {
      method: 'POST',
      body: JSON.stringify({ note: taskNote || null })
    });
    taskNote = '';
    status = 'Task plan generated';
    await invalidateAll();
  }

  async function approveTask(taskId: number, stepId: number | null = null) {
    status = 'Approving task...';
    await api(`/api/tasks/${taskId}/approve`, {
      method: 'POST',
      body: JSON.stringify(stepId ? { stepId } : {})
    });
    status = 'Approved';
    await invalidateAll();
  }

  async function rejectTask(taskId: number) {
    status = 'Rejecting task...';
    await api(`/api/tasks/${taskId}/reject`, { method: 'POST', body: '{}' });
    status = 'Task rejected';
    await invalidateAll();
  }

  async function executeTask(taskId: number) {
    status = 'Executing task...';
    await api(`/api/tasks/${taskId}/execute`, { method: 'POST', body: '{}' });
    status = 'Task execution finished';
    await invalidateAll();
  }

  async function selectFolder(accountId: number, folderPath: string) {
    const params = new URLSearchParams();
    params.set('accountId', String(accountId));
    params.set('folder', folderPath);
    await goto(`/?${params.toString()}`);
  }

  async function setQuickView(nextView: string) {
    const params = new URLSearchParams();
    if (nextView !== 'inbox') params.set('view', nextView);
    await goto(`/?${params.toString()}`);
  }

  async function moveSelected(folderPath: string) {
    if (!data.selected?.message) return;
    status = 'Moving message...';
    await api(`/api/messages/${data.selected.message.id}/move`, {
      method: 'POST',
      body: JSON.stringify({ folderPath })
    });
    status = 'Moved';
    await invalidateAll();
  }

  function toggleBulkMessage(id: number, selected: boolean) {
    if (selected) {
      if (!selectedMessageIds.includes(id)) selectedMessageIds = [...selectedMessageIds, id];
      return;
    }
    selectedMessageIds = selectedMessageIds.filter((value) => value !== id);
  }

  function toggleSelectAllVisible(selected: boolean) {
    if (!selected) {
      selectedMessageIds = [];
      return;
    }
    selectedMessageIds = data.messages.map((message: { id: number }) => message.id);
  }

  async function runBulkAction(action: 'move' | 'mark_read' | 'mark_unread' | 'flag' | 'unflag', folderPath?: string) {
    if (!selectedMessageIds.length) return;
    status = `Applying ${action.replace('_', ' ')}...`;
    await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ action, folderPath, messageIds: selectedMessageIds })
    });
    selectedMessageIds = [];
    status = 'Bulk action complete';
    await invalidateAll();
  }

  async function toggleRead() {
    if (!data.selected?.message) return;
    await api(`/api/messages/${data.selected.message.id}/read`, {
      method: 'POST',
      body: JSON.stringify({ read: !data.selected.message.isRead })
    });
    await invalidateAll();
  }

  async function toggleFlagged() {
    if (!data.selected?.message) return;
    await api(`/api/messages/${data.selected.message.id}/flag`, {
      method: 'POST',
      body: JSON.stringify({ flagged: !data.selected.message.isFlagged })
    });
    await invalidateAll();
  }

  async function exportContacts() {
    const accountId = accountFilter ? `?accountId=${encodeURIComponent(accountFilter)}` : '';
    const response = await fetch(`/api/contacts/export${accountId}`, {
      headers: { 'x-csrf-token': data.csrfToken }
    });
    const csv = await response.text();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(csv);
      status = 'Contacts CSV copied to clipboard';
    } else {
      status = 'Contacts export ready';
    }
  }

  async function importContacts() {
    if (!contactsImportCsv.trim()) return;
    const result = await api('/api/contacts/import', {
      method: 'POST',
      body: JSON.stringify({
        accountId: accountFilter ? Number(accountFilter) : null,
        csv: contactsImportCsv
      })
    });
    status = `Imported ${result.imported} contacts`;
    contactsImportCsv = '';
    await invalidateAll();
  }

  async function addAgentTool() {
    const headers = parseJsonMap(agentToolForm.headersJson);
    const envMap = parseJsonMap(agentToolForm.envJson);
    const args = agentToolForm.argsCsv
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    await api('/api/tools', {
      method: 'POST',
      body: JSON.stringify({
        name: agentToolForm.name,
        description: agentToolForm.description || null,
        kind: agentToolForm.kind,
        endpoint: agentToolForm.endpoint || null,
        command: agentToolForm.command || null,
        args,
        authHeaders: headers,
        env: envMap,
        readOnly: agentToolForm.readOnly,
        requireApprovalForWrite: agentToolForm.requireApprovalForWrite
      })
    });
    agentToolForm = {
      name: '',
      description: '',
      kind: 'mcp_http',
      endpoint: '',
      command: '',
      argsCsv: '',
      headersJson: '',
      envJson: '',
      readOnly: false,
      requireApprovalForWrite: true
    };
    status = 'Tool added';
    await invalidateAll();
  }

  async function testAgentTool(id: number) {
    status = 'Testing tool...';
    await api(`/api/tools/${id}/test`, { method: 'POST', body: '{}' });
    status = 'Tool test complete';
  }

  async function toggleAgentTool(id: number, enabled: boolean) {
    await api(`/api/tools/${id}`, {
      method: 'POST',
      body: JSON.stringify({ isEnabled: !enabled })
    });
    status = enabled ? 'Tool disabled' : 'Tool enabled';
    await invalidateAll();
  }

  async function removeAgentTool(id: number) {
    await api(`/api/tools/${id}`, { method: 'DELETE' });
    status = 'Tool removed';
    await invalidateAll();
  }

  function applyAiPreset(profile: 'primary' | 'fallback' | 'advanced', presetId: string) {
    const preset = data.aiPresets?.find((item: { id: string }) => item.id === presetId);
    const current = aiProfileForms[profile];
    if (!current) return;
    if (!preset || preset.id === 'manual') {
      aiProfileForms = {
        ...aiProfileForms,
        [profile]: {
          ...current,
          preset: 'manual'
        }
      };
      return;
    }
    aiProfileForms = {
      ...aiProfileForms,
      [profile]: {
        ...current,
        preset: preset.id,
        label: preset.label,
        provider: preset.provider,
        transport: preset.transport,
        model: preset.defaultModel,
        baseUrl: preset.baseUrl,
        notes: preset.notes
      }
    };
  }

  async function saveAiProfile(profile: 'primary' | 'fallback' | 'advanced') {
    const form = aiProfileForms[profile];
    if (!form) return;
    status = `Saving ${form.label}...`;
    await api('/api/ai-profiles', {
      method: 'POST',
      body: JSON.stringify({
        profile: form.profile,
        label: form.label,
        provider: form.provider,
        transport: form.transport,
        model: form.model,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey.trim() ? form.apiKey : undefined,
        preset: form.preset || null,
        isEnabled: form.isEnabled,
        notes: form.notes || null
      })
    });
    status = `${form.label} saved`;
    await invalidateAll();
  }

  function openCompose(mode: 'compose' | 'reply' | 'reply_all' | 'forward') {
    composeMode = mode;
    composeEditorMode = 'plain';
    composeHtml = '';
    const selected = data.selected?.message;
    const accountId = selected?.accountId || data.accounts[0]?.id || 0;
    if (!selected || mode === 'compose') {
      const serverDraft = data.drafts?.find((draft: DraftView) => (draft.accountId || accountId) === accountId && draft.status === 'draft');
      compose = serverDraft
        ? {
            draftId: serverDraft.id,
            accountId: serverDraft.accountId || accountId,
            to: serverDraft.to || '',
            cc: serverDraft.cc || '',
            bcc: serverDraft.bcc || '',
            subject: serverDraft.subject || '',
            body: serverDraft.bodyText || '',
            attachments: (serverDraft.attachments || []).map((attachment) => ({
              filename: attachment.filename,
              contentType: attachment.contentType || 'application/octet-stream',
              contentBase64: attachment.contentBase64
            })),
            sourceMessageId: serverDraft.sourceMessageId ?? null
          }
        : { draftId: null, accountId, to: '', cc: '', bcc: '', subject: '', body: '', attachments: [], sourceMessageId: null };
      composeHtml = serverDraft?.bodyHtml || '';
      composeEditorMode = composeHtml ? 'rich' : 'plain';
    } else if (mode === 'reply') {
      compose = { draftId: null, accountId, to: selected.from, cc: '', bcc: '', subject: replySubject(selected.subject), body: '', attachments: [], sourceMessageId: selected.id };
    } else if (mode === 'reply_all') {
      compose = {
        draftId: null,
        accountId,
        to: selected.from,
        cc: [selected.to, selected.cc].filter(Boolean).join(', '),
        bcc: '',
        subject: replySubject(selected.subject),
        body: '',
        attachments: [],
        sourceMessageId: selected.id
      };
    } else {
      compose = {
        draftId: null,
        accountId,
        to: '',
        cc: '',
        bcc: '',
        subject: forwardSubject(selected.subject),
        body: `\n\n--- Forwarded message ---\nFrom: ${selected.from}\nTo: ${selected.to}\nDate: ${new Date(selected.date).toLocaleString()}\nSubject: ${selected.subject}\n\n${selected.bodyText}`,
        attachments: [],
        sourceMessageId: selected.id
      };
    }
    composeOpen = true;
  }

  function openDraft(draft: DraftView) {
    composeMode = draft.mode;
    compose = {
      draftId: draft.id,
      accountId: draft.accountId || data.accounts[0]?.id || 0,
      to: draft.to || '',
      cc: draft.cc || '',
      bcc: draft.bcc || '',
      subject: draft.subject || '',
      body: draft.bodyText || '',
      attachments: (draft.attachments || []).map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType || 'application/octet-stream',
        contentBase64: attachment.contentBase64
      })),
      sourceMessageId: draft.sourceMessageId
    };
    composeHtml = draft.bodyHtml || '';
    composeEditorMode = composeHtml ? 'rich' : 'plain';
    composeOpen = true;
  }

  async function sendCompose() {
    const bodyText = composeEditorMode === 'rich' ? stripHtml(composeHtml) : compose.body;
    const payload = {
      ...compose,
      body: bodyText,
      bodyHtml: composeEditorMode === 'rich' ? composeHtml : null,
      mode: composeMode
    };
    status = navigator.onLine ? 'Sending...' : 'Offline: queuing';
    try {
      await api('/api/compose', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      composeOpen = false;
      status = 'Sent';
      await invalidateAll();
    } catch (error) {
      if (!navigator.onLine || error instanceof TypeError) {
        const queued = await enqueueOutbox(payload as Record<string, unknown>);
        status = queued ? 'Queued for send when online' : 'Unable to queue';
      } else {
        throw error;
      }
    }
  }

  async function saveDraft() {
    try {
      const result = await api('/api/drafts', {
        method: 'POST',
        body: JSON.stringify({
          id: compose.draftId,
          accountId: compose.accountId,
          mode: composeMode,
          sourceMessageId: compose.sourceMessageId,
          to: compose.to,
          cc: compose.cc || null,
          bcc: compose.bcc || null,
          subject: compose.subject,
          bodyText: compose.body,
          bodyHtml: composeEditorMode === 'rich' ? composeHtml : null,
          attachments: compose.attachments
        })
      });
      compose.draftId = result.draft.id;
    } catch {
      // Offline or transient errors: keep local draft cache only.
    }
    await putLocalDraft(`draft-${compose.draftId}`, {
      compose,
      composeMode,
      composeHtml,
      composeEditorMode
    });
  }

  async function flushOutbox() {
    if (!navigator.onLine) return;
    const queued = await listOutbox();
    for (const item of queued) {
      try {
        await api('/api/compose', {
          method: 'POST',
          body: JSON.stringify(item.payload)
        });
        await deleteOutbox(item.id);
      } catch {
        // Keep queued for later retry.
      }
    }
  }

  async function onAttachFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files || []);
    for (const file of files) {
      const contentBase64 = await fileToBase64(file);
      compose.attachments = [
        ...compose.attachments,
        {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          contentBase64
        }
      ];
    }
    input.value = '';
  }

  function removeAttachment(index: number) {
    compose.attachments = compose.attachments.filter((_, idx) => idx !== index);
  }

  function fileToBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || '');
        const [, base64] = raw.split(',');
        resolve(base64 || '');
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function stripHtml(value: string) {
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseJsonMap(value: string) {
    if (!value.trim()) return {};
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
      return {};
    }
  }

  function replySubject(subject: string) {
    return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  }

  function forwardSubject(subject: string) {
    return /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`;
  }

  function riskClass(risk: string | null | undefined) {
    if (risk === 'high') return 'border-red-400/40 bg-red-400/10 text-red-200';
    if (risk === 'medium') return 'border-amber-300/40 bg-amber-300/10 text-amber-100';
    return 'border-accent-line bg-accent-soft text-accent';
  }
</script>

<svelte:head>
  <title>Triage</title>
</svelte:head>

<main class="relative grid h-screen grid-cols-1 md:grid-cols-[76px_minmax(320px,430px)_1fr] overflow-hidden text-zinc-100">
  {#if isLoading}
    <div class="fixed left-0 right-0 top-0 z-50 h-1 bg-accent/20" transition:fade>
      <div class="h-full bg-accent animate-pulse" style="width: 30%"></div>
    </div>
    <div class="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-full border border-accent/20 bg-black/80 px-3 py-1.5 text-xs text-accent backdrop-blur-md" transition:fade>
      <Loader2 size={14} class="animate-spin" />
      <span>Working...</span>
    </div>
  {/if}

  <!-- Desktop Sidebar -->
  <nav class="glass z-10 hidden flex-col items-center gap-3 border-y-0 border-l-0 px-3 py-4 md:flex">
    <div class="mb-4 grid h-10 w-10 place-items-center rounded-md bg-accent text-black">
      <Mail size={20} />
    </div>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'inbox' ? 'bg-white/10' : ''}`} title="Inbox" onclick={() => setQuickView('inbox')}>
      <Inbox size={20} />
    </button>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'unread' ? 'bg-white/10' : ''}`} title="Unread" onclick={() => setQuickView('unread')}>
      <EyeOff size={20} />
    </button>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'starred' ? 'bg-white/10' : ''}`} title="Starred" onclick={() => setQuickView('starred')}>
      <Star size={20} />
    </button>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'pending' ? 'bg-white/10' : ''}`} title="Pending" onclick={() => setQuickView('pending')}>
      <Clock3 size={20} />
    </button>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'executed' ? 'bg-white/10' : ''}`} title="Executed" onclick={() => setQuickView('executed')}>
      <Check size={20} />
    </button>
    <button class="focus-ring rounded-md p-3 text-zinc-300" title="Compose" onclick={() => openCompose('compose')}>
      <PenLine size={20} />
    </button>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'accounts' ? 'bg-white/10' : ''}`} title="Accounts" onclick={() => (view = 'accounts')}>
      <Settings size={20} />
    </button>
    <button class={`focus-ring rounded-md p-3 text-zinc-300 ${view === 'memory' ? 'bg-white/10' : ''}`} title="Memory" onclick={() => (view = 'memory')}>
      <Shield size={20} />
    </button>
  </nav>

  <!-- Mobile Bottom Rail -->
  <nav class="glass fixed bottom-0 left-0 right-0 z-20 flex h-16 items-center justify-around border-x-0 border-b-0 px-2 md:hidden">
    <button class={`flex flex-col items-center gap-1 p-2 text-zinc-300 ${view === 'inbox' ? 'text-accent' : ''}`} onclick={() => { view = 'inbox'; deselectMessage(); }}>
      <Inbox size={20} />
      <span class="text-[10px]">Inbox</span>
    </button>
    <button class={`flex flex-col items-center gap-1 p-2 text-zinc-300 ${view === 'pending' ? 'text-accent' : ''}`} onclick={() => { view = 'pending'; deselectMessage(); goto('/?view=pending'); }}>
      <Clock3 size={20} />
      <span class="text-[10px]">Pending</span>
    </button>
    <button class={`flex flex-col items-center gap-1 p-2 text-zinc-300 ${view === 'executed' ? 'text-accent' : ''}`} onclick={() => { view = 'executed'; deselectMessage(); goto('/?view=executed'); }}>
      <Check size={20} />
      <span class="text-[10px]">Done</span>
    </button>
    <button class={`flex flex-col items-center gap-1 p-2 text-zinc-300 ${view === 'accounts' ? 'text-accent' : ''}`} onclick={() => { view = 'accounts'; deselectMessage(); }}>
      <Settings size={20} />
      <span class="text-[10px]">Config</span>
    </button>
    <button class={`flex flex-col items-center gap-1 p-2 text-zinc-300 ${view === 'memory' ? 'text-accent' : ''}`} onclick={() => { view = 'memory'; deselectMessage(); }}>
      <Shield size={20} />
      <span class="text-[10px]">Memory</span>
    </button>
  </nav>

  <section class={`border-r border-white/10 bg-black/30 pb-16 md:pb-0 ${data.query.messageId ? 'hidden md:block' : 'block'}`}>
    <div class="border-b border-white/10 p-4">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-semibold">Triage</h1>
        <span class="rounded-full border border-accent-line bg-accent-soft px-2 py-1 text-xs text-accent">review-first</span>
      </div>
      <div class="mt-4 flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2">
        <Search size={16} class="text-zinc-500" />
        <input
          bind:this={searchInput}
          class="w-full bg-transparent text-sm outline-none"
          placeholder="Search mail..."
          bind:value={search}
          onkeydown={(event) => event.key === 'Enter' && applySearch()}
        />
      </div>
      <div class="mt-2 grid grid-cols-[1fr_auto] gap-2">
        <select
          class="w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-xs text-zinc-300 outline-none"
          bind:value={accountFilter}
          onchange={applySearch}
        >
          <option value="">All accounts</option>
          {#each data.accounts as account (account.id)}
            <option value={String(account.id)}>{account.email}</option>
          {/each}
        </select>
        <button class="rounded-md border border-white/10 px-2 py-2 text-xs text-zinc-400" onclick={applySearch}>Apply</button>
      </div>
      <p class="mt-2 text-[11px] text-zinc-500">Shortcut: <kbd class="rounded border border-white/10 px-1 py-0.5">/</kbd> search, <kbd class="rounded border border-white/10 px-1 py-0.5">j</kbd>/<kbd class="rounded border border-white/10 px-1 py-0.5">k</kbd> move selection</p>
      {#if status}
        <p class="mt-3 text-xs text-accent">{status}</p>
      {/if}
    </div>

    {#if view === 'accounts'}
      <div class="space-y-4 overflow-y-auto p-4" in:fade={{ duration: 150 }}>
        <h2 class="text-sm font-medium text-zinc-300">Email Accounts</h2>
        {#each data.accounts as account (account.id)}
          <article class="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-medium">{account.email}</p>
                <p class="text-xs text-zinc-500">{account.host}:{account.port} -> {account.smtpHost}:{account.smtpPort}</p>
                <p class="mt-1 text-xs text-zinc-400">{account.syncStatus}{account.lastSyncAt ? ` · ${new Date(account.lastSyncAt).toLocaleString()}` : ''}</p>
              </div>
              <span class="rounded-full border border-white/10 px-2 py-1 text-xs">{account.isEnabled ? 'enabled' : 'disabled'}</span>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button class="rounded-md border border-white/10 px-2 py-1 text-xs" onclick={() => accountAction(account.id, 'test')}>Test</button>
              <button class="rounded-md border border-white/10 px-2 py-1 text-xs" onclick={() => accountAction(account.id, account.isEnabled ? 'disable' : 'enable')}>{account.isEnabled ? 'Disable' : 'Enable'}</button>
              <button class="rounded-md border border-red-400/30 px-2 py-1 text-xs text-red-200" onclick={() => accountAction(account.id, 'delete')}>Remove</button>
            </div>
          </article>
        {/each}
        <form class="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3" onsubmit={(event) => { event.preventDefault(); addAccount(); }}>
          <h3 class="text-sm font-medium">Add IMAP/SMTP</h3>
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Email" bind:value={accountForm.email} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="IMAP host" bind:value={accountForm.host} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="IMAP username" bind:value={accountForm.username} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="IMAP password" type="password" bind:value={accountForm.password} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="SMTP host" bind:value={accountForm.smtpHost} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="SMTP username" bind:value={accountForm.smtpUsername} />
          <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="SMTP password" type="password" bind:value={accountForm.smtpPassword} />
          <button class="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-black"><Plus size={16} /> Add account</button>
        </form>
      </div>
    {:else if view === 'memory'}
      <div class="flex h-[calc(100vh-108px)] flex-col p-4" in:fade={{ duration: 150 }}>
        <h2 class="text-sm font-medium text-zinc-300">AGENT_INSTRUCTIONS.md</h2>
        <p class="mt-1 text-xs text-zinc-500">These instructions are included in every AI triage prompt.</p>
        <textarea class="mt-4 min-h-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-sm leading-6 outline-none" bind:value={memoryText}></textarea>
        <div class="mt-3 flex gap-2">
          <button class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black" onclick={saveMemory}>Save</button>
          <button class="rounded-md border border-white/10 px-3 py-2 text-sm" onclick={resetMemory}>Reset</button>
        </div>
      </div>
    {:else}
      <div class="h-[calc(100vh-108px)] overflow-y-auto" in:fade={{ duration: 150 }}>
      <div class="border-b border-white/10 p-3">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs uppercase tracking-[0.18em] text-zinc-500">Folders</p>
          <button class="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300" onclick={() => openCompose('compose')}>Compose</button>
        </div>
        <div class="mb-2 flex flex-wrap items-center gap-1.5">
          <button
            class="rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300"
            onclick={() => toggleSelectAllVisible(selectedMessageIds.length !== data.messages.length)}
          >
            {#if selectedMessageIds.length === data.messages.length && data.messages.length}
              <span class="inline-flex items-center gap-1"><CheckSquare2 size={12} /> All</span>
            {:else}
              <span class="inline-flex items-center gap-1"><Square size={12} /> Select</span>
            {/if}
          </button>
          <button data-testid="bulk-read" class="rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300 disabled:opacity-40" disabled={!selectedMessageIds.length} onclick={() => runBulkAction('mark_read')}>Read</button>
          <button data-testid="bulk-unread" class="rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300 disabled:opacity-40" disabled={!selectedMessageIds.length} onclick={() => runBulkAction('mark_unread')}>Unread</button>
          <button data-testid="bulk-star" class="rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300 disabled:opacity-40" disabled={!selectedMessageIds.length} onclick={() => runBulkAction('flag')}>Star</button>
          <button data-testid="bulk-unstar" class="rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300 disabled:opacity-40" disabled={!selectedMessageIds.length} onclick={() => runBulkAction('unflag')}>Unstar</button>
          <button data-testid="bulk-trash" class="rounded-md border border-red-400/30 px-2 py-1 text-[11px] text-red-200 disabled:opacity-40" disabled={!selectedMessageIds.length} onclick={() => runBulkAction('move', 'Trash')}>Trash</button>
        </div>
        <div class="max-h-44 space-y-1 overflow-y-auto">
          {#each data.folders as folder (folder.id)}
            <button
                class={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/[0.05] ${data.query?.folder === folder.path && data.query?.accountId === folder.accountId ? 'bg-white/[0.08] text-accent' : 'text-zinc-400'}`}
                onclick={() => selectFolder(folder.accountId, folder.path)}
              >
                <span class="flex min-w-0 items-center gap-2">
                  <FolderOpen size={14} class="shrink-0" />
                  <span class="truncate">{folder.path}</span>
                </span>
                <span class="shrink-0 text-[11px] text-zinc-500">{folder.unread ? `${folder.unread}/` : ''}{folder.total}</span>
              </button>
            {/each}
          </div>
          {#if data.drafts?.length}
            <div class="mt-3 border-t border-white/10 pt-2">
              <p class="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Drafts</p>
              <div class="max-h-24 space-y-1 overflow-y-auto">
                {#each data.drafts.slice(0, 6) as draft (draft.id)}
                  <button class="w-full rounded-md border border-white/10 px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-white/[0.05]" onclick={() => openDraft(draft)}>
                    <p class="truncate">{draft.subject || '(no subject)'}</p>
                    <p class="truncate text-zinc-500">{draft.to || 'unsent draft'}</p>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
        {#each data.messages as message (message.id)}
          <button
            data-testid="message-row"
            class={`block w-full border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/[0.04] ${data.selected?.message?.id === message.id ? 'bg-white/[0.06]' : ''}`}
            onclick={() => selectMessage(message.id)}
          >
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  class="h-3.5 w-3.5 rounded border-white/20 bg-black/50 accent-[var(--accent)]"
                  checked={selectedMessageIds.includes(message.id)}
                  onclick={(event) => event.stopPropagation()}
                  onchange={(event) => toggleBulkMessage(message.id, (event.currentTarget as HTMLInputElement).checked)}
                />
                <p class={`truncate text-sm ${message.isRead ? 'font-medium text-zinc-400' : 'font-semibold text-zinc-100'}`}>{message.from}</p>
              </div>
              <time class="shrink-0 text-xs text-zinc-500">{new Date(message.date).toLocaleDateString()}</time>
            </div>
            <p class={`mt-1 truncate text-sm ${message.isRead ? 'text-zinc-300' : 'font-medium text-white'}`}>{message.isFlagged ? '★ ' : ''}{message.subject}</p>
            <p class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{message.snippet}</p>
            <div class="mt-2 flex items-center gap-2">
              <span class="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-500">{message.folderPath}</span>
              <span class="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-400">{message.accountEmail}</span>
              {#if message.suggestionStatus}
                <span class={`rounded-full border px-2 py-0.5 text-[11px] ${riskClass(message.riskLevel)}`}>{message.recommendedAction}</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <section class={`min-w-0 overflow-y-auto pb-20 md:pb-0 ${data.selected || view === 'executed' || view === 'accounts' || view === 'memory' ? 'block' : 'hidden md:block'}`}>
    {#if data.selected}
      <div class="sticky top-0 z-10 flex border-b border-white/10 bg-black/80 p-2 backdrop-blur-md md:hidden">
        <button class="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-zinc-300" onclick={deselectMessage}>
          <ChevronLeft size={20} />
          <span>Back</span>
        </button>
      </div>

      <article class="mx-auto max-w-5xl p-4 md:p-8" in:fade={{ duration: 150 }}>
        <header class="border-b border-white/10 pb-6">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full border border-white/10 px-2 py-1 text-xs text-zinc-400">{data.selected.account?.email}</span>
            <span class="rounded-full border border-white/10 px-2 py-1 text-xs text-zinc-400">{data.selected.message.folderPath}</span>
          </div>
          <h2 class="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">{data.selected.message.subject}</h2>
          <p class="mt-3 text-sm text-zinc-400">From {data.selected.message.from} to {data.selected.message.to} · {new Date(data.selected.message.date).toLocaleString()}</p>
        </header>

        {#if data.selected.attachments?.length}
          <section class="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p class="text-xs uppercase tracking-[0.18em] text-zinc-500">Attachments</p>
            <div class="mt-2 flex flex-wrap gap-2">
              {#each data.selected.attachments as attachment (attachment.id)}
                <a class="inline-flex items-center gap-2 rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-200 hover:bg-white/[0.06]" href={`/api/messages/${data.selected.message.id}/attachments/${attachment.id}`}>
                  <Paperclip size={13} />
                  <span>{attachment.filename}</span>
                  <span class="text-zinc-500">{Math.max(1, Math.round((attachment.sizeBytes || 0) / 1024))}KB</span>
                </a>
              {/each}
            </div>
          </section>
        {/if}

        <div class="sticky top-0 z-10 mt-4 flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/70 py-3 backdrop-blur-md">
          <button class="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-black" onclick={() => openCompose('reply')}><Reply size={16} /> Reply</button>
          <button data-testid="reply-all" class="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-200" onclick={() => openCompose('reply_all')}><ReplyAll size={16} /> Reply all</button>
          <button class="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-200" onclick={() => openCompose('forward')}><Forward size={16} /> Forward</button>
          <button data-testid="toggle-star" class={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${data.selected.message.isFlagged ? 'border-accent/50 text-accent' : 'border-white/10 text-zinc-200'}`} onclick={toggleFlagged}><Star size={16} /> {data.selected.message.isFlagged ? 'Starred' : 'Star'}</button>
          <button data-testid="toggle-read" class="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-200" onclick={toggleRead}>
            {#if data.selected.message.isRead}<EyeOff size={16} /> Mark unread{:else}<Eye size={16} /> Mark read{/if}
          </button>
          <select class="min-w-44 rounded-md border border-white/10 bg-black/60 px-3 py-2 text-sm text-zinc-200 outline-none" onchange={(event) => moveSelected(event.currentTarget.value)}>
            <option value="">Move...</option>
            {#each data.folders.filter((folder) => folder.accountId === data.selected?.message.accountId) as folder (folder.id)}
              <option value={folder.path}>{folder.path}</option>
            {/each}
          </select>
          <button class="flex items-center gap-2 rounded-md border border-red-400/30 px-3 py-2 text-sm text-red-200" onclick={() => moveSelected('Trash')}><Trash2 size={16} /> Trash</button>
        </div>

        {#if data.selected.suggestion}
          <section class={`mt-8 rounded-lg border p-4 md:p-5 ${riskClass(data.selected.suggestion.riskLevel)}`} data-testid="ai-action-card" in:fly={{ y: 20, duration: 300, delay: 100 }}>
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p class="text-xs uppercase tracking-[0.18em] opacity-80">AI Action Card</p>
                <h3 class="mt-2 text-xl font-semibold">{data.selected.suggestion.category}</h3>
                <p class="mt-2 text-sm opacity-90">{data.selected.suggestion.reasoningSummary}</p>
              </div>
              <div class="flex flex-wrap gap-2 text-xs">
                <span class="rounded-full border border-current/20 px-2 py-1">{data.selected.suggestion.recommendedAction}</span>
                <span class="rounded-full border border-current/20 px-2 py-1">{Math.round(data.selected.suggestion.confidence * 100)}%</span>
                <span class="rounded-full border border-current/20 px-2 py-1">{data.selected.suggestion.riskLevel} risk</span>
              </div>
            </div>
            {#if data.selected.suggestion.targetFolder}
              <p class="mt-4 text-sm">Target folder: {data.selected.suggestion.targetFolder}</p>
            {/if}
            {#if data.selected.suggestion.delegateInstructions}
              <p class="mt-4 text-sm">Delegate: {data.selected.suggestion.delegateInstructions}</p>
            {/if}
            {#if data.selected.suggestion.draftReply || ['reply', 'forward'].includes(data.selected.suggestion.recommendedAction)}
              <label class="mt-5 block text-sm font-medium" for="draft">Draft</label>
              <textarea id="draft" data-testid="draft-reply" class="mt-2 min-h-44 w-full resize-y rounded-md border border-current/20 bg-black/30 p-3 text-sm text-white outline-none" bind:value={draftText}></textarea>
            {/if}
            <div class="mt-5 flex flex-wrap items-center gap-2">
              <button data-testid="execute-suggestion" class="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-black" onclick={executeSuggestion}><Send size={16} /> Execute</button>
              <button class="rounded-md border border-current/20 px-3 py-2 text-sm" onclick={saveEdit}>Save Edit</button>
              <button class="rounded-md border border-current/20 px-3 py-2 text-sm" onclick={rejectSuggestion}>Reject</button>
              <div class="mt-2 flex w-full flex-wrap gap-2 md:mt-0 md:w-auto md:flex-1">
                 <input class="min-w-0 flex-1 rounded-md border border-current/20 bg-black/30 px-3 py-2 text-sm text-white" placeholder="Tweak this suggestion..." bind:value={regenNote} />
                 <button class="flex items-center gap-2 rounded-md border border-current/20 px-3 py-2 text-sm" onclick={regenerate}><RefreshCw size={16} /> Regenerate</button>
              </div>
            </div>
          </section>
        {:else}
          <div in:fade>
            <button class="mt-6 rounded-md bg-accent px-3 py-2 text-sm font-medium text-black" onclick={() => generateSuggestion(data.selected?.message.id ?? 0)}>Generate suggestion</button>
          </div>
        {/if}

        <section class="mt-6 rounded-lg border border-white/10 bg-white/[0.03] p-4 md:p-5" data-testid="agent-task-card">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="text-xs uppercase tracking-[0.18em] text-zinc-500">Agent Task Plan</p>
              <h3 class="mt-1 text-lg font-semibold">Action Graph</h3>
            </div>
            <button data-testid="plan-task" class="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-200" onclick={createTaskPlan}>
              <Bot size={15} />
              Plan Task
            </button>
          </div>
          <div class="mt-3 flex gap-2">
            <input class="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none" placeholder="Add planning note (optional)..." bind:value={taskNote} />
          </div>
          {#if data.tasks?.length}
            <div class="mt-4 space-y-3">
              {#each data.tasks as task (task.run.id)}
                <article class="rounded-md border border-white/10 bg-black/30 p-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p class="text-sm font-medium">{task.run.summary}</p>
                      <p class="text-xs text-zinc-500">{task.run.status} · {task.run.complexity} · {task.run.providerUsed}/{task.run.modelUsed}</p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <button data-testid="approve-task" class="rounded-md border border-white/10 px-2 py-1 text-xs" onclick={() => approveTask(task.run.id)}>Approve all</button>
                      <button data-testid="execute-task" class="rounded-md border border-white/10 px-2 py-1 text-xs" onclick={() => executeTask(task.run.id)}>Execute</button>
                      <button class="rounded-md border border-red-400/30 px-2 py-1 text-xs text-red-200" onclick={() => rejectTask(task.run.id)}>Reject</button>
                    </div>
                  </div>
                  {#if task.run.errorMessage}
                    <p class="mt-2 text-xs text-red-200">{task.run.errorMessage}</p>
                  {/if}
                  {#if task.run.resultSummary}
                    <p class="mt-2 text-xs text-accent">{task.run.resultSummary}</p>
                  {/if}
                  <div class="mt-3 space-y-2">
                    {#each task.steps as step (step.id)}
                      <div class="rounded-md border border-white/10 px-2 py-2">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <p class="text-xs font-medium">{step.title}</p>
                          <div class="flex items-center gap-2">
                            <span class={`rounded-full border px-2 py-0.5 text-[11px] ${riskClass(step.riskLevel)}`}>{step.status}</span>
                            {#if step.status === 'pending'}
                              <button class="rounded-md border border-white/10 px-2 py-0.5 text-[11px]" onclick={() => approveTask(task.run.id, step.id)}>Approve</button>
                            {/if}
                          </div>
                        </div>
                        <p class="mt-1 text-xs text-zinc-400">{step.details}</p>
                        {#if step.toolName}
                          <p class="mt-1 text-[11px] text-zinc-500">Tool: {step.toolName}</p>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </article>
              {/each}
            </div>
          {:else}
            <p class="mt-3 text-xs text-zinc-500">No task plan yet for this message.</p>
          {/if}
        </section>

        {#if data.selected.thread?.length > 1}
          <section class="mt-8 rounded-lg border border-white/10 bg-white/[0.03] p-4 md:p-5">
            <p class="text-xs uppercase tracking-[0.18em] text-zinc-500">Conversation</p>
            <div class="mt-4 space-y-3">
              {#each data.selected.thread as item (item.id)}
                <button
                  class={`w-full rounded-md border p-3 text-left ${item.id === data.selected.message.id ? 'border-accent/40 bg-accent-soft' : 'border-white/10 bg-black/20'}`}
                  onclick={() => selectMessage(item.id)}
                >
                  <div class="flex items-center justify-between gap-3">
                    <p class="truncate text-sm font-medium">{item.from}</p>
                    <time class="shrink-0 text-xs text-zinc-500">{new Date(item.date).toLocaleString()}</time>
                  </div>
                  <p class="mt-1 truncate text-xs text-zinc-400">{item.subject}</p>
                  <p class="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{item.bodyText}</p>
                </button>
              {/each}
            </div>
          </section>
        {/if}

        <section class="prose prose-invert mt-8 max-w-none rounded-lg border border-white/10 bg-white/[0.03] p-4 md:p-6">
          {#if data.selected.message.safeBodyHtml}
            <div class="mb-4 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
              <p class="text-xs uppercase tracking-[0.18em] text-zinc-500">Message Body</p>
              <div class="flex items-center gap-2 rounded-md border border-white/10 p-1 text-xs">
                <button
                  class={`rounded px-2 py-1 ${bodyMode === 'html' ? 'bg-accent text-black' : 'text-zinc-400'}`}
                  onclick={() => (bodyMode = 'html')}
                >HTML</button>
                <button
                  class={`rounded px-2 py-1 ${bodyMode === 'text' ? 'bg-accent text-black' : 'text-zinc-400'}`}
                  onclick={() => (bodyMode = 'text')}
                >Text</button>
              </div>
            </div>
          {/if}
          {#if bodyMode === 'html' && data.selected.message.safeBodyHtml}
            <article class="email-html overflow-x-auto text-sm leading-7 text-zinc-200">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html data.selected.message.safeBodyHtml}
            </article>
          {:else}
            <pre class="whitespace-pre-wrap font-sans text-sm leading-7 text-zinc-200">{data.selected.message.bodyText}</pre>
          {/if}
        </section>
      </article>
    {:else if view === 'executed'}
      <div class="mx-auto max-w-4xl p-8" in:fade={{ duration: 150 }}>
        <h2 class="text-2xl font-semibold">Executed Actions</h2>
        <div class="mt-6 space-y-3">
          {#each data.executed as action (action.id)}
            <article class="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <p class="font-medium">{action.actionType}</p>
              <p class="text-sm text-zinc-500">{action.status} · {new Date(action.createdAt).toLocaleString()}</p>
              <pre class="mt-3 overflow-auto rounded-md bg-black/30 p-3 text-xs text-zinc-400">{action.detailsJson}</pre>
            </article>
          {/each}
        </div>
      </div>
    {:else if view === 'accounts'}
      <div class="mx-auto max-w-3xl p-8" in:fade={{ duration: 150 }}>
        <h2 class="text-2xl font-semibold">Configuration</h2>
        <p class="mt-2 text-zinc-400">Passwords are encrypted at rest and are never displayed after saving.</p>
        <div class="mt-8 grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
          <div class="rounded-lg border border-white/10 bg-white/[0.03] p-4 md:p-5">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 class="font-medium">AI Profiles</h3>
                <p class="mt-1 text-sm text-zinc-400">Primary, fallback, and advanced planner settings live here. Leave the API key blank to keep the existing saved key.</p>
              </div>
              <span class="rounded-full border border-white/10 px-2 py-1 text-[11px] text-zinc-400">UI-managed</span>
            </div>
            <div class="mt-4 space-y-3">
              {#each aiProfileKeys as profileKey (profileKey)}
                <article class="rounded-md border border-white/10 bg-black/20 p-3">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p class="text-sm font-medium">{aiProfileForms[profileKey].label}</p>
                      <p class="text-xs text-zinc-500">{profileKey} · {aiProfileForms[profileKey].provider} · {aiProfileForms[profileKey].model}</p>
                    </div>
                    <label class="inline-flex items-center gap-2 text-xs text-zinc-300">
                      <input type="checkbox" bind:checked={aiProfileForms[profileKey].isEnabled} />
                      Enabled
                    </label>
                  </div>
                  <div class="mt-3 grid gap-2 md:grid-cols-2">
                    <select class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" bind:value={aiProfileForms[profileKey].preset} onchange={(event) => applyAiPreset(profileKey, (event.currentTarget as HTMLSelectElement).value)}>
                      {#each data.aiPresets as preset (preset.id)}
                        <option value={preset.id}>{preset.label}</option>
                      {/each}
                    </select>
                    <select class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" bind:value={aiProfileForms[profileKey].transport}>
                      <option value="openai_compatible">OpenAI compatible</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>
                  <div class="mt-2 grid gap-2 md:grid-cols-2">
                    <input class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Label" bind:value={aiProfileForms[profileKey].label} />
                    <input class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Provider" bind:value={aiProfileForms[profileKey].provider} />
                    <input class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Model" bind:value={aiProfileForms[profileKey].model} />
                    <input class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Base URL" bind:value={aiProfileForms[profileKey].baseUrl} />
                  </div>
                  <input class="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="API key or bearer token" type="password" bind:value={aiProfileForms[profileKey].apiKey} />
                  <textarea class="mt-2 min-h-20 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Notes" bind:value={aiProfileForms[profileKey].notes}></textarea>
                  <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p class="text-xs text-zinc-500">{data.aiProfiles.find((item: { profile: string }) => item.profile === profileKey)?.hasApiKey ? 'Saved key present' : 'No saved key'}</p>
                    <div class="flex gap-2">
                      <button class="rounded-md border border-white/10 px-3 py-2 text-xs" onclick={() => applyAiPreset(profileKey, 'manual')}>Manual</button>
                      <button class="rounded-md bg-accent px-3 py-2 text-xs font-medium text-black" onclick={() => saveAiProfile(profileKey)}>Save</button>
                    </div>
                  </div>
                </article>
              {/each}
            </div>
          </div>
          <div class="rounded-lg border border-white/10 bg-white/[0.03] p-4 md:p-5">
            <h3 class="font-medium">Model Picks</h3>
            <p class="mt-1 text-sm text-zinc-400">Good starting points for common setups.</p>
            <div class="mt-4 space-y-3">
              {#each data.aiRecommendations as recommendation (recommendation.model)}
                <article class="rounded-md border border-white/10 bg-black/20 p-3">
                  <p class="text-sm font-medium">{recommendation.label}</p>
                  <p class="text-xs text-accent">{recommendation.model}</p>
                  <p class="mt-1 text-xs leading-5 text-zinc-400">{recommendation.reason}</p>
                </article>
              {/each}
            </div>
            <p class="mt-4 text-xs leading-5 text-zinc-500">DeepSeek Flash is the fastest triage default. Use a stronger model such as DeepSeek Pro or Claude Sonnet for complex task planning and multi-step work.</p>
          </div>
        </div>
        <div class="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-5">
          <h3 class="font-medium">Contacts Import/Export</h3>
          <p class="mt-2 text-sm text-zinc-400">Export copies CSV to clipboard. Import accepts <code>email,name</code> or <code>account_id,email,name</code> rows.</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm" onclick={exportContacts}><Download size={15} /> Export CSV</button>
            <button class="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm" onclick={importContacts}><Upload size={15} /> Import CSV</button>
          </div>
          <textarea class="mt-3 min-h-28 w-full rounded-md border border-white/10 bg-black/30 p-3 text-xs outline-none" placeholder="email,name&#10;person@example.com,Person Name" bind:value={contactsImportCsv}></textarea>
        </div>
        <div class="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-5">
          <h3 class="font-medium">Agent Tools (Bring Your Own)</h3>
          <p class="mt-2 text-sm text-zinc-400">Default mode is owner-trusted. Tools can run with full access for this instance.</p>
          <div class="mt-3 space-y-2">
            {#each data.tools as tool (tool.id)}
              <article class="rounded-md border border-white/10 bg-black/20 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p class="text-sm font-medium">{tool.name}</p>
                    <p class="text-xs text-zinc-500">{tool.kind} · {tool.readOnly ? 'read-only' : 'read/write'} · {tool.isEnabled ? 'enabled' : 'disabled'}</p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button class="rounded-md border border-white/10 px-2 py-1 text-xs" onclick={() => testAgentTool(tool.id)}>Test</button>
                    <button class="rounded-md border border-white/10 px-2 py-1 text-xs" onclick={() => toggleAgentTool(tool.id, tool.isEnabled)}>{tool.isEnabled ? 'Disable' : 'Enable'}</button>
                    <button class="rounded-md border border-red-400/30 px-2 py-1 text-xs text-red-200" onclick={() => removeAgentTool(tool.id)}>Remove</button>
                  </div>
                </div>
              </article>
            {/each}
          </div>
          <form class="mt-4 space-y-2" onsubmit={(event) => { event.preventDefault(); addAgentTool(); }}>
            <div class="grid gap-2 md:grid-cols-2">
              <input class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Tool name" bind:value={agentToolForm.name} />
              <select class="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" bind:value={agentToolForm.kind}>
                <option value="mcp_http">MCP HTTP</option>
                <option value="cli">CLI</option>
              </select>
            </div>
            <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Description" bind:value={agentToolForm.description} />
            <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Endpoint URL (for MCP HTTP)" bind:value={agentToolForm.endpoint} />
            <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Command (for CLI)" bind:value={agentToolForm.command} />
            <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="CLI args csv, e.g. -e,console.log(1)" bind:value={agentToolForm.argsCsv} />
            <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Auth headers JSON map" bind:value={agentToolForm.headersJson} />
            <input class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Env JSON map" bind:value={agentToolForm.envJson} />
            <div class="flex flex-wrap items-center gap-3 text-xs text-zinc-300">
              <label class="inline-flex items-center gap-2"><input type="checkbox" bind:checked={agentToolForm.readOnly} /> Read-only</label>
              <label class="inline-flex items-center gap-2"><input type="checkbox" bind:checked={agentToolForm.requireApprovalForWrite} /> Require approval for writes</label>
            </div>
            <button class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black">Add tool</button>
          </form>
        </div>
        <form class="mt-4 flex gap-2" onsubmit={(event) => { event.preventDefault(); addWebhook(); }}>
          <input class="flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm" placeholder="Delegate webhook URL" bind:value={webhookTarget} />
          <button class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black">Add webhook</button>
        </form>
      </div>
    {:else if view === 'memory'}
      <div class="mx-auto max-w-3xl p-8" in:fade={{ duration: 150 }}>
        <h2 class="text-2xl font-semibold">Living Memory</h2>
        <p class="mt-3 text-zinc-400">The editor on the left writes to <code>/data/AGENT_INSTRUCTIONS.md</code>. New suggestions use the latest saved version.</p>
      </div>
    {:else}
      <div class="grid h-full place-items-center text-zinc-500" in:fade>No message selected</div>
    {/if}
  </section>

  {#if composeOpen}
    <section class="fixed bottom-4 right-4 z-40 flex max-h-[86vh] w-[min(720px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-white/10 bg-zinc-950 shadow-2xl shadow-black/60" in:fly={{ y: 24, duration: 180 }}>
      <header class="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p class="text-xs uppercase tracking-[0.18em] text-accent">AI-ready compose</p>
          <h2 class="text-sm font-semibold capitalize">{composeMode.replace('_', ' ')}</h2>
        </div>
        <button class="rounded-md p-2 text-zinc-400 hover:bg-white/10" title="Close" onclick={() => (composeOpen = false)}>
          <X size={18} />
        </button>
      </header>
      <form class="flex min-h-0 flex-1 flex-col" onsubmit={(event) => { event.preventDefault(); sendCompose(); }}>
        <div class="grid gap-2 border-b border-white/10 p-4">
          <select class="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none" bind:value={compose.accountId}>
            {#each data.accounts as account (account.id)}
              <option value={account.id}>{account.email}</option>
            {/each}
          </select>
          <input class="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none" list="contact-options" placeholder="To" bind:value={compose.to} />
          <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
            <input class="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none" list="contact-options" placeholder="Cc" bind:value={compose.cc} />
            <input class="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none" list="contact-options" placeholder="Bcc" bind:value={compose.bcc} />
          </div>
          <input class="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none" placeholder="Subject" bind:value={compose.subject} />
          <datalist id="contact-options">
            {#each data.contacts as contact (contact.id)}
              <option value={contact.name ? `${contact.name} <${contact.email}>` : contact.email}></option>
            {/each}
          </datalist>
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex rounded-md border border-white/10 p-1 text-xs">
              <button
                type="button"
                class={`rounded px-2 py-1 ${composeEditorMode === 'plain' ? 'bg-accent text-black' : 'text-zinc-400'}`}
                onclick={() => (composeEditorMode = 'plain')}
              >Plain</button>
              <button
                type="button"
                class={`rounded px-2 py-1 ${composeEditorMode === 'rich' ? 'bg-accent text-black' : 'text-zinc-400'}`}
                onclick={() => (composeEditorMode = 'rich')}
              >Rich</button>
            </div>
            <label class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">
              <Paperclip size={13} />
              <span>Attach</span>
              <input class="hidden" type="file" multiple onchange={onAttachFiles} />
            </label>
            {#if compose.draftId}
              <span class="text-xs text-zinc-500">Draft #{compose.draftId}</span>
            {/if}
          </div>
          {#if compose.attachments.length}
            <div class="rounded-md border border-white/10 bg-black/20 p-2">
              <p class="mb-2 text-xs text-zinc-500">Attachments</p>
              <div class="flex flex-wrap gap-2">
                {#each compose.attachments as attachment, idx (`${attachment.filename}-${idx}`)}
                  <button type="button" class="inline-flex items-center gap-2 rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-200" onclick={() => removeAttachment(idx)}>
                    <Paperclip size={12} />
                    <span>{attachment.filename}</span>
                    <span class="text-zinc-500">Remove</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
        {#if composeEditorMode === 'rich'}
          <textarea class="min-h-0 flex-1 resize-none bg-black/30 p-4 text-sm leading-6 text-zinc-100 outline-none" placeholder="Write rich HTML body..." bind:value={composeHtml}></textarea>
        {:else}
          <textarea class="min-h-0 flex-1 resize-none bg-black/30 p-4 text-sm leading-6 text-zinc-100 outline-none" placeholder="Write the message..." bind:value={compose.body}></textarea>
        {/if}
        <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
          <p class="text-xs text-zinc-500">Autosaves while editing. Offline sends are queued.</p>
          <div class="flex gap-2">
            <button data-testid="save-draft" type="button" class="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300" onclick={saveDraft}>Save Draft</button>
            <button type="button" class="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300" onclick={() => (composeOpen = false)}>Cancel</button>
            <button data-testid="send-compose" class="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-black"><Send size={16} /> Send</button>
          </div>
        </footer>
      </form>
    </section>
  {/if}
</main>
