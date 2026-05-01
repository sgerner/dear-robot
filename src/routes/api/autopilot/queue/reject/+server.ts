import { error, json } from '@sveltejs/kit';
import { QueueBulkSchema, rejectQueueItems } from '$lib/server/agent/autopilot';

export async function POST({ request }) {
  try {
    const input = QueueBulkSchema.parse(await request.json());
    return json(rejectQueueItems(input.ids));
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid rejection payload');
  }
}
