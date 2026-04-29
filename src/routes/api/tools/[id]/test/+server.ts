import { error, json } from '@sveltejs/kit';
import { testAgentTool } from '$lib/server/agent/tools';

export async function POST({ params }) {
  try {
    return json(await testAgentTool(Number(params.id)));
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Tool test failed');
  }
}
