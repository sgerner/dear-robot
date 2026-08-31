import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getBrowserRun, stopBrowserRecording } from '$lib/server/browser';

const StopInputSchema = z.object({
  saveRecipe: z.boolean().default(true),
  name: z.string().trim().min(1).max(120).optional()
});

export async function POST({ params, request }) {
  try {
    const runId = z.coerce.number().int().positive().parse(params.id);
    if (!getBrowserRun(runId)) throw error(404, 'Browser run not found');
    const input = StopInputSchema.parse(await request.json().catch(() => ({})));
    return json({ ...(await stopBrowserRecording(runId, input.saveRecipe)) });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Browser recording could not stop');
  }
}
