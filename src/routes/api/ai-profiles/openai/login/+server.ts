import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  openAiLoginStatus,
  startOpenAiLogin
} from '$lib/server/ai/openai-codex';

const ProfileSchema = z.enum(['primary', 'fallback', 'advanced']);

export async function POST({ request }) {
  try {
    const profile = ProfileSchema.parse((await request.json()).profile);
    return json(await startOpenAiLogin(profile));
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Unable to start OpenAI login');
  }
}

export function GET({ url }) {
  try {
    const profile = ProfileSchema.parse(url.searchParams.get('profile'));
    return json(openAiLoginStatus(profile));
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid OpenAI profile');
  }
}
