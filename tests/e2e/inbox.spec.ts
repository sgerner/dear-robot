import { test, expect } from '@playwright/test';

test('triages and executes a mock reply action', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Triage' })).toBeVisible();

  await page.getByText('Still no update on my refund').click();
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
