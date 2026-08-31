import { error, json } from '@sveltejs/kit';
import { runAutomationWorkflow } from '$lib/server/agent/workflows';

export async function POST({ params, request }) {
  try {
    const body = await request.json().catch(() => ({}));
    return json(await runAutomationWorkflow(Number(params.id), body.messageId ?? null, body.actor || 'user'));
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Workflow run failed');
  }
}
