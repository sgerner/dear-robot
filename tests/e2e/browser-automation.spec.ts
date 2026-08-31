import { test, expect } from '@playwright/test';

test('browser automations panel exposes safe recipe controls', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTitle('Operations').click();
  await expect(page.getByRole('heading', { name: 'Teach the agent once, replay safely' })).toBeVisible();
  await expect(page.getByText('Isolated · allowlisted · approval-gated')).toBeVisible();
  await expect(page.getByText('Farin destination')).toBeVisible();
  await expect(page.getByRole('button', { name: /Create profile/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Save recipe shell/ })).toBeVisible();
});
