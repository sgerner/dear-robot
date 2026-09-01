import { test, expect } from '@playwright/test';

test('browser automations start from email and stay out of Operations setup', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTitle('Operations').click();
  await expect(page.getByRole('heading', { name: 'Autopilot Control Room' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
  await expect(page.getByText('Browser automations')).toHaveCount(0);
  await expect(page.getByText('Start from the email, not Settings')).toHaveCount(0);
});
