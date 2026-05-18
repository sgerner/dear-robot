import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$lib/server/env';
import { getAiConfigForRuntime } from '$lib/server/ai/settings';
import { getMessageDetail } from '$lib/server/services/messages';
import { readAgentInstructions } from '$lib/server/memory';
import { readGlobalSkillsMarkdown, truncateMarkdown } from '$lib/server/skills';
import { endpointFor, type ProviderConfig } from '$lib/server/ai/provider';

const GenerateComposeSchema = z.object({
  prompt: z.string().min(1),
  to: z.string().optional().default(''),
  subject: z.string().optional().default(''),
  context: z.object({ messageId: z.number().int().positive() }).nullable().optional()
});

type ChatMessage = { role: 'system' | 'user'; content: string };

async function generateWithOpenAiCompatible(profile: ProviderConfig, messages: ChatMessage[]) {
  if (!profile.apiKey) throw new Error('Primary AI profile has no API key');
  const endpoint = endpointFor(profile);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${profile.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: profile.model,
        messages,
        temperature: 0.6
      })
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`${profile.provider} ${response.status}: ${text.slice(0, 240)}`);
    const parsed = JSON.parse(text);
    return String(parsed?.choices?.[0]?.message?.content || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

function profileForCompose(): ProviderConfig {
  return getAiConfigForRuntime('primary', {
    profile: 'primary',
    label: 'Primary',
    provider: env.AI_PROVIDER || 'deepseek',
    transport: 'openai_compatible',
    model: env.AI_MODEL || 'deepseek-v4-flash',
    baseUrl: env.AI_BASE_URL || 'https://api.deepseek.com',
    proxyEnabled: !!env.AI_PROXY_URL,
    proxyUrl: env.AI_PROXY_URL || null,
    apiKey: env.AI_API_KEY || undefined,
    preset: env.AI_PROVIDER || 'deepseek',
    isEnabled: true,
    notes: null
  }) as ProviderConfig;
}

export async function POST({ request }) {
  const { prompt, to, subject, context } = GenerateComposeSchema.parse(await request.json());
  const profile = profileForCompose();
  if (!profile.isEnabled) throw error(400, 'Primary AI profile is disabled');
  if (profile.transport !== 'openai_compatible')
    throw error(400, 'Compose generation currently supports OpenAI-compatible profiles only');
  let contextText = '';
  if (context?.messageId) {
    const detail = getMessageDetail(context.messageId);
    if (detail?.message) {
      contextText = `\n\nOriginal message context:\nFrom: ${detail.message.from}\nSubject: ${detail.message.subject}\nBody: ${(detail.message.bodyText || '').slice(0, 1200)}`;
    }
  }
  const systemPrompt = `You are an email assistant. Write professional, concise emails based on the user's request.
Generate only the email body text with no markdown.${contextText}`;
  const userPrompt = `AGENT_INSTRUCTIONS.md:
${readAgentInstructions()}

skills.md:
${truncateMarkdown(readGlobalSkillsMarkdown(), 2200)}

Instructions:
${prompt}

Recipient: ${to || 'Unknown'}
Subject: ${subject || 'None specified'}`;
  const body = await generateWithOpenAiCompatible(profile, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]);
  return json({ body, subject: subject || undefined });
}
