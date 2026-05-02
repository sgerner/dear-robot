import { env } from '../env';
import { buildSuggestionMessages } from './prompts';
import { buildRepairMessages, extractJson, parseSuggestion } from './repair';
import type { EmailSuggestion, EmailSuggestionInput, EmailSuggestionResult } from './schema';
import { getAiConfigForRuntime } from './settings';
import { z } from 'zod';

type ChatMessage = { role: string; content: string };

type ProviderConfig = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string | undefined;
  transport: 'openai_compatible' | 'anthropic';
};

class ProviderError extends Error {}

function endpointFor(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  return `${base}/chat/completions`;
}

async function openAiCompatibleComplete(config: ProviderConfig, messages: ChatMessage[]) {
  if (!config.apiKey) throw new ProviderError(`${config.provider} API key is not configured`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    if (env.DEBUG_AI) {
      console.log('[triage] ai request', {
        provider: config.provider,
        model: config.model,
        messages
      });
    }
    const response = await fetch(endpointFor(config.baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    });
    const text = await response.text();
    if (!response.ok)
      throw new ProviderError(`${config.provider} ${response.status}: ${text.slice(0, 300)}`);
    const parsed = JSON.parse(text);
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string')
      throw new ProviderError(`${config.provider} returned no message content`);
    if (env.DEBUG_AI) console.log('[triage] ai response', { provider: config.provider, content });
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function anthropicComplete(config: ProviderConfig, messages: ChatMessage[]) {
  if (!config.apiKey) throw new ProviderError(`${config.provider} API key is not configured`);
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const anthropicMessages = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: message.content }]
    }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    if (env.DEBUG_AI) {
      console.log('[triage] ai request', {
        provider: config.provider,
        model: config.model,
        transport: 'anthropic',
        messages
      });
    }
    const response = await fetch(config.baseUrl.replace(/\/+$/, '') + '/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 4096,
        system,
        messages: anthropicMessages,
        temperature: 0.2
      })
    });
    const text = await response.text();
    if (!response.ok)
      throw new ProviderError(`${config.provider} ${response.status}: ${text.slice(0, 300)}`);
    const parsed = JSON.parse(text);
    const content = Array.isArray(parsed?.content)
      ? parsed.content.map((part: { text?: string }) => part?.text || '').join('')
      : '';
    if (typeof content !== 'string' || !content)
      throw new ProviderError(`${config.provider} returned no message content`);
    if (env.DEBUG_AI) console.log('[triage] ai response', { provider: config.provider, content });
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function completeChat(config: ProviderConfig, messages: ChatMessage[]) {
  return config.transport === 'anthropic'
    ? anthropicComplete(config, messages)
    : openAiCompatibleComplete(config, messages);
}

function configFor(profile: 'primary' | 'fallback' | 'advanced'): ProviderConfig {
  const defaults = {
    primary: {
      profile: 'primary' as const,
      label: 'Primary',
      provider: env.AI_PROVIDER || 'deepseek',
      transport: 'openai_compatible' as const,
      model: env.AI_MODEL || 'deepseek-v4-flash',
      baseUrl: env.AI_BASE_URL || 'https://api.deepseek.com',
      apiKey: env.AI_API_KEY || undefined,
      preset: env.AI_PROVIDER || 'deepseek',
      isEnabled: true,
      notes: null
    },
    fallback: {
      profile: 'fallback' as const,
      label: 'Fallback',
      provider: env.AI_FALLBACK_PROVIDER || 'gemini',
      transport: 'openai_compatible' as const,
      model: env.AI_FALLBACK_MODEL || 'gemini-2.5-flash',
      baseUrl:
        env.AI_FALLBACK_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: env.AI_FALLBACK_API_KEY || undefined,
      preset: env.AI_FALLBACK_PROVIDER || 'gemini',
      isEnabled: true,
      notes: null
    },
    advanced: {
      profile: 'advanced' as const,
      label: 'Advanced Planner',
      provider: env.AI_ADVANCED_PROVIDER || env.AI_PROVIDER || 'deepseek',
      transport: 'openai_compatible' as const,
      model: env.AI_ADVANCED_MODEL || 'deepseek-v4-pro',
      baseUrl: env.AI_ADVANCED_BASE_URL || env.AI_BASE_URL || 'https://api.deepseek.com',
      apiKey: env.AI_ADVANCED_API_KEY || env.AI_API_KEY || undefined,
      preset: env.AI_ADVANCED_PROVIDER || 'deepseek',
      isEnabled: true,
      notes: null
    }
  }[profile];
  return getAiConfigForRuntime(profile, defaults);
}

