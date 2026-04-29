import { error, json } from '@sveltejs/kit';
import { executeTaskRun } from '$lib/server/agent/tasks';

export async function POST({ params }) {
  try {
    return json(await executeTaskRun(Number(params.id)));
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Task execution failed');
  }
}
