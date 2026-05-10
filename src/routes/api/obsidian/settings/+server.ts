import { error, json } from '@sveltejs/kit';
import {
  ObsidianSettingsSchema,
  getObsidianSettings,
  upsertObsidianSettings
} from '$lib/server/obsidian';

export function GET() {
  return json({ settings: getObsidianSettings() });
}

export async function POST({ request }) {
  try {
    const input = ObsidianSettingsSchema.parse(await request.json());
    return json({ settings: upsertObsidianSettings(input) });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid Obsidian vault settings');
  }
}
