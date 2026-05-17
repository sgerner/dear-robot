import { z } from 'zod';

export const AgentStepSchema = z
  .object({
    title: z.string().min(1).max(180),
    kind: z.enum(['draft_reply', 'move_to_folder', 'tool_call', 'delegate', 'mark_done']),
    details: z.string().min(1).max(1500),
    tool_name: z.string().min(1).max(120).nullable().optional(),
    tool_input: z.record(z.string(), z.unknown()).nullable().optional(),
    requires_approval: z.boolean().default(true),
    risk_level: z.enum(['low', 'medium', 'high']).default('low')
  })
  .strict();

export const AgentPlanSchema = z
  .object({
    summary: z.string().min(1).max(800),
    complexity: z.enum(['simple', 'advanced']),
    requires_user_approval: z.boolean().default(true),
    final_reply_draft: z.string().max(8000).nullable().optional(),
    steps: z.array(AgentStepSchema).min(1).max(12)
  })
  .strict();

export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export const ToolBaseSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(600).nullable().optional(),
  kind: z.enum(['mcp_http', 'cli']),
  endpoint: z.preprocess((val) => (val === '' ? null : val), z.string().url().nullable().optional()),
  command: z.string().min(1).max(240).nullable().optional(),
  args: z.array(z.string()).default([]),
  authHeaders: z.record(z.string(), z.string()).default({}),
  env: z.record(z.string(), z.string()).default({}),
  skillsMarkdown: z.string().max(20000).nullable().optional(),
  readOnly: z.boolean().default(false),
  requireApprovalForWrite: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  isEnabled: z.boolean().default(true)
});

export const ToolCreateSchema = ToolBaseSchema.superRefine((value, ctx) => {
  if (value.kind === 'mcp_http' && !value.endpoint) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'endpoint is required for mcp_http tools'
    });
  }
  if (value.kind === 'cli' && !value.command) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'command is required for cli tools' });
  }
});

export const ToolUpdateSchema = ToolBaseSchema.partial().extend({
  isEnabled: z.boolean().optional()
});

export const TaskPlanInputSchema = z.object({
  note: z.string().max(1500).nullable().optional()
});

export const TaskApproveSchema = z.object({
  stepId: z.coerce.number().int().positive().nullable().optional()
});
