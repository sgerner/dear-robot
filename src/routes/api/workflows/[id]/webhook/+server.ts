import { error, json } from '@sveltejs/kit';
import { runAutomationWorkflow } from '$lib/server/agent/workflows';

export async function POST({ params, request }) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.messageId) throw error(400, 'messageId is required');
    return json(await runAutomationWorkflow(Number(params.id), Number(body.messageId), 'webhook'));
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Workflow webhook failed');
  }
}
