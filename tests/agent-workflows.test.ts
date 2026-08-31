import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = ':memory:';
  process.env.APP_PASSWORD = 'test-password';
  process.env.APP_SESSION_SECRET = 'test-session-secret-that-is-long-enough';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
  process.env.AI_PROVIDER = 'mock';
  process.env.AI_API_KEY = '';
  const { resetForTests } = await import('../src/lib/server/db/bootstrap');
  resetForTests();
});

describe('durable agent workflows', () => {
  it('resolves step outputs into later steps and persists a draft', async () => {
    const { listMessages } = await import('../src/lib/server/services/messages');
    const { createTaskRunFromPlan, approveTaskRun, executeTaskRun } = await import(
      '../src/lib/server/agent/tasks'
    );
    const { db } = await import('../src/lib/server/db');
    const { drafts } = await import('../src/lib/server/db/schema');
    const message = listMessages({ limit: 1 })[0];
    const initialDraftCount = db.select().from(drafts).all().length;
    const plan = {
      summary: 'Find related messages and save a reply draft.',
      complexity: 'advanced' as const,
      requires_user_approval: true,
      max_turns: 8,
      final_reply_draft: null,
      steps: [
        {
          title: 'Search mail',
          kind: 'tool_call' as const,
          details: 'Search for related messages.',
          tool_name: 'mailbox_search',
          tool_input: { query: 'test' },
          depends_on: [],
          condition: null,
          output_key: 'lookup',
          max_attempts: 2,
          retry_delay_ms: 100,
          requires_approval: false,
          risk_level: 'low' as const
        },
        {
          title: 'Save draft',
          kind: 'draft_reply' as const,
          details: 'Use the lookup result: {{outputs.lookup}}',
          tool_name: null,
          tool_input: { draft: 'Context: {{outputs.lookup}}' },
          depends_on: [1],
          condition: { path: 'steps.1.output.count', operator: 'exists' as const },
          output_key: 'draft',
          max_attempts: 2,
          retry_delay_ms: 100,
          requires_approval: true,
          risk_level: 'low' as const
        }
      ]
    };
    const task = createTaskRunFromPlan(message.id, plan, { actor: 'test' });
    expect(task?.run.status).toBe('needs_approval');
    approveTaskRun(task!.run.id);
    const completed = await executeTaskRun(task!.run.id);
    expect(completed?.run.status).toBe('completed');
    expect(completed?.steps.every((step) => step.status === 'completed')).toBe(true);
    expect(db.select().from(drafts).all().length).toBe(initialDraftCount + 1);
  });

  it('creates and runs a durable automation rule in dry-run mode', async () => {
    const { createAutomationWorkflow, runAutomationWorkflow } = await import(
      '../src/lib/server/agent/workflows'
    );
    const { listMessages } = await import('../src/lib/server/services/messages');
    const { listTaskRuns } = await import('../src/lib/server/agent/tasks');
    const message = listMessages({ limit: 1 })[0];
    const workflow = createAutomationWorkflow({
      name: 'Triage test',
      description: 'Review this message',
      trigger_type: 'manual',
      enabled: false,
      dry_run: true,
      filters: {},
      plan_template: {}
    });
    const result = await runAutomationWorkflow(workflow!.id, message.id);
    expect(result.created).toBe(1);
    expect(listTaskRuns(message.id)[0].workflowId).toBe(workflow!.id);
  });

  it('persists an agent loop session even with the deterministic provider', async () => {
    const { listMessages } = await import('../src/lib/server/services/messages');
    const { runAgentToolLoop } = await import('../src/lib/server/agent/loop');
    const message = listMessages({ limit: 1 })[0];
    const result = await runAgentToolLoop({ messageId: message.id, prompt: 'Summarize this email.' });
    expect(result.status).toBe('completed');
    expect(result.sessionId).toBeTypeOf('number');
  });
});
