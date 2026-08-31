import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getBrowserRecipe, runBrowserRecipe } from '$lib/server/browser';

const RunInputSchema = z.object({
  triggerType: z.string().trim().max(40).default('manual'),
  headless: z.boolean().optional()
});

export async function POST({ params, request }) {
  try {
    const recipeId = z.coerce.number().int().positive().parse(params.id);
    if (!getBrowserRecipe(recipeId)) throw error(404, 'Browser recipe not found');
    const body = await request.json().catch(() => ({}));
    const input = RunInputSchema.parse(body);
    return json({ run: await runBrowserRecipe(recipeId, input) }, { status: 202 });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Browser recipe run failed');
  }
}
