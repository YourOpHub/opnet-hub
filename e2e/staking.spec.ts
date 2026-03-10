import { test, expect } from '@playwright/test';
import { mockAPIs } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await page.goto('/');
  // Navigate to Staking
  const defiBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' });
  await defiBtn.hover();
  await page.locator('.nav-drop-item', { hasText: 'Stake' }).click();
});

test('staking page shows connect wallet prompt', async ({ page }) => {
  const connectBtn = page.locator('button', { hasText: 'Connect Wallet' });
  await expect(connectBtn).toBeVisible();
});

test('staking page has heading and subtitle', async ({ page }) => {
  await expect(page.locator('h2', { hasText: 'Staking' })).toBeVisible();
  await expect(page.locator('text=MINE').first()).toBeVisible();
});

test('staking stats grid is displayed', async ({ page }) => {
  // Stats should be rendered
  await expect(page.locator('text=APR').first()).toBeVisible();
  await expect(page.locator('text=Total Staked').first()).toBeVisible();
});

test('staking form has correct ARIA roles', async ({ page }) => {
  const form = page.locator('[role="form"][aria-label="Staking interface"]');
  await expect(form).toBeVisible();
});
