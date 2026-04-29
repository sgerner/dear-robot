import { error, json } from '@sveltejs/kit';
import { deleteAgentTool, updateAgentTool } from '$lib/server/agent/tools';

export async function POST({ params, request }) {
  try {
    const tool = updateAgentTool(Number(params.id), await request.json());
    if (!tool) throw error(404, 'Tool not found');
    return json({ tool });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Invalid update payload');
  }
}

export function DELETE({ params }) {
  const ok = deleteAgentTool(Number(params.id));
  if (!ok) throw error(404, 'Tool not found');
  return json({ ok: true });
}
