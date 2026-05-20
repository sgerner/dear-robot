import { error, json } from '@sveltejs/kit';
import { buildUnifiedAgentContext } from '$lib/server/agent/context';

export function GET({ params }) {
  const context = buildUnifiedAgentContext(Number(params.id), { includeBody: false });
  if (!context) throw error(404, 'Message not found');
  return json(context);
}