function mockSuggestion(input: EmailSuggestionInput): EmailSuggestion {
  const haystack = `${input.subject}\n${input.sender}\n${input.bodyText}`.toLowerCase();
  const folder = (name: string) =>
    input.availableFolders.find((candidate) => candidate.toLowerCase() === name.toLowerCase()) ??
    name;
  if (
    haystack.includes('password') ||
    haystack.includes('phishing') ||
    haystack.includes('click http')
  ) {
    return {
      category: 'Suspicious',
      confidence: 0.98,
      recommended_action: 'spam',
      target_folder: folder('Spam Review'),
      draft_reply: null,
      forward_to: null,
      delegate_instructions: null,
      reasoning_summary: 'Suspicious credential or link pattern should be routed for review.',
      risk_level: 'high'
    };
  }
  if (
    haystack.includes('newsletter') ||
    haystack.includes('digest') ||
    haystack.includes('webinar')
  ) {
    return {
      category: 'Newsletter',
      confidence: 0.94,
      recommended_action: 'move_to_folder',
      target_folder: folder('Newsletters'),
      draft_reply: null,
      forward_to: null,
      delegate_instructions: null,
      reasoning_summary: 'Informational bulk email with no response required.',
      risk_level: 'low'
    };
  }
  if (haystack.includes('receipt') || haystack.includes('payment')) {
    return {
      category: 'Receipt',
      confidence: 0.93,
      recommended_action: 'move_to_folder',
      target_folder: folder('Receipts'),
      draft_reply: null,
      forward_to: null,
      delegate_instructions: null,
      reasoning_summary: 'Transactional receipt should be filed.',
      risk_level: haystack.includes('refund') || haystack.includes('chargeback') ? 'high' : 'low'
    };
  }
  if (
    haystack.includes('refund') ||
    haystack.includes('unacceptable') ||
    haystack.includes('angry')
  ) {
    return {
      category: 'Customer Escalation',
      confidence: 0.88,
      recommended_action: 'reply',
      target_folder: null,
      draft_reply: `Hi,\n\nI am sorry this has taken extra follow-up. I am reviewing it now and will send a clear update as soon as possible.\n\nThank you for your patience.`,
      forward_to: null,
      delegate_instructions: null,
      reasoning_summary:
        'Angry customer and refund context require empathetic human-reviewed response.',
      risk_level: 'high'
    };
  }
  if (
    haystack.includes('contract') ||
    haystack.includes('chargeback') ||
    haystack.includes('personal details')
  ) {
    return {
      category: 'Sensitive Legal Financial',
      confidence: 0.9,
      recommended_action: 'reply',
      target_folder: null,
      draft_reply:
        'Hi,\n\nThis involves sensitive legal or financial details, so it needs careful review before we respond or share information. I will review the details and confirm the appropriate next step.',
      forward_to: null,
      delegate_instructions: null,
      reasoning_summary: 'Legal, financial, and personal data context requires high-risk review.',
      risk_level: 'high'
    };
  }
  if (haystack.includes('pricing') || haystack.includes('checklist')) {
    return {
      category: haystack.includes('pricing') ? 'Vendor Pricing' : 'Internal Task',
      confidence: 0.78,
      recommended_action: 'delegate',
      target_folder: null,
      draft_reply: null,
      forward_to: null,
      delegate_instructions: haystack.includes('pricing')
        ? 'Review vendor pricing update and adjust costing assumptions if needed.'
        : 'Assign the requested internal checklist update.',
      reasoning_summary: 'Operational follow-up is suitable for delegation.',
      risk_level: haystack.includes('pricing') ? 'medium' : 'low'
    };
  }
  return {
    category: haystack.includes('wholesale')
      ? 'Wholesale Inquiry'
      : haystack.includes('meeting')
        ? 'Scheduling'
        : 'General Reply',
    confidence: 0.82,
    recommended_action: 'reply',
    target_folder: null,
    draft_reply: input.regenerationNote
      ? `Hi,\n\nThanks for the note. I will adjust the response accordingly and follow up shortly.\n\nThanks.`
      : `Hi,\n\nThanks for reaching out. I will review the details and follow up with the next step shortly.\n\nThanks.`,
    forward_to: null,
    delegate_instructions: null,
    reasoning_summary: 'Message appears to need a concise reviewed reply.',
    risk_level: haystack.includes('wholesale') || haystack.includes('quote') ? 'medium' : 'low'
  };
}

async function completeWithRepair(config: ProviderConfig, messages: ChatMessage[]) {
  const raw = await completeChat(config, messages);
  try {
    return { suggestion: parseSuggestion(raw), raw, repaired: false };
  } catch (error) {
    const maxRepair = Math.max(0, env.AI_MAX_REPAIR_ATTEMPTS);
    if (maxRepair < 1) throw error;
    const repairMessages = buildRepairMessages(
      raw,
      error instanceof Error ? error.message : 'Invalid output'
    );
    const repairedRaw = await completeChat(config, repairMessages);
    return { suggestion: parseSuggestion(repairedRaw), raw: repairedRaw, repaired: true };
  }
}

type StructuredResult<T> = {
  object: T;
  provider: string;
  model: string;
  repaired: boolean;
  fallbackUsed: boolean;
  rawModel: string | null;
  errorMessage: string | null;
};

