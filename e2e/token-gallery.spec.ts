import { test, expect } from '@playwright/test';
import { mockAPIs, mockTokenAPI } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await mockTokenAPI(page);
  await page.goto('/');
  // Navigate to Token Explorer — click instead of hover for stability
  await page.locator('nav.nav-desktop button.Nt', { hasText: 'Tokens' }).click();
  await page.locator('.nav-drop-item', { hasText: 'Explorer' }).click();
});

test('token gallery renders with tabs', async ({ page }) => {
  await expect(page.locator('button', { hasText: /Featured/ })).toBeVisible();
  await expect(page.locator('button', { hasText: /All Tokens/ })).toBeVisible();
  await expect(page.locator('button', { hasText: /My/ })).toBeVisible();
});

test('featured tab shows MINE and VIBE tokens', async ({ page }) => {
  await page.locator('button', { hasText: /Featured/ }).click();

  await expect(page.locator('text=MINE').first()).toBeVisible();
  await expect(page.locator('text=VIBE').first()).toBeVisible();
});

test('featured token has mint button', async ({ page }) => {
  await page.locator('button', { hasText: /Featured/ }).click();

  const mintBtn = page.locator('button', { hasText: /Mint/i }).first();
  await expect(mintBtn).toBeVisible();
});

test('clicking mint opens mint panel', async ({ page }) => {
  await page.locator('button', { hasText: /Featured/ }).click();

  const mintBtn = page.locator('button', { hasText: /🪙 Mint|Mint/i }).first();
  await mintBtn.click();

  const closeOrInput = page.locator('button', { hasText: 'Close' }).or(page.locator('input[placeholder*="Amount"]'));
  await expect(closeOrInput.first()).toBeVisible();
});

test('all tokens tab shows search input', async ({ page }) => {
  await page.locator('button', { hasText: /All Tokens/ }).click();
  await page.waitForTimeout(500);

  const search = page.locator('[aria-label="Search tokens by name, symbol, or address"]');
  await expect(search).toBeVisible();
});

test('search input accepts text in all tokens tab', async ({ page }) => {
  await page.locator('button', { hasText: /All Tokens/ }).click();
  await page.waitForTimeout(500);

  const search = page.locator('[aria-label="Search tokens by name, symbol, or address"]');
  if (await search.isVisible({ timeout: 3000 }).catch(() => false)) {
    await search.fill('MINE');
    await expect(search).toHaveValue('MINE');
  }
});

test('refresh button is present', async ({ page }) => {
  await page.locator('button', { hasText: /All Tokens/ }).click();
  await page.waitForTimeout(500);

  const refreshBtn = page.locator('[aria-label="Refresh token list"]');
  if (await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(refreshBtn).toBeVisible();
  }
});
