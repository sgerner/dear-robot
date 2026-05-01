import { error, json } from '@sveltejs/kit';
import { recordOutcome } from '$lib/server/agent/autopilot';

export async function POST({ request }) {
  try {
    return json({ outcome: recordOutcome(await request.json()) });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid outcome payload');
  }
}