function parseWithSchema<T>(raw: string, schema: z.ZodType<T>) {
  const parsed = JSON.parse(extractJson(raw));
  return schema.parse(parsed);
}

function buildGenericRepairMessages(raw: string, validationError: string) {
  return [
    {
      role: 'system',
      content: 'Repair this output into strict JSON only. No markdown, no extra text.'
    },
    {
      role: 'user',
      content: `Validation error: ${validationError}\n\nInvalid output:\n${raw}`
    }
  ] satisfies ChatMessage[];
}

async function completeStructuredWithRepair<T>(
  config: ProviderConfig,
  messages: ChatMessage[],
  schema: z.ZodType<T>
) {
  const raw = await completeChat(config, messages);
  try {
    return { object: parseWithSchema(raw, schema), raw, repaired: false };
  } catch (error) {
    const maxRepair = Math.max(0, env.AI_MAX_REPAIR_ATTEMPTS);
    if (maxRepair < 1) throw error;
    const repairMessages = buildGenericRepairMessages(
      raw,
      error instanceof Error ? error.message : 'Invalid output'
    );
    const repairedRaw = await completeChat(config, repairMessages);
    return { object: parseWithSchema(repairedRaw, schema), raw: repairedRaw, repaired: true };
  }
}

export async function generateStructuredObject<T>(options: {
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  profile?: 'primary' | 'advanced';
  allowFallback?: boolean;
  mock?: () => T;
}): Promise<StructuredResult<T>> {
  const profile = options.profile || 'primary';
  const primary = configFor(profile);
  const fallback = configFor('fallback');
  if (primary.provider === 'mock' || !primary.apiKey) {
    if (!options.mock) throw new ProviderError(`${primary.provider} API key is not configured`);
    const object = options.mock();
    return {
      object,
      provider: 'mock',
      model: profile === 'advanced' ? 'deterministic-advanced' : 'deterministic-fixture',
      repaired: false,
      fallbackUsed: false,
      rawModel: env.DEBUG_AI ? JSON.stringify(object) : null,
      errorMessage: null
    };
  }
  try {
    const result = await completeStructuredWithRepair(primary, options.messages, options.schema);
    return {
      object: result.object,
      provider: primary.provider,
      model: primary.model,
      repaired: result.repaired,
      fallbackUsed: false,
      rawModel: env.DEBUG_AI ? result.raw : null,
      errorMessage: null
    };
  } catch (primaryError) {
    if (options.allowFallback === false) throw primaryError;
    if (fallback.apiKey && fallback.model) {
      const result = await completeStructuredWithRepair(fallback, options.messages, options.schema);
      return {
        object: result.object,
        provider: fallback.provider,
        model: fallback.model,
        repaired: result.repaired,
        fallbackUsed: true,
        rawModel: env.DEBUG_AI ? result.raw : null,
        errorMessage: null
      };
    }
    throw primaryError;
  }
}

export async function generateEmailSuggestion(
  input: EmailSuggestionInput
): Promise<EmailSuggestionResult> {
  const primary = configFor('primary');
  if (primary.provider === 'mock') {
    return {
      suggestion: mockSuggestion(input),
      provider: 'mock',
      model: 'deterministic-fixture',
      repaired: false,
      fallbackUsed: false,
      rawModel: env.DEBUG_AI ? JSON.stringify(mockSuggestion(input)) : null,
      errorMessage: null
    };
  }

  const fallback = configFor('fallback');
  const messages = buildSuggestionMessages(input);
  try {
    const result = await completeWithRepair(primary, messages);
    return {
      suggestion: result.suggestion,
      provider: primary.provider,
      model: primary.model,
      repaired: result.repaired,
      fallbackUsed: false,
      rawModel: env.DEBUG_AI ? result.raw : null,
      errorMessage: null
    };
  } catch (primaryError) {
    if (fallback.apiKey && fallback.model) {
      try {
        const result = await completeWithRepair(fallback, messages);
        return {
          suggestion: result.suggestion,
          provider: fallback.provider,
          model: fallback.model,
          repaired: result.repaired,
          fallbackUsed: true,
          rawModel: env.DEBUG_AI ? result.raw : null,
          errorMessage: null
        };
      } catch (fallbackError) {
        return errorSuggestion(
          input,
          `${describeError(primaryError)}; fallback failed: ${describeError(fallbackError)}`
        );
      }
    }
    return errorSuggestion(input, describeError(primaryError));
  }
}

function errorSuggestion(input: EmailSuggestionInput, message: string): EmailSuggestionResult {
  return {
    suggestion: {
      category: 'AI Error',
      confidence: 0,
      recommended_action: 'no_action',
      target_folder: null,
      draft_reply: null,
      forward_to: null,
      delegate_instructions: null,
      reasoning_summary: `AI suggestion failed: ${message.slice(0, 240)}`,
      risk_level: 'medium'
    },
    provider: 'error',
    model: input.existingSuggestion ? 'regenerate' : 'suggest',
    repaired: false,
    fallbackUsed: false,
    rawModel: null,
    errorMessage: message
  };
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
