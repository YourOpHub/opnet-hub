import { test, expect } from '@playwright/test';
import { mockAPIs } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await page.goto('/');
});

test('Connect Wallet button is visible and clickable', async ({ page }) => {
  const walletBtn = page.locator('button.Wb');
  await expect(walletBtn).toBeVisible();
  await expect(walletBtn).toContainText('Connect Wallet');
});

test('wallet button has correct ARIA attributes', async ({ page }) => {
  const walletBtn = page.locator('button.Wb');
  await expect(walletBtn).toHaveAttribute('aria-label', 'Connect wallet');
});
