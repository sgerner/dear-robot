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

describe('Phase 1 email client services', () => {
  it('lists folders with counts and moves messages', async () => {
    const { listFoldersWithCounts, listMessages, moveMessage } = await import('../src/lib/server/services/messages');
    const inbox = listMessages({ folder: 'INBOX', limit: 10 })[0];
    expect(inbox).toBeTruthy();
    await moveMessage(inbox.id, 'Archive');
    expect(listMessages({ folder: 'Archive', limit: 10 }).some((message) => message.id === inbox.id)).toBe(true);
    expect(listFoldersWithCounts().some((folder) => folder.path === 'Archive' && folder.total > 0)).toBe(true);
  });

  it('updates read and starred state through the provider abstraction', async () => {
    const { listMessages, setMessageFlagged, setMessageRead } = await import('../src/lib/server/services/messages');
    const { recordedMockActions } = await import('../src/lib/server/email/mock');
    const message = listMessages({ limit: 10 })[0];
    await setMessageRead(message.id, true);
    await setMessageFlagged(message.id, true);
    expect(listMessages({ view: 'starred', limit: 10 }).some((row) => row.id === message.id)).toBe(true);
    expect(recordedMockActions().map((action) => action.type)).toContain('mark_read');
    expect(recordedMockActions().map((action) => action.type)).toContain('set_flagged');
  });

  it('saves drafts and sends compose payload with attachments', async () => {
    const { listMessages, sendComposedMessage, upsertDraft, getMessageDetail } = await import('../src/lib/server/services/messages');
    const { recordedMockActions } = await import('../src/lib/server/email/mock');
    const message = listMessages({ limit: 10 })[0];
    const detail = getMessageDetail(message.id);
    expect(detail?.attachments?.length).toBeGreaterThan(0);

    const draft = upsertDraft({
      accountId: message.accountId,
      mode: 'reply_all',
      sourceMessageId: message.id,
      to: 'steven@butteredupbakery.com',
      cc: 'mesa@buttereupbakery.com',
      bcc: null,
      subject: 'Re: testing draft',
      bodyText: 'Draft body',
      bodyHtml: '<p>Draft body</p>',
      attachments: [
        {
          filename: 'phase2.txt',
          contentType: 'text/plain',
          contentBase64: Buffer.from('phase2 attachment', 'utf8').toString('base64')
        }
      ]
    });
    expect(draft.id).toBeTruthy();

    await sendComposedMessage({
      accountId: message.accountId,
      to: 'steven@butteredupbakery.com',
      cc: null,
      bcc: null,
      subject: 'Phase2 send',
      body: 'Hello',
      bodyHtml: '<p>Hello</p>',
      attachments: [
        {
          filename: 'phase2.txt',
          contentType: 'text/plain',
          contentBase64: Buffer.from('phase2 attachment', 'utf8').toString('base64')
        }
      ],
      mode: 'compose',
      draftId: draft.id,
      sourceMessageId: null
    });
    const sendAction = recordedMockActions().find((action) => action.type === 'send') as
      | { attachments?: unknown[] }
      | undefined;
    expect(sendAction).toBeTruthy();
    expect(sendAction?.attachments?.length).toBe(1);
  });

  it('supports bulk message actions', async () => {
    const { listMessages, bulkMessageAction } = await import('../src/lib/server/services/messages');
    const ids = listMessages({ limit: 3 }).map((row) => row.id);
    await bulkMessageAction({ messageIds: ids, action: 'mark_read' });
    await bulkMessageAction({ messageIds: ids, action: 'flag' });
    const refreshed = listMessages({ view: 'starred', limit: 20 });
    expect(refreshed.filter((row) => ids.includes(row.id)).length).toBe(ids.length);
  });

  it('imports and exports contacts as csv', async () => {
    const { importContactsCsv, exportContactsCsv, listMessages } = await import('../src/lib/server/services/messages');
    const accountId = listMessages({ limit: 1 })[0]?.accountId;
    expect(accountId).toBeTruthy();
    const importResult = importContactsCsv({
      accountId,
      csv: 'email,name\nalpha@example.com,Alpha\nbeta@example.com,Beta'
    });
    expect(importResult.imported).toBe(2);
    const csv = exportContactsCsv(accountId);
    expect(csv).toContain('alpha@example.com');
    expect(csv).toContain('beta@example.com');
  });

  it('creates and executes an agent task plan with a configured tool', async () => {
    const { createAgentTool } = await import('../src/lib/server/agent/tools');
    const { createTaskPlanForMessage, approveTaskRun, executeTaskRun } = await import('../src/lib/server/agent/tasks');
    const { listMessages } = await import('../src/lib/server/services/messages');
    const message = listMessages({ limit: 1 })[0];
    createAgentTool({
      name: 'local-json',
      description: 'returns static JSON for testing',
      kind: 'cli',
      command: 'node',
      args: ['-e', 'process.stdout.write(JSON.stringify({ok:true,source:"cli"}))'],
      readOnly: true
    });
    const planned = await createTaskPlanForMessage(message.id, { note: 'Use ERP credit memo workflow' });
    expect(planned?.run.id).toBeTruthy();
    const approved = approveTaskRun(planned?.run.id || 0, {});
    expect(approved?.run.status).toBe('planned');
    const executed = await executeTaskRun(planned?.run.id || 0);
    expect(executed?.run.status).toBe('completed');
  });
});
