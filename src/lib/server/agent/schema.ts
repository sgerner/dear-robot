import { z } from 'zod';

export const AgentConditionSchema = z
  .object({
    path: z.string().min(1).max(240),
    operator: z.enum([
      'exists',
      'not_exists',
      'equals',
      'not_equals',
      'contains',
      'truthy',
      'falsy'
    ]),
    value: z.unknown().optional()
  })
  .strict();

export const AgentStepSchema = z
  .object({
    title: z.string().min(1).max(180),
    kind: z.enum([
      'draft_reply',
      'send_reply',
      'move_to_folder',
      'tool_call',
      'browser_recipe',
      'farin_upload',
      'delegate',
      'mark_done',
      'notify'
    ]),
    details: z.string().min(1).max(1500),
    tool_name: z.string().min(1).max(120).nullable().optional(),
    tool_input: z.record(z.string(), z.unknown()).nullable().optional(),
    depends_on: z.array(z.number().int().min(1).max(12)).max(12).default([]),
    condition: AgentConditionSchema.nullable().optional(),
    output_key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,80}$/).nullable().optional(),
    max_attempts: z.number().int().min(1).max(8).default(3),
    retry_delay_ms: z.number().int().min(100).max(120000).default(1000),
    approval_reason: z.string().max(500).nullable().optional(),
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
    max_turns: z.number().int().min(1).max(24).default(8),
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
  inputSchema: z.record(z.string(), z.unknown()).default({}),
  outputSchema: z.record(z.string(), z.unknown()).default({}),
  allowedHosts: z.array(z.string().min(1).max(255)).max(50).default([]),
  maxInputBytes: z.number().int().min(1000).max(2000000).default(200000),
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
  note: z.string().max(1500).nullable().optional(),
  actor: z.string().min(1).max(120).default('user'),
  idempotency_key: z.string().min(1).max(240).nullable().optional(),
  workflow_id: z.coerce.number().int().positive().nullable().optional(),
  trigger_type: z.string().min(1).max(80).default('manual'),
  approval_mode: z.enum(['always', 'risk_based', 'read_only_auto']).default('always')
});

export const TaskApproveSchema = z.object({
  stepId: z.coerce.number().int().positive().nullable().optional()
});

export const TaskEditSchema = z.object({
  title: z.string().min(1).max(180).optional(),
  details: z.string().min(1).max(1500).optional(),
  tool_name: z.string().min(1).max(120).nullable().optional(),
  tool_input: z.record(z.string(), z.unknown()).nullable().optional(),
  depends_on: z.array(z.number().int().min(1).max(12)).max(12).optional(),
  condition: AgentConditionSchema.nullable().optional(),
  output_key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,80}$/).nullable().optional(),
  max_attempts: z.number().int().min(1).max(8).optional(),
  retry_delay_ms: z.number().int().min(100).max(120000).optional()
});

export const TaskRunControlSchema = z.object({
  reason: z.string().max(500).nullable().optional()
});

export type AgentCondition = z.infer<typeof AgentConditionSchema>;
