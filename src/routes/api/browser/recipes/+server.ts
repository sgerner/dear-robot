import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  createBrowserRecipe,
  listBrowserRecipes
} from '$lib/server/browser';

const ActionSchema = z.record(z.string(), z.unknown());
const BrowserRecipeInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  profileId: z.coerce.number().int().positive(),
  startUrl: z.string().trim().url().max(2048),
  actions: z.array(ActionSchema).max(200).default([]),
  enabled: z.boolean().default(true)
});

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

export function GET({ url }) {
  const profileIdRaw = url.searchParams.get('profileId');
  let profileId: number | undefined;
  if (profileIdRaw) {
    const parsed = Number(profileIdRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) throw error(400, 'Invalid browser profile id');
    profileId = parsed;
  }
  return json({ recipes: listBrowserRecipes(profileId) });
}

export async function POST({ request }) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input = BrowserRecipeInputSchema.parse({ ...body, actions: normalizeActions(body) });
    return json({ recipe: createBrowserRecipe(input) }, { status: 201 });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Browser recipe creation failed');
  }
}
