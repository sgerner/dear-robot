import { json } from '@sveltejs/kit';
import { listAgentNotifications, markAgentNotificationsRead } from '$lib/server/agent/runtime';

export function GET({ url }) {
  return json({
    notifications: listAgentNotifications({
      unreadOnly: url.searchParams.get('unread') === '1',
      limit: Number(url.searchParams.get('limit') || 50)
    })
  });
}

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids)
    ? body.ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
    : [];
  return json(markAgentNotificationsRead(ids));
}
