import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { listAiProfiles, upsertAiProfile, AiProfileSchema } from '$lib/server/ai/settings';

const AiProfileSaveSchema = AiProfileSchema.extend({
  apiKey: z.string().min(1).nullable().optional()
});

export function GET() {
  return json({
    profiles: listAiProfiles()
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
