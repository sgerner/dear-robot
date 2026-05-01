import { error, json } from '@sveltejs/kit';
import { QueueBulkSchema, executeQueueItems } from '$lib/server/agent/autopilot';

export async function POST({ request }) {
  try {
    const input = QueueBulkSchema.parse(await request.json());
    return json(await executeQueueItems(input.ids));
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid execution payload');
  }
}
