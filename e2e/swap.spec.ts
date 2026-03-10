import { test, expect } from '@playwright/test';
import { mockAPIs } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await page.goto('/');
  // Navigate to Swap
  const defiBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' });
  await defiBtn.hover();
  await page.locator('.nav-drop-item', { hasText: 'Swap' }).click();
});

test('swap form renders with inputs and selects', async ({ page }) => {
  const form = page.locator('[role="form"][aria-label="Token swap"]');
  await expect(form).toBeVisible();

  // Amount input
  const amountInput = page.locator('[aria-label*="Amount of"]');
  await expect(amountInput).toBeVisible();
  await expect(amountInput).toHaveAttribute('placeholder', '0.0');

  // Token selectors
  await expect(page.locator('[aria-label="Select token to swap from"]')).toBeVisible();
  await expect(page.locator('[aria-label="Select token to receive"]')).toBeVisible();

  // Flip button
  await expect(page.locator('[aria-label="Swap token direction"]')).toBeVisible();
});

test('enter swap amount and verify button state', async ({ page }) => {
  const amountInput = page.locator('[aria-label*="Amount of"]');
  await amountInput.fill('100');

  // When disconnected, "Connect Wallet to Swap" button should be present
  await expect(page.locator('.swap-connect-btn')).toBeVisible();
});

test('flip button swaps token direction', async ({ page }) => {
  const fromSelect = page.locator('[aria-label="Select token to swap from"]');
  const toSelect = page.locator('[aria-label="Select token to receive"]');

  const fromBefore = await fromSelect.inputValue();
  const toBefore = await toSelect.inputValue();

  await page.locator('[aria-label="Swap token direction"]').click();

  const fromAfter = await fromSelect.inputValue();
  const toAfter = await toSelect.inputValue();

  expect(fromAfter).toBe(toBefore);
  expect(toAfter).toBe(fromBefore);
});

test('slippage settings panel toggles', async ({ page }) => {
  const settingsBtn = page.locator('[aria-label*="Slippage settings"]');
  await expect(settingsBtn).toBeVisible();
  await settingsBtn.click();

  // Slippage buttons should appear
  const slipBtns = page.locator('.slip-btn');
  await expect(slipBtns.first()).toBeVisible();

  // Click a slippage option
  await slipBtns.nth(2).click(); // 1.0%
  await expect(settingsBtn).toContainText('%');
});

test('swap button shows Connect Wallet when disconnected', async ({ page }) => {
  const connectBtn = page.locator('.swap-connect-btn', { hasText: 'Connect Wallet' });
  await expect(connectBtn).toBeVisible();
});

test('switch to Pools tab and back', async ({ page }) => {
  // Tab buttons are in .max-w-560 wrapper, not inside .swap-panel
  const tabBar = page.locator('.max-w-560');
  await tabBar.locator('button', { hasText: 'Pools' }).click();

  // Create Pool button should appear
  await expect(page.locator('button', { hasText: '+ Create Pool' })).toBeVisible();

  // Switch back to Swap
  await tabBar.locator('button', { hasText: 'Swap' }).click();
  await expect(page.locator('[role="form"][aria-label="Token swap"]')).toBeVisible();
});

test('liquidity toggle button works', async ({ page }) => {
  const liqBtn = page.locator('[aria-label="Toggle liquidity panel"]');
  await expect(liqBtn).toBeVisible();
  await expect(liqBtn).toHaveAttribute('aria-expanded', 'false');

  await liqBtn.click();
  await expect(liqBtn).toHaveAttribute('aria-expanded', 'true');
});

test('mint buttons are present in swap view', async ({ page }) => {
  // Mint section has "1K MINE" and "1K VIBE" buttons
  await expect(page.locator('button', { hasText: '1K MINE' })).toBeVisible();
  await expect(page.locator('button', { hasText: '1K VIBE' })).toBeVisible();
});
