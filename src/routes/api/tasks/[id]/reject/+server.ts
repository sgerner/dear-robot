import { error, json } from '@sveltejs/kit';
import { rejectTaskRun } from '$lib/server/agent/tasks';

export function POST({ params }) {
  const task = rejectTaskRun(Number(params.id));
  if (!task) throw error(404, 'Task not found');
  return json(task);
}
