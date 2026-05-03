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
import { getTaskRunDetail, listTaskRuns } from '$lib/server/agent/tasks';
import { listAgentTools } from '$lib/server/agent/tools';
import { listAiProfiles } from '$lib/server/ai/settings';
import { getMemoryOverview, memoryOnboardingState } from '$lib/server/memory-learning';
import { defaultGlobalSkillsMarkdown, readGlobalSkillsMarkdown } from '$lib/server/skills';
import { getGoogleOauthSettings } from '$lib/server/oauth/google';
import { listAutopilotDashboard } from '$lib/server/agent/autopilot';
import { env } from '$lib/server/env';
import { speechToTextProviders } from '$lib/speech/providers';
import { getAudioDictationSettings } from '$lib/server/ai/settings';

export function load({ url }) {
  const query = MessageQuerySchema.parse({
    q: url.searchParams.get('q') || undefined,
    view: url.searchParams.get('view') || undefined,
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
  const messages = listMessages(effectiveQuery);
  const messageParam = url.searchParams.get('message');
  const selectedId = messageParam ? Number(messageParam) : messages[0]?.id || 0;
  const selected = selectedId ? getMessageDetail(selectedId) : null;
  const memoryOverview = getMemoryOverview();
  const appOrigin = env.NODE_ENV === 'production' ? null : `http://localhost:${env.PORT}`;
  const mcpPath = '/api/mcp/sse';

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
    folders: listFoldersWithCounts(effectiveQuery.accountId),
    contacts: listContacts('', 100),
    drafts: listDrafts(effectiveQuery.accountId),
    messages,
    selected,
    tasks: listTaskRuns(selected?.message?.id)
      .slice(0, 5)
      .map((task) => getTaskRunDetail(task.id))
      .filter((task): task is NonNullable<ReturnType<typeof getTaskRunDetail>> => Boolean(task)),
    tools: listAgentTools(),
    aiProfiles,
    googleOauthSettings: getGoogleOauthSettings(),
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
    memory: readAgentInstructions(),
    skillsMarkdown: readGlobalSkillsMarkdown(),
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
    autopilot: listAutopilotDashboard(),
    memoryOnboarding: memoryOnboardingState(),
    executed: db
      .select()
      .from(executedActions)
      .orderBy(desc(executedActions.createdAt))
      .limit(30)
      .all()
  };
}
