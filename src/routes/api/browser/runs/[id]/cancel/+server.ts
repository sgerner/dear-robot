import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { cancelBrowserRun, getBrowserRun } from '$lib/server/browser';

export async function POST({ params }) {
  const runId = z.coerce.number().int().positive().safeParse(params.id);
  if (!runId.success) throw error(400, 'Invalid browser run id');
  if (!getBrowserRun(runId.data)) throw error(404, 'Browser run not found');
  const run = await cancelBrowserRun(runId.data);
  return json({ run });
}
