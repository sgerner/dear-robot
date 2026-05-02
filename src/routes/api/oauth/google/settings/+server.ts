import { error, json } from '@sveltejs/kit';
import {
  GoogleOauthSettingsSchema,
  getGoogleOauthSettings,
  upsertGoogleOauthSettings
} from '$lib/server/oauth/google';

export function GET() {
  return json({ settings: getGoogleOauthSettings() });
}

export async function POST({ request }) {
  try {
    const input = GoogleOauthSettingsSchema.parse(await request.json());
    return json({ settings: upsertGoogleOauthSettings(input) });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid Google OAuth settings payload');
  }
}
