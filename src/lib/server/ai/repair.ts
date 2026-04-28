import { z } from 'zod';
import { EmailSuggestionSchema, type EmailSuggestion } from './schema';

export class AiValidationError extends Error {
  constructor(
    message: string,
    public readonly raw: string
  ) {
    super(message);
  }
}

export function extractJson(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

export function parseSuggestion(raw: string): EmailSuggestion {
  try {
    const parsed = JSON.parse(extractJson(raw));
    return EmailSuggestionSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AiValidationError(error.issues.map((issue) => issue.message).join('; '), raw);
    }
    throw new AiValidationError(error instanceof Error ? error.message : 'Invalid JSON', raw);
  }
}

export function buildRepairMessages(invalidOutput: string, validationError: string) {
  return [
    {
      role: 'system',
      content:
        'Repair the assistant output into strict JSON only. Do not add markdown. Do not change the intended action unless required by the schema.'
    },
    {
      role: 'user',
      content: `Validation error: ${validationError}

Expected object:
{
  "category": "string",
  "confidence": 0.0,
  "recommended_action": "reply|forward|move_to_folder|delete|spam|delegate|archive|no_action",
  "target_folder": "string|null",
  "draft_reply": "string|null",
  "forward_to": "string|null",
  "delegate_instructions": "string|null",
  "reasoning_summary": "string",
  "risk_level": "low|medium|high"
}

Invalid output:
${invalidOutput}`
    }
  ];
}
