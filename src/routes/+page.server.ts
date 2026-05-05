import {
  MessageQuerySchema,
  getMessageDetail,
  listContacts,
  listDrafts,
  listFoldersWithCounts,
  listMessages
} from '$lib/server/services/messages';
import { listAccounts } from '$lib/server/services/accounts';
import { readAgentInstructions } from '$lib/server/memory';
import { db } from '$lib/server/db';
import { executedActions } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';
import { listTaskRunDetailsForMessage } from '$lib/server/agent/tasks';
import { listAgentTools } from '$lib/server/agent/tools';
import { listAiProfiles } from '$lib/server/ai/settings';
import { getMemoryOverview, memoryOnboardingState } from '$lib/server/memory-learning';
import { defaultGlobalSkillsMarkdown, readGlobalSkillsMarkdown } from '$lib/server/skills';
import { getGoogleOauthSettings } from '$lib/server/oauth/google';
import { listAutopilotDashboard } from '$lib/server/agent/autopilot';
import { env } from '$lib/server/env';
import { speechToTextProviders } from '$lib/speech/providers';
import { getAudioDictationSettings } from '$lib/server/ai/settings';

export function load({ url, depends }) {
  const useDepends = typeof depends === 'function' ? depends : () => {};
  const requestedView = url.searchParams.get('view');
  const view =
    requestedView && ['inbox', 'unread', 'starred', 'pending', 'operations', 'settings'].includes(requestedView)
      ? requestedView
      : 'inbox';
  const isSettingsView = view === 'settings';
  const isOperationsView = view === 'operations';
  const isInboxView = !isSettingsView && !isOperationsView;
  useDepends('app:base');
  if (isInboxView) useDepends('app:inbox');
  if (isSettingsView) useDepends('app:settings');
  if (isOperationsView) useDepends('app:operations');

  const query = MessageQuerySchema.parse({
    q: url.searchParams.get('q') || undefined,
    view,
    accountId: url.searchParams.get('accountId') || undefined,
    folder: url.searchParams.get('folder') || undefined,
    limit: url.searchParams.get('limit') || 80
  });
  const inboxScopedView = !query.view || ['inbox', 'unread', 'starred', 'pending'].includes(query.view);
  const effectiveQuery = {
    ...query,
    folder: query.folder || (inboxScopedView ? 'INBOX' : undefined)
  };
  const accounts = listAccounts();
  const aiProfiles = listAiProfiles();
  const hasConfiguredAiProfile = aiProfiles.some(
    (profile) => profile.isEnabled && (profile.hasApiKey || profile.provider === 'mock')
  );
  const hasRealAccount = accounts.some((account) => account.host !== 'mock');
  const demoMailboxPresent = accounts.some(
    (account) => account.host === 'mock' && account.email === 'mock@example.test'
  );
  const messages = isInboxView ? listMessages(effectiveQuery) : [];
  const messageParam = url.searchParams.get('message');
  const selectedId = isInboxView ? (messageParam ? Number(messageParam) : messages[0]?.id || 0) : 0;
  const selected = isInboxView && selectedId ? getMessageDetail(selectedId) : null;
  const memoryOverview = isSettingsView ? getMemoryOverview() : null;
  const appOrigin = env.NODE_ENV === 'production' ? null : `http://localhost:${env.PORT}`;
  const mcpPath = '/api/mcp/sse';
  const tools = isSettingsView ? listAgentTools() : [];
  const googleOauthSettings = isSettingsView
    ? getGoogleOauthSettings()
    : {
        provider: 'google',
        clientId: '',
        redirectUri: '',
        scopes: ['openid', 'email', 'profile', 'https://mail.google.com/'],
        isEnabled: true,
        hasClientSecret: false
      };

  return {
    query: {
      ...effectiveQuery,
      messageId: messageParam ? Number(messageParam) : null,
      settings: url.searchParams.get('settings') || 'accounts',
      ops: url.searchParams.get('ops') || 'autopilot',
      oauth: url.searchParams.get('oauth') || null,
      email: url.searchParams.get('email') || null
    },
    accounts,
    folders: isInboxView || isSettingsView ? listFoldersWithCounts(effectiveQuery.accountId) : [],
    contacts: isInboxView ? listContacts('', 100) : [],
    drafts: isInboxView ? listDrafts(effectiveQuery.accountId) : [],
    messages,
    selected,
    tasks: selected?.message?.id ? listTaskRunDetailsForMessage(selected.message.id, 5) : [],
    tools,
    aiProfiles,
    googleOauthSettings,
    speechProviders: speechToTextProviders,
    audioDictationSettings: getAudioDictationSettings(),
    onboarding: {
      hasConfiguredAiProfile,
      hasRealAccount,
      demoMailboxPresent,
      needsAiSetup: !hasConfiguredAiProfile,
      needsEmailSetup: hasConfiguredAiProfile && !hasRealAccount,
      demoDataWillBePrunedOnRealAccount: demoMailboxPresent && !hasRealAccount
    },
    memory: isSettingsView ? readAgentInstructions() : '',
    skillsMarkdown: isSettingsView ? readGlobalSkillsMarkdown() : '',
    defaultSkillsMarkdown: defaultGlobalSkillsMarkdown,
    memoryOverview,
    mcp: {
      path: mcpPath,
      endpoint: appOrigin ? `${appOrigin}${mcpPath}` : mcpPath,
      authToken: env.MCP_AUTH_TOKEN || '',
      authHeader: env.MCP_AUTH_TOKEN
        ? `Authorization: Bearer ${env.MCP_AUTH_TOKEN}`
        : 'Authorization: Bearer <MCP_AUTH_TOKEN>'
    },
    autopilot: isOperationsView ? listAutopilotDashboard() : null,
    memoryOnboarding: isSettingsView ? memoryOnboardingState() : null,
    executed: isOperationsView
      ? db
          .select()
          .from(executedActions)
          .orderBy(desc(executedActions.createdAt))
          .limit(30)
          .all()
      : []
  };
}
