import { test, expect } from '@playwright/test';
import { mockAPIs } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await page.goto('/');
});

test('hero section renders with headline and description', async ({ page }) => {
  await expect(page.locator('.hero-h1')).toContainText('DeFi on');
  await expect(page.locator('.hero-h1 .hero-ac')).toContainText('Pure Bitcoin');
  await expect(page.locator('.hero-p')).toContainText('Swap, stake, and earn');
});

test('feature cards are displayed', async ({ page }) => {
  const features = page.locator('.fgrid .fc');
  await expect(features.first()).toBeVisible();
  // At least 5 feature cards rendered
  await expect(features).toHaveCount(10);
});

test('CTA buttons navigate correctly', async ({ page }) => {
  // "Start Trading" → Swap
  await page.locator('.hero-ctas .btn-p', { hasText: 'Start Trading' }).click();
  await expect(page.locator('.hero-h1')).not.toBeVisible();

  // Go back home
  await page.locator('.Lo').click();
  await expect(page.locator('.hero-h1')).toBeVisible();

  // "Play & Earn" → Game
  await page.locator('.hero-ctas .btn-s', { hasText: 'Play' }).click();
  await expect(page.locator('.hero-h1')).not.toBeVisible();
});
