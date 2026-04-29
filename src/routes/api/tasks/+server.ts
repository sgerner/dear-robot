import { json } from '@sveltejs/kit';
import { listTaskRuns } from '$lib/server/agent/tasks';

export function GET({ url }) {
  const messageId = url.searchParams.get('messageId');
  return json({ tasks: listTaskRuns(messageId ? Number(messageId) : undefined) });
}
