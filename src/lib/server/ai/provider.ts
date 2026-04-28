import { env } from '../env';
import { buildSuggestionMessages } from './prompts';
import { buildRepairMessages, parseSuggestion } from './repair';
import type { EmailSuggestion, EmailSuggestionInput, EmailSuggestionResult } from './schema';

type ChatMessage = { role: string; content: string };

type ProviderConfig = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string | undefined;
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
    if (!response.ok) throw new ProviderError(`${config.provider} ${response.status}: ${text.slice(0, 300)}`);
    const parsed = JSON.parse(text);
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new ProviderError(`${config.provider} returned no message content`);
    if (env.DEBUG_AI) console.log('[triage] ai response', { provider: config.provider, content });
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function mockSuggestion(input: EmailSuggestionInput): EmailSuggestion {
  const haystack = `${input.subject}\n${input.sender}\n${input.bodyText}`.toLowerCase();
  const folder = (name: string) => input.availableFolders.find((candidate) => candidate.toLowerCase() === name.toLowerCase()) ?? name;
  if (haystack.includes('password') || haystack.includes('phishing') || haystack.includes('click http')) {
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
  if (haystack.includes('newsletter') || haystack.includes('digest') || haystack.includes('webinar')) {
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
  if (haystack.includes('refund') || haystack.includes('unacceptable') || haystack.includes('angry')) {
    return {
      category: 'Customer Escalation',
      confidence: 0.88,
      recommended_action: 'reply',
      target_folder: null,
      draft_reply: `Hi,\n\nI am sorry this has taken extra follow-up. I am reviewing it now and will send a clear update as soon as possible.\n\nThank you for your patience.`,
      forward_to: null,
      delegate_instructions: null,
      reasoning_summary: 'Angry customer and refund context require empathetic human-reviewed response.',
      risk_level: 'high'
    };
  }
  if (haystack.includes('contract') || haystack.includes('chargeback') || haystack.includes('personal details')) {
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
    category: haystack.includes('wholesale') ? 'Wholesale Inquiry' : haystack.includes('meeting') ? 'Scheduling' : 'General Reply',
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
  const raw = await openAiCompatibleComplete(config, messages);
  try {
    return { suggestion: parseSuggestion(raw), raw, repaired: false };
  } catch (error) {
    const maxRepair = Math.max(0, env.AI_MAX_REPAIR_ATTEMPTS);
    if (maxRepair < 1) throw error;
    const repairMessages = buildRepairMessages(raw, error instanceof Error ? error.message : 'Invalid output');
    const repairedRaw = await openAiCompatibleComplete(config, repairMessages);
    return { suggestion: parseSuggestion(repairedRaw), raw: repairedRaw, repaired: true };
  }
}

export async function generateEmailSuggestion(input: EmailSuggestionInput): Promise<EmailSuggestionResult> {
  if (!env.AI_API_KEY || env.AI_PROVIDER === 'mock') {
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

  const primary = {
    provider: env.AI_PROVIDER || 'deepseek',
    model: env.AI_MODEL || 'deepseek-v4-flash',
    baseUrl: env.AI_BASE_URL,
    apiKey: env.AI_API_KEY
  };
  const fallback = {
    provider: env.AI_FALLBACK_PROVIDER || 'gemini',
    model: env.AI_FALLBACK_MODEL || '',
    baseUrl: env.AI_FALLBACK_BASE_URL,
    apiKey: env.AI_FALLBACK_API_KEY
  };
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
        return errorSuggestion(input, `${describeError(primaryError)}; fallback failed: ${describeError(fallbackError)}`);
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
