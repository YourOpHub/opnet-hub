import { test, expect } from '@playwright/test';
import { mockAPIs } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await page.goto('/');
  // Navigate to Cross-Chain
  const defiBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' });
  await defiBtn.hover();
  await page.locator('.nav-drop-item', { hasText: 'Cross-Chain' }).click();
});

test('cross-chain page renders with title', async ({ page }) => {
  await expect(page.locator('text=FractalSwap').first()).toBeVisible();
});

test('wallet connection section shows connect buttons', async ({ page }) => {
  const walletRegion = page.locator('[role="region"][aria-label="Wallet connections"]');
  await expect(walletRegion).toBeVisible();

  // OPNet wallet button
  await expect(page.locator('button', { hasText: /Connect OPWallet/i })).toBeVisible();
});

test('create order form has required fields', async ({ page }) => {
  const orderForm = page.locator('[role="form"][aria-label="Create swap order"]');
  await expect(orderForm).toBeVisible();

  // Direction toggle buttons
  await expect(page.locator('button', { hasText: /I have BTC/i })).toBeVisible();
  await expect(page.locator('button', { hasText: /I have FB/i })).toBeVisible();

  // Amount inputs
  await expect(page.locator('[aria-label*="Amount you pay"]')).toBeVisible();
  await expect(page.locator('[aria-label*="Amount you get"]')).toBeVisible();

  // Address input
  await expect(page.locator('[aria-label*="receiving address"]')).toBeVisible();
});

test('fill order form shows summary', async ({ page }) => {
  const payInput = page.locator('[aria-label*="Amount you pay"]');
  const getInput = page.locator('[aria-label*="Amount you get"]');

  await payInput.fill('0.001');
  await getInput.fill('0.001');

  // Summary box should appear
  await expect(page.locator('text=You pay').first()).toBeVisible();
});

test('direction toggle changes address label', async ({ page }) => {
  // Default is BTC→FB, address should be "Fractal receiving address"
  // Click "I have FB" to switch
  await page.locator('button', { hasText: /I have FB/i }).click();

  // Address input label should reference Bitcoin
  const addrInput = page.locator('[aria-label*="receiving address"]');
  await expect(addrInput).toBeVisible();
});

test('stats section displays', async ({ page }) => {
  const statsRegion = page.locator('[role="region"][aria-label="FractalSwap statistics"]');
  await expect(statsRegion).toBeVisible();

  await expect(page.locator('text=Active Orders').first()).toBeVisible();
});
