import { test, expect } from '@playwright/test';
import { mockAPIs, mockMarketplaceTokens } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await mockMarketplaceTokens(page);
  await page.goto('/');
  // Navigate to Market
  const defiBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' });
  await defiBtn.hover();
  await page.locator('.nav-drop-item', { hasText: 'Market' }).click();
});

test('marketplace shows token search', async ({ page }) => {
  const searchInput = page.locator('[aria-label="Search tokens by name, symbol, or contract address"]');
  await expect(searchInput).toBeVisible();
});

test('marketplace shows token list', async ({ page }) => {
  const tokenList = page.locator('[role="list"][aria-label="Available tokens"]');
  await expect(tokenList).toBeVisible();
});

test('search input accepts text', async ({ page }) => {
  const searchInput = page.locator('[aria-label="Search tokens by name, symbol, or contract address"]');
  await searchInput.fill('MINE');
  await expect(searchInput).toHaveValue('MINE');
});

test('token cards are present and clickable', async ({ page }) => {
  const tokenCard = page.locator('[aria-label="Available tokens"] [role="listitem"]').first();
  await expect(tokenCard).toBeVisible({ timeout: 5000 });

  // Scroll into view and click
  await tokenCard.scrollIntoViewIfNeeded();
  await tokenCard.click({ force: true });

  // Should navigate to orderbook — back button appears
  await expect(page.locator('button', { hasText: '← Back' })).toBeVisible();
});

test('orderbook shows order form with type toggles', async ({ page }) => {
  const tokenCard = page.locator('[aria-label="Available tokens"] [role="listitem"]').first();
  await expect(tokenCard).toBeVisible({ timeout: 5000 });
  await tokenCard.scrollIntoViewIfNeeded();
  await tokenCard.click({ force: true });

  // Order form
  const orderForm = page.locator('[role="form"][aria-label="Place a marketplace order"]');
  await expect(orderForm).toBeVisible();

  // Order type toggles
  await expect(orderForm.locator('button', { hasText: 'Sell Tokens' })).toBeVisible();
  await expect(orderForm.locator('button', { hasText: /Buy Tokens/i })).toBeVisible();
});

test('fill create order form and see total', async ({ page }) => {
  const tokenCard = page.locator('[aria-label="Available tokens"] [role="listitem"]').first();
  await expect(tokenCard).toBeVisible({ timeout: 5000 });
  await tokenCard.scrollIntoViewIfNeeded();
  await tokenCard.click({ force: true });

  // Fill amount and price
  await page.locator('[aria-label="Amount to sell"]').fill('100000');
  await page.locator('[aria-label="Price in sats per token"]').fill('0.5');

  // Total should appear
  await expect(page.locator('text=Total:').first()).toBeVisible();
});

test('switch to buy order type', async ({ page }) => {
  const tokenCard = page.locator('[aria-label="Available tokens"] [role="listitem"]').first();
  await expect(tokenCard).toBeVisible({ timeout: 5000 });
  await tokenCard.scrollIntoViewIfNeeded();
  await tokenCard.click({ force: true });

  // Click "Buy Tokens" toggle
  await page.locator('button', { hasText: /Buy Tokens/i }).click();

  // Amount label should change to "Amount you want"
  await expect(page.locator('[aria-label="Amount you want"]')).toBeVisible();
});

test('back button returns to token list', async ({ page }) => {
  const tokenCard = page.locator('[aria-label="Available tokens"] [role="listitem"]').first();
  await expect(tokenCard).toBeVisible({ timeout: 5000 });
  await tokenCard.scrollIntoViewIfNeeded();
  await tokenCard.click({ force: true });
  await page.locator('button', { hasText: '← Back' }).click();

  // Token list visible again
  await expect(page.locator('[aria-label="Search tokens by name, symbol, or contract address"]')).toBeVisible();
});

test('create order button shows connect wallet when disconnected', async ({ page }) => {
  const tokenCard = page.locator('[aria-label="Available tokens"] [role="listitem"]').first();
  await expect(tokenCard).toBeVisible({ timeout: 5000 });
  await tokenCard.scrollIntoViewIfNeeded();
  await tokenCard.click({ force: true });

  // The marketplace form has its own "Connect Wallet" button (lbtn class)
  const connectBtn = page.locator('button.lbtn', { hasText: 'Connect Wallet' });
  await expect(connectBtn).toBeVisible();
});
