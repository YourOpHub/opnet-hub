// Full E2E: import wallet → connect → test all pages → interactions
import { chromium } from 'playwright';
import fs from 'fs';

const CDP_URL = 'http://localhost:9222';
const SS_DIR = '/tmp/e2e-screenshots';
const MNEMONIC = 'veteran sunset borrow ecology artist magnet endorse tube tobacco soda odor okay';
const SITE = 'https://opnethub.xyz';
const EXT_ID = 'dcbggdilciclhajiamaloohdajdkmcig';
const PWD = 'TestPass123!';

fs.mkdirSync(SS_DIR, { recursive: true });
const errors = [];

async function ss(page, name) {
  await page.screenshot({ path: `${SS_DIR}/${name}.png`, fullPage: false });
  console.log(`  [ss] ${name}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Find popup by polling context pages
async function waitForPopup(ctx, match, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = ctx.pages().find(p => p.url().includes(match));
    if (found) return found;
    await sleep(500);
  }
  return null;
}

async function main() {
  console.log('=== Connecting to browser ===');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];

  // ========== PHASE 1: IMPORT WALLET ==========
  console.log('\n=== PHASE 1: Import Wallet ===');
  let ext = ctx.pages().find(p => p.url().includes('chrome-extension://'));
  if (!ext) {
    ext = await ctx.newPage();
    await ext.goto(`chrome-extension://${EXT_ID}/index.html`);
  }
  await ext.bringToFront();
  await ext.waitForLoadState('networkidle');
  await sleep(2000);

  if (ext.url().includes('/welcome')) {
    console.log('Step 0: Welcome → Import Existing Wallet');
    await ext.locator('button', { hasText: 'Import Existing Wallet' }).click();
    await sleep(2000);

    // Password
    console.log('Step 1: Create Password');
    const pwdFields = ext.locator('input[type="password"]');
    await pwdFields.nth(0).fill(PWD);
    await pwdFields.nth(1).fill(PWD);
    await ext.locator('button', { hasText: 'Continue' }).click();
    await sleep(2000);

    // Select OP_WALLET type
    console.log('Step 2: Select OP_WALLET type');
    await ext.locator('text=OP_WALLET').first().click();
    await sleep(2000);

    // Enter mnemonic
    console.log('Step 3: Enter mnemonic');
    const wordInputs = ext.locator('input');
    const words = MNEMONIC.split(' ');
    const inputCount = await wordInputs.count();
    for (let i = 0; i < Math.min(inputCount, words.length); i++) {
      await wordInputs.nth(i).fill(words[i]);
      await sleep(50);
    }
    await ext.locator('button', { hasText: 'Continue' }).click();
    await sleep(3000);

    // Step 3/4: Address selection (Taproot)
    console.log('Step 4: Address selection → Continue');
    const continueBtn = ext.locator('button', { hasText: 'Continue' });
    if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await continueBtn.click();
      await sleep(5000);
    }

    await ss(ext, '01-wallet-imported');
    console.log('Wallet imported! URL:', ext.url());
  } else {
    console.log('Wallet already set up');
    await ss(ext, '01-wallet-ready');
  }

  // ========== PHASE 2: CONNECT WALLET ==========
  console.log('\n=== PHASE 2: Connect Wallet ===');
  let site = ctx.pages().find(p => p.url().includes('opnethub'));
  if (!site) {
    site = await ctx.newPage();
    await site.goto(SITE);
  }
  await site.bringToFront();
  await site.reload({ waitUntil: 'networkidle' });
  await sleep(3000);

  // Track console errors
  site.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push({ url: site.url(), text: msg.text().substring(0, 300) });
    }
  });

  const hasProvider = await site.evaluate(() => !!window.opnet);
  console.log('Provider injected:', hasProvider);

  if (hasProvider) {
    // Trigger requestAccounts
    console.log('Calling requestAccounts...');
    site.evaluate(() => window.opnet.requestAccounts()).catch(() => {});
    await sleep(1000);

    // Wait for notification popup
    const popup = await waitForPopup(ctx, 'notification', 15000);
    if (popup) {
      console.log('Popup found:', popup.url());

      // Wait for page to fully load
      await popup.waitForLoadState('networkidle').catch(() => {});
      await sleep(5000);

      // Debug: dump page content
      const html = await popup.content().catch(() => 'no content');
      console.log('Popup HTML length:', html.length);
      const text = await popup.locator('body').innerText().catch(() => 'no text');
      console.log('Popup text:', text.substring(0, 300));
      await ss(popup, '02-connect-popup');

      // OP_WALLET uses <div> not <button>! Click the orange Connect div.
      const clicked = await popup.evaluate(() => {
        // Find the div with "Connect" text and orange background
        const all = document.querySelectorAll('div[style*="cursor: pointer"]');
        for (const el of all) {
          const inner = el.querySelector('div');
          if (inner && inner.textContent.trim() === 'Connect') {
            el.click();
            return 'clicked';
          }
        }
        // Fallback: find any element with exact "Connect" text
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent.trim() === 'Connect') {
            walker.currentNode.parentElement.click();
            return 'clicked-text';
          }
        }
        return 'not-found';
      });
      console.log('Connect click result:', clicked);
      await sleep(3000);
    } else {
      console.log('No popup — trying direct notification page...');
      const directPage = await ctx.newPage();
      await directPage.goto(`chrome-extension://${EXT_ID}/notification.html`);
      await sleep(3000);
      await ss(directPage, '02-notification-direct');

      const text = await directPage.locator('body').innerText().catch(() => '');
      console.log('Notification text:', text.substring(0, 200));

      if (text.includes('Connect')) {
        const connectBtn = directPage.locator('button', { hasText: 'Connect' }).last();
        if (await connectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await connectBtn.click();
          console.log('Clicked Connect on direct notification page');
          await sleep(3000);
        }
      }
      await directPage.close();
    }

    // Verify connection
    await site.bringToFront();
    await sleep(2000);

    try {
      const accounts = await Promise.race([
        site.evaluate(() => window.opnet.getAccounts()),
        sleep(5000).then(() => null)
      ]);
      console.log('Accounts:', JSON.stringify(accounts));

      if (accounts) {
        const balance = await site.evaluate(() => window.opnet.getBalance().catch(e => e.message));
        console.log('Balance:', JSON.stringify(balance));

        const network = await site.evaluate(() => window.opnet.getNetwork().catch(e => e.message));
        console.log('Network:', JSON.stringify(network));
      }
    } catch(e) {
      console.log('Connection check error:', e.message);
    }

    // Reload to apply wallet state to UI
    await site.reload({ waitUntil: 'networkidle' });
    await sleep(3000);
    await ss(site, '03-site-connected');
  }

  // ========== PHASE 3: TEST ALL PAGES ==========
  console.log('\n=== PHASE 3: Test All Pages ===');

  const routes = [
    { name: 'Swap', group: 'DeFi', item: 'Swap' },
    { name: 'Staking', group: 'DeFi', item: 'Stake' },
    { name: 'Marketplace', group: 'DeFi', item: 'Market' },
    { name: 'CrossChain', group: 'DeFi', item: 'Cross-Chain' },
    { name: 'TokenExplorer', group: 'Tokens', item: 'Explorer' },
    { name: 'TokenTools', group: 'Tokens', item: 'Tools' },
    { name: 'Launchpad', group: 'Tokens', item: 'Launchpad' },
  ];

  for (const r of routes) {
    console.log(`\n--- ${r.name} ---`);
    try {
      await site.goto(SITE, { waitUntil: 'networkidle' });
      await sleep(1000);
      await site.locator('nav.nav-desktop button.Nt', { hasText: r.group }).click();
      await sleep(800);
      await site.locator('.nav-drop-item', { hasText: r.item }).click();
      await sleep(4000);
      await ss(site, `10-${r.name}`);

      // Check for errors on page
      const alerts = site.locator('[role="alert"], .error-msg, .toast-error');
      if (await alerts.first().isVisible({ timeout: 500 }).catch(() => false)) {
        const errText = await alerts.first().innerText().catch(() => '');
        console.log(`  ALERT: ${errText.substring(0, 100)}`);
      }
      console.log('  OK');
    } catch (err) {
      console.log(`  FAIL: ${err.message.substring(0, 120)}`);
      await ss(site, `10-${r.name}-FAIL`).catch(() => {});
    }
  }

  // ========== PHASE 4: INTERACTIONS ==========
  console.log('\n=== PHASE 4: Interactions ===');

  // --- Swap ---
  console.log('\n--- Swap: Enter amount, flip, slippage ---');
  try {
    await site.goto(SITE, { waitUntil: 'networkidle' });
    await sleep(1000);
    await site.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' }).click();
    await sleep(500);
    await site.locator('.nav-drop-item', { hasText: 'Swap' }).click();
    await sleep(3000);

    const amtInput = site.locator('[aria-label*="Amount"]').first();
    if (await amtInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await amtInput.fill('100');
      console.log('  Amount: 100');
    }

    const flipBtn = site.locator('[aria-label="Swap token direction"]');
    if (await flipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await flipBtn.click();
      console.log('  Flipped direction');
    }

    await ss(site, '20-swap-interaction');

    // Try mint 1K MINE (will need wallet approval)
    const mintBtn = site.locator('button', { hasText: '1K MINE' });
    if (await mintBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('  Clicking 1K MINE mint...');
      await mintBtn.click();
      await sleep(3000);

      // Check for approval popup
      const txPopup = await waitForPopup(ctx, 'notification', 10000);
      if (txPopup) {
        console.log('  TX approval popup appeared!');
        await txPopup.waitForLoadState('networkidle').catch(() => {});
        await sleep(5000);
        await ss(txPopup, '21-mint-approval');

        const popupText = await txPopup.locator('body').innerText().catch(() => '');
        console.log('  Popup text:', popupText.substring(0, 200));

        // OP_WALLET uses divs, not buttons. Click Sign/Confirm via JS.
        const signResult = await txPopup.evaluate(() => {
          const divs = document.querySelectorAll('div[style*="cursor: pointer"]');
          for (const el of divs) {
            const inner = el.querySelector('div');
            if (inner && /Sign|Confirm|Approve/i.test(inner.textContent.trim())) {
              el.click();
              return inner.textContent.trim();
            }
          }
          return 'not-found';
        });
        console.log('  Sign click:', signResult);
        if (signResult !== 'not-found') {
          await sleep(10000);
          console.log('  Transaction signed!');
        }
      } else {
        console.log('  No TX popup (wallet might not be connected)');
        // Check if connect wallet dialog appeared instead
        await ss(site, '21-mint-result');
      }
    }

    await site.bringToFront();
    await sleep(1000);
    await ss(site, '22-swap-done');
    console.log('  Swap done');
  } catch(e) {
    console.log('  Swap error:', e.message.substring(0, 100));
  }

  // --- Marketplace ---
  console.log('\n--- Marketplace: Browse tokens, fill order ---');
  try {
    await site.goto(SITE, { waitUntil: 'networkidle' });
    await sleep(1000);
    await site.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' }).click();
    await sleep(500);
    await site.locator('.nav-drop-item', { hasText: 'Market' }).click();
    await sleep(4000);

    // Click first token
    const tokenCard = site.locator('[role="listitem"]').first();
    if (await tokenCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tokenCard.scrollIntoViewIfNeeded();
      await tokenCard.click({ force: true });
      await sleep(3000);
      await ss(site, '30-orderbook');

      // Fill sell order
      const sellAmt = site.locator('[aria-label="Amount to sell"]');
      if (await sellAmt.isVisible({ timeout: 3000 }).catch(() => false)) {
        await sellAmt.fill('1000');
        const price = site.locator('[aria-label="Price in sats per token"]');
        if (await price.isVisible()) await price.fill('0.5');
        await ss(site, '31-sell-order');
        console.log('  Sell order filled');
      }

      // Switch to buy
      const buyBtn = site.locator('button', { hasText: /Buy Tokens/i });
      if (await buyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await buyBtn.click();
        await sleep(1000);
        await ss(site, '32-buy-mode');
        console.log('  Buy mode');
      }

      // Back
      const backBtn = site.locator('button', { hasText: /Back/i }).first();
      if (await backBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await backBtn.click();
        await sleep(2000);
        console.log('  Back to list');
      }
    }
    console.log('  Marketplace done');
  } catch(e) {
    console.log('  Market error:', e.message.substring(0, 100));
  }

  // --- Staking ---
  console.log('\n--- Staking: Enter amount ---');
  try {
    await site.goto(SITE, { waitUntil: 'networkidle' });
    await sleep(1000);
    await site.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' }).click();
    await sleep(500);
    await site.locator('.nav-drop-item', { hasText: 'Stake' }).click();
    await sleep(4000);
    await ss(site, '40-staking');

    const stakeInput = site.locator('input[type="number"], input[placeholder*="0"]').first();
    if (await stakeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await stakeInput.fill('1000');
      await ss(site, '41-stake-amount');
      console.log('  Entered 1000 MINE');
    }
    console.log('  Staking done');
  } catch(e) {
    console.log('  Staking error:', e.message.substring(0, 100));
  }

  // --- CrossChain ---
  console.log('\n--- CrossChain: Fill order form ---');
  try {
    await site.goto(SITE, { waitUntil: 'networkidle' });
    await sleep(1000);
    await site.locator('nav.nav-desktop button.Nt', { hasText: 'DeFi' }).click();
    await sleep(500);
    await site.locator('.nav-drop-item', { hasText: 'Cross-Chain' }).click();
    await sleep(4000);

    // Fill BTC amount
    const btcInput = site.locator('input[placeholder*="0.001"]').first();
    if (await btcInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btcInput.fill('0.001');
      console.log('  BTC amount: 0.001');
    }

    // Fill Fractal address
    const addrInput = site.locator('input[placeholder*="bc1p"]').first();
    if (await addrInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addrInput.fill('bc1ptestfractaladdress123');
      console.log('  Fractal address filled');
    }

    await ss(site, '50-crosschain');
    console.log('  CrossChain done');
  } catch(e) {
    console.log('  CrossChain error:', e.message.substring(0, 100));
  }

  // --- Token Explorer ---
  console.log('\n--- Token Explorer: Search, tabs ---');
  try {
    await site.goto(SITE, { waitUntil: 'networkidle' });
    await sleep(1000);
    await site.locator('nav.nav-desktop button.Nt', { hasText: 'Tokens' }).click();
    await sleep(500);
    await site.locator('.nav-drop-item', { hasText: 'Explorer' }).click();
    await sleep(4000);

    // Search
    const search = site.locator('input[placeholder*="Search"]').first();
    if (await search.isVisible({ timeout: 3000 }).catch(() => false)) {
      await search.fill('MINE');
      await sleep(1000);
      await ss(site, '60-token-search');
      console.log('  Searched MINE');
      await search.clear();
    }

    // Featured tab
    const featuredTab = site.locator('button', { hasText: 'Featured' });
    if (await featuredTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await featuredTab.click();
      await sleep(2000);
      await ss(site, '61-featured');
      console.log('  Featured tab');
    }

    console.log('  Token Explorer done');
  } catch(e) {
    console.log('  Explorer error:', e.message.substring(0, 100));
  }

  // ========== FINAL REPORT ==========
  console.log('\n========================================');
  console.log('=========== FINAL REPORT ==============');
  console.log('========================================');
  console.log(`Console errors: ${errors.length}`);
  for (const e of errors) {
    console.log(`  [${e.url.substring(0, 40)}] ${e.text.substring(0, 150)}`);
  }
  console.log(`Screenshots: ${SS_DIR}/`);
  console.log('Done!');

  browser.close();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
