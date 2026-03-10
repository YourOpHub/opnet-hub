import { test, expect } from '@playwright/test';
import { mockAPIs } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await page.goto('/');
  // Navigate to Launchpad
  const tokensBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'Tokens' });
  await tokensBtn.hover();
  await page.locator('.nav-drop-item', { hasText: 'Launchpad' }).click();
});

test('launchpad page renders', async ({ page }) => {
  const region = page.locator('[role="region"][aria-label="Token Launchpad"]');
  await expect(region).toBeVisible();
});

test('launchpad shows deploy button', async ({ page }) => {
  const deployBtn = page.locator('button', { hasText: /Deploy New Contract|New Token|Deploy/i });
  await expect(deployBtn).toBeVisible();
});

test('launchpad shows existing deployed tokens', async ({ page }) => {
  // Featured tokens (MINE, VIBE) should be listed
  await expect(page.locator('text=MINE').first()).toBeVisible();
});
