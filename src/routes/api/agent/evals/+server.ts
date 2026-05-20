import { json } from '@sveltejs/kit';
import { runAgentQualityEvals } from '$lib/server/agent/evals';

export function GET() {
  return json(runAgentQualityEvals());
}
