import { json } from '@sveltejs/kit';
import { listAttachments } from '$lib/server/services/messages';

export function GET({ params }) {
  return json({ attachments: listAttachments(Number(params.id)) });
}
