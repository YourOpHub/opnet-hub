import { test, expect } from '@playwright/test';
import { mockAPIs } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await page.goto('/');
});

test('landing page loads by default', async ({ page }) => {
  await expect(page.locator('.hero-h1')).toBeVisible();
  await expect(page).toHaveTitle(/OPNet/i);
});

test('navigate to Swap via DeFi group', async ({ page }) => {
  // Hover on DeFi group to open dropdown
  const defiBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' });
  await defiBtn.hover();
  // Click Swap in dropdown
  const swapItem = page.locator('.nav-drop-item', { hasText: 'Swap' });
  await expect(swapItem).toBeVisible();
  await swapItem.click();
  // Verify Swap content loaded (main content changed)
  await expect(page.locator('.hero-h1')).not.toBeVisible();
});

test('navigate to Token Explorer via Tokens group', async ({ page }) => {
  const tokensBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'Tokens' });
  await tokensBtn.hover();
  const explorerItem = page.locator('.nav-drop-item', { hasText: 'Explorer' });
  await expect(explorerItem).toBeVisible();
  await explorerItem.click();
  await expect(page.locator('.hero-h1')).not.toBeVisible();
});

test('logo click returns to Home', async ({ page }) => {
  // Navigate away first
  const defiBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' });
  await defiBtn.hover();
  await page.locator('.nav-drop-item', { hasText: 'Swap' }).click();
  await expect(page.locator('.hero-h1')).not.toBeVisible();

  // Click logo to go home
  await page.locator('.Lo').click();
  await expect(page.locator('.hero-h1')).toBeVisible();
});

test('Home button has active state on landing', async ({ page }) => {
  const homeBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'Home' });
  await expect(homeBtn).toHaveClass(/on/);
});
