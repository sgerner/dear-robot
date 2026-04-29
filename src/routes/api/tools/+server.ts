import { error, json } from '@sveltejs/kit';
import { createAgentTool, listAgentTools } from '$lib/server/agent/tools';

export function GET() {
  return json({ tools: listAgentTools() });
}

export async function POST({ request }) {
  try {
    return json({ tool: createAgentTool(await request.json()) });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid tool payload');
  }
}
