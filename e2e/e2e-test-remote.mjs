// Real-wallet E2E test via Playwright CDP connection
import { chromium } from 'playwright';
import fs from 'fs';

const CDP_URL = 'http://localhost:9222';
const SCREENSHOT_DIR = '/tmp/e2e-screenshots';
const MNEMONIC = 'veteran sunset borrow ecology artist magnet endorse tube tobacco soda odor okay';
const SITE_URL = 'https://opnethub.xyz';
const EXTENSION_ID = 'dcbggdilciclhajiamaloohdajdkmcig';
const WALLET_PWD = 'TestPass123!';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const consoleErrors = [];

async function ss(page, name) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: false });
  console.log(`  [ss] ${name}.png`);
}

async function clickVisible(page, locator, timeout = 5000) {
  if (await locator.isVisible({ timeout }).catch(() => false)) {
    await locator.click();
    return true;
  }
  return false;
}

async function importWallet(context) {
  console.log('\n=== STEP 1: Import wallet ===');

  let extPage = context.pages().find(p => p.url().includes('chrome-extension://'));
  if (!extPage) {
    extPage = await context.newPage();
    await extPage.goto(`chrome-extension://${EXTENSION_ID}/index.html`);
  }
  await extPage.bringToFront();
  await extPage.waitForLoadState('networkidle');
  await extPage.waitForTimeout(2000);

  const currentUrl = extPage.url();
  console.log('Wallet URL:', currentUrl);

  // If already past welcome, check if wallet is set up
  if (!currentUrl.includes('/welcome') && !currentUrl.includes('/create')) {
    console.log('Wallet appears already set up');
    await ss(extPage, '01-wallet-ready');
    return extPage;
  }

  // === Welcome page → Click "Import Existing Wallet" ===
  if (currentUrl.includes('/welcome')) {
    await ss(extPage, '01-welcome');
    console.log('Clicking "Import Existing Wallet"...');
    await extPage.locator('button', { hasText: 'Import Existing Wallet' }).click();
    await extPage.waitForTimeout(2000);
  }

  // === Create Password page ===
  const pwdInputs = extPage.locator('input[type="password"]');
  const pwdCount = await pwdInputs.count();
  if (pwdCount >= 2) {
    console.log('Create Password page — entering password...');
    await pwdInputs.nth(0).fill(WALLET_PWD);
    await pwdInputs.nth(1).fill(WALLET_PWD);
    await ss(extPage, '02-password-filled');

    // Click Continue
    const continueBtn = extPage.locator('button', { hasText: /Continue/i });
    await continueBtn.click();
    await extPage.waitForTimeout(3000);
    await ss(extPage, '03-after-password');
  }

  // === Step 1/4: Wallet Type Selection ===
  // Should see OP_WALLET (RECOMMENDED), UniSat, Sparrow, etc.
  const bodyText = await extPage.locator('body').innerText().catch(() => '');
  console.log('Current page text (first 300):', bodyText.substring(0, 300));

  // Click OP_WALLET option (recommended)
  const opwalletOption = extPage.locator('text=OP_WALLET').first();
  if (await opwalletOption.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Step 1/4: Selecting OP_WALLET type...');
    // Click the whole row/card, not just the text
    const card = opwalletOption.locator('xpath=ancestor::div[contains(@class,"cursor") or @role="button" or @tabindex]').first();
    if (await card.isVisible().catch(() => false)) {
      await card.click();
    } else {
      await opwalletOption.click();
    }
    await extPage.waitForTimeout(2000);
    await ss(extPage, '04-wallet-type-selected');
  }

  // === Step 2/4: Enter Mnemonic ===
  console.log('Looking for mnemonic input...');
  const bodyText2 = await extPage.locator('body').innerText().catch(() => '');
  console.log('Page text (first 400):', bodyText2.substring(0, 400));
  await ss(extPage, '05-mnemonic-page');

  // Try textarea first
  const textarea = extPage.locator('textarea').first();
  if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Found textarea — entering mnemonic...');
    await textarea.fill(MNEMONIC);
  } else {
    // Try individual word inputs
    const wordInputs = extPage.locator('input[type="text"], input[type="password"], input:not([type])');
    const inputCount = await wordInputs.count();
    console.log(`Found ${inputCount} inputs`);

    if (inputCount >= 12) {
      const words = MNEMONIC.split(' ');
      for (let i = 0; i < Math.min(inputCount, words.length); i++) {
        await wordInputs.nth(i).fill(words[i]);
        await extPage.waitForTimeout(100);
      }
    } else if (inputCount > 0) {
      // Single input field
      await wordInputs.first().fill(MNEMONIC);
    }
  }
  await extPage.waitForTimeout(500);
  await ss(extPage, '06-mnemonic-entered');

  // Click next/continue/import
  const nextBtn = extPage.locator('button:not([disabled])').filter({ hasText: /Next|Continue|Import|Confirm|Restore/i }).first();
  if (await clickVisible(extPage, nextBtn)) {
    console.log('Clicked next after mnemonic');
    await extPage.waitForTimeout(3000);
    await ss(extPage, '07-after-mnemonic');
  }

  // === Handle Step 3/4: Address selection (just click Continue) ===
  // After mnemonic, we get address type selection (Taproot recommended)
  const step3Text = await extPage.locator('body').innerText().catch(() => '');
  if (step3Text.includes('STEP 3') || step3Text.includes('Address') || step3Text.includes('Taproot')) {
    console.log('Step 3/4: Address selection — clicking Continue...');
    const continueBtn = extPage.locator('button:not([disabled])').filter({ hasText: /Continue/i }).first();
    if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await continueBtn.click();
      await extPage.waitForTimeout(5000);
    }
    await ss(extPage, '08-wallet-dashboard');
  }

  // We should now be on the wallet dashboard
  console.log('Wallet URL after import:', extPage.url());

  await ss(extPage, '09-wallet-final');
  console.log('Final wallet URL:', extPage.url());
  return extPage;
}

