import { json } from '@sveltejs/kit';
import { RegenerateSchema, regenerateSuggestion } from '$lib/server/services/messages';

export async function POST({ params, request }) {
  const input = RegenerateSchema.parse(await request.json());
  return json({ suggestion: await regenerateSuggestion(Number(params.id), input.note) });
}
