import { test, expect } from '@playwright/test';
import { mockAPIs } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await page.goto('/');
});

test('quest FAB button is visible and toggles panel', async ({ page }) => {
  const fab = page.locator('button.q-fab');
  await expect(fab).toBeVisible();
  await expect(fab).toHaveAttribute('aria-expanded', 'false');

  // Open quests panel
  await fab.click();
  await expect(fab).toHaveAttribute('aria-expanded', 'true');

  // Quest panel should appear
  const panel = page.locator('.qp');
  await expect(panel).toBeVisible();
});

test('quest panel shows quest items and can be closed', async ({ page }) => {
  // Open panel
  await page.locator('button.q-fab').click();
  const panel = page.locator('.qp');
  await expect(panel).toBeVisible();

  // Should contain quest titles
  await expect(panel.locator('text=Connect Wallet').first()).toBeVisible();

  // Close panel via close button inside panel
  await panel.locator('button.qp-close').click();
  await expect(page.locator('button.q-fab')).toHaveAttribute('aria-expanded', 'false');
});
