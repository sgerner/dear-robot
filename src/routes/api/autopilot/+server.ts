import { error, json } from '@sveltejs/kit';
import { listAutopilotDashboard, runAutopilotNow, updateAutopilotPolicy } from '$lib/server/agent/autopilot';

export function GET() {
  return json(listAutopilotDashboard());
}

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  try {
    if (body?.action === 'run') return json({ run: await runAutopilotNow(), dashboard: listAutopilotDashboard() });
    if (body?.action === 'save_policy') return json({ policy: updateAutopilotPolicy(body.policy || {}) });
    throw error(400, 'Unsupported autopilot action');
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Autopilot request failed');
  }
}
