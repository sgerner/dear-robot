import { json } from '@sveltejs/kit';
import { MessageQuerySchema, listMessages } from '$lib/server/services/messages';

export function GET({ url }) {
  const query = MessageQuerySchema.parse({
    q: url.searchParams.get('q') || undefined,
    view: url.searchParams.get('view') || undefined,
    accountId: url.searchParams.get('accountId') || undefined,
    limit: url.searchParams.get('limit') || 50
  });
  return json({ messages: listMessages(query) });
}
