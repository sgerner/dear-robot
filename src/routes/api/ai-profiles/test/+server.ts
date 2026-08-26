import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$lib/server/env';
import { getAiConfigForRuntime } from '$lib/server/ai/settings';
import { fetchWithTimeout } from '$lib/server/fetch';
import { getSpeechProvider } from '$lib/speech/providers';
import {
  baseEndpointFor,
  defaultApiKeyForProvider,
  defaultBaseUrlForProvider,
  defaultModelForProvider
} from '$lib/server/ai/provider';

const TestSchema = z.object({
  profile: z.enum(['primary', 'fallback', 'advanced', 'audio']),
  config: z
    .object({
      provider: z.string().optional(),
      transport: z.enum(['openai_compatible', 'anthropic']).optional(),
      model: z.string().optional(),
      baseUrl: z.string().optional(),
      proxyEnabled: z.boolean().optional(),
      proxyUrl: z.string().nullable().optional(),
      apiKey: z.string().or(z.record(z.string(), z.string())).optional()
    })
    .optional()
});

type RuntimeProfile = ReturnType<typeof getAiConfigForRuntime>;

function profileConfig(
  profile: z.infer<typeof TestSchema>['profile'],
  overrides?: z.infer<typeof TestSchema>['config']
): RuntimeProfile {
  let base: RuntimeProfile;
  if (profile === 'primary') {
    const provider = env.AI_PROVIDER || 'deepseek';
    base = {
      profile: 'primary',
      label: 'Primary',
      provider,
      transport: 'openai_compatible',
      model: env.AI_MODEL || defaultModelForProvider(provider, 'deepseek-v4-flash'),
      baseUrl: env.AI_BASE_URL || defaultBaseUrlForProvider(provider, 'https://api.deepseek.com'),
      proxyEnabled: !!env.AI_PROXY_URL,
      proxyUrl: env.AI_PROXY_URL || null,
      apiKey: defaultApiKeyForProvider(provider, env.AI_API_KEY),
      preset: provider,
      isEnabled: true,
      notes: null
    };
  } else if (profile === 'fallback') {
    const provider = env.AI_FALLBACK_PROVIDER || 'gemini';
    base = {
      profile: 'fallback',
      label: 'Fallback',
      provider,
      transport: 'openai_compatible',
      model: env.AI_FALLBACK_MODEL || defaultModelForProvider(provider, 'gemini-2.5-flash'),
      baseUrl:
        env.AI_FALLBACK_BASE_URL ||
        defaultBaseUrlForProvider(
          provider,
          'https://generativelanguage.googleapis.com/v1beta/openai/'
        ),
      proxyEnabled: !!env.AI_FALLBACK_PROXY_URL,
      proxyUrl: env.AI_FALLBACK_PROXY_URL || null,
      apiKey: defaultApiKeyForProvider(provider, env.AI_FALLBACK_API_KEY),
      preset: provider,
      isEnabled: true,
      notes: null
    };
  } else if (profile === 'advanced') {
    const provider = env.AI_ADVANCED_PROVIDER || env.AI_PROVIDER || 'deepseek';
    base = {
      profile: 'advanced',
      label: 'Advanced Planner',
      provider,
      transport: 'openai_compatible',
      model: env.AI_ADVANCED_MODEL || defaultModelForProvider(provider, 'deepseek-v4-pro'),
      baseUrl:
        env.AI_ADVANCED_BASE_URL ||
        env.AI_BASE_URL ||
        defaultBaseUrlForProvider(provider, 'https://api.deepseek.com'),
      proxyEnabled: !!env.AI_ADVANCED_PROXY_URL,
      proxyUrl: env.AI_ADVANCED_PROXY_URL || null,
      apiKey: env.AI_ADVANCED_API_KEY || env.AI_API_KEY || defaultApiKeyForProvider(provider),
      preset: provider,
      isEnabled: true,
      notes: null
    };
  } else {
    base = {
      profile: 'audio',
      label: 'Dictation (Speech-to-Text)',
      provider: 'deepgram',
      transport: 'openai_compatible',
      model: 'nova-3',
      baseUrl: 'https://api.deepgram.com',
      proxyEnabled: false,
      proxyUrl: null,
      apiKey: undefined,
      preset: 'deepgram',
      isEnabled: true,
      notes: null
    };
  }

  const config = getAiConfigForRuntime(profile, base);

  if (overrides) {
    if (overrides.provider) config.provider = overrides.provider;
    if (overrides.transport) config.transport = overrides.transport;
    if (overrides.model) config.model = overrides.model;
    if (overrides.baseUrl) config.baseUrl = overrides.baseUrl;
    if (overrides.proxyEnabled !== undefined) config.proxyEnabled = overrides.proxyEnabled;
    if (overrides.proxyUrl !== undefined) config.proxyUrl = overrides.proxyUrl;
    if (overrides.apiKey) {
      if (typeof overrides.apiKey === 'string') {
        config.apiKey = overrides.apiKey;
      } else {
        const record = overrides.apiKey as Record<string, string>;
        config.envValues = { ...(config.envValues || {}), ...record };
        config.apiKey = record.apiKey || record.API_KEY || Object.values(record)[0] || config.apiKey;
      }
    }
  }

  return config;
}

async function testOpenAiCompatible(profile: RuntimeProfile) {
  const base = baseEndpointFor(profile);
  const response = await fetchWithTimeout(`${base}/models`, {
    headers: {
      Authorization: `Bearer ${profile.apiKey || ''}`
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
}

async function testAnthropic(profile: RuntimeProfile) {
  const base = baseEndpointFor(profile);
  const response = await fetchWithTimeout(`${base}/models`, {
    headers: {
      'x-api-key': profile.apiKey || '',
      'anthropic-version': '2023-06-01'
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
}

export async function POST({ request }) {
  const payload = await request.json();
  const { profile, config: overrides } = TestSchema.parse(payload);
  const config = profileConfig(profile, overrides);

  if (!config.isEnabled) throw error(400, 'Profile is disabled');
  if (profile === 'audio' && config.provider === 'browser_web_speech') {
    return json({ ok: true, message: 'Browser fallback requires no API key.' });
  }
  if (!config.apiKey) throw error(400, 'Profile has no API key');
  try {
    if (profile === 'audio' && config.provider === 'deepgram') {
      const res = await fetchWithTimeout('https://api.deepgram.com/v1/projects', {
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
      return json({
        ok: true,
        message: `${provider.label} saved. Batch/streaming support depends on provider capabilities.`
      });
    }
    if (config.transport === 'anthropic') await testAnthropic(config);
    else await testOpenAiCompatible(config);
    return json({ ok: true, message: `${config.label} connection succeeded.` });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Profile test failed');
  }
}
