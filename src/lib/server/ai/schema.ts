import { z } from 'zod';

export const RecommendedActionSchema = z.enum([
  'reply',
  'forward',
  'move_to_folder',
  'delete',
  'spam',
  'delegate',
  'archive',
  'no_action'
]);

export const EmailSuggestionSchema = z
  .object({
    category: z.string().min(1).max(120),
    confidence: z.number().min(0).max(1),
    recommended_action: RecommendedActionSchema,
    target_folder: z.string().min(1).max(180).nullable(),
    draft_reply: z.string().min(1).max(6000).nullable(),
    forward_to: z.string().min(3).max(320).nullable(),
    delegate_instructions: z.string().min(1).max(2000).nullable(),
    reasoning_summary: z.string().min(1).max(1000),
    risk_level: z.enum(['low', 'medium', 'high'])
  })
  .strict();

export const EmailSuggestionInputSchema = z.object({
  agentInstructions: z.string(),
  subject: z.string(),
  sender: z.string(),
  recipients: z.string(),
  cc: z.string().nullable().optional(),
  date: z.string(),
  bodyText: z.string(),
  availableFolders: z.array(z.string()),
  memoryContext: z.string().optional(),
  existingSuggestion: EmailSuggestionSchema.nullable().optional(),
  regenerationNote: z.string().nullable().optional()
});

export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;
export type EmailSuggestion = z.infer<typeof EmailSuggestionSchema>;
export type EmailSuggestionInput = z.infer<typeof EmailSuggestionInputSchema>;

export type EmailSuggestionResult = {
  suggestion: EmailSuggestion;
  provider: string;
  model: string;
  repaired: boolean;
  fallbackUsed: boolean;
  rawModel: string | null;
  errorMessage: string | null;
};
