import { error } from '@sveltejs/kit';
import { getSpeechProvider } from '$lib/speech/providers';

type AudioRuntimeProfile = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  isEnabled: boolean;
};

export async function transcribeWithConfiguredProvider(
  profile: AudioRuntimeProfile,
  blob: Blob,
  language?: string
) {
  const provider = getSpeechProvider(profile.provider);
  if (!profile.isEnabled) throw error(400, 'Audio profile is disabled');
  if (provider.id !== 'browser_web_speech' && !profile.apiKey) {
    throw error(400, 'Audio provider API key is missing');
  }
  if (provider.id === 'browser_web_speech') {
    throw error(400, 'Browser fallback does not support server transcription');
  }
  if (provider.id === 'openai' || provider.id === 'groq') {
    return openAiStyleTranscribe(profile, blob, language);
  }
  if (provider.id === 'deepgram') {
    return deepgramTranscribe(profile, blob, language);
  }
  throw error(400, `${provider.label} batch transcription is not yet configured. Enable streaming fallback or pick a batch-capable provider.`);
}

async function openAiStyleTranscribe(profile: AudioRuntimeProfile, blob: Blob, language?: string) {
  const base = profile.baseUrl.replace(/\/+$/, '');
  const endpoint = `${base}/audio/transcriptions`;
  const form = new FormData();
  form.set('model', profile.model);
  form.set('file', blob, 'dictation.webm');
  form.set('response_format', 'json');
  if (language) form.set('language', language);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${profile.apiKey || ''}`
    },
    body: form
  });
  if (!res.ok) {
    const text = await res.text();
    throw error(res.status, `Transcription failed: ${text.slice(0, 400)}`);
  }
  const payload = (await res.json()) as { text?: string };
  return payload.text || '';
}

async function deepgramTranscribe(profile: AudioRuntimeProfile, blob: Blob, language?: string) {
  const base = profile.baseUrl.replace(/\/+$/, '');
  const endpoint = new URL(`${base}/v1/listen`);
  endpoint.searchParams.set('model', profile.model || 'nova-3');
  endpoint.searchParams.set('smart_format', 'true');
  endpoint.searchParams.set('punctuate', 'true');
  if (language) endpoint.searchParams.set('language', language);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Token ${profile.apiKey || ''}`,
      'content-type': blob.type || 'audio/webm'
    },
    body: blob
  });
  if (!res.ok) {
    const text = await res.text();
    throw error(res.status, `Transcription failed: ${text.slice(0, 400)}`);
  }
  const payload = (await res.json()) as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
  };
  return payload.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
}

