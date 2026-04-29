import { json } from '@sveltejs/kit';
import { getMessageDetail } from '$lib/server/services/messages';

export function GET({ params }) {
  const detail = getMessageDetail(Number(params.id));
  return json({ attachments: detail?.attachments ?? [] });
}
