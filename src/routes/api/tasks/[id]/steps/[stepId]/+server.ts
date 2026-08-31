import { error, json } from '@sveltejs/kit';
import { editTaskStep } from '$lib/server/agent/tasks';

export async function PATCH({ params, request }) {
  try {
    const task = editTaskStep(
      Number(params.id),
      Number(params.stepId),
      await request.json().catch(() => ({}))
    );
    if (!task) throw error(404, 'Task or step not found');
    return json(task);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Step update failed');
  }
}
