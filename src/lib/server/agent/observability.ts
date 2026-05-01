import crypto from 'node:crypto';
import { db, nowIso } from '../db';
import { aiObservability } from '../db/schema';

export function recordAiObservation(input: {
  messageId?: number | null;
  suggestionId?: number | null;
  taskRunId?: number | null;
  operation: string;
  provider: string;
  model: string;
  status: 'ok' | 'error';
  latencyMs: number;
  promptHash: string;
  estimatedCostCents?: number;
  errorMessage?: string | null;
}) {
  return db
    .insert(aiObservability)
    .values({
      messageId: input.messageId ?? null,
      suggestionId: input.suggestionId ?? null,
      taskRunId: input.taskRunId ?? null,
      operation: input.operation,
      provider: input.provider,
      model: input.model,
      status: input.status,
      latencyMs: Math.max(0, Math.round(input.latencyMs)),
      promptHash: input.promptHash,
      estimatedCostCents: input.estimatedCostCents ?? 0,
      errorMessage: input.errorMessage ?? null,
      createdAt: nowIso()
    })
    .returning()
    .get();
}

export function promptHash(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}
