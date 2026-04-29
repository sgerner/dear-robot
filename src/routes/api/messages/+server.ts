import { json } from '@sveltejs/kit';
import { BulkMessageActionSchema, MessageQuerySchema, bulkMessageAction, listMessages } from '$lib/server/services/messages';

export function GET({ url }) {
  const query = MessageQuerySchema.parse({
    q: url.searchParams.get('q') || undefined,
    view: url.searchParams.get('view') || undefined,
    accountId: url.searchParams.get('accountId') || undefined,
    folder: url.searchParams.get('folder') || undefined,
    limit: url.searchParams.get('limit') || 50
  });
  return json({ messages: listMessages(query) });
}

export async function POST({ request }) {
  const input = BulkMessageActionSchema.parse(await request.json());
  return json(await bulkMessageAction(input));
}
