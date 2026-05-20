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
    const { listFoldersWithCounts, listMessages, moveMessage } =
      await import('../src/lib/server/services/messages');
    const inbox = listMessages({ folder: 'INBOX', limit: 10 })[0];
    expect(inbox).toBeTruthy();
    await moveMessage(inbox.id, 'Archive');
    expect(
      listMessages({ folder: 'Archive', limit: 10 }).some((message) => message.id === inbox.id)
    ).toBe(true);
    expect(
      listFoldersWithCounts().some((folder) => folder.path === 'Archive' && folder.total > 0)
    ).toBe(true);
  });

  it('updates read and starred state through the provider abstraction', async () => {
    const { listMessages, setMessageFlagged, setMessageRead } =
      await import('../src/lib/server/services/messages');
    const { recordedMockActions } = await import('../src/lib/server/email/mock');
    const message = listMessages({ limit: 10 })[0];
    await setMessageRead(message.id, true);
    await setMessageFlagged(message.id, true);
    expect(listMessages({ view: 'starred', limit: 10 }).some((row) => row.id === message.id)).toBe(
      true
    );
    expect(recordedMockActions().map((action) => action.type)).toContain('mark_read');
    expect(recordedMockActions().map((action) => action.type)).toContain('set_flagged');
  });

  it('threads replies by headers instead of subject text', async () => {
    const { db, nowIso } = await import('../src/lib/server/db');
    const { messages } = await import('../src/lib/server/db/schema');
    const { getMessageDetail, listConversationMessages, listMessages } = await import(
      '../src/lib/server/services/messages'
    );

    const account = listMessages({ limit: 1 })[0];
    expect(account).toBeTruthy();
    const folderPath = account.folderPath || 'INBOX';
    const createdAt = nowIso();
    const rootMessageId = `<thread-root-${Date.now()}@example.test>`;
    const replyMessageId = `<thread-reply-${Date.now()}@example.test>`;
    const unrelatedMessageId = `<thread-independent-${Date.now()}@example.test>`;
    const baseValues = {
      accountId: account.accountId,
      folderPath,
      subject: 'Threading regression subject',
      from: 'Sender <sender@example.test>',
      to: 'Recipient <recipient@example.test>',
      cc: null,
      bcc: null,
      date: createdAt,
      bodyText: 'Test body',
      bodyHtml: null,
      latestSuggestionId: null,
      isRead: false,
      isAnswered: false,
      isFlagged: false,
      createdAt,
      updatedAt: createdAt
    };

    const root = db
      .insert(messages)
      .values({
        ...baseValues,
        providerMessageId: `INBOX:${rootMessageId}`,
        messageIdHeader: rootMessageId,
        inReplyTo: null,
        references: null,
        threadId: null
      })
      .returning()
      .get();
    const reply = db
      .insert(messages)
      .values({
        ...baseValues,
        providerMessageId: `INBOX:${replyMessageId}`,
        subject: `Re: ${baseValues.subject}`,
        messageIdHeader: replyMessageId,
        inReplyTo: rootMessageId,
        references: rootMessageId,
        threadId: null,
        date: new Date(Date.parse(createdAt) + 60_000).toISOString()
      })
      .returning()
      .get();
    const unrelated = db
      .insert(messages)
      .values({
        ...baseValues,
        providerMessageId: `INBOX:${unrelatedMessageId}`,
        subject: `Re: ${baseValues.subject}`,
        messageIdHeader: unrelatedMessageId,
        inReplyTo: null,
        references: null,
        threadId: null,
        date: new Date(Date.parse(createdAt) + 120_000).toISOString()
      })
      .returning()
      .get();

    const detail = getMessageDetail(root.id);
    expect(detail?.thread.map((item) => item.id)).toContain(root.id);
    expect(detail?.thread.map((item) => item.id)).toContain(reply.id);
    expect(detail?.thread.map((item) => item.id)).not.toContain(unrelated.id);

    const grouped = listConversationMessages({ limit: 20 }).filter((row) =>
      row.searchText.includes('Threading regression subject')
    );
    expect(grouped.length).toBe(2);
    expect(grouped.find((row) => row.conversationMessageIds.includes(root.id))?.conversationCount).toBe(2);
    expect(
      grouped.find((row) => row.conversationMessageIds.includes(unrelated.id))?.conversationCount
    ).toBe(1);
  });

  it('saves drafts and sends compose payload with attachments', async () => {
    const { listMessages, sendComposedMessage, upsertDraft, getMessageDetail } =
      await import('../src/lib/server/services/messages');
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
    const { importContactsCsv, exportContactsCsv, listMessages } =
      await import('../src/lib/server/services/messages');
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
    const { createTaskPlanForMessage, approveTaskRun, executeTaskRun } =
      await import('../src/lib/server/agent/tasks');
    const { listMessages } = await import('../src/lib/server/services/messages');
    const message =
      listMessages({ limit: 20 }).find((row) =>
        `${row.subject} ${row.snippet}`.toLowerCase().includes('refund')
      ) || listMessages({ limit: 1 })[0];
    createAgentTool({
      name: 'local-json',
      description: 'returns static JSON for testing',
      kind: 'cli',
      command: 'node',
      args: ['-e', 'process.stdout.write(JSON.stringify({ok:true,source:"cli"}))'],
      readOnly: true
    });
    const planned = await createTaskPlanForMessage(message.id, {
      note: 'Use ERP credit memo workflow'
    });
    expect(planned?.run.id).toBeTruthy();
    expect(
      planned?.steps.some((step) => step.kind === 'tool_call' && step.status === 'approved')
    ).toBe(true);
    const approved = approveTaskRun(planned?.run.id || 0, {});
    expect(approved?.run.status).toBe('planned');
    const executed = await executeTaskRun(planned?.run.id || 0);
    expect(executed?.run.status).toBe('completed');
  });

  it('exposes the obsidian vault tool when enabled and mounted', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tempVault = fs.mkdtempSync(path.join(os.tmpdir(), 'dear-robot-obsidian-'));
    const { upsertObsidianSettings, executeObsidianTool } = await import(
      '../src/lib/server/obsidian'
    );
    const { getAvailableAgentToolByName, listAvailableAgentTools, executeTool } = await import(
      '../src/lib/server/agent/tools'
    );
    upsertObsidianSettings({ isEnabled: true, vaultPath: tempVault });
    expect(listAvailableAgentTools().some((tool) => tool.name === 'obsidian_vault')).toBe(true);
    const tool = getAvailableAgentToolByName('obsidian_vault');
    expect(tool).toBeTruthy();
    await executeObsidianTool({
      action: 'write',
      path: 'notes/context.md',
      content: '# Context\n\nImportant note'
    });
    const read = await executeObsidianTool({
      action: 'read',
      path: 'notes/context.md'
    });
    expect((read as { content?: string }).content).toContain('Important note');
    const viaGateway = await executeTool(
      tool as unknown as {
        name: string;
        kind: 'obsidian';
        endpoint: null;
        command: null;
        args?: string[];
        argsJson?: null;
        timeoutMs: number;
      },
      {
        action: 'append',
        path: 'notes/context.md',
        content: 'Follow-up'
      },
      { dryRun: false }
    );
    expect(viaGateway.ok).toBe(true);
    const appended = fs.readFileSync(path.join(tempVault, 'notes/context.md'), 'utf8');
    expect(appended).toContain('Follow-up');
  });

  it('runs autopilot, queues actions, records observability and outcomes', async () => {
    const {
      approveQueueItems,
      executeQueueItems,
      listAutopilotDashboard,
      recordOutcome,
      runAutopilotNow,
      updateAutopilotPolicy
    } = await import('../src/lib/server/agent/autopilot');
    updateAutopilotPolicy({
      autopilotEnabled: true,
      dryRunOnly: true,
      allowAutoFileLowRisk: false,
      allowAutoNoActionLowRisk: false,
      requireApprovalForSend: true,
      maxMessagesPerRun: 4,
      maxAutoActionsPerRun: 0,
      followUpDays: 2,
      autoApproveReadOnlyToolCalls: false
    });
    const run = await runAutopilotNow();
    expect(run?.scannedCount).toBeGreaterThan(0);
    const dashboard = listAutopilotDashboard();
    expect(dashboard.queue.length).toBeGreaterThan(0);
    expect(dashboard.observability.length).toBeGreaterThan(0);
    expect(dashboard.summaries.length).toBeGreaterThan(0);
    const moveItem = dashboard.queue.find((item) => item.actionType === 'move_to_folder');
    expect(moveItem).toBeTruthy();
    approveQueueItems([moveItem?.id || 0]);
    const executed = await executeQueueItems([moveItem?.id || 0]);
    expect(executed.executed).toBe(1);
    const outcome = recordOutcome({
      messageId: moveItem?.messageId || 0,
      suggestionId: moveItem?.suggestionId || null,
      actionQueueId: moveItem?.id || null,
      outcomeType: 'resolved',
      notes: 'Handled correctly'
    });
    expect(outcome.id).toBeTruthy();
  });

  it('removes seeded demo mail when the first real account is added', async () => {
    const { createAccount, listAccounts } = await import('../src/lib/server/services/accounts');
    expect(listAccounts().some((account) => account.host === 'mock')).toBe(true);
    await createAccount({
      email: 'real@example.com',
      host: 'mock',
      port: 993,
      username: 'real@example.com',
      password: 'secret',
      smtpHost: 'mock',
      smtpPort: 465,
      smtpUsername: 'real@example.com',
      smtpPassword: 'secret'
    });
    expect(listAccounts().some((account) => account.email === 'mock@example.test')).toBe(false);
    expect(listAccounts().some((account) => account.email === 'real@example.com')).toBe(true);
  });

  it('tests account credentials without saving to the database', async () => {
    const { testAccountInput, listAccounts } = await import('../src/lib/server/services/accounts');
    const initialCount = listAccounts().length;
    const result = await testAccountInput({
      email: 'test@example.com',
      host: 'mock',
      port: 993,
      username: 'test@example.com',
      password: 'password',
      smtpHost: 'mock',
      smtpPort: 465,
      smtpUsername: 'test@example.com',
      smtpPassword: 'password'
    });
    expect(result.ok).toBe(true);
    expect(listAccounts().length).toBe(initialCount);
  });

  it('discovers account settings for common domains', async () => {
    const { discoverAccountSettings } = await import('../src/lib/server/email/discovery');
    const gmail = await discoverAccountSettings('test@gmail.com');
    expect(gmail).toBeTruthy();
    expect(gmail?.host).toBe('imap.gmail.com');
    expect(gmail?.smtpHost).toBe('smtp.gmail.com');

    const unknown = await discoverAccountSettings('test@nonexistent-domain-12345.com');
    expect(unknown).toBeTruthy(); // Should return guessed settings
    expect(unknown?.host).toBe('imap.nonexistent-domain-12345.com');
  });

  it('defaults the root inbox view to inbox messages only', async () => {
    const { load } = await import('../src/routes/+page.server');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await load({ url: new URL('http://localhost/') } as any)) as any;
    expect(result.query.folder).toBe('INBOX');
    expect(result.messages.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(result.messages.every((message: any) => message.folderPath === 'INBOX')).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const folderResult = (await load({ url: new URL('http://localhost/?folder=Archive') } as any)) as any;
    expect(folderResult.query.folder).toBe('Archive');
  });

  it('preserves safe inline styles in html email sanitization', async () => {
    const { sanitizeEmailHtml } = await import('../src/lib/server/html');
    const html = sanitizeEmailHtml(
      '<table style="width:100%"><tr><td style="padding:16px;color:#ff5500">Hello<script>alert(1)</script></td></tr></table>'
    );
    expect(html).toContain('style="width:100%"');
    expect(html).toContain('style="padding:16px;color:#ff5500"');
    expect(html).not.toContain('<script>');
  });

  it('ensures moved messages do not reappear in the inbox after a sync', async () => {
    const { listMessages, moveMessage } = await import('../src/lib/server/services/messages');
    const { syncAccount } = await import('../src/lib/server/sync');
    const { listAccounts } = await import('../src/lib/server/services/accounts');

    // 1. Get initial inbox count
    const initialMessages = listMessages({ folder: 'INBOX', limit: 200 });
    const messageToMove = initialMessages[0];
    expect(messageToMove).toBeTruthy();

    // 2. Move message to Archive
    await moveMessage(messageToMove.id, 'Archive');

    // 3. Verify it's gone from Inbox locally
    const afterMoveMessages = listMessages({ folder: 'INBOX', limit: 200 });
    expect(afterMoveMessages.some((m) => m.id === messageToMove.id)).toBe(false);

    // 4. Trigger a sync (this is where it used to reappear)
    const account = listAccounts().find((a) => a.id === messageToMove.accountId);
    expect(account).toBeTruthy();
    await syncAccount(account!.id);

    // 5. Verify it's STILL gone from Inbox after sync
    const afterSyncMessages = listMessages({ folder: 'INBOX', limit: 200 });
    expect(afterSyncMessages.some((m) => m.id === messageToMove.id)).toBe(false);

    // 6. Verify it's present in Archive
    const archiveMessages = listMessages({ folder: 'Archive', limit: 200 });
    expect(archiveMessages.some((m) => m.subject === messageToMove.subject)).toBe(true);
  });
});
