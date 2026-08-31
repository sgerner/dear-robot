import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getBrowserRun } from '$lib/server/browser';

export function GET({ params }) {
  const runId = z.coerce.number().int().positive().safeParse(params.id);
  if (!runId.success) throw error(400, 'Invalid browser run id');
  const run = getBrowserRun(runId.data);
  if (!run) throw error(404, 'Browser run not found');
  return json({ run });
}
