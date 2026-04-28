import { error, json } from '@sveltejs/kit';
import { getMessageDetail } from '$lib/server/services/messages';

export function GET({ params }) {
  const detail = getMessageDetail(Number(params.id));
  if (!detail) throw error(404, 'Message not found');
  return json(detail);
}
