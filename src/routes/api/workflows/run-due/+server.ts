import { json } from '@sveltejs/kit';
import { runDueAutomationWorkflows } from '$lib/server/agent/workflows';

export async function POST() {
  return json({ runs: await runDueAutomationWorkflows() });
}
