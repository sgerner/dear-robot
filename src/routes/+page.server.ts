import { MessageQuerySchema, getMessageDetail, listMessages } from '$lib/server/services/messages';
import { listAccounts } from '$lib/server/services/accounts';
import { readAgentInstructions } from '$lib/server/memory';
import { db } from '$lib/server/db';
import { executedActions } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';

export function load({ url }) {
  const query = MessageQuerySchema.parse({
    q: url.searchParams.get('q') || undefined,
    view: url.searchParams.get('view') || undefined,
    accountId: url.searchParams.get('accountId') || undefined,
    limit: url.searchParams.get('limit') || 80
  });
  const messages = listMessages(query);
  const selectedId = Number(url.searchParams.get('message') || messages[0]?.id || 0);
  return {
    query,
    accounts: listAccounts(),
    messages,
    selected: selectedId ? getMessageDetail(selectedId) : null,
    memory: readAgentInstructions(),
    executed: db.select().from(executedActions).orderBy(desc(executedActions.createdAt)).limit(30).all()
  };
}
