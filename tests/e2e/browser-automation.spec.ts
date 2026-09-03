import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

function testCsrfToken() {
  const secret = 'test-session-secret-32-bytes';
  const session = createHmac('sha256', secret).update('dear-robot-authenticated').digest('base64url');
  return createHmac('sha256', secret).update(session).digest('base64url');
}

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

test('browser automation settings is a management view and keeps creation in Inbox', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Browser automations' }).click();

  await expect(page.getByRole('heading', { name: 'Manage saved report automations' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saved browser profiles' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saved recipes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent runs' })).toBeVisible();
  await expect(page.getByText('Start from an email and choose “Automate this report”.')).toBeVisible();
  await expect(page.getByText('Creation stays in Inbox')).toBeVisible();
  await expect(page.getByRole('button', { name: /Create profile|Save recipe shell/ })).toHaveCount(0);
});

test('browser automation settings edits an existing profile and recipe', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  const headers = { 'x-csrf-token': testCsrfToken() };
  const profileResponse = await page.request.post('/api/browser/profiles', {
    headers,
    data: {
      name: 'Settings profile',
      startUrl: 'https://reports.example.test/login',
      allowedHosts: ['login.example.test'],
      username: 'old-user',
      password: 'old-password'
    }
  });
  expect(profileResponse.ok()).toBeTruthy();
  const profile = (await profileResponse.json()).profile;
  const recipeResponse = await page.request.post('/api/browser/recipes', {
    headers,
    data: {
      profileId: profile.id,
      name: 'Old settings recipe',
      description: 'Old description',
      startUrl: 'https://reports.example.test/login',
      actions: [{ type: 'goto', url: 'https://reports.example.test/login' }]
    }
  });
  expect(recipeResponse.ok()).toBeTruthy();

  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Browser automations' }).click();
  await expect(page.getByRole('heading', { name: 'Settings profile' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit profile' }).click();
  await page.getByLabel('Username').fill('new-user');
  await page.getByLabel('Password').fill('new-password');
  await page.getByLabel('Allowed hosts').fill('reports.example.test, login.example.test');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Browser profile updated. Credentials remain encrypted on the server.')).toBeVisible();

  await page.getByRole('button', { name: 'Edit recipe' }).click();
  await page.getByLabel('Recipe name').fill('Latest settings recipe');
  await page.getByLabel('Description').fill('Updated report instructions');
  await page.getByLabel('Start URL').fill('https://reports.example.test/reports/latest');
  await page.getByLabel('Safe action recipe').fill(JSON.stringify([
    { type: 'goto', url: 'https://reports.example.test/reports/latest' },
    { type: 'download' }
  ], null, 2));
  await page.getByRole('button', { name: 'Save recipe' }).click();

  await expect(page.getByRole('heading', { name: 'Latest settings recipe' })).toBeVisible();
  await expect(page.getByText('Updated report instructions')).toBeVisible();
  const savedProfileResponse = await page.request.get(`/api/browser/profiles/${profile.id}`);
  const savedProfile = (await savedProfileResponse.json()).profile;
  expect(savedProfile).toMatchObject({ hasUsername: true, hasPassword: true });
  expect(savedProfile).not.toHaveProperty('usernameEncrypted');
  expect(savedProfile).not.toHaveProperty('passwordEncrypted');
  expect(await page.getByText('new-password').count()).toBe(0);
});
