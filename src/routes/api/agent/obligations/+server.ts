import { error, json } from '@sveltejs/kit';
import {
  listOpenObligations,
  scanRecentMessagesForObligations,
  updateObligationStatus
} from '$lib/server/agent/obligations';
import { z } from 'zod';

const UpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  status: z.enum(['open', 'done', 'dismissed'])
});

export function GET() {
  return json({ obligations: listOpenObligations() });
}

export async function POST({ request }) {
  const payload = await request.json().catch(() => ({}));
  if (payload.action === 'scan') return json(scanRecentMessagesForObligations(payload.limit));
  const parsed = UpdateSchema.safeParse(payload);
  if (!parsed.success) throw error(400, 'Invalid obligation update');
  return json({ obligation: updateObligationStatus(parsed.data.id, parsed.data.status) });
}
