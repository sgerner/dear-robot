import { error, json } from '@sveltejs/kit';
import {
  deleteAutomationWorkflow,
  getAutomationWorkflow,
  updateAutomationWorkflow
} from '$lib/server/agent/workflows';

export function GET({ params }) {
  const workflow = getAutomationWorkflow(Number(params.id));
  if (!workflow) throw error(404, 'Workflow not found');
  return json({ workflow });
}

export async function PATCH({ params, request }) {
  try {
    const workflow = updateAutomationWorkflow(Number(params.id), await request.json());
    if (!workflow) throw error(404, 'Workflow not found');
    return json({ workflow });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Workflow update failed');
  }
}

export function DELETE({ params }) {
  if (!deleteAutomationWorkflow(Number(params.id))) throw error(404, 'Workflow not found');
  return json({ ok: true });
}
