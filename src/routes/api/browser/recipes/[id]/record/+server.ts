import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getBrowserRecipe, startBrowserRecording } from '$lib/server/browser';

const RecordInputSchema = z.object({
  startUrl: z.string().trim().url().max(2048).optional()
});

export async function POST({ params, request }) {
  try {
    const recipeId = z.coerce.number().int().positive().parse(params.id);
    const recipe = getBrowserRecipe(recipeId);
    if (!recipe) throw error(404, 'Browser recipe not found');
    const input = RecordInputSchema.parse(await request.json().catch(() => ({})));
    return json(
      {
        ...(await startBrowserRecording({
          profileId: recipe.profileId,
          recipeId,
          startUrl: input.startUrl || recipe.startUrl
        }))
      },
      { status: 202 }
    );
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Browser recording could not start');
  }
}