async function connectWallet(sitePage) {
  console.log('\n=== STEP 2: Connect wallet to site ===');

  await sitePage.bringToFront();
  await sitePage.goto(SITE_URL);
  await sitePage.waitForLoadState('networkidle');
  await sitePage.waitForTimeout(2000);
  await ss(sitePage, '10-landing');

  // Click Connect Wallet button
  const connectBtn = sitePage.locator('button', { hasText: /Connect Wallet/i }).first();
  if (!(await connectBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log('No Connect Wallet button — might already be connected');
    return;
  }

  console.log('Clicking Connect Wallet...');
  await connectBtn.click();
  await sitePage.waitForTimeout(3000);
  await ss(sitePage, '11-connect-dialog');

  // The modal has class wallet-connect-modal-backdrop and backdrop intercepts clicks.
  // The wallet option inside it has the OP WALLET logo.
  // Use force:true to bypass backdrop interception.

  // Find the wallet option inside the modal — it's a clickable div/button with the OP WALLET logo
  const modalBackdrop = sitePage.locator('.wallet-connect-modal-backdrop');
  if (await modalBackdrop.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Found wallet-connect modal backdrop');

    // Try to find and click the actual wallet option element inside the modal
    // The wallet option likely has an image and "WALLET" text
    const walletItem = modalBackdrop.locator('div, button, a').filter({ has: sitePage.locator('img') }).first();
    if (await walletItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Clicking wallet option with force...');
      await walletItem.click({ force: true });
      await sitePage.waitForTimeout(5000);
      await ss(sitePage, '12-after-wallet-click');
    } else {
      // Direct approach: click the image inside the modal
      const modalImg = modalBackdrop.locator('img').first();
      if (await modalImg.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Clicking modal image with force...');
        await modalImg.click({ force: true });
        await sitePage.waitForTimeout(5000);
        await ss(sitePage, '12-after-img-click');
      } else {
        console.log('No clickable wallet option found in modal. Using JS click...');
        // JavaScript click approach
        await modalBackdrop.evaluate(el => {
          const items = el.querySelectorAll('div, button');
          for (const item of items) {
            if (item.querySelector('img') && item.offsetHeight > 30) {
              item.click();
              return;
            }
          }
        });
        await sitePage.waitForTimeout(5000);
        await ss(sitePage, '12-after-js-click');
      }
    }
  } else {
    console.log('No wallet-connect modal found');
    await ss(sitePage, '12-no-modal');
  }

  // Handle extension popup approval if needed
  const allPages = sitePage.context().pages();
  console.log(`Open pages after wallet click: ${allPages.length}`);
  for (const p of allPages) {
    const pUrl = p.url();
    if (pUrl.includes('chrome-extension://') && pUrl.includes('notification')) {
      console.log('Found extension notification popup, approving...');
      await p.bringToFront();
      await p.waitForTimeout(2000);
      await ss(p, '13-wallet-approval');
      const approveBtn = p.locator('button', { hasText: /Approve|Connect|Confirm|Accept|Allow/i }).first();
      if (await approveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await approveBtn.click();
        await p.waitForTimeout(3000);
      }
    }
  }

  await sitePage.bringToFront();
  await sitePage.waitForTimeout(2000);
  await ss(sitePage, '14-wallet-connected');
}

async function testPages(sitePage) {
  console.log('\n=== STEP 3: Test all pages ===');

  const navRoutes = [
    { name: 'Swap', group: 'DeFi', item: 'Swap' },
    { name: 'Staking', group: 'DeFi', item: 'Stake' },
    { name: 'Marketplace', group: 'DeFi', item: 'Market' },
    { name: 'CrossChain', group: 'DeFi', item: 'Cross-Chain' },
    { name: 'TokenExplorer', group: 'Tokens', item: 'Explorer' },
    { name: 'TokenTools', group: 'Tokens', item: 'Tools' },
    { name: 'Launchpad', group: 'Tokens', item: 'Launchpad' },
  ];

  for (const route of navRoutes) {
    console.log(`\n--- ${route.name} ---`);
    try {
      await sitePage.goto(SITE_URL);
      await sitePage.waitForLoadState('networkidle');
      await sitePage.waitForTimeout(1000);

      // Open nav dropdown
      const navBtn = sitePage.locator('nav.nav-desktop button.Nt', { hasText: route.group });
      await navBtn.click();
      await sitePage.waitForTimeout(800);

      // Click dropdown item
      await sitePage.locator('.nav-drop-item', { hasText: route.item }).click();
      await sitePage.waitForTimeout(4000);
      await ss(sitePage, `30-${route.name}`);

      // Check for visible errors on page
      const errorBanner = sitePage.locator('.error, [role="alert"], .toast-error').first();
      if (await errorBanner.isVisible({ timeout: 1000 }).catch(() => false)) {
        const errText = await errorBanner.innerText().catch(() => 'unknown');
        console.log(`  WARNING: Error visible on page: ${errText.substring(0, 100)}`);
      }

      console.log('  OK');
    } catch (err) {
      console.log(`  FAIL: ${err.message.substring(0, 150)}`);
      await ss(sitePage, `30-${route.name}-FAIL`).catch(() => {});
    }
  }
}

async function testSwapInteraction(sitePage) {
  console.log('\n=== STEP 4: Test Swap interaction ===');
  try {
    await sitePage.goto(SITE_URL);
    await sitePage.waitForLoadState('networkidle');
    await sitePage.waitForTimeout(1000);

    // Navigate to Swap
    await sitePage.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' }).click();
    await sitePage.waitForTimeout(500);
    await sitePage.locator('.nav-drop-item', { hasText: 'Swap' }).click();
    await sitePage.waitForTimeout(3000);

    // Enter amount
    const amountInput = sitePage.locator('[aria-label*="Amount"]').first();
    if (await amountInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await amountInput.fill('100');
      console.log('  Entered swap amount: 100');
      await sitePage.waitForTimeout(1000);
    }

    // Try flip button
    const flipBtn = sitePage.locator('[aria-label="Swap token direction"]');
    if (await flipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await flipBtn.click();
      console.log('  Flipped swap direction');
      await sitePage.waitForTimeout(1000);
    }

    // Try slippage settings
    const slipBtn = sitePage.locator('[aria-label*="Slippage"]').first();
    if (await slipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await slipBtn.click();
      await sitePage.waitForTimeout(500);
      console.log('  Opened slippage settings');
    }

    // Mint buttons
    const mintBtn = sitePage.locator('button', { hasText: '1K MINE' });
    if (await mintBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('  Clicking mint 1K MINE...');
      await mintBtn.click();
      await sitePage.waitForTimeout(5000);

      // Check for extension popup
      const allPages = sitePage.context().pages();
      for (const p of allPages) {
        if (p.url().includes('notification') || p.url().includes('confirm')) {
          console.log('  Extension popup opened for tx signing');
          await p.bringToFront();
          await ss(p, '40-mint-approval');
          // Approve
          const approveBtn = p.locator('button', { hasText: /Approve|Confirm|Sign/i }).first();
          if (await approveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await approveBtn.click();
            console.log('  Approved mint tx');
            await p.waitForTimeout(5000);
          }
          break;
        }
      }
    }

    await sitePage.bringToFront();
    await sitePage.waitForTimeout(2000);
    await ss(sitePage, '41-swap-interaction');
    console.log('  Swap interaction done');
  } catch (err) {
    console.log(`  Swap FAIL: ${err.message.substring(0, 150)}`);
    await ss(sitePage, '41-swap-FAIL').catch(() => {});
  }
}

async function testMarketplaceInteraction(sitePage) {
  console.log('\n=== STEP 5: Test Marketplace interaction ===');
  try {
    await sitePage.goto(SITE_URL);
    await sitePage.waitForLoadState('networkidle');
    await sitePage.waitForTimeout(1000);

    await sitePage.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' }).click();
    await sitePage.waitForTimeout(500);
    await sitePage.locator('.nav-drop-item', { hasText: 'Market' }).click();
    await sitePage.waitForTimeout(4000);
    await ss(sitePage, '50-marketplace');

    // Click first token card
    const tokenCard = sitePage.locator('[role="listitem"]').first();
    if (await tokenCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tokenCard.scrollIntoViewIfNeeded();
      await tokenCard.click({ force: true });
      await sitePage.waitForTimeout(3000);
      await ss(sitePage, '51-orderbook');

      // Fill sell order
      const amountInput = sitePage.locator('[aria-label="Amount to sell"]');
      if (await amountInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await amountInput.fill('1000');
        const priceInput = sitePage.locator('[aria-label="Price in sats per token"]');
        if (await priceInput.isVisible()) {
          await priceInput.fill('0.5');
        }
        await ss(sitePage, '52-sell-order-filled');
        console.log('  Sell order form filled');
      }

      // Switch to buy
      const buyBtn = sitePage.locator('button', { hasText: /Buy Tokens/i });
      if (await buyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await buyBtn.click();
        await sitePage.waitForTimeout(1000);
        await ss(sitePage, '53-buy-mode');
        console.log('  Switched to buy mode');
      }
    }
    console.log('  Marketplace interaction done');
  } catch (err) {
    console.log(`  Marketplace FAIL: ${err.message.substring(0, 150)}`);
    await ss(sitePage, '53-marketplace-FAIL').catch(() => {});
  }
}

async function testStakingInteraction(sitePage) {
  console.log('\n=== STEP 6: Test Staking interaction ===');
  try {
    await sitePage.goto(SITE_URL);
    await sitePage.waitForLoadState('networkidle');
    await sitePage.waitForTimeout(1000);

    await sitePage.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' }).click();
    await sitePage.waitForTimeout(500);
    await sitePage.locator('.nav-drop-item', { hasText: 'Stake' }).click();
    await sitePage.waitForTimeout(4000);
    await ss(sitePage, '60-staking');

    const stakeInput = sitePage.locator('input[type="number"], input[placeholder*="amount" i], [aria-label*="stake" i]').first();
    if (await stakeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await stakeInput.fill('1000');
      console.log('  Entered stake amount');
      await sitePage.waitForTimeout(1000);
      await ss(sitePage, '61-stake-amount');
    }
    console.log('  Staking interaction done');
  } catch (err) {
    console.log(`  Staking FAIL: ${err.message.substring(0, 150)}`);
    await ss(sitePage, '61-staking-FAIL').catch(() => {});
  }
}

async function main() {
  console.log('Connecting to browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  console.log(`Pages: ${context.pages().length}`);

  // Step 1: Import wallet
  await importWallet(context);

  // Step 2: Connect wallet to site
  let sitePage = context.pages().find(p => p.url().includes('opnethub'));
  if (!sitePage) {
    sitePage = await context.newPage();
  }

  sitePage.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({ url: sitePage.url(), text: msg.text().substring(0, 300) });
    }
  });

  await connectWallet(sitePage);

  // Step 3: Test all pages
  await testPages(sitePage);

  // Step 4: Test interactions
  await testSwapInteraction(sitePage);
  await testMarketplaceInteraction(sitePage);
  await testStakingInteraction(sitePage);

  // Final report
  console.log('\n========== FINAL REPORT ==========');
  console.log(`Console errors: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    for (const e of consoleErrors) {
      console.log(`  [${e.url.substring(0, 40)}] ${e.text}`);
    }
  }
  console.log(`Screenshots: ${SCREENSHOT_DIR}/`);
  console.log('Done.');
  browser.close();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
