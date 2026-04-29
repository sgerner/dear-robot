import { test, expect } from '@playwright/test';

test('triages and executes a mock reply action', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Triage' })).toBeVisible();

  await page.getByTestId('message-row').filter({ hasText: 'Still no update on my refund' }).first().click();
  await expect(page.getByTestId('ai-action-card')).toBeVisible();
  await expect(page.getByTestId('draft-reply')).toBeVisible();
  await page.getByTestId('draft-reply').fill('Hi Jordan, I am checking this now and will follow up today.');
  await page.getByRole('button', { name: 'Save Edit' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByTestId('execute-suggestion').click();
  await expect(page.getByText('Executed')).toBeVisible();

  await page.getByTitle('Executed').click();
  await expect(page.getByText('reply').first()).toBeVisible();
});

test('manages mock account lifecycle controls', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTitle('Accounts').click();
  await expect(page.getByText('Email Accounts')).toBeVisible();
  await page.getByRole('button', { name: 'Test' }).first().click();
  await expect(page.getByText('Account test complete')).toBeVisible();
});

test('uses email-client folder, flag, read, and compose controls', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByTestId('message-row').filter({ hasText: 'Still no update on my refund' }).first().click();
  await page.getByTestId('toggle-star').click();
  await expect(page.getByTestId('toggle-star')).toContainText('Starred');
  await page.getByTestId('toggle-read').click();
  await page.getByTestId('reply-all').click();
  await expect(page.getByText('AI-ready compose')).toBeVisible();
  await page.getByPlaceholder('Write the message...').fill('Thanks, I am handling this from the client workflow.');
  await page.getByTestId('send-compose').click();
  await expect(page.getByText('Sent')).toBeVisible();
});

test('phase2 compose supports attachments and draft save', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('button', { name: 'Compose', exact: true }).first().click();
  await expect(page.getByText('AI-ready compose')).toBeVisible();
  await page.getByPlaceholder('To').fill('steven@butteredupbakery.com');
  await page.getByPlaceholder('Subject').fill('Phase2 attachment draft');
  await page.getByPlaceholder('Write the message...').fill('Attachment test body');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'phase2.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('phase2 attachment', 'utf8')
  });
  await expect(page.getByRole('button', { name: 'phase2.txt Remove' }).first()).toBeVisible();
  await page.getByTestId('save-draft').click();
  await page.getByTestId('send-compose').click();
  await expect(page.getByText('Sent')).toBeVisible();
});

test('phase3 bulk toolbar updates selected messages', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  const rows = page.getByTestId('message-row');
  await rows.nth(0).locator('input[type="checkbox"]').check();
  await rows.nth(1).locator('input[type="checkbox"]').check();
  await page.getByTestId('bulk-read').click();
  await expect(page.getByText('Bulk action complete')).toBeVisible();
});

test('phase4 agent planning flow creates, approves, and executes task', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByTestId('message-row').first().click();
  await page.getByTestId('plan-task').click();
  await expect(page.getByText('Task plan generated')).toBeVisible();
  await page.getByTestId('approve-task').first().click();
  await page.getByTestId('execute-task').first().click();
  await expect(page.getByText('Task execution finished')).toBeVisible();
});
