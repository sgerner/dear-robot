import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  browserReportWorkflowPlan,
  extractBrowserLinks,
  getBrowserAutomationForMessage,
  getBrowserProfile,
  getBrowserRecipe,
  getBrowserRun,
  finishClientBrowserRecording,
  startEmailBrowserAutomation,
  startEmailBrowserAutomationClient,
  stopBrowserRecording,
  updateBrowserProfile
} from '$lib/server/browser';
import { getMessageDetail } from '$lib/server/services/messages';
import {
  createAutomationWorkflow,
  listAutomationWorkflows
} from '$lib/server/agent/workflows';

const IdSchema = z.coerce.number().int().positive();

const StartSchema = z.object({
  action: z.enum(['start', 'start_client']).default('start'),
  startUrl: z.string().trim().url().max(2048).optional(),
  name: z.string().trim().max(120).optional(),
  username: z.string().trim().max(500).optional(),
  password: z.string().max(4000).optional()
});

const CompleteClientSchema = z.object({
  action: z.literal('complete_client'),
  runId: IdSchema,
  profileId: IdSchema,
  recipeId: IdSchema,
  actions: z.array(z.unknown()).max(100),
  downloadFilename: z.string().trim().max(180).optional(),
  username: z.string().trim().max(500).optional(),
  password: z.string().max(4000).optional(),
  createWorkflow: z.boolean().default(true),
  enableWorkflow: z.boolean().default(false),
  schedule: z.string().trim().regex(/^every\s+(?:[1-9]\d*)\s*(?:s|m|h|d)$/i).default('every 7d'),
  timezone: z.string().trim().max(80).default('UTC')
});

const CompleteSchema = z.object({
  action: z.literal('complete'),
  runId: IdSchema,
  profileId: IdSchema,
  recipeId: IdSchema,
  username: z.string().trim().max(500).optional(),
  password: z.string().max(4000).optional(),
  createWorkflow: z.boolean().default(true),
  enableWorkflow: z.boolean().default(false),
  schedule: z.string().trim().regex(/^every\s+(?:[1-9]\d*)\s*(?:s|m|h|d)$/i).default('every 7d'),
  timezone: z.string().trim().max(80).default('UTC')
});

function messageId(raw: string) {
  const parsed = IdSchema.safeParse(raw);
  if (!parsed.success) throw error(400, 'Invalid message id');
  return parsed.data;
}

function senderFilter(value: string) {
  return value.match(/<([^>]+)>/)?.[1] || value;
}

function subjectFilter(value: string) {
  return value.replace(/^(?:re|fw|fwd):\s*/i, '').trim().slice(0, 180);
}

function createReportWorkflow(input: {
  detail: NonNullable<ReturnType<typeof getMessageDetail>>;
  recipe: { id: number; name: string };
  createWorkflow: boolean;
  enableWorkflow: boolean;
  schedule: string;
  timezone: string;
}) {
  if (!input.createWorkflow) return null;
  const existing = listAutomationWorkflows().find(
    (candidate) => (candidate.filters as Record<string, unknown>)?.browserRecipeId === input.recipe.id
  );
  if (existing) return existing;
  return createAutomationWorkflow({
    name: `Weekly ${input.recipe.name}`,
    description: `Download the report requested by “${input.detail.message.subject}” and queue it for Farin review.`,
    enabled: input.enableWorkflow,
    trigger_type: 'schedule',
    schedule: input.schedule,
    timezone: input.timezone,
    filters: {
      browserRecipeId: input.recipe.id,
      accountId: input.detail.message.accountId,
      senderContains: senderFilter(input.detail.message.from),
      subjectContains: subjectFilter(input.detail.message.subject)
    },
    plan_template: browserReportWorkflowPlan(input.recipe),
    approval_mode: 'always',
    dry_run: true,
    max_runs_per_hour: 4
  });
}

export function GET({ params }) {
  const id = messageId(params.id);
  const detail = getMessageDetail(id);
  if (!detail) throw error(404, 'Message not found');
  return json({
    message: {
      id: detail.message.id,
      subject: detail.message.subject,
      from: detail.message.from
    },
    links: extractBrowserLinks(detail.message.bodyText, detail.message.bodyHtml),
    automation: getBrowserAutomationForMessage(id)
  });
}

export async function POST({ params, request }) {
  const id = messageId(params.id);
  const detail = getMessageDetail(id);
  if (!detail) throw error(404, 'Message not found');
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action || 'start';

  try {
    if (action === 'complete_client') {
      const input = CompleteClientSchema.parse(body);
      const run = getBrowserRun(input.runId);
      const recipe = getBrowserRecipe(input.recipeId);
      if (
        !run ||
        !recipe ||
        recipe.sourceMessageId !== id ||
        run.recipeId !== recipe.id ||
        run.profileId !== input.profileId
      ) {
        throw error(409, 'This browser session is not associated with the selected email.');
      }

      const stopped = finishClientBrowserRecording({
        runId: input.runId,
        actions: input.actions,
        downloadFilename: input.downloadFilename
      });
      let profile = getBrowserProfile(input.profileId);
      if (profile && (input.username?.trim() || input.password)) {
        profile = updateBrowserProfile(input.profileId, {
          ...(input.username?.trim() ? { username: input.username.trim() } : {}),
          ...(input.password ? { password: input.password } : {})
        });
      }
      const workflow = createReportWorkflow({
        detail,
        recipe: stopped.recipe,
        createWorkflow: input.createWorkflow,
        enableWorkflow: input.enableWorkflow,
        schedule: input.schedule,
        timezone: input.timezone
      });
      return json({
        messageId: id,
        run: stopped.run,
        recipe: stopped.recipe,
        profile,
        workflow,
        credentialsSaved: Boolean(input.username?.trim() || input.password)
      });
    }

    if (action === 'complete') {
      const input = CompleteSchema.parse(body);
      const run = getBrowserRun(input.runId);
      const recipe = getBrowserRecipe(input.recipeId);
      if (
        !run ||
        !recipe ||
        recipe.sourceMessageId !== id ||
        run.recipeId !== recipe.id ||
        run.profileId !== input.profileId
      ) {
        throw error(409, 'This browser session is not associated with the selected email.');
      }

      const stopped = await stopBrowserRecording(input.runId, true);
      let profile = getBrowserProfile(input.profileId);
      if (profile && (input.username?.trim() || input.password)) {
        profile = updateBrowserProfile(input.profileId, {
          ...(input.username?.trim() ? { username: input.username.trim() } : {}),
          ...(input.password ? { password: input.password } : {})
        });
      }

      const workflow = createReportWorkflow({
        detail,
        recipe,
        createWorkflow: input.createWorkflow,
        enableWorkflow: input.enableWorkflow,
        schedule: input.schedule,
        timezone: input.timezone
      });

      return json({
        messageId: id,
        run: stopped.run,
        recipe: stopped.recipe,
        profile,
        workflow,
        credentialsSaved: Boolean(input.username?.trim() || input.password)
      });
    }

    const input = StartSchema.parse({ ...body, action: action === 'start_client' ? 'start_client' : 'start' });
    const result = input.action === 'start_client'
      ? startEmailBrowserAutomationClient(id, input)
      : await startEmailBrowserAutomation(id, input);
    return json(await result, { status: 202 });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Email browser automation failed');
  }
}
