import { MessageQuerySchema, getMessageDetail, listContacts, listDrafts, listFoldersWithCounts, listMessages } from '$lib/server/services/messages';
import { listAccounts } from '$lib/server/services/accounts';
import { readAgentInstructions } from '$lib/server/memory';
import { db } from '$lib/server/db';
import { executedActions } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';
import { getTaskRunDetail, listTaskRuns } from '$lib/server/agent/tasks';
import { listAgentTools } from '$lib/server/agent/tools';
import { listAiProfiles } from '$lib/server/ai/settings';
import { AI_MODEL_RECOMMENDATIONS, AI_PRESETS } from '$lib/ai-presets';

export function load({ url }) {
  const query = MessageQuerySchema.parse({
    q: url.searchParams.get('q') || undefined,
    view: url.searchParams.get('view') || undefined,
    accountId: url.searchParams.get('accountId') || undefined,
    folder: url.searchParams.get('folder') || undefined,
    limit: url.searchParams.get('limit') || 80
  });
  const messages = listMessages(query);
  const messageParam = url.searchParams.get('message');
  const selectedId = messageParam ? Number(messageParam) : (messages[0]?.id || 0);
  const selected = selectedId ? getMessageDetail(selectedId) : null;
  
  return {
    query: {
      ...query,
      messageId: messageParam ? Number(messageParam) : null
    },
    accounts: listAccounts(),
    folders: listFoldersWithCounts(query.accountId),
    contacts: listContacts('', 100),
    drafts: listDrafts(query.accountId),
    messages,
    selected,
    tasks: listTaskRuns(selected?.message?.id)
      .slice(0, 5)
      .map((task) => getTaskRunDetail(task.id))
      .filter((task): task is NonNullable<ReturnType<typeof getTaskRunDetail>> => Boolean(task)),
    tools: listAgentTools(),
    aiProfiles: listAiProfiles(),
    aiPresets: AI_PRESETS,
    aiRecommendations: AI_MODEL_RECOMMENDATIONS,
    memory: readAgentInstructions(),
    executed: db.select().from(executedActions).orderBy(desc(executedActions.createdAt)).limit(30).all()
  };
}
