import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getAiConfigForRuntime } from '$lib/server/ai/settings';
import { transcribeWithConfiguredProvider } from '$lib/server/audio/providers';

const AudioTranscribeQuerySchema = z.object({
  language: z.string().trim().min(2).max(16).optional()
});

export async function POST({ request, url }) {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) throw error(400, 'Missing audio file');
  if (file.size <= 0) throw error(400, 'Audio file is empty');
  if (file.size > 20 * 1024 * 1024) throw error(400, 'Audio file exceeds 20MB');
  const { language } = AudioTranscribeQuerySchema.parse({
    language: url.searchParams.get('language') || undefined
  });
  const profile = getAiConfigForRuntime('audio', {
    profile: 'audio',
    label: 'Dictation (Speech-to-Text)',
    provider: 'deepgram',
    transport: 'openai_compatible',
    model: 'nova-3',
    baseUrl: 'https://api.deepgram.com',
    apiKey: undefined,
    preset: 'deepgram',
    isEnabled: true,
    notes: JSON.stringify({ useStreaming: true })
  });
  if (!profile.isEnabled) throw error(400, 'Audio AI profile is disabled');
  const text = await transcribeWithConfiguredProvider(profile, file, language);
  return json({ text });
}
