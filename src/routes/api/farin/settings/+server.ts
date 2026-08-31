import { error, json } from '@sveltejs/kit';
import { getFarinSettings, saveFarinSettings } from '$lib/server/farin';
import { z } from 'zod';

const FarinSettingsSchema = z.object({
  host: z.string().trim().url().max(2048).optional(),
  companyId: z.string().trim().max(160).nullable().optional(),
  apiKey: z.string().trim().max(500).nullable().optional(),
  automationSecret: z.string().trim().max(500).nullable().optional(),
  enabled: z.boolean().optional()
});

export function GET() {
  return json({ settings: getFarinSettings() });
}

export async function POST({ request }) {
  try {
    const input = FarinSettingsSchema.parse(await request.json());
    return json({ settings: saveFarinSettings(input) });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Farin settings could not be saved');
  }
}
