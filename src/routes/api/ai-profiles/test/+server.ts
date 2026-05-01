import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$lib/server/env';
import { getAiConfigForRuntime } from '$lib/server/ai/settings';
import { getSpeechProvider } from '$lib/speech/providers';

const TestSchema = z.object({
  profile: z.enum(['primary', 'fallback', 'advanced', 'audio'])
});

type RuntimeProfile = ReturnType<typeof getAiConfigForRuntime>;

function profileConfig(profile: z.infer<typeof TestSchema>['profile']): RuntimeProfile {
  if (profile === 'primary') {
    return getAiConfigForRuntime('primary', {
      profile: 'primary',
      label: 'Primary',
      provider: env.AI_PROVIDER || 'deepseek',
      transport: 'openai_compatible',
      model: env.AI_MODEL || 'deepseek-v4-flash',
      baseUrl: env.AI_BASE_URL || 'https://api.deepseek.com',
      apiKey: env.AI_API_KEY || undefined,
      preset: env.AI_PROVIDER || 'deepseek',
      isEnabled: true,
      notes: null
    });
  }
  if (profile === 'fallback') {
    return getAiConfigForRuntime('fallback', {
      profile: 'fallback',
      label: 'Fallback',
      provider: env.AI_FALLBACK_PROVIDER || 'gemini',
      transport: 'openai_compatible',
      model: env.AI_FALLBACK_MODEL || 'gemini-2.5-flash',
      baseUrl: env.AI_FALLBACK_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: env.AI_FALLBACK_API_KEY || undefined,
      preset: env.AI_FALLBACK_PROVIDER || 'gemini',
      isEnabled: true,
      notes: null
    });
  }
  if (profile === 'advanced') {
    return getAiConfigForRuntime('advanced', {
      profile: 'advanced',
      label: 'Advanced Planner',
      provider: env.AI_ADVANCED_PROVIDER || env.AI_PROVIDER || 'deepseek',
      transport: 'openai_compatible',
      model: env.AI_ADVANCED_MODEL || 'deepseek-v4-pro',
      baseUrl: env.AI_ADVANCED_BASE_URL || env.AI_BASE_URL || 'https://api.deepseek.com',
      apiKey: env.AI_ADVANCED_API_KEY || env.AI_API_KEY || undefined,
      preset: env.AI_ADVANCED_PROVIDER || 'deepseek',
      isEnabled: true,
      notes: null
    });
  }
  return getAiConfigForRuntime('audio', {
    profile: 'audio',
    label: 'Dictation (Speech-to-Text)',
    provider: 'deepgram',
    transport: 'openai_compatible',
    model: 'nova-3',
    baseUrl: 'https://api.deepgram.com',
    apiKey: undefined,
    preset: 'deepgram',
    isEnabled: true,
    notes: null
  });
}

async function testOpenAiCompatible(profile: RuntimeProfile) {
  const base = profile.baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}/models`, {
    headers: {
      Authorization: `Bearer ${profile.apiKey || ''}`
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
}

async function testAnthropic(profile: RuntimeProfile) {
  const base = profile.baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}/models`, {
    headers: {
      'x-api-key': profile.apiKey || '',
      'anthropic-version': '2023-06-01'
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
}

export async function POST({ request }) {
  const { profile } = TestSchema.parse(await request.json());
  const config = profileConfig(profile);
  if (!config.isEnabled) throw error(400, 'Profile is disabled');
  if (profile === 'audio' && config.provider === 'browser_web_speech') {
    return json({ ok: true, message: 'Browser fallback requires no API key.' });
  }
  if (!config.apiKey) throw error(400, 'Profile has no API key');
  try {
    if (profile === 'audio' && config.provider === 'deepgram') {
      const res = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${config.apiKey || ''}` }
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 220)}`);
      }
      return json({ ok: true, message: 'Dictation provider connection succeeded.' });
    }
    if (profile === 'audio') {
      const provider = getSpeechProvider(config.provider);
      return json({ ok: true, message: `${provider.label} saved. Batch/streaming support depends on provider capabilities.` });
    }
    if (config.transport === 'anthropic') await testAnthropic(config);
    else await testOpenAiCompatible(config);
    return json({ ok: true, message: `${config.label} connection succeeded.` });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Profile test failed');
  }
}
