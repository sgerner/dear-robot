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
  const { clearMockActions } = await import('../src/lib/server/email/mock');
  clearMockActions();
  resetForTests();
});

describe('AI agent supercharge services', () => {
  it('extracts obligations conservatively and infers common due dates', async () => {
    const { extractObligationDrafts, inferDueDate } = await import(
      '../src/lib/server/agent/obligations'
    );
    const anchor = '2026-05-19T12:00:00.000Z';
    const drafts = extractObligationDrafts({
      id: 1,
      accountId: 1,
      providerMessageId: 'provider-1',
      threadId: 'thread-1',
      messageIdHeader: null,
      inReplyTo: null,
      references: null,
      folderPath: 'INBOX',
      subject: 'Contract review',
      from: 'Pat <pat@example.com>',
      to: 'user@example.com',
      cc: null,
      bcc: null,
      date: anchor,
      bodyText:
        'Please review the contract by 2026-05-22. I will send the invoice in two days. Thanks for the update.',
      bodyHtml: null,
      isRead: false,
      isAnswered: false,
      isFlagged: false,
      latestSuggestionId: null,
      createdAt: anchor,
      updatedAt: anchor
    });

    expect(drafts.some((draft) => draft.kind === 'review')).toBe(true);
    expect(drafts.some((draft) => draft.kind === 'send')).toBe(true);
    expect(drafts.some((draft) => draft.title.includes('Thanks for the update'))).toBe(false);
    expect(localDate(inferDueDate('Please send this in two days', anchor))).toBe('05/21/2026');
    expect(localDate(inferDueDate('Please respond by the end of the month', anchor))).toBe(
      '05/31/2026'
    );
    expect(localDate(inferDueDate('Please review by 2026-05-22', anchor))).toBe('05/22/2026');
  });

  it('aggregates recent tool calls through task run ownership', async () => {
    const { db, nowIso } = await import('../src/lib/server/db');
    const { taskRuns, toolCalls } = await import('../src/lib/server/db/schema');
    const { listMessages } = await import('../src/lib/server/services/messages');
    const { buildUnifiedAgentContext } = await import('../src/lib/server/agent/context');
    const message = listMessages({ limit: 1 })[0];
    const now = nowIso();
    const run = db
      .insert(taskRuns)
      .values({
        messageId: message.id,
        status: 'completed',
        complexity: 'simple',
        modelUsed: 'mock',
        providerUsed: 'mock',
        summary: 'Test run',
        planJson: '{}',
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .get();
    db.insert(toolCalls)
      .values({
        taskRunId: run.id,
        taskStepId: null,
        toolId: null,
        toolName: 'mailbox_search',
        requestJson: '{"messageId":999999}',
        responseJson: '{}',
        status: 'completed',
        durationMs: 4,
        createdAt: now
      })
      .run();

    const context = buildUnifiedAgentContext(message.id, { includeBody: false });
    expect(context?.recentToolCalls).toEqual([
      expect.objectContaining({ toolName: 'mailbox_search', status: 'completed' })
    ]);
  });

  it('keeps sensitive draft and mark-done actions approval gated by policy', async () => {
    const { assessAgentAction } = await import('../src/lib/server/agent/policy');

    expect(
      assessAgentAction({
        action: 'draft_reply',
        subject: 'Legal contract update',
        bodyText: 'The contract and wire transfer details need review.'
      })
    ).toMatchObject({ riskLevel: 'high', requiresApproval: true });
    expect(
      assessAgentAction({
        action: 'mark_done',
        subject: 'Contract deadline',
        bodyText: 'Please confirm the legal deadline.'
      })
    ).toMatchObject({ riskLevel: 'high', requiresApproval: true });
  });

  it('builds briefing stats without requiring a scan on normal reads', async () => {
    const { buildDailyBriefing } = await import('../src/lib/server/agent/briefing');
    const briefing = buildDailyBriefing();

    expect(briefing.refresh).toBeNull();
    expect(briefing.stats).toEqual(
      expect.objectContaining({
        pendingApprovals: expect.any(Number),
        dueFollowUps: expect.any(Number),
        openObligations: expect.any(Number),
        importantUnread: expect.any(Number)
      })
    );
    expect(Array.isArray(briefing.pendingApprovals)).toBe(true);
    expect(Array.isArray(briefing.importantUnread)).toBe(true);
  });
});

function localDate(value: string | null) {
  expect(value).toBeTruthy();
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value as string));
}
