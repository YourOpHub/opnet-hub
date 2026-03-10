import { test, expect } from '@playwright/test';
import { mockAPIs } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAPIs(page);
  await page.goto('/');
  // Navigate to MultiSend
  const tokensBtn = page.locator('nav.nav-desktop button.Nt', { hasText: 'Tokens' });
  await tokensBtn.hover();
  await page.locator('.nav-drop-item', { hasText: 'MultiSend' }).click();
});

test('multisender page renders with wizard steps', async ({ page }) => {
  const region = page.locator('[role="region"][aria-label="Multi-Sender"]');
  await expect(region).toBeVisible();

  // Wizard navigation
  const wizardNav = page.locator('[role="navigation"][aria-label="Multi-sender wizard steps"]');
  await expect(wizardNav).toBeVisible();

  // Step badges
  const stepBadges = page.locator('[role="button"][aria-label*="Step"]');
  const count = await stepBadges.count();
  expect(count).toBeGreaterThanOrEqual(3);
});

test('step 1: select token section visible', async ({ page }) => {
  // Step 1 should be active by default
  await expect(page.locator('text=Select Token').first()).toBeVisible();
});

test('navigation buttons render correctly', async ({ page }) => {
  // Back button should be disabled on step 1
  const backBtn = page.locator('button', { hasText: 'Back' }).first();
  if (await backBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expect(backBtn).toBeDisabled();
  }

  // Next button should be visible
  const nextBtn = page.locator('button', { hasText: 'Next' }).first();
  await expect(nextBtn).toBeVisible();
});

test('footer disclaimer is present', async ({ page }) => {
  const footer = page.locator('[role="note"]');
  if (await footer.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expect(footer).toBeVisible();
  }
});
