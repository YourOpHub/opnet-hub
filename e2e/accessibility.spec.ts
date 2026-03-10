import { test, expect } from '@playwright/test';
import { mockAPIs } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await page.goto('/');
});

test('skip-to-content link exists and targets main', async ({ page }) => {
  const skipLink = page.locator('a.skip-link');
  await expect(skipLink).toHaveAttribute('href', '#main-content');
  // Should become visible on focus
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
});

test('page has correct landmark roles', async ({ page }) => {
  await expect(page.locator('header[role="banner"]')).toBeVisible();
  await expect(page.locator('main[role="main"]')).toBeVisible();
  await expect(page.locator('footer[role="contentinfo"]')).toBeVisible();
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible();
});

test('keyboard navigation works on nav buttons', async ({ page }) => {
  const homeBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'Home' });
  await homeBtn.focus();
  await expect(homeBtn).toBeFocused();

  // Tab to next nav group button
  await page.keyboard.press('Tab');
  const defiBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' });
  await expect(defiBtn).toBeFocused();

  // Enter to toggle dropdown
  await page.keyboard.press('Enter');
  await expect(page.locator('.nav-dropdown').first()).toBeVisible();
});
