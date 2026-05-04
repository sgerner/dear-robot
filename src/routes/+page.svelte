<script lang="ts">
  import {
    Bot,
    ChevronLeft,
    Menu,
    Inbox,
    Mail,
    PenLine,
    Settings,
    Sparkles,
    X
  } from 'lucide-svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  import type { ModelsDevModel, ModelsDevProvider } from '$lib/server/ai/modelsdev';
  import {
    cacheEncryptionEnabled,
    deleteOutbox,
    enqueueOutbox,
    listOutbox,
    loadCacheEncryptionPassphrase,
    putLocalDraft,
    replaceCache,
    setCacheEncryptionPassphrase,
    setCacheMeta
  } from '$lib/client/local-cache';
  import ComposeDrawer from '$lib/components/ComposeDrawer.svelte';
  import MobileQuickActions from '$lib/components/MobileQuickActions.svelte';
  import InboxSidebar from '$lib/components/InboxSidebar.svelte';
  import MessageList from '$lib/components/MessageList.svelte';
  import MessageDetail from '$lib/components/MessageDetail.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import ScrollArea from '$lib/components/ui/ScrollArea.svelte';
  import SettingsAccounts from '$lib/components/settings/SettingsAccounts.svelte';
  import SettingsAdvanced from '$lib/components/settings/SettingsAdvanced.svelte';
  import SettingsCategoryList from '$lib/components/settings/SettingsCategoryList.svelte';
  import SettingsInterface from '$lib/components/settings/SettingsInterface.svelte';
  import SettingsMemory from '$lib/components/settings/SettingsMemory.svelte';
  import SettingsModels from '$lib/components/settings/SettingsModels.svelte';
  import SettingsTools from '$lib/components/settings/SettingsTools.svelte';

  let { data } = $props();
  type AppView = 'inbox' | 'unread' | 'starred' | 'pending' | 'operations' | 'settings';
  type SettingsCategory = 'accounts' | 'models' | 'memory' | 'tools' | 'interface' | 'advanced';
  type QuickActionId =
    | 'reply'
    | 'reply_all'
    | 'forward'
    | 'archive'
    | 'delete'
    | 'spam'
    | 'toggle_read'
    | 'star';
  type SwipeActionId = 'archive' | 'delete' | 'spam' | 'toggle_read' | 'star' | 'none';
  type FolderRole =
    | 'inbox'
    | 'archive'
    | 'spam'
    | 'trash'
    | 'sent'
    | 'drafts'
    | 'newsletters'
    | 'receipts';
  let view = $state<AppView>('inbox');
  let settingsCategory = $state<SettingsCategory>('accounts');
  let operationsCategory = $state<'autopilot' | 'executed'>('autopilot');
  let isLoading = $state(false);
  let search = $state('');
  let accountFilter = $state<string>('');
  type ButtonState = 'idle' | 'loading' | 'success' | 'error';
  let accountAddState = $state<ButtonState>('idle');
  let accountAddError = $state('');
  let accountTestState = $state<ButtonState>('idle');
  let accountTestError = $state('');
  let accountDiscoverState = $state<ButtonState>('idle');
  let accountDiscoverError = $state('');
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
  let skillsText = $state('');
  let coreProfileText = $state('');
  let memoryAdvancedMode = $state(false);
  let webhookTarget = $state('');
  let status = $state('');
  let taskNote = $state('');
  let memoryAssistantPrompt = $state('');
  const coreAiProfileKeys = ['primary', 'fallback', 'advanced'] as const;
  const settingsCategories = [
    { key: 'accounts', label: 'Accounts', detail: 'Mailboxes and Gmail OAuth' },
    { key: 'models', label: 'Models', detail: 'Primary, fallback, advanced, audio' },
    { key: 'memory', label: 'Memory', detail: 'Core profile and learned rules' },
    { key: 'tools', label: 'Agent Tools', detail: 'MCP, CLI, delegate hooks' },
    { key: 'interface', label: 'Interface', detail: 'Quick actions, swipes, folder roles' },
    { key: 'advanced', label: 'Advanced', detail: 'Cache, backups, audit, contacts' }
  ] as const;
  const settingsCategoryKeys = settingsCategories.map((category) => category.key);
  const quickActionCatalog: Array<{
    id: QuickActionId;
    label: string;
    tone?: 'danger' | 'accent';
  }> = [
    { id: 'reply', label: 'Reply', tone: 'accent' },
    { id: 'reply_all', label: 'Reply all' },
    { id: 'forward', label: 'Forward' },
    { id: 'archive', label: 'Archive' },
    { id: 'delete', label: 'Trash', tone: 'danger' },
    { id: 'spam', label: 'Spam', tone: 'danger' },
    { id: 'toggle_read', label: 'Read/unread' },
    { id: 'star', label: 'Star' }
  ];
  const swipeActionCatalog: Array<{ id: SwipeActionId; label: string }> = [
    { id: 'archive', label: 'Archive' },
    { id: 'delete', label: 'Trash' },
    { id: 'spam', label: 'Spam' },
    { id: 'toggle_read', label: 'Read/unread' },
    { id: 'star', label: 'Star' },
    { id: 'none', label: 'No action' }
  ];
  const folderRoleOptions: Array<{ value: '' | FolderRole; label: string }> = [
    { value: '', label: 'No role' },
    { value: 'inbox', label: 'Inbox' },
    { value: 'archive', label: 'Archive' },
    { value: 'spam', label: 'Spam/Junk' },
    { value: 'trash', label: 'Trash' },
    { value: 'sent', label: 'Sent' },
    { value: 'drafts', label: 'Drafts' },
    { value: 'newsletters', label: 'Newsletters' },
    { value: 'receipts', label: 'Receipts' }
  ];
  const inboxViews = ['inbox', 'unread', 'starred', 'pending'] as const;
  function isInboxView(next: string): next is (typeof inboxViews)[number] {
    return inboxViews.includes(next as (typeof inboxViews)[number]);
  }
  function seedAiProfileForm(profile: 'primary' | 'fallback' | 'advanced' | 'audio') {
    const saved = data.aiProfiles?.find((item: { profile: string }) => item.profile === profile);
    const aiPresets = ((data as any).aiPresets || []) as Array<Record<string, any>>;
    const preset = aiPresets.find(
      (item) => item.id === saved?.preset || item.provider === saved?.provider
    );
    const fallbackPreset =
      aiPresets.find((item) => item.id === (profile === 'audio' ? 'openai-audio' : profile)) ||
      aiPresets[0];
    const chosen = preset || fallbackPreset;
    return {
      profile,
      label: saved?.label || chosen?.label || profile,
      provider: saved?.provider || chosen?.provider || '',
      transport: saved?.transport || chosen?.transport || 'openai_compatible',
      model: saved?.model || chosen?.defaultModel || '',
      baseUrl: saved?.baseUrl || chosen?.baseUrl || '',
      apiKey: '',
      hasApiKey: saved?.hasApiKey ?? false,
      preset: saved?.preset || chosen?.id || 'manual',
      isEnabled: saved?.isEnabled ?? true,
      notes: saved?.notes || chosen?.notes || ''
    };
  }
  let aiProfileForms = $state<
    Record<
      string,
      {
        profile: 'primary' | 'fallback' | 'advanced' | 'audio';
        label: string;
        provider: string;
        transport: 'openai_compatible' | 'anthropic';
        model: string;
        baseUrl: string;
        apiKey: string;
        hasApiKey: boolean;
        preset: string;
        isEnabled: boolean;
        notes: string;
      }
    >
  >({});
  let aiCatalogOptions = $state<Record<string, Array<{ id: string; label: string }>>>({});
  let modelsDevProviders = $state<Array<ModelsDevProvider>>([]);
  let modelsDevLoaded = $state(false);
  let modelsDevLoading = $state(false);
  let profileMode = $state<Record<string, 'catalog' | 'manual'>>({
    primary: 'catalog',
    fallback: 'catalog',
    advanced: 'catalog',
    audio: 'manual'
  });
  let profileEnvValues = $state<Record<string, Record<string, string>>>({
    primary: {},
    fallback: {},
    advanced: {},
    audio: {}
  });
  const aiProfileRecommendations: Record<string, string[]> = {
    primary: [
      'DeepSeek `deepseek-v4-flash`',
      'OpenAI `gpt-5.5`',
      'Google `gemini-3.1-pro-preview`'
    ],
    fallback: [
      'OpenAI `gpt-5.4-mini`',
      'Anthropic `claude-sonnet-4-6`',
      'Google `gemini-3.1-flash-lite-preview`'
    ],
    advanced: ['DeepSeek `deepseek-v4-pro`', 'OpenAI `gpt-5.5-pro`', 'Anthropic `claude-opus-4-7`'],
    audio: ['Deepgram `nova-3`', 'OpenAI `gpt-4o-mini-transcribe`', 'Groq `whisper-large-v3-turbo`']
  };
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
  let cliInstallForm = $state({
    manager: 'npm',
    packageSpec: '',
    binaryName: ''
  });
  let bodyMode = $state<'text' | 'html'>('text');
  let searchInput = $state<HTMLInputElement | undefined>(undefined);
  let composeOpen = $state(false);
  let composeMode = $state<'compose' | 'reply' | 'reply_all' | 'forward'>('compose');
  let composeEditorMode = $state<'plain' | 'rich'>('plain');
  let composeHtml = $state('');
  let composeAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  let mobileMenuOpen = $state(false);
  let selectedMessageId = $state<number | null>(null);
  let contactsImportCsv = $state('');
  let cachePassphrase = $state('');
  let cacheEncrypted = $state(false);
  let backups = $state<Array<{ id: string; createdAt: string }>>([]);
  let auditSnapshot = $state<{ actions: number; toolCalls: number; memoryEvents: number } | null>(
    null
  );
  let selectedQueueIds = $state<number[]>([]);
  let showShortcutHelp = $state(false);
  let autopilotPolicy = $state({
    autopilotEnabled: false,
    dryRunOnly: true,
    allowAutoFileLowRisk: false,
    allowAutoNoActionLowRisk: false,
    requireApprovalForSend: true,
    maxMessagesPerRun: 25,
    maxAutoActionsPerRun: 5,
    followUpDays: 2,
    autoApproveReadOnlyToolCalls: true
  });
  let googleOauthSettings = $state({
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    scopes: ['openid', 'email', 'profile', 'https://mail.google.com/'].join('\n'),
    isEnabled: true
  });
  let googleOauthHasSecret = $state(false);
  let googleOauthConnectedEmail = $state('');
  let dictationTarget = $state<HTMLTextAreaElement | HTMLInputElement | null>(null);
  let dictationActive = $state(false);
  let dictationLevel = $state(0);
  let dictationUnavailable = $state(false);
  let mediaRecorder: MediaRecorder | null = null;
  let recordingChunks: BlobPart[] = [];
  let recordingStream: MediaStream | null = null;
  let dictationAudioContext: AudioContext | null = null;
  let dictationAudioSource: MediaStreamAudioSourceNode | null = null;
  let dictationAnalyser: AnalyserNode | null = null;
  let dictationAnimationFrame: number | null = null;
  let audioProviderId = $state('deepgram');
  let audioModelId = $state('nova-3');
  let audioApiKey = $state('');
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
  let composeAiPrompt = $state('');
  let isGeneratingCompose = $state(false);
  let foldersExpanded = $state(false);
  let quickActionIds = $state<QuickActionId[]>([
    'reply',
    'reply_all',
    'forward',
    'archive',
    'delete',
    'spam'
  ]);
  let swipeSettings = $state({
    leftShort: 'delete' as SwipeActionId,
    leftLong: 'spam' as SwipeActionId,
    rightShort: 'archive' as SwipeActionId,
    rightLong: 'toggle_read' as SwipeActionId
  });
  let swiping = $state<{
    id: number;
    startX: number;
    deltaX: number;
    pointerId: number;
    dragging: boolean;
  } | null>(null);
  let quickActionOverflowOpen = $state(false);
  let isMobileViewport = $state(false);
  let mobileSettingsDetailOpen = $state(false);

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
    const nextView = data.query?.view;
    view =
      typeof nextView === 'string' &&
      ['inbox', 'unread', 'starred', 'pending', 'operations', 'settings'].includes(nextView)
        ? (nextView as AppView)
        : 'inbox';
    const nextSettings = data.query?.settings;
    settingsCategory = settingsCategoryKeys.includes(nextSettings as SettingsCategory)
      ? (nextSettings as SettingsCategory)
      : 'accounts';
    const nextOps = data.query?.ops;
    operationsCategory = nextOps === 'executed' ? 'executed' : 'autopilot';

    accountFilter = data.query?.accountId ? String(data.query.accountId) : '';
    draftText = data.selected?.suggestion?.draftReply || '';
    memoryText = data.memory;
    skillsText = data.skillsMarkdown || data.defaultSkillsMarkdown || '';
    coreProfileText = data.memoryOverview?.profile?.coreProfile || '';
    memoryAdvancedMode = data.memoryOverview?.profile?.advancedMode || false;
    bodyMode = data.selected?.message?.safeBodyHtml ? 'html' : 'text';
    googleOauthHasSecret = Boolean(data.googleOauthSettings?.hasClientSecret);
    googleOauthConnectedEmail = data.query?.oauth === 'connected' ? data.query?.email || '' : '';
  });

  $effect(() => {
    const urlSearch = data.query?.q || '';
    if (!searchDebounce && untrack(() => search) !== urlSearch) {
      search = urlSearch;
    }
  });

  $effect(() => {
    const currentSelectedMessageId = data.selected?.message?.id ?? null;
    if (untrack(() => selectedMessageId) !== currentSelectedMessageId) {
      selectedMessageId = currentSelectedMessageId;
    }
  });

  $effect(() => {
    const defaultAccountId = data.selected?.message?.accountId || data.accounts[0]?.id || 0;
    if (!untrack(() => compose.accountId)) {
      compose.accountId = defaultAccountId;
    }
  });

  $effect(() => {
    void replaceCache('messages', data.messages);
    void replaceCache('folders', data.folders);
    void replaceCache('contacts', data.contacts);
    void setCacheMeta('lastPageCacheAt', new Date().toISOString());
    cacheEncrypted = cacheEncryptionEnabled();
  });

  $effect(() => {
    const serverOauth = data.googleOauthSettings;
    const nextClientId = serverOauth?.clientId || '';
    const nextRedirectUri = serverOauth?.redirectUri || (typeof window !== 'undefined' ? `${window.location.origin}/api/accounts/google/callback` : '');
    const nextScopes = (serverOauth?.scopes || ['openid', 'email', 'profile', 'https://mail.google.com/']).join('\n');
    const nextIsEnabled = serverOauth?.isEnabled ?? true;
    
    untrack(() => {
      if (googleOauthSettings.clientId !== nextClientId) googleOauthSettings.clientId = nextClientId;
      if (googleOauthSettings.redirectUri !== nextRedirectUri) googleOauthSettings.redirectUri = nextRedirectUri;
      if (googleOauthSettings.scopes !== nextScopes) googleOauthSettings.scopes = nextScopes;
      if (googleOauthSettings.isEnabled !== nextIsEnabled) googleOauthSettings.isEnabled = nextIsEnabled;
    });
  });

  $effect(() => {
    const p = data.autopilot?.policy;
    if (p) {
      untrack(() => {
        if (autopilotPolicy.autopilotEnabled !== Boolean(p.autopilotEnabled)) autopilotPolicy.autopilotEnabled = Boolean(p.autopilotEnabled);
        if (autopilotPolicy.dryRunOnly !== Boolean(p.dryRunOnly)) autopilotPolicy.dryRunOnly = Boolean(p.dryRunOnly);
        if (autopilotPolicy.allowAutoFileLowRisk !== Boolean(p.allowAutoFileLowRisk)) autopilotPolicy.allowAutoFileLowRisk = Boolean(p.allowAutoFileLowRisk);
        if (autopilotPolicy.allowAutoNoActionLowRisk !== Boolean(p.allowAutoNoActionLowRisk)) autopilotPolicy.allowAutoNoActionLowRisk = Boolean(p.allowAutoNoActionLowRisk);
        if (autopilotPolicy.requireApprovalForSend !== Boolean(p.requireApprovalForSend)) autopilotPolicy.requireApprovalForSend = Boolean(p.requireApprovalForSend);
        if (autopilotPolicy.maxMessagesPerRun !== (p.maxMessagesPerRun || 25)) autopilotPolicy.maxMessagesPerRun = p.maxMessagesPerRun || 25;
        if (autopilotPolicy.maxAutoActionsPerRun !== (p.maxAutoActionsPerRun || 5)) autopilotPolicy.maxAutoActionsPerRun = p.maxAutoActionsPerRun || 5;
        if (autopilotPolicy.followUpDays !== (p.followUpDays || 2)) autopilotPolicy.followUpDays = p.followUpDays || 2;
        if (autopilotPolicy.autoApproveReadOnlyToolCalls !== Boolean(p.autoApproveReadOnlyToolCalls)) autopilotPolicy.autoApproveReadOnlyToolCalls = Boolean(p.autoApproveReadOnlyToolCalls);
      });
    }
  });

  aiProfileForms = {
    primary: seedAiProfileForm('primary'),
    fallback: seedAiProfileForm('fallback'),
    advanced: seedAiProfileForm('advanced'),
    audio: seedAiProfileForm('audio')
  } as typeof aiProfileForms;

  $effect(() => {
    const audioProfile = aiProfileForms.audio;
    const providerFromSettings =
      data.audioDictationSettings?.provider || audioProfile?.provider || 'deepgram';
    audioProviderId = providerFromSettings;
    const provider =
      data.speechProviders?.find((item: { id: string }) => item.id === providerFromSettings) ||
      data.speechProviders?.[0];
    const desiredModel =
      data.audioDictationSettings?.model ||
      audioProfile?.model ||
      provider?.defaultModel ||
      'nova-3';
    const matchedModel = provider?.models?.some(
      (model: { id: string }) => model.id === desiredModel
    )
      ? desiredModel
      : provider?.defaultModel || desiredModel;
    audioModelId = matchedModel;
  });

  $effect(() => {
    for (const profile of coreAiProfileKeys) {
      const form = aiProfileForms[profile];
      const currentMode = profileMode[profile];
      const nextMode: 'catalog' | 'manual' =
        form?.preset === 'modeldev' ? 'catalog' : currentMode || 'catalog';
      if (currentMode !== nextMode) {
        untrack(() => {
          profileMode = { ...profileMode, [profile]: nextMode };
        });
      }
      if (form?.notes && form.notes.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(form.notes) as { env?: Record<string, string> };
          if (parsed.env && typeof parsed.env === 'object') {
            untrack(() => {
              const currentEnvStr = JSON.stringify(profileEnvValues[profile] || {});
              const nextEnvStr = JSON.stringify(parsed.env);
              if (currentEnvStr !== nextEnvStr) {
                profileEnvValues = { ...profileEnvValues, [profile]: parsed.env };
              }
            });
          }
        } catch {
          // keep existing
        }
      }
    }
  });

  onMount(() => {
    loadUiPreferences();
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 767px)');
    const applyViewport = () => {
      isMobileViewport = media.matches;
      if (!media.matches) mobileSettingsDetailOpen = false;
    };
    applyViewport();
    media.addEventListener('change', applyViewport);
    return () => media.removeEventListener('change', applyViewport);
  });

  const onboardingTitle = $derived(
    data.onboarding?.needsAiSetup
      ? 'Step 1: add your AI profiles'
      : data.onboarding?.needsEmailSetup
        ? 'Step 2: add your first email account'
        : null
  );
  const onboardingBody = $derived(
    data.onboarding?.needsAiSetup
      ? 'Configure the primary, fallback, and advanced AI profiles in Config. Once the AI profiles are saved, the app will guide you to add a mailbox.'
      : data.onboarding?.needsEmailSetup
        ? 'Your AI profiles are ready. Add a real IMAP/SMTP account next. The seeded demo mailbox will be removed automatically the first time you save a real account.'
        : data.onboarding?.demoDataWillBePrunedOnRealAccount
          ? 'Demo messages are still loaded. They will be removed automatically when you save your first real mailbox.'
          : null
  );
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
    if (view !== 'settings') return;
    void refreshBackups();
  });

  function stopDictationMeter() {
    if (dictationAnimationFrame !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(dictationAnimationFrame);
    }
    dictationAnimationFrame = null;
    dictationAnalyser?.disconnect();
    dictationAudioSource?.disconnect();
    if (dictationAudioContext && dictationAudioContext.state !== 'closed') {
      void dictationAudioContext.close();
    }
    dictationAnalyser = null;
    dictationAudioSource = null;
    dictationAudioContext = null;
    dictationLevel = 0;
  }

  function openSettings(category: SettingsCategory = 'accounts') {
    mobileMenuOpen = false;
    mobileSettingsDetailOpen = false;
    if (isMobileViewport) {
      void navigateView('settings', { clearMessage: true });
      return;
    }
    void navigateView('settings', { settings: category, clearMessage: true });
  }

  function openSettingsCategory(category: SettingsCategory) {
    mobileMenuOpen = false;
    if (isMobileViewport) mobileSettingsDetailOpen = true;
    void navigateView('settings', { settings: category, clearMessage: true });
  }

  function audioProvider() {
    return (
      data.speechProviders?.find((provider: { id: string }) => provider.id === audioProviderId) ||
      data.speechProviders?.[0]
    );
  }

  function audioModels() {
    return audioProvider()?.models || [];
  }

  function _browserSpeechSupported() {
    if (typeof window === 'undefined') return false;
    const maybeWindow = window as Window & {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    return Boolean(maybeWindow.SpeechRecognition || maybeWindow.webkitSpeechRecognition);
  }

  function openOperations(category: 'autopilot' | 'executed' = 'autopilot') {
    mobileMenuOpen = false;
    void navigateView('operations', { ops: category, clearMessage: true });
  }

  async function navigateView(
    nextView: AppView,
    options: {
      settings?: SettingsCategory;
      ops?: 'autopilot' | 'executed';
      clearMessage?: boolean;
    } = {}
  ) {
    mobileMenuOpen = false;
    showShortcutHelp = false;
    const params = new URLSearchParams(location.search);
    if (nextView === 'inbox') params.delete('view');
    else params.set('view', nextView);
    if (options.clearMessage || nextView === 'settings' || nextView === 'operations')
      params.delete('message');
    if (nextView !== 'settings') params.delete('settings');
    if (nextView !== 'operations') params.delete('ops');
    if (options.settings) params.set('settings', options.settings);
    if (options.ops) params.set('ops', options.ops);
    if (nextView === 'settings' || nextView === 'operations') {
      params.delete('folder');
      params.delete('accountId');
    }
    if (['inbox', 'unread', 'starred', 'pending'].includes(nextView)) {
      params.delete('folder');
    }
    await goto(`/?${params.toString()}`);
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    const recognitionAvailable =
      typeof navigator !== 'undefined' &&
      !!(window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    dictationUnavailable = !recognitionAvailable && typeof MediaRecorder === 'undefined';
    loadCacheEncryptionPassphrase();
    cacheEncrypted = cacheEncryptionEnabled();
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.getAttribute('contenteditable') === 'true';
      if (!typing && event.key === '/' && isInboxView(view)) {
        event.preventDefault();
        searchInput?.focus();
        return;
      }
      if (!typing && event.key === '?' && isInboxView(view)) {
        event.preventDefault();
        showShortcutHelp = !showShortcutHelp;
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'c') {
        event.preventDefault();
        openCompose('compose');
        return;
      }
      if (!isInboxView(view)) return;
      const selectedId = data.selected?.message?.id ?? data.messages[0]?.id;
      const current =
        data.selected?.message ||
        data.messages.find((message: { id: number }) => message.id === selectedId);
      const index = data.messages.findIndex((message: { id: number }) => message.id === selectedId);
      if (event.key === 'j') {
        const next = data.messages[Math.min(index + 1, data.messages.length - 1)];
        if (next) void selectMessage(next.id);
      } else if (event.key === 'k') {
        const prev = data.messages[Math.max(index - 1, 0)];
        if (prev) void selectMessage(prev.id);
      } else if (event.key === 'r' && current) {
        event.preventDefault();
        openCompose('reply');
      } else if (event.key === 'a' && current) {
        event.preventDefault();
        void archiveSelected();
      } else if (event.key === 'f' && current) {
        event.preventDefault();
        openCompose('forward');
      } else if (event.key === 's' && current) {
        event.preventDefault();
        void toggleFlagged();
      } else if (event.key === 'u' && current) {
        event.preventDefault();
        void toggleRead();
      } else if (event.key === 'e' && current) {
        event.preventDefault();
        void archiveSelected();
      } else if (event.key === '#') {
        event.preventDefault();
        void deleteSelected();
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
      if (!response.ok) {
        const text = await response.text();
        try {
          const json = JSON.parse(text);
          throw new Error(json.message || text);
        } catch {
          throw new Error(text);
        }
      }
      return response.json();
    } finally {
      isLoading = false;
    }
  }

  function loadUiPreferences() {
    if (typeof localStorage === 'undefined') return;
    try {
      const savedQuickActions = JSON.parse(
        localStorage.getItem('dear-robot.quickActions') || 'null'
      ) as QuickActionId[] | null;
      if (Array.isArray(savedQuickActions)) {
        const allowed = savedQuickActions.filter((id): id is QuickActionId =>
          quickActionCatalog.some((action) => action.id === id)
        );
        if (allowed.length) quickActionIds = allowed;
      }
      const savedSwipes = JSON.parse(
        localStorage.getItem('dear-robot.swipeActions') || 'null'
      ) as Partial<typeof swipeSettings> | null;
      if (savedSwipes) {
        swipeSettings = {
          leftShort: coerceSwipeAction(savedSwipes.leftShort, 'delete'),
          leftLong: coerceSwipeAction(savedSwipes.leftLong, 'spam'),
          rightShort: coerceSwipeAction(savedSwipes.rightShort, 'archive'),
          rightLong: coerceSwipeAction(savedSwipes.rightLong, 'toggle_read')
        };
      }
    } catch {
      quickActionIds = ['reply', 'reply_all', 'forward', 'archive', 'delete', 'spam'];
    }
  }

  function coerceSwipeAction(value: unknown, fallback: SwipeActionId): SwipeActionId {
    return swipeActionCatalog.some((action) => action.id === value)
      ? (value as SwipeActionId)
      : fallback;
  }

  function saveUiPreferences() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('dear-robot.quickActions', JSON.stringify(quickActionIds));
    localStorage.setItem('dear-robot.swipeActions', JSON.stringify(swipeSettings));
  }

  function setQuickActionEnabled(actionId: QuickActionId, enabled: boolean) {
    if (enabled && !quickActionIds.includes(actionId)) {
      quickActionIds = [...quickActionIds, actionId];
    } else if (!enabled) {
      quickActionIds = quickActionIds.filter((id) => id !== actionId);
    }
    saveUiPreferences();
  }

  function moveQuickAction(actionId: QuickActionId, direction: -1 | 1) {
    const index = quickActionIds.indexOf(actionId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= quickActionIds.length) return;
    const next = [...quickActionIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    quickActionIds = next;
    saveUiPreferences();
  }

  function updateSwipeSetting(key: keyof typeof swipeSettings, action: SwipeActionId) {
    swipeSettings = { ...swipeSettings, [key]: action };
    saveUiPreferences();
  }

  function resetInterfacePreferences() {
    quickActionIds = ['reply', 'reply_all', 'forward', 'archive', 'delete', 'spam'];
    swipeSettings = {
      leftShort: 'delete',
      leftLong: 'spam',
      rightShort: 'archive',
      rightLong: 'toggle_read'
    };
    saveUiPreferences();
    status = 'Interface preferences reset';
  }

  async function selectMessage(id: number) {
    isLoading = true;
    try {
      showShortcutHelp = false;
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
      showShortcutHelp = false;
      const params = new URLSearchParams(location.search);
      params.delete('message');
      await goto(`/?${params.toString()}`);
    } finally {
      isLoading = false;
    }
  }

  async function mobileBack() {
    if (view === 'settings') {
      if (isMobileViewport && mobileSettingsDetailOpen) {
        mobileSettingsDetailOpen = false;
        const params = new URLSearchParams(location.search);
        params.delete('settings');
        params.delete('message');
        await goto(`/?${params.toString()}`);
        return;
      }
      await navigateView('inbox', { clearMessage: true });
      return;
    }
    if (view === 'operations') {
      await navigateView('inbox', { clearMessage: true });
      return;
    }
    await deselectMessage();
  }

  async function applySearch(options: { clearMessage?: boolean } = {}) {
    isLoading = true;
    try {
      const active =
        typeof document !== 'undefined' ? document.activeElement === searchInput : false;
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (view !== 'inbox') params.set('view', view);
      if (accountFilter) params.set('accountId', accountFilter);
      if (data.query?.folder) params.set('folder', data.query.folder);
      if (options.clearMessage) params.delete('message');
      await goto(`/?${params.toString()}`);
      if (active) {
        await tick();
        if (typeof document !== 'undefined' && document.activeElement !== searchInput) {
          searchInput?.focus({ preventScroll: true });
        }
      }
    } finally {
      isLoading = false;
    }
  }

  function scheduleSearch() {
    if (searchDebounce) clearTimeout(searchDebounce);
    if (!['inbox', 'unread', 'starred', 'pending'].includes(view)) return;
    searchDebounce = setTimeout(() => {
      void applySearch({ clearMessage: true });
    }, 250);
  }

  onDestroy(() => {
    if (searchDebounce) clearTimeout(searchDebounce);
    stopDictationMeter();
  });

  async function executeSuggestion() {
    if (!data.selected?.suggestion) return;
    status = 'Executing...';
    await api(`/api/suggestions/${data.selected.suggestion.id}/execute`, {
      method: 'POST',
      body: '{}'
    });
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
    await api(`/api/suggestions/${data.selected.suggestion.id}/reject`, {
      method: 'POST',
      body: '{}'
    });
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
    accountAddState = 'loading';
    accountAddError = '';
    try {
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
      accountAddState = 'success';
      status = 'Account added';
      await invalidateAll();
    } catch (err: any) {
      accountAddState = 'error';
      accountAddError = err.message || 'Failed to add account';
      status = accountAddError;
    } finally {
      if (accountAddState === 'success') {
        setTimeout(() => {
          accountAddState = 'idle';
        }, 3000);
      }
    }
  }

  async function testNewAccount() {
    accountTestState = 'loading';
    accountTestError = '';
    try {
      const result = await api('/api/accounts/test', {
        method: 'POST',
        body: JSON.stringify(accountForm)
      });
      if (result.ok) {
        accountTestState = 'success';
        status = 'Connection successful!';
      } else {
        accountTestState = 'error';
        accountTestError = result.message || 'Connection test failed';
        status = `Connection failed: ${result.message}`;
      }
    } catch (err: any) {
      accountTestState = 'error';
      accountTestError = err.message || 'Connection test failed';
      status = accountTestError;
    } finally {
      if (accountTestState === 'success') {
        setTimeout(() => {
          accountTestState = 'idle';
        }, 3000);
      }
    }
  }

  async function discoverAccountSettings() {
    if (!accountForm.email || !accountForm.email.includes('@')) return;
    accountDiscoverState = 'loading';
    accountDiscoverError = '';
    try {
      const result = await api('/api/accounts/discover', {
        method: 'POST',
        body: JSON.stringify({ email: accountForm.email })
      });
      if (result.ok && result.settings) {
        accountForm = {
          ...accountForm,
          ...result.settings
        };
        accountDiscoverState = 'success';
        status = 'Settings discovered';
      } else {
        accountDiscoverState = 'error';
        accountDiscoverError = result.message || 'Could not discover settings';
        status = accountDiscoverError;
      }
    } catch (err: any) {
      accountDiscoverState = 'error';
      accountDiscoverError = err.message || 'Could not discover settings';
      status = accountDiscoverError;
    } finally {
      if (accountDiscoverState === 'success') {
        setTimeout(() => {
          accountDiscoverState = 'idle';
        }, 3000);
      }
    }
  }

  async function saveGoogleOauthSettings() {
    const scopes = googleOauthSettings.scopes
      .split('\n')
      .map((scope) => scope.trim())
      .filter(Boolean);
    await api('/api/oauth/google/settings', {
      method: 'POST',
      body: JSON.stringify({
        clientId: googleOauthSettings.clientId,
        clientSecret: googleOauthSettings.clientSecret,
        redirectUri: googleOauthSettings.redirectUri,
        scopes,
        isEnabled: googleOauthSettings.isEnabled
      })
    });
    googleOauthSettings.clientSecret = '';
    googleOauthHasSecret = true;
    status = 'Google OAuth settings saved';
  }

  async function testAiProfile(profile: 'primary' | 'fallback' | 'advanced' | 'audio') {
    status = `Testing ${profile} profile...`;
    const form = aiProfileForms[profile];
    let configOverrides: any = {};

    if (profile === 'audio') {
      configOverrides = {
        provider: audioProviderId,
        model: audioModelId,
        apiKey: audioApiKey.trim() ? audioApiKey : undefined
      };
    } else if (profileMode[profile] === 'catalog') {
      const envKeys = requiredEnvVars(profile as 'primary' | 'fallback' | 'advanced');
      const envPayload: Record<string, string> = {};
      for (const envKey of envKeys) {
        const value = profileEnvValues[profile]?.[envKey] || '';
        if (value.trim()) envPayload[envKey] = value.trim();
      }
      configOverrides = {
        provider: form.provider,
        model: form.model,
        baseUrl: form.baseUrl,
        apiKey: envPayload
      };
    } else {
      configOverrides = {
        provider: form.provider,
        model: form.model,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey?.trim() ? form.apiKey : undefined
      };
    }

    try {
      const result = await api('/api/ai-profiles/test', {
        method: 'POST',
        body: JSON.stringify({ profile, config: configOverrides })
      });
      status = result.message || `${profile} profile test passed`;
    } catch (e: any) {
      status = e.message || 'Test failed';
      throw e;
    }
  }

  async function loadModelsDevCatalog() {
    if (modelsDevLoaded || modelsDevLoading) return;
    modelsDevLoading = true;
    try {
      const result = await api('/api/ai-profiles/modelsdev');
      modelsDevProviders = result.providers || [];
      modelsDevLoaded = true;
    } finally {
      modelsDevLoading = false;
    }
  }

  function modelsDevProviderByInput(input: string) {
    const normalized = input.trim().toLowerCase();
    return (
      modelsDevProviders.find(
        (provider) =>
          provider.id.toLowerCase() === normalized || provider.name.toLowerCase() === normalized
      ) || null
    );
  }

  function selectedCatalogProvider(profile: 'primary' | 'fallback' | 'advanced') {
    return modelsDevProviderByInput(aiProfileForms[profile]?.provider || '');
  }

  function selectedCatalogModels(profile: 'primary' | 'fallback' | 'advanced') {
    return selectedCatalogProvider(profile)?.models || [];
  }

  function requiredEnvVars(profile: 'primary' | 'fallback' | 'advanced') {
    return selectedCatalogProvider(profile)?.env || ['API_KEY'];
  }

  function setProfileMode(
    profile: 'primary' | 'fallback' | 'advanced',
    mode: 'catalog' | 'manual'
  ) {
    if (mode === 'manual') {
      aiProfileForms = {
        ...aiProfileForms,
        [profile]: {
          ...aiProfileForms[profile],
          transport: 'openai_compatible'
        }
      };
    }
    profileMode = {
      ...profileMode,
      [profile]: mode
    };
    if (mode === 'catalog') void loadModelsDevCatalog();
  }

  function selectCatalogProviderForProfile(
    profile: 'primary' | 'fallback' | 'advanced',
    input: string
  ) {
    const provider = modelsDevProviderByInput(input);
    if (!provider) {
      aiProfileForms = {
        ...aiProfileForms,
        [profile]: {
          ...aiProfileForms[profile],
          provider: input
        }
      };
      return;
    }
    const defaultModel = provider.models[0]?.id || aiProfileForms[profile].model || '';
    const knownBaseByProvider: Record<string, string> = {
      deepseek: 'https://api.deepseek.com',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      openai: 'https://api.openai.com/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      groq: 'https://api.groq.com/openai/v1'
    };
    const fallbackBase =
      provider.api || knownBaseByProvider[provider.id] || aiProfileForms[profile].baseUrl || '';
    aiProfileForms = {
      ...aiProfileForms,
      [profile]: {
        ...aiProfileForms[profile],
        provider: provider.id,
        model: defaultModel,
        baseUrl: fallbackBase,
        transport: provider.id === 'anthropic' ? 'anthropic' : 'openai_compatible',
        preset: 'modeldev',
        label:
          profile === 'advanced' ? 'Advanced Planner' : profile[0].toUpperCase() + profile.slice(1)
      }
    };
  }

  function profileDefaultModelOptions(profile: 'primary' | 'fallback' | 'advanced' | 'audio') {
    const presetId = aiProfileForms[profile]?.preset;
    const preset = (((data as any).aiPresets || []) as Array<Record<string, any>>).find(
      (item) => item.id === presetId
    );
    return (preset?.modelOptions || []).map((id: string) => ({ id, label: id }));
  }

  function _resolvedModelOptions(profile: 'primary' | 'fallback' | 'advanced' | 'audio') {
    const dynamic = aiCatalogOptions[profile];
    if (dynamic?.length) return dynamic;
    return profileDefaultModelOptions(profile);
  }

  async function _fetchAiModelCatalog(profile: 'primary' | 'fallback' | 'advanced' | 'audio') {
    const form = aiProfileForms[profile];
    if (!form) return;
    if (form.provider === 'modeldev' && form.baseUrl.includes('api.model.dev')) {
      form.baseUrl = form.baseUrl.replace('api.model.dev', 'model.dev');
      aiProfileForms = { ...aiProfileForms, [profile]: { ...form } };
    }
    status = `Fetching model catalog for ${form.label}...`;
    const result = await api('/api/ai-profiles/catalog', {
      method: 'POST',
      body: JSON.stringify({
        profile,
        provider: form.provider,
        transport: form.transport,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey.trim() ? form.apiKey : undefined
      })
    });
    aiCatalogOptions = {
      ...aiCatalogOptions,
      [profile]: result.models || []
    };
    status = `Loaded ${(result.models || []).length} models`;
  }

  async function runAutopilot() {
    status = 'Running autopilot...';
    await api('/api/autopilot', { method: 'POST', body: JSON.stringify({ action: 'run' }) });
    selectedQueueIds = [];
    status = 'Autopilot run complete';
    await invalidateAll();
  }

  async function saveAutopilotPolicy() {
    await api('/api/autopilot', {
      method: 'POST',
      body: JSON.stringify({ action: 'save_policy', policy: autopilotPolicy })
    });
    status = 'Autopilot policy saved';
    await invalidateAll();
  }

  function _toggleQueueItem(id: number, selected: boolean) {
    selectedQueueIds = selected
      ? Array.from(new Set([...selectedQueueIds, id]))
      : selectedQueueIds.filter((value) => value !== id);
  }

  function _selectAllQueue() {
    const ids = (data.autopilot?.queue || [])
      .filter((item: { status: string }) => item.status === 'proposed')
      .map((item: { id: number }) => item.id);
    selectedQueueIds = selectedQueueIds.length === ids.length ? [] : ids;
  }

  async function _queueAction(action: 'approve' | 'reject' | 'execute') {
    if (!selectedQueueIds.length) return;
    status = `${action} queue items...`;
    await api(`/api/autopilot/queue/${action}`, {
      method: 'POST',
      body: JSON.stringify({ ids: selectedQueueIds })
    });
    selectedQueueIds = [];
    status = `Queue ${action} complete`;
    await invalidateAll();
  }

  async function recordMessageOutcome(
    outcomeType: 'resolved' | 'needs_followup' | 'bad_draft' | 'wrong_action'
  ) {
    if (!data.selected?.message) return;
    await api('/api/autopilot/outcomes', {
      method: 'POST',
      body: JSON.stringify({
        messageId: data.selected.message.id,
        suggestionId: data.selected.suggestion?.id || null,
        outcomeType
      })
    });
    status = 'Outcome recorded';
    await invalidateAll();
  }

  function startGoogleConnect() {
    window.location.href = '/api/accounts/google/start';
  }

  async function accountAction(id: number, action: 'test' | 'enable' | 'disable' | 'delete') {
    status = `${action} account...`;
    if (action === 'delete') await api(`/api/accounts/${id}`, { method: 'DELETE' });
    else await api(`/api/accounts/${id}/${action}`, { method: 'POST', body: '{}' });
    status = `Account ${action} complete`;
    await invalidateAll();
  }

  async function saveMemory() {
    await api('/api/memory', {
      method: 'POST',
      body: JSON.stringify({ action: 'save_markdown', markdown: memoryText })
    });
    status = 'Memory saved';
    await invalidateAll();
  }

  async function saveSkills() {
    await api('/api/memory', {
      method: 'POST',
      body: JSON.stringify({ action: 'save_skills_markdown', skillsMarkdown: skillsText })
    });
    status = 'Skills saved';
    await invalidateAll();
  }

  async function resetSkills() {
    isLoading = true;
    try {
      const response = await fetch('/api/memory');
      const json = await response.json();
      skillsText = json.defaultSkillsMarkdown || skillsText;
    } finally {
      isLoading = false;
    }
  }

  async function saveCoreProfile() {
    await api('/api/memory', {
      method: 'POST',
      body: JSON.stringify({ action: 'save_core_profile', coreProfile: coreProfileText })
    });
    status = 'Core profile saved';
    await invalidateAll();
  }

  async function setAdvancedMemoryMode(enabled: boolean) {
    await api('/api/memory', {
      method: 'POST',
      body: JSON.stringify({ action: 'set_advanced_mode', enabled })
    });
    memoryAdvancedMode = enabled;
    status = enabled ? 'Advanced memory mode enabled' : 'Advanced memory mode disabled';
    await invalidateAll();
  }

  async function removeMemoryRule(id: number) {
    await api('/api/memory', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_rule', id })
    });
    status = 'Rule removed';
    await invalidateAll();
  }

  async function applyMemoryAssistant() {
    if (!memoryAssistantPrompt.trim()) return;
    status = 'Updating memory...';
    const result = await api('/api/memory/assistant', {
      method: 'POST',
      body: JSON.stringify({ prompt: memoryAssistantPrompt })
    });
    memoryAssistantPrompt = '';
    coreProfileText = result.memoryOverview?.profile?.coreProfile || coreProfileText;
    memoryAdvancedMode = Boolean(
      result.memoryOverview?.profile?.advancedMode ?? memoryAdvancedMode
    );
    status = result.action?.summary || 'Memory updated';
    await invalidateAll();
  }

  async function refreshBackups() {
    const response = await api('/api/admin/backups');
    backups = response.backups || [];
  }

  async function createBackupNow() {
    status = 'Creating backup...';
    await api('/api/admin/backups', { method: 'POST', body: '{}' });
    await refreshBackups();
    status = 'Backup created';
  }

  async function loadAuditSnapshot() {
    const audit = await api('/api/admin/audit');
    auditSnapshot = {
      actions: audit.actions?.length || 0,
      toolCalls: audit.toolCalls?.length || 0,
      memoryEvents: audit.memoryEvents?.length || 0
    };
  }

  async function restoreBackupNow(id: string) {
    status = 'Restoring backup...';
    await api(`/api/admin/backups/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      body: '{}'
    });
    status = 'Backup restored';
    await invalidateAll();
  }

  function saveCacheEncryption() {
    setCacheEncryptionPassphrase(cachePassphrase || null);
    cacheEncrypted = cacheEncryptionEnabled();
    status = cacheEncrypted
      ? 'Encrypted browser cache enabled'
      : 'Encrypted browser cache disabled';
  }

  function getDictationTarget(targetId: string) {
    return document.getElementById(targetId) as HTMLTextAreaElement | HTMLInputElement | null;
  }

  async function toggleDictation(targetId: string) {
    const target = getDictationTarget(targetId);
    if (dictationActive) {
      if (dictationTarget?.id === targetId) {
        mediaRecorder?.stop();
      }
      return;
    }
    if (!target) return;
    if (typeof MediaRecorder === 'undefined') {
      status = 'Dictation unavailable in this browser';
      return;
    }
    try {
      dictationTarget = target;
      dictationLevel = 0;
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingChunks = [];
      mediaRecorder = new MediaRecorder(recordingStream, { mimeType: 'audio/webm' });
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunks.push(event.data);
      };
      mediaRecorder.onstop = async () => {
        dictationActive = false;
        stopDictationMeter();
        const blob = new Blob(recordingChunks, { type: 'audio/webm' });
        recordingStream?.getTracks().forEach((track) => track.stop());
        recordingStream = null;
        mediaRecorder = null;
        if (blob.size === 0) return;
        status = 'Transcribing audio...';
        const form = new FormData();
        form.set('file', blob, 'dictation.webm');
        const response = await fetch('/api/audio/transcribe', {
          method: 'POST',
          headers: { 'x-csrf-token': data.csrfToken },
          body: form
        });
        if (!response.ok) throw new Error(await response.text());
        const json = await response.json();
        if (typeof json.text === 'string' && json.text.trim()) {
          const currentTarget = dictationTarget;
          if (currentTarget) {
            const start = currentTarget.selectionStart ?? currentTarget.value.length;
            const end = currentTarget.selectionEnd ?? currentTarget.value.length;
            const before = currentTarget.value.slice(0, start);
            const after = currentTarget.value.slice(end);
            const separator = before && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : '';
            currentTarget.value = `${before}${separator}${json.text.trim()}${after}`;
            currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
          }
          status = 'Transcription inserted';
        } else {
          status = 'No speech detected';
        }
        dictationTarget = null;
        recordingChunks = [];
      };
      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        dictationAudioContext = new AudioContextCtor();
        if (dictationAudioContext.state === 'suspended') {
          await dictationAudioContext.resume();
        }
        dictationAudioSource = dictationAudioContext.createMediaStreamSource(recordingStream);
        dictationAnalyser = dictationAudioContext.createAnalyser();
        dictationAnalyser.fftSize = 256;
        dictationAnalyser.smoothingTimeConstant = 0.7;
        dictationAudioSource.connect(dictationAnalyser);
        const buffer = new Uint8Array(dictationAnalyser.fftSize);
        const updateLevel = () => {
          if (!dictationAnalyser) return;
          dictationAnalyser.getByteTimeDomainData(buffer);
          let sum = 0;
          for (const sample of buffer) {
            const normalized = (sample - 128) / 128;
            sum += normalized * normalized;
          }
          const rms = Math.sqrt(sum / buffer.length);
          dictationLevel = Math.min(1, Math.max(0, Math.pow(rms * 5.5, 0.82)));
          dictationAnimationFrame = window.requestAnimationFrame(updateLevel);
        };
        updateLevel();
      }
      mediaRecorder.start();
      dictationActive = true;
      status = 'Recording... click stop when done';
    } catch (err) {
      dictationActive = false;
      stopDictationMeter();
      dictationTarget = null;
      status = err instanceof Error ? err.message : 'Unable to start recording';
      recordingStream?.getTracks().forEach((track) => track.stop());
      recordingStream = null;
    }
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

  async function saveToolSkills(id: number, skillsMarkdown: string) {
    const result = await api(`/api/tools/${id}`, {
      method: 'POST',
      body: JSON.stringify({ skillsMarkdown })
    });
    status = 'Tool skills saved';
    await invalidateAll();
    return result.tool;
  }

  async function saveToolConfig(id: number, input: { envJson: string; headersJson: string }) {
    try {
      const payload: Record<string, unknown> = {};
      if (input.envJson.trim()) payload.env = parseToolJsonRecord(input.envJson);
      if (input.headersJson.trim()) payload.authHeaders = parseToolJsonRecord(input.headersJson);
      if (!Object.keys(payload).length) {
        status = 'Nothing to save';
        return;
      }
      await api(`/api/tools/${id}`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      status = 'Tool config saved';
      await invalidateAll();
    } catch (error) {
      status = error instanceof Error ? error.message : 'Invalid tool config';
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
    mobileMenuOpen = false;
    showShortcutHelp = false;
    const params = new URLSearchParams();
    params.set('accountId', String(accountId));
    params.set('folder', folderPath);
    await goto(`/?${params.toString()}`);
  }

  async function setQuickView(nextView: AppView) {
    mobileMenuOpen = false;
    showShortcutHelp = false;
    await navigateView(nextView, { clearMessage: true });
  }

  async function moveSelected(folderPath: string) {
    if (!data.selected?.message) return;
    await moveMessageToFolder(data.selected.message.id, folderPath);
  }

  async function moveMessageToFolder(messageId: number, folderPath: string) {
    status = 'Moving message...';
    await api(`/api/messages/${messageId}/move`, {
      method: 'POST',
      body: JSON.stringify({ folderPath })
    });
    status = 'Moved';
    await invalidateAll();
  }

  async function archiveSelected() {
    if (!data.selected?.message) return;
    await archiveMessage(data.selected.message.id);
  }

  async function archiveMessage(messageId: number) {
    const accountId = messageForAction(messageId)?.accountId;
    const archiveFolder = resolveFolderPath(accountId, ['archive']);
    if (!archiveFolder) {
      status = 'No archive folder configured for this account';
      return;
    }
    await moveMessageToFolder(messageId, archiveFolder);
  }

  function resolveFolderPath(accountId: number | null | undefined, names: string[]) {
    if (!accountId) return null;
    const folders = data.folders.filter(
      (folder: { accountId: number; path: string; role?: string | null }) =>
        folder.accountId === accountId
    );
    const normalized = names.map((name) => name.toLowerCase());
    const exact = folders.find(
      (folder: { path: string; role?: string | null }) =>
        normalized.includes(folder.path.toLowerCase()) ||
        (folder.role ? normalized.includes(folder.role.toLowerCase()) : false)
    );
    if (exact) return exact.path;
    const loose = folders.find((folder: { path: string; role?: string | null }) =>
      normalized.some(
        (name) =>
          folder.path.toLowerCase().includes(name) ||
          (folder.role ? folder.role.toLowerCase().includes(name) : false)
      )
    );
    return loose?.path || null;
  }

  async function _markSpam() {
    if (!data.selected?.message) return;
    await markMessageSpam(data.selected.message.id);
  }

  async function markMessageSpam(messageId: number) {
    const accountId = messageForAction(messageId)?.accountId;
    const spamFolder = resolveFolderPath(accountId, ['spam', 'junk', 'spam review']);
    if (!spamFolder) {
      status = 'No spam folder configured for this account';
      return;
    }
    await moveMessageToFolder(messageId, spamFolder);
  }

  async function deleteSelected() {
    if (!data.selected?.message) return;
    await deleteMessage(data.selected.message.id);
  }

  async function deleteMessage(messageId: number) {
    const accountId = messageForAction(messageId)?.accountId;
    const trashFolder = resolveFolderPath(accountId, [
      'trash',
      'deleted items',
      'deleted messages',
      'bin'
    ]);
    if (!trashFolder) {
      status = 'No trash folder configured for this account';
      return;
    }
    await moveMessageToFolder(messageId, trashFolder);
  }

  function messageForAction(messageId: number) {
    if (data.selected?.message?.id === messageId) return data.selected.message;
    return data.messages.find((message: { id: number }) => message.id === messageId);
  }

  async function toggleRead() {
    if (!data.selected?.message) return;
    const messageId = data.selected.message.id;
    const nextRead = !data.selected.message.isRead;
    data = {
      ...data,
      selected: {
        ...data.selected,
        message: { ...data.selected.message, isRead: nextRead }
      }
    };
    await tick();
    const result = await api(`/api/messages/${messageId}/read`, {
      method: 'POST',
      body: JSON.stringify({ read: nextRead })
    });
    if (result?.message && data.selected) {
      data = {
        ...data,
        selected: {
          ...data.selected,
          message: result.message
        }
      };
    }
    await invalidateAll();
  }

  async function toggleMessageRead(messageId: number) {
    const row = messageForAction(messageId);
    if (!row) return;
    await api(`/api/messages/${messageId}/read`, {
      method: 'POST',
      body: JSON.stringify({ read: !row.isRead })
    });
    status = row.isRead ? 'Marked unread' : 'Marked read';
    await invalidateAll();
  }

  async function toggleFlagged() {
    if (!data.selected?.message) return;
    const messageId = data.selected.message.id;
    const nextFlagged = !data.selected.message.isFlagged;
    data = {
      ...data,
      selected: {
        ...data.selected,
        message: { ...data.selected.message, isFlagged: nextFlagged }
      }
    };
    await tick();
    const result = await api(`/api/messages/${messageId}/flag`, {
      method: 'POST',
      body: JSON.stringify({ flagged: nextFlagged })
    });
    if (result?.message && data.selected) {
      data = {
        ...data,
        selected: {
          ...data.selected,
          message: result.message
        }
      };
    }
    await invalidateAll();
  }

  async function toggleMessageFlagged(messageId: number) {
    const row = messageForAction(messageId);
    if (!row) return;
    await api(`/api/messages/${messageId}/flag`, {
      method: 'POST',
      body: JSON.stringify({ flagged: !row.isFlagged })
    });
    status = row.isFlagged ? 'Unstarred' : 'Starred';
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

  async function copyToClipboard(value: string, label = 'Copied') {
    if (!value) {
      status = 'Nothing to copy';
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      status = 'Clipboard unavailable in this browser';
      return;
    }
    await navigator.clipboard.writeText(value);
    status = `${label} copied`;
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

  async function installCliPackage() {
    if (!cliInstallForm.packageSpec.trim()) {
      status = 'Enter a package to install';
      return;
    }
    status = `Installing ${cliInstallForm.packageSpec} via ${cliInstallForm.manager}...`;
    const result = await api('/api/tools/install', {
      method: 'POST',
      body: JSON.stringify({
        manager: cliInstallForm.manager,
        packageSpec: cliInstallForm.packageSpec.trim(),
        binaryName: cliInstallForm.binaryName.trim() || null
      })
    });
    status = result.warning
      ? `Installed with warning: ${result.warning}`
      : `Installed ${cliInstallForm.packageSpec}`;
    if (cliInstallForm.binaryName.trim() && !agentToolForm.command.trim()) {
      agentToolForm = {
        ...agentToolForm,
        kind: 'cli',
        command: cliInstallForm.binaryName.trim()
      };
    }
  }

  function _applyAiPreset(
    profile: 'primary' | 'fallback' | 'advanced' | 'audio',
    presetId: string
  ) {
    const preset = (((data as any).aiPresets || []) as Array<Record<string, any>>).find(
      (item) => item.id === presetId
    );
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
      aiCatalogOptions = { ...aiCatalogOptions, [profile]: [] };
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
    aiCatalogOptions = { ...aiCatalogOptions, [profile]: [] };
  }

  function selectAudioProvider(providerId: string) {
    audioProviderId = providerId;
    const provider = data.speechProviders?.find((item: { id: string }) => item.id === providerId);
    if (!provider) return;
    audioModelId = provider.defaultModel;
    if (provider.authType === 'none') {
      audioApiKey = '';
    }
  }

  function syncAudioProviderIntoProfile() {
    const provider = audioProvider();
    if (!provider) return;
    aiProfileForms = {
      ...aiProfileForms,
      audio: {
        ...aiProfileForms.audio,
        provider: provider.id,
        model: audioModelId,
        preset: provider.id
      }
    };
  }

  async function saveAudioDictationProfile() {
    const provider = audioProvider();
    if (!provider) return;
    const model =
      audioModels().find((item: { id: string }) => item.id === audioModelId)?.id ||
      provider.defaultModel;
    syncAudioProviderIntoProfile();
    status = `Saving dictation provider (${provider.label})...`;
    try {
      await api('/api/ai-profiles', {
        method: 'POST',
        body: JSON.stringify({
          profile: 'audio',
          label: `Dictation: ${provider.label}`,
          provider: provider.id,
          transport: 'openai_compatible',
          model,
          baseUrl:
            provider.id === 'deepgram'
              ? 'https://api.deepgram.com'
              : provider.id === 'groq'
                ? 'https://api.groq.com/openai/v1'
                : provider.id === 'openai'
                  ? 'https://api.openai.com/v1'
                  : provider.id === 'assemblyai'
                    ? 'https://api.assemblyai.com'
                    : provider.id === 'elevenlabs'
                      ? 'https://api.elevenlabs.io'
                      : provider.id === 'soniox'
                        ? 'https://stt-rt.soniox.com'
                        : provider.id === 'google_cloud_stt'
                          ? 'https://speech.googleapis.com'
                          : 'browser://speech-recognition',
          apiKey: provider.authType === 'none' ? null : audioApiKey.trim() ? audioApiKey : undefined,
          preset: provider.id,
          isEnabled: true,
          notes: 'Speech-to-text dictation provider'
        })
      });
      status = 'Dictation provider saved';
      if (provider.authType !== 'none') audioApiKey = '';
      await invalidateAll();
    } catch (e: any) {
      status = e.message || 'Save failed';
      throw e;
    }
  }

  async function saveAiProfile(profile: 'primary' | 'fallback' | 'advanced' | 'audio') {
    const form = aiProfileForms[profile];
    if (!form) return;
    if (form.provider === 'modeldev' && form.baseUrl.includes('api.model.dev')) {
      form.baseUrl = form.baseUrl.replace('api.model.dev', 'model.dev');
      aiProfileForms = { ...aiProfileForms, [profile]: { ...form } };
    }
    const isCoreProfile = coreAiProfileKeys.includes(profile as (typeof coreAiProfileKeys)[number]);
    
    try {
      if (isCoreProfile && profileMode[profile] === 'catalog') {
        const envKeys = requiredEnvVars(profile as 'primary' | 'fallback' | 'advanced');
        const envPayload: Record<string, string> = {};
        for (const envKey of envKeys) {
          const value = profileEnvValues[profile]?.[envKey] || '';
          if (value.trim()) envPayload[envKey] = value.trim();
        }
        await api('/api/ai-profiles', {
          method: 'POST',
          body: JSON.stringify({
            profile: form.profile,
            label: form.label,
            provider: form.provider,
            transport: form.transport,
            model: form.model,
            baseUrl: form.baseUrl,
            apiKey: envPayload,
            preset: 'modeldev',
            isEnabled: form.isEnabled,
            notes: JSON.stringify({
              source: 'modelsdev',
              env: envPayload
            })
          })
        });
        status = `${form.label} saved`;
        await invalidateAll();
        return;
      }
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
    } catch (e: any) {
      status = e.message || 'Save failed';
      throw e;
    }
  }

  function openCompose(mode: 'compose' | 'reply' | 'reply_all' | 'forward') {
    composeMode = mode;
    composeEditorMode = 'plain';
    composeHtml = '';
    const selected = data.selected?.message;
    const accountId = selected?.accountId || data.accounts[0]?.id || 0;
    if (!selected || mode === 'compose') {
      const serverDraft = data.drafts?.find(
        (draft: DraftView) =>
          (draft.accountId || accountId) === accountId && draft.status === 'draft'
      );
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
        : {
            draftId: null,
            accountId,
            to: '',
            cc: '',
            bcc: '',
            subject: '',
            body: '',
            attachments: [],
            sourceMessageId: null
          };
      composeHtml = serverDraft?.bodyHtml || '';
      composeEditorMode = composeHtml ? 'rich' : 'plain';
    } else if (mode === 'reply') {
      compose = {
        draftId: null,
        accountId,
        to: selected.from,
        cc: '',
        bcc: '',
        subject: replySubject(selected.subject),
        body: '',
        attachments: [],
        sourceMessageId: selected.id
      };
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

  function _openDraft(draft: DraftView) {
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

  async function generateComposeBody() {
    if (!composeAiPrompt.trim()) return;
    isGeneratingCompose = true;
    status = 'Generating email...';
    try {
      const result = await api('/api/compose/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt: composeAiPrompt,
          to: compose.to,
          subject: compose.subject,
          context:
            composeMode !== 'compose' && compose.sourceMessageId
              ? { messageId: compose.sourceMessageId }
              : null
        })
      });
      if (result.body) {
        compose.body = result.body;
        composeHtml = result.bodyHtml || result.body;
        if (result.subject && !compose.subject) {
          compose.subject = result.subject;
        }
      }
      composeAiPrompt = '';
      status = 'Email generated';
    } catch (error) {
      status = 'Failed to generate email';
      console.error(error);
    } finally {
      isGeneratingCompose = false;
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
    return value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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

  function parseToolJsonRecord(value: string) {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Tool config must be a JSON object');
    }
    const record: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val !== 'string') {
        throw new Error(`Tool config value for "${key}" must be a string`);
      }
      record[key] = val;
    }
    return record;
  }

  function replySubject(subject: string) {
    return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  }

  function forwardSubject(subject: string) {
    return /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`;
  }

  function riskClass(risk: string | null | undefined) {
    if (risk === 'high') return 'border-destructive/30 bg-destructive/10 text-destructive';
    if (risk === 'medium') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400';
    return 'border-primary/30 bg-primary/10 text-primary';
  }

  function quickActionMeta(actionId: QuickActionId | SwipeActionId) {
    return (
      quickActionCatalog.find((action) => action.id === actionId) ||
      swipeActionCatalog.find((action) => action.id === actionId)
    );
  }

  function visibleMobileQuickActions() {
    return quickActionIds.length > 6 ? quickActionIds.slice(0, 5) : quickActionIds;
  }

  function overflowMobileQuickActions() {
    return quickActionIds.length > 6 ? quickActionIds.slice(5) : [];
  }

  function quickActionButtonClass(actionId: QuickActionId, compact = false) {
    const meta = quickActionCatalog.find((action) => action.id === actionId);
    const base = compact
      ? 'grid place-items-center rounded-lg border p-2 text-sm transition-all duration-200 active:scale-95'
      : 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0';
    if (meta?.tone === 'danger')
      return `${base} border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:shadow-lg hover:shadow-destructive/20`;
    if (meta?.tone === 'accent')
      return `${base} border-primary/30 bg-gradient-to-b from-primary to-primary/90 text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/40 hover:border-primary/50`;
    return `${base} border-border bg-muted/40 text-foreground hover:bg-muted hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10`;
  }

  async function runQuickAction(actionId: QuickActionId, messageId = data.selected?.message?.id) {
    if (!messageId) return;
    quickActionOverflowOpen = false;
    if (actionId === 'reply') return openCompose('reply');
    if (actionId === 'reply_all') return openCompose('reply_all');
    if (actionId === 'forward') return openCompose('forward');
    if (actionId === 'archive') return archiveMessage(messageId);
    if (actionId === 'delete') return deleteMessage(messageId);
    if (actionId === 'spam') return markMessageSpam(messageId);
    if (actionId === 'toggle_read') return toggleMessageRead(messageId);
    if (actionId === 'star') return toggleMessageFlagged(messageId);
  }

  async function saveFolderRole(folderId: number, role: '' | FolderRole) {
    await api(`/api/folders/${folderId}`, {
      method: 'POST',
      body: JSON.stringify({ role: role || null })
    });
    status = 'Folder role saved';
    await invalidateAll();
  }

  function clampSwipe(delta: number) {
    return Math.max(-164, Math.min(164, delta));
  }

  function swipeActionForDelta(delta: number) {
    const abs = Math.abs(delta);
    if (abs < 56) return null;
    if (delta < 0) return abs > 128 ? swipeSettings.leftLong : swipeSettings.leftShort;
    return abs > 128 ? swipeSettings.rightLong : swipeSettings.rightShort;
  }

  function swipeLabel(actionId: SwipeActionId | null) {
    if (!actionId || actionId === 'none') return 'Release';
    return quickActionMeta(actionId)?.label || 'Release';
  }

  function startSwipe(event: PointerEvent, messageId: number) {
    if (event.pointerType === 'mouse') return;
    swiping = {
      id: messageId,
      startX: event.clientX,
      deltaX: 0,
      pointerId: event.pointerId,
      dragging: false
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function updateSwipe(event: PointerEvent) {
    if (!swiping || swiping.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swiping.startX;
    swiping = { ...swiping, deltaX: clampSwipe(deltaX), dragging: Math.abs(deltaX) > 8 };
  }

  async function finishSwipe(event: PointerEvent, messageId: number) {
    if (!swiping || swiping.pointerId !== event.pointerId) {
      await selectMessage(messageId);
      return;
    }
    const { deltaX, dragging } = swiping;
    swiping = null;
    if (!dragging || Math.abs(deltaX) < 56) {
      await selectMessage(messageId);
      return;
    }
    const action = swipeActionForDelta(deltaX);
    if (!action || action === 'none') return;
    if (action === 'archive') await archiveMessage(messageId);
    if (action === 'delete') await deleteMessage(messageId);
    if (action === 'spam') await markMessageSpam(messageId);
    if (action === 'toggle_read') await toggleMessageRead(messageId);
    if (action === 'star') await toggleMessageFlagged(messageId);
  }

  function cancelSwipe() {
    swiping = null;
  }

  function folderGroups() {
    const groups = new Map<
      number,
      { accountId: number; accountEmail: string; folders: typeof data.folders }
    >();
    for (const folder of data.folders) {
      if (!groups.has(folder.accountId)) {
        groups.set(folder.accountId, {
          accountId: folder.accountId,
          accountEmail: folder.accountEmail,
          folders: []
        });
      }
      groups.get(folder.accountId)?.folders.push(folder);
    }
    return Array.from(groups.values()).sort((left, right) =>
      left.accountEmail.localeCompare(right.accountEmail)
    );
  }

  const mobileHeaderTitle = $derived(
    view === 'operations'
      ? 'AI Operations'
      : view === 'settings'
        ? isMobileViewport && mobileSettingsDetailOpen
          ? settingsCategories.find((category) => category.key === settingsCategory)?.label ||
            'Settings'
          : 'Settings'
        : data.query?.messageId
          ? data.selected?.message?.subject || 'Dear Robot'
          : 'Dear Robot'
  );
</script>

<svelte:head>
  <title>Dear Robot</title>
</svelte:head>

<main
  class="relative z-10 grid h-screen grid-cols-1 overflow-hidden pt-14 text-foreground md:grid-cols-[60px_minmax(300px,380px)_1fr] md:pt-0"
>
  {#if isLoading}
    <div class="fixed left-0 right-0 top-0 z-50 h-0.5 bg-primary/20" transition:fade>
      <div class="h-full w-1/3 bg-primary animate-pulse"></div>
    </div>
  {/if}

  {#if mobileMenuOpen}
    <button
      class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
      aria-label="Close navigation"
      onclick={() => (mobileMenuOpen = false)}
      transition:fade={{ duration: 150 }}
    ></button>
    <aside
      class="fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-border bg-background md:hidden"
      in:fly={{ x: -24, duration: 200 }}
    >
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div class="flex items-center gap-2">
          <div
            class="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
          >
            <Mail size={14} />
          </div>
          <p class="text-sm font-semibold text-foreground">Dear Robot</p>
        </div>
        <button
          class="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          onclick={() => (mobileMenuOpen = false)}
        >
          <X size={16} />
        </button>
      </div>
      <div class="space-y-1 p-3">
        <button
          class={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${isInboxView(view) ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          onclick={() => setQuickView('inbox')}
        >
          <Inbox size={18} />
          <span>Inbox</span>
        </button>
        <button
          class={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${view === 'operations' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          onclick={() => openOperations('autopilot')}
        >
          <Bot size={18} />
          <span>AI Operations</span>
        </button>
        <button
          class={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${view === 'settings' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          onclick={() => openSettings('accounts')}
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
      </div>
      <div class="flex-1"></div>
      <div class="border-t border-border/60 p-3">
        <button
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-all duration-200"
          onclick={() => openCompose('compose')}
        >
          <PenLine size={18} />
          <span>Compose</span>
        </button>
      </div>
    </aside>
  {/if}

  <!-- Mobile Header -->
  <header
    class="fixed left-0 right-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-border/60 bg-background/80 backdrop-cinematic px-3 md:hidden"
  >
    <div class="flex items-center gap-1">
      <button
        class="rounded-lg p-2 text-foreground hover:bg-muted transition-colors"
        aria-label="Open navigation"
        onclick={() => (mobileMenuOpen = true)}
      >
        <Menu size={20} />
      </button>
      {#if view === 'settings' || view === 'operations' || data.query?.messageId}
        <button
          class="rounded-lg p-2 text-foreground hover:bg-muted transition-colors"
          aria-label="Back"
          onclick={mobileBack}
        >
          <ChevronLeft size={20} />
        </button>
      {/if}
    </div>
    <div class="min-w-0 flex-1 text-center">
      <p class="truncate text-sm font-semibold text-foreground">{mobileHeaderTitle}</p>
    </div>
    <button
      class="rounded-lg p-2 text-primary hover:bg-primary/10 transition-colors"
      aria-label="Compose"
      title="Compose"
      onclick={() => openCompose('compose')}
    >
      <PenLine size={20} />
    </button>
  </header>

  <!-- Desktop Icon Rail -->
  <nav
    class="z-10 hidden h-full flex-col items-center gap-1 overflow-y-auto border-r border-border/60 bg-background/80 backdrop-cinematic px-2 pt-4 scrollbar-none md:flex"
  >
    <div
      class="mb-6 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20"
    >
      <Mail size={18} />
    </div>
    <div class="flex flex-col gap-1">
      <button
        class={`rounded-xl p-3 transition-all duration-200 ${isInboxView(view) ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
        title="Inbox"
        onclick={() => setQuickView('inbox')}
      >
        <Inbox size={20} />
      </button>
      <button
        class={`rounded-xl p-3 transition-all duration-200 ${view === 'operations' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
        title="Operations"
        onclick={() => openOperations('autopilot')}
      >
        <Bot size={20} />
      </button>
      <button
        class={`rounded-xl p-3 transition-all duration-200 ${view === 'settings' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
        title="Settings"
        onclick={() => openSettings()}
      >
        <Settings size={20} />
      </button>
    </div>
    <div class="flex-1"></div>
    <button
      class="mb-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-xl hover:shadow-primary/30 hover:scale-105 active:scale-95"
      title="Compose (c)"
      onclick={() => openCompose('compose')}
    >
      <PenLine size={20} />
    </button>
  </nav>

  <section
    class={`h-full overflow-hidden border-r border-border/60 bg-background/80 backdrop-cinematic pb-20 md:pb-0 ${view === 'settings' || view === 'operations' || data.query.messageId ? 'hidden md:flex md:flex-col' : 'flex flex-col'}`}
  >
    <div class="flex-none border-b border-border/60 pt-2">
      {#if onboardingTitle && onboardingBody}
        <div
          class="mb-2 rounded-xl border border-primary/20 bg-primary/[0.04] p-3 mx-2"
          transition:slide={{ duration: 200 }}
        >
          <div class="flex items-start gap-3">
            <div
              class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10"
            >
              <Sparkles size={14} class="text-primary" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-semibold text-sm text-foreground">{onboardingTitle}</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{onboardingBody}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <Button variant="default" size="sm" onclick={() => openSettings()}
                  >Open config</Button
                >
                {#if data.onboarding?.needsEmailSetup}
                  <Button variant="outline" size="sm" onclick={() => openSettings()}
                    >Add mailbox</Button
                  >
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/if}

      {#if isInboxView(view)}
        <InboxSidebar
          {view}
          bind:search
          bind:accountFilter
          accounts={data.accounts}
          folders={data.folders}
          query={data.query}
          bind:foldersExpanded
          bind:showShortcutHelp
          {isInboxView}
          {setQuickView}
          {applySearch}
          {scheduleSearch}
          bind:searchInput
          {selectFolder}
        />
      {/if}

      {#if status}
        <div
          class="m-2 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-2 py-1.5"
          transition:slide={{ duration: 200 }}
        >
          <div class="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"></div>
          <p class="text-[11px] font-medium text-primary">{status}</p>
        </div>
      {/if}
    </div>

    {#if isInboxView(view)}
      <MessageList
        messages={data.messages}
        selectedId={data.selected?.message?.id ?? null}
        {swiping}
        {swipeSettings}
        {view}
        {swipeLabel}
        {swipeActionForDelta}
        {startSwipe}
        {updateSwipe}
        {finishSwipe}
        {cancelSwipe}
        {selectMessage}
        {riskClass}
      />
    {:else if view === 'operations'}
      <ScrollArea class="flex-1 min-h-0">
        <div class="space-y-4 p-3" in:fade={{ duration: 150 }}>
          <div class="flex rounded-lg border border-border/60 bg-muted/30 p-1">
            <button
              class={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${operationsCategory === 'autopilot' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              onclick={() => openOperations('autopilot')}>Autopilot</button
            >
            <button
              class={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${operationsCategory === 'executed' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              onclick={() => openOperations('executed')}>Executed</button
            >
          </div>
          <Card class="p-4" hover>
            <div class="flex items-center gap-2 mb-2">
              <Bot size={16} class="text-primary" />
              <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                AI Operations
              </p>
            </div>
            <h2 class="text-sm font-semibold text-foreground">
              {operationsCategory === 'autopilot' ? 'Autopilot' : 'Executed actions'}
            </h2>
            <p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {operationsCategory === 'autopilot'
                ? `Review pending AI actions. ${data.autopilot?.stats?.proposed || 0} items waiting.`
                : `Review the log. ${data.executed?.length || 0} actions recorded.`}
            </p>
            <div class="mt-4 flex gap-2">
              <Button variant="outline" size="sm" onclick={() => openOperations(operationsCategory)}
                >Refresh</Button
              >
              {#if operationsCategory === 'autopilot'}
                <Button variant="default" size="sm" onclick={runAutopilot}>Run</Button>
              {/if}
            </div>
          </Card>
        </div>
      </ScrollArea>
    {:else if view === 'settings'}
      <ScrollArea class="flex-1 min-h-0">
        <div class="space-y-1 p-3" in:fade={{ duration: 150 }}>
          <h2
            class="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3"
          >
            Settings
          </h2>
          {#each settingsCategories as category (category.key)}
            <button
              class={`w-full rounded-lg px-3 py-2.5 text-left transition-all duration-200 ${settingsCategory === category.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              onclick={() => openSettingsCategory(category.key)}
            >
              <p class="text-sm font-medium">{category.label}</p>
              <p class="mt-0.5 text-xs text-muted-foreground/80">{category.detail}</p>
            </button>
          {/each}
        </div>
      </ScrollArea>
    {/if}
  </section>

  <section
    class={`min-w-0 overflow-y-auto bg-background/60 backdrop-cinematic pb-24 md:pb-0 ${(data.query.messageId && data.selected) || view === 'operations' || view === 'settings' ? 'block' : 'hidden md:block'}`}
  >
    <MessageDetail
      selected={data.selected}
      {view}
      {quickActionIds}
      {quickActionMeta}
      {runQuickAction}
      {moveSelected}
      folders={data.folders}
      bind:bodyMode
      bind:draftText
      bind:regenNote
      bind:taskNote
      dictationTargetId={dictationTarget?.id || null}
      {dictationActive}
      {dictationUnavailable}
      {dictationLevel}
      {toggleDictation}
      {executeSuggestion}
      {saveEdit}
      {rejectSuggestion}
      {regenerate}
      {generateSuggestion}
      {recordMessageOutcome}
      {createTaskPlan}
      {selectMessage}
      {riskClass}
      {approveTask}
      {rejectTask}
      {executeTask}
    />
    {#if view === 'operations'}
      <div class="mx-auto max-w-5xl p-4 md:p-8" in:fade={{ duration: 150 }}>
        <div class="mb-6 flex rounded-lg border border-border/60 bg-muted/30 p-1">
          <button
            class={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 ${operationsCategory === 'autopilot' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onclick={() => openOperations('autopilot')}>Autopilot</button
          >
          <button
            class={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 ${operationsCategory === 'executed' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onclick={() => openOperations('executed')}>Executed</button
          >
        </div>
        {#if operationsCategory === 'autopilot'}
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="text-xs font-medium text-primary">AI Operations</p>
              <h2 class="mt-1 text-2xl font-semibold text-foreground">Autopilot Control Room</h2>
              <p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                The agent scans mail, proposes actions, tracks follow-ups, and keeps a decision log.
                Sends, forwards, and delegation stay approval-gated.
              </p>
            </div>
            <Button variant="default" onclick={runAutopilot}>Run Autopilot</Button>
          </div>

          <section class="mt-6 grid gap-3 md:grid-cols-4">
            {#each [{ value: data.autopilot?.stats?.proposed || 0, label: 'Awaiting review' }, { value: data.autopilot?.stats?.approved || 0, label: 'Approved' }, { value: data.autopilot?.stats?.openFollowUps || 0, label: 'Open follow-ups' }, { value: `${data.autopilot?.stats?.avgLatencyMs || 0}ms`, label: 'AI latency' }] as stat, i (i)}
              <Card class="p-4">
                <p class="text-2xl font-semibold text-foreground">{stat.value}</p>
                <p class="mt-1 text-xs text-muted-foreground">{stat.label}</p>
              </Card>
            {/each}
          </section>

          <section class="mt-6">
            <Card class="p-5">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 class="font-medium text-foreground">Policy</h3>
                  <p class="mt-1 text-sm text-muted-foreground">
                    Keep this boring: simulation first, explicit sends always.
                  </p>
                </div>
                <Button variant="default" size="sm" onclick={saveAutopilotPolicy}
                  >Save Policy</Button
                >
              </div>
              <div class="mt-4 grid gap-3 md:grid-cols-2">
                <label
                  class="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground"
                >
                  <span>Autopilot enabled</span><input
                    type="checkbox"
                    bind:checked={autopilotPolicy.autopilotEnabled}
                  />
                </label>
                <label
                  class="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground"
                >
                  <span>Dry-run only</span><input
                    type="checkbox"
                    bind:checked={autopilotPolicy.dryRunOnly}
                  />
                </label>
                <label
                  class="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground"
                >
                  <span>Auto-file low-risk mail</span><input
                    type="checkbox"
                    bind:checked={autopilotPolicy.allowAutoFileLowRisk}
                  />
                </label>
                <label
                  class="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground"
                >
                  <span>Auto-handle low-risk no-action</span><input
                    type="checkbox"
                    bind:checked={autopilotPolicy.allowAutoNoActionLowRisk}
                  />
                </label>
                <label
                  class="rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground"
                >
                  <span>Messages per run</span><input
                    class="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus:ring-1 focus:ring-ring"
                    type="number"
                    min="1"
                    max="200"
                    bind:value={autopilotPolicy.maxMessagesPerRun}
                  />
                </label>
                <label
                  class="rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground"
                >
                  <span>Max auto actions per run</span><input
                    class="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus:ring-1 focus:ring-ring"
                    type="number"
                    min="0"
                    max="100"
                    bind:value={autopilotPolicy.maxAutoActionsPerRun}
                  />
                </label>
              </div>
            </Card>
          </section>

          <section class="mt-6 grid gap-4 xl:grid-cols-2">
            <Card class="p-5">
              <h3 class="font-medium text-foreground">Recent Runs</h3>
              <div class="mt-4 space-y-2">
                {#each data.autopilot?.runs || [] as run (run.id)}
                  <div class="rounded-md border border-border bg-background/50 p-3">
                    <p class="text-sm text-foreground">{run.status} · {run.mode}</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                      Scanned {run.scannedCount}, queued {run.queuedCount}, executed {run.executedCount}
                    </p>
                    {#if run.errorMessage}<p class="mt-1 text-xs text-destructive">
                        {run.errorMessage}
                      </p>{/if}
                  </div>
                {:else}
                  <p class="text-sm text-muted-foreground">No runs yet.</p>
                {/each}
              </div>
            </Card>
            <Card class="p-5">
              <h3 class="font-medium text-foreground">Thread Intelligence</h3>
              <div class="mt-4 space-y-2">
                {#each data.autopilot?.summaries || [] as summary (summary.id)}
                  <Card class="p-3">
                    <p class="truncate text-sm font-medium text-foreground">{summary.subject}</p>
                    <p class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {summary.summary}
                    </p>
                    <p class="mt-2 text-xs text-primary">{summary.nextAction}</p>
                  </Card>
                {:else}
                  <p class="text-sm text-muted-foreground">
                    Run autopilot to build thread summaries.
                  </p>
                {/each}
              </div>
            </Card>
          </section>

          <section class="mt-6">
            <Card class="p-5">
              <h3 class="font-medium text-foreground">AI Observability</h3>
              <div class="mt-4 overflow-x-auto">
                <table class="w-full text-left text-xs">
                  <thead class="text-muted-foreground">
                    <tr
                      ><th class="py-2">Operation</th><th>Model</th><th>Status</th><th>Latency</th
                      ><th>Prompt</th></tr
                    >
                  </thead>
                  <tbody>
                    {#each data.autopilot?.observability || [] as item (item.id)}
                      <tr class="border-t border-border"
                        ><td class="py-2 text-foreground">{item.operation}</td><td
                          class="text-foreground">{item.provider}/{item.model}</td
                        ><td class="text-foreground">{item.status}</td><td class="text-foreground"
                          >{item.latencyMs}ms</td
                        ><td class="text-muted-foreground">{item.promptHash}</td></tr
                      >
                    {/each}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        {:else if operationsCategory === 'executed'}
          <h2 class="text-2xl font-semibold text-foreground">Executed Actions</h2>
          <div class="mt-6 space-y-3">
            {#each data.executed as action (action.id)}
              <Card class="p-4">
                <p class="font-medium text-foreground">{action.actionType}</p>
                <p class="text-sm text-muted-foreground">
                  {action.status} · {new Date(action.createdAt).toLocaleString()}
                </p>
                <pre
                  class="mt-3 overflow-auto rounded-md bg-background p-3 text-xs text-muted-foreground">{action.detailsJson}</pre>
              </Card>
            {:else}
              <p class="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
                No executed actions yet.
              </p>
            {/each}
          </div>
        {/if}
      </div>
    {:else if view === 'settings'}
      <div class="mx-auto max-w-5xl p-4 md:p-8" in:fade={{ duration: 150 }}>
        {#if isMobileViewport && !mobileSettingsDetailOpen}
          <h2 class="text-2xl font-semibold text-foreground">Settings</h2>
          <p class="mt-2 text-muted-foreground">Choose what you want to configure.</p>
          <SettingsCategoryList
            categories={settingsCategories as unknown as Array<{
              key: string;
              label: string;
              detail: string;
            }>}
            selected={settingsCategory}
            onSelect={(category) => openSettingsCategory(category as SettingsCategory)}
          />
        {:else}
          <h2 class="text-2xl font-semibold text-foreground">Configuration</h2>
          {#if settingsCategory === 'accounts'}
            <SettingsAccounts
              {data}
              bind:accountForm
              bind:googleOauthSettings
              {googleOauthHasSecret}
              {googleOauthConnectedEmail}
              dictationTargetId={dictationTarget?.id || null}
              {dictationActive}
              {dictationUnavailable}
              {dictationLevel}
              {folderRoleOptions}
              {saveFolderRole}
              {toggleDictation}
              {accountAction}
              {addAccount}
              {testNewAccount}
              {discoverAccountSettings}
              {saveGoogleOauthSettings}
              {startGoogleConnect}
              {accountAddState}
              {accountAddError}
              {accountTestState}
              {accountTestError}
              {accountDiscoverState}
              {accountDiscoverError}
              />
          {/if}
          {#if settingsCategory === 'memory'}
            <SettingsMemory
              {data}
              bind:memoryAssistantPrompt
              bind:coreProfileText
              bind:memoryAdvancedMode
              bind:memoryText
              bind:skillsText
              dictationTargetId={dictationTarget?.id || null}
              {dictationActive}
              {dictationUnavailable}
              {dictationLevel}
              {toggleDictation}
              {applyMemoryAssistant}
              {saveCoreProfile}
              {saveSkills}
              {resetSkills}
              {setAdvancedMemoryMode}
              {saveMemory}
              {resetMemory}
              {removeMemoryRule}
            />
          {/if}
          {#if settingsCategory === 'models'}
            <SettingsModels
              {data}
              {coreAiProfileKeys}
              bind:aiProfileForms
              bind:profileMode
              bind:profileEnvValues
              {aiProfileRecommendations}
              {modelsDevProviders}
              {loadModelsDevCatalog}
              {selectCatalogProviderForProfile}
              {selectedCatalogModels}
              {selectedCatalogProvider}
              {requiredEnvVars}
              {setProfileMode}
              {testAiProfile}
              {saveAiProfile}
              {modelsDevLoading}
              bind:audioProviderId
              bind:audioModelId
              bind:audioApiKey
              {audioProvider}
              {audioModels}
              {selectAudioProvider}
              {saveAudioDictationProfile}
            />
          {/if}
          {#if settingsCategory === 'tools'}
            <SettingsTools
              {data}
              {copyToClipboard}
              {testAgentTool}
              {toggleAgentTool}
              {removeAgentTool}
              {addAgentTool}
              {saveToolSkills}
              {saveToolConfig}
              {installCliPackage}
              {addWebhook}
              bind:agentToolForm
              bind:cliInstallForm
              bind:webhookTarget
            />
          {/if}
          {#if settingsCategory === 'interface'}
            <SettingsInterface
              {quickActionCatalog}
              {quickActionIds}
              {resetInterfacePreferences}
              {setQuickActionEnabled}
              {moveQuickAction}
              {swipeSettings}
              {swipeActionCatalog}
              {updateSwipeSetting}
              folderGroups={folderGroups()}
              {saveFolderRole}
              {folderRoleOptions}
            />
          {/if}
          {#if settingsCategory === 'advanced'}
            <SettingsAdvanced
              bind:cachePassphrase
              {cacheEncrypted}
              {saveCacheEncryption}
              {backups}
              {createBackupNow}
              {refreshBackups}
              {restoreBackupNow}
              {auditSnapshot}
              {loadAuditSnapshot}
              bind:contactsImportCsv
              {exportContacts}
              {importContacts}
              dictationTargetId={dictationTarget?.id || null}
              {dictationActive}
              {dictationUnavailable}
              {dictationLevel}
              {toggleDictation}
            />
          {/if}
        {/if}
      </div>
    {/if}
  </section>

  {#if data.query?.messageId && data.selected?.message && !['settings', 'operations'].includes(view)}
    <MobileQuickActions
      selectedMessage={data.selected.message}
      visibleActionIds={visibleMobileQuickActions()}
      overflowActionIds={overflowMobileQuickActions()}
      {quickActionButtonClass}
      {quickActionMeta}
      {runQuickAction}
      bind:quickActionOverflowOpen
    />
  {/if}

  {#if composeOpen}
    <ComposeDrawer
      {data}
      bind:compose
      {composeMode}
      bind:composeEditorMode
      bind:composeHtml
      bind:composeAiPrompt
      {isGeneratingCompose}
      dictationTargetId={dictationTarget?.id || null}
      {dictationActive}
      {dictationUnavailable}
      {dictationLevel}
      {toggleDictation}
      {onAttachFiles}
      {removeAttachment}
      {generateComposeBody}
      {saveDraft}
      {sendCompose}
      onClose={() => (composeOpen = false)}
    />
  {/if}
</main>
