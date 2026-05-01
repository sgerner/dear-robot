import { error, json } from '@sveltejs/kit';
import { QueueBulkSchema, approveQueueItems } from '$lib/server/agent/autopilot';

export async function POST({ request }) {
  try {
    const input = QueueBulkSchema.parse(await request.json());
    return json(approveQueueItems(input.ids));
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid approval payload');
  }
}
