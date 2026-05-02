import { error, json } from '@sveltejs/kit';
import { createTaskPlanForMessage } from '$lib/server/agent/tasks';

export async function POST({ params, request }) {
  try {
    return json(
      await createTaskPlanForMessage(Number(params.id), await request.json().catch(() => ({})))
    );
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Task planning failed');
  }
}
