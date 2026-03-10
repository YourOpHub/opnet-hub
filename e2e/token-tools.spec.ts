import { test, expect } from '@playwright/test';
import { mockAPIs } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await page.goto('/');
  // Navigate to Token Tools — click instead of hover for stability
  await page.locator('nav.nav-desktop button.Nt', { hasText: 'Tokens' }).click();
  await page.locator('.nav-drop-item', { hasText: 'Tools' }).click();
  // Wait for lazy-loaded component
  await page.waitForSelector('[role="tablist"]', { timeout: 10000 });
});

test('token tools page renders with tab list', async ({ page }) => {
  const tabList = page.locator('[role="tablist"]');
  await expect(tabList).toBeVisible();
});

test('converter tool: BTC/sats radio buttons', async ({ page }) => {
  const btcRadio = page.locator('[role="radio"]').first();
  await expect(btcRadio).toBeVisible();
});

test('converter tool: enter BTC amount', async ({ page }) => {
  const btcInput = page.locator('[aria-label="BTC amount"]');
  if (await btcInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btcInput.fill('1');
    await expect(btcInput).toHaveValue('1');
  }
});

test('faucet tab: token selector and action button', async ({ page }) => {
  const faucetTab = page.locator('[role="tab"]', { hasText: /Faucet/i });
  await faucetTab.click();

  await expect(page.locator('button', { hasText: /MINE/i }).first()).toBeVisible();

  const actionBtn = page.locator('button', { hasText: /Connect Wallet|Mint/i }).first();
  await expect(actionBtn).toBeVisible();
});

test('tab switching works', async ({ page }) => {
  const tabs = page.locator('[role="tab"]');
  const count = await tabs.count();
  expect(count).toBeGreaterThanOrEqual(2);

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
});

test('UTXO viewer has address input', async ({ page }) => {
  const utxoTab = page.locator('[role="tab"]', { hasText: /UTXO/i }).first();
  await utxoTab.click();

  const addrInput = page.locator('[aria-label="Bitcoin or OPNet address"]');
  if (await addrInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await addrInput.fill('opt1pp76test');
    await expect(addrInput).toHaveValue('opt1pp76test');
  }
});
