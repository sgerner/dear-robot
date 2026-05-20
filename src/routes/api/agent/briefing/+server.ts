import { json } from '@sveltejs/kit';
import { buildDailyBriefing } from '$lib/server/agent/briefing';

export function GET() {
  return json(buildDailyBriefing());
}

export async function POST() {
  return json(buildDailyBriefing({ refreshObligations: true }));
}
