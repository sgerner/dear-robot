import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  deleteBrowserRecipe,
  getBrowserRecipe,
  updateBrowserRecipe
} from '$lib/server/browser';

const IdSchema = z.coerce.number().int().positive();
const ActionSchema = z.record(z.string(), z.unknown());
const BrowserRecipeUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    profileId: z.coerce.number().int().positive().optional(),
    startUrl: z.string().trim().url().max(2048).optional(),
    actions: z.array(ActionSchema).max(200).optional(),
    enabled: z.boolean().optional()
  })
  .strict();

function recipeId(raw: string) {
  const parsed = IdSchema.safeParse(raw);
  if (!parsed.success) throw error(400, 'Invalid browser recipe id');
  return parsed.data;
}

function normalizeActions(body: Record<string, unknown>) {
  if (Array.isArray(body.actions)) return body.actions;
  if (typeof body.actionsJson === 'string' && body.actionsJson.trim()) {
    try {
      const parsed = JSON.parse(body.actionsJson);
      return Array.isArray(parsed) ? parsed : body.actions;
    } catch {
      throw new Error('Recipe actions must be valid JSON');
    }
  }
  return body.actions;
}

export function GET({ params }) {
  const recipe = getBrowserRecipe(recipeId(params.id));
  if (!recipe) throw error(404, 'Browser recipe not found');
  return json({ recipe });
}

export async function PATCH({ params, request }) {
  try {
    const id = recipeId(params.id);
    const body = (await request.json()) as Record<string, unknown>;
    const input = BrowserRecipeUpdateSchema.parse({ ...body, actions: normalizeActions(body) });
    const recipe = updateBrowserRecipe(id, input);
    if (!recipe) throw error(404, 'Browser recipe not found');
    return json({ recipe });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Browser recipe update failed');
  }
}

export async function DELETE({ params }) {
  const deleted = await deleteBrowserRecipe(recipeId(params.id));
  if (!deleted) throw error(404, 'Browser recipe not found');
  return json({ ok: true });
}
