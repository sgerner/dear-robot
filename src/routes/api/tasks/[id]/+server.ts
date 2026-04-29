import { error, json } from '@sveltejs/kit';
import { getTaskRunDetail } from '$lib/server/agent/tasks';

export function GET({ params }) {
  const task = getTaskRunDetail(Number(params.id));
  if (!task) throw error(404, 'Task not found');
  return json(task);
}
