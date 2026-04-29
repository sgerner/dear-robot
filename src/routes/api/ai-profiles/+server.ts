import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { AI_PRESETS } from '$lib/ai-presets';
import { listAiProfiles, upsertAiProfile, AiProfileSchema } from '$lib/server/ai/settings';

const AiProfileSaveSchema = AiProfileSchema.extend({
  apiKey: z.string().min(1).nullable().optional()
});

export function GET() {
  return json({
    profiles: listAiProfiles(),
    presets: AI_PRESETS
  });
}

export async function POST({ request }) {
  try {
    const input = AiProfileSaveSchema.parse(await request.json());
    return json({ profile: upsertAiProfile(input) });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid AI profile payload');
  }
}
