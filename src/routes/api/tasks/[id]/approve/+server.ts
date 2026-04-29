import { error, json } from '@sveltejs/kit';
import { approveTaskRun } from '$lib/server/agent/tasks';

export async function POST({ params, request }) {
  try {
    const task = approveTaskRun(Number(params.id), await request.json().catch(() => ({})));
    if (!task) throw error(404, 'Task not found');
    return json(task);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Approve failed');
  }
}
