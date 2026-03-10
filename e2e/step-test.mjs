// Step-by-step E2E test — full wallet + all actions on all pages
import { chromium } from 'playwright';
import fs from 'fs';

const CDP = 'http://localhost:9222';
const SS = '/tmp/e2e-screenshots';
const SITE = 'https://opnethub.xyz';

fs.mkdirSync(SS, { recursive: true });
const errors = [];
let step = 0;

async function ss(page, name) {
  const fname = `${String(++step).padStart(2,'0')}-${name}`;
  await page.screenshot({ path: `${SS}/${fname}.png`, fullPage: false });
  console.log(`  [${fname}]`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitPopup(ctx, match, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = ctx.pages().find(p => p.url().includes(match));
    if (p) return p;
    await sleep(500);
  }
  return null;
}

// Click a div-button in OP_WALLET popup (they use divs, not <button>)
async function clickOPWalletDiv(page, text) {
  return page.evaluate((txt) => {
    const els = document.querySelectorAll('div[style*="cursor: pointer"], div[style*="cursor:pointer"]');
    for (const el of els) {
      if (el.textContent.trim() === txt || el.querySelector('div')?.textContent?.trim() === txt) {
        el.click();
        return true;
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim() === txt) {
        let el = walker.currentNode.parentElement;
        while (el && !el.style?.cursor?.includes('pointer')) el = el.parentElement;
        if (el) { el.click(); return true; }
        walker.currentNode.parentElement.click();
        return true;
      }
    }
    return false;
  }, text);
}

// Sign TX in OP_WALLET popup — button text is "Sign"
async function signTX(ctx, txPopup, label) {
  await txPopup.waitForLoadState('networkidle').catch(() => {});
  await sleep(2000);
  await ss(txPopup, `${label}-tx-popup`);
  const txt = await txPopup.locator('body').innerText().catch(() => '');
  console.log(`TX popup [${label}]:`, txt.substring(0, 150));

  const signed = await clickOPWalletDiv(txPopup, 'Sign');
  console.log(`  Sign click: ${signed}`);
  if (!signed) {
    await txPopup.evaluate(() => {
      const all = [...document.querySelectorAll('div')];
      const d = all.find(d => d.textContent.trim() === 'Sign' && d.offsetHeight > 0);
      if (d) d.click();
    });
    console.log('  Fallback sign');
  }
  await sleep(10000);
}

// Navigate to a DeFi page via nav dropdown
async function navTo(site, menu, item) {
  await site.goto(SITE, { waitUntil: 'networkidle' });
  await sleep(1000);
  await site.locator('nav.nav-desktop button.Nt', { hasText: menu }).click();
  await sleep(600);
  await site.locator('.nav-drop-item').filter({ hasText: new RegExp(item, 'i') }).first().click();
  await sleep(4000);
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  let site = ctx.pages().find(p => p.url().includes('opnethub'));

  // Track errors
  site.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push({ page: site.url(), text: msg.text().substring(0, 300) });
    }
  });

  // ===== STEP 1: CONNECT WALLET =====
  console.log('\n=== STEP 1: CONNECT WALLET ===');
  await site.bringToFront();
  await site.reload({ waitUntil: 'networkidle' });
  await sleep(3000);

  const provider = await site.evaluate(() => !!window.opnet);
  console.log('Provider:', provider);

  // Set localStorage for auto-reconnect + call requestAccounts
  await site.evaluate(() => {
    localStorage.setItem('WC_SelectedWallet', 'OP_WALLET');
  });
  const reqPromise = site.evaluate(() =>
    window.opnet.requestAccounts().catch(e => ({ error: e.message }))
  ).catch(() => null);

  const popup = await waitPopup(ctx, 'notification', 8000);
  if (popup) {
    console.log('Approval popup appeared');
    await popup.waitForLoadState('networkidle').catch(() => {});
    await sleep(2000);
    await clickOPWalletDiv(popup, 'Connect');
    await sleep(3000);
    await site.bringToFront();
  }
  const accounts = await reqPromise;
  console.log('Accounts:', JSON.stringify(accounts));

  // Reload to trigger walletconnect auto-reconnect
  await site.reload({ waitUntil: 'networkidle' });
  await sleep(4000);

  // Check wallet connection status
  const walletBtn = await site.locator('header button').last().innerText().catch(() => '');
  console.log('Header button:', walletBtn);
  const isUIConnected = !walletBtn.includes('Connect');
  console.log('UI Connected:', isUIConnected);
  await ss(site, 'wallet-connected');

  // ===== STEP 2: STAKING (triggers UI wallet connection) =====
  console.log('\n=== STEP 2: STAKING ===');
  await navTo(site, 'DeFi', 'Stake');
  await ss(site, 'staking-page');

  const statsText = await site.locator('body').innerText().catch(() => '');
  const hasAPR = statsText.includes('APR');
  const hasLive = statsText.includes('Live on Testnet');
  console.log(`Stats: APR=${hasAPR}, Live=${hasLive}`);

  // Read current balances
  const balCards = await site.locator('.stat-card, .stat-num').allInnerTexts().catch(() => []);
  console.log('Balance cards:', balCards.join(' | '));

  // Enter stake amount
  const stakeInput = site.locator('input[type="number"], input[placeholder*="0"]').first();
  if (await stakeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await stakeInput.fill('100');
    await sleep(500);
    await ss(site, 'staking-amount');
    console.log('Stake amount: 100');

    const stakeBtn = site.locator('button', { hasText: /Stake MINE/i }).first();
    if (await stakeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('Clicking Stake MINE...');
      await stakeBtn.click();
      await sleep(3000);

      const txPopup = await waitPopup(ctx, 'notification', 10000);
      if (txPopup) {
        await signTX(ctx, txPopup, 'stake');
        await site.bringToFront();
        await sleep(3000);
        await ss(site, 'after-stake');
        console.log('Staking TX signed!');
      } else {
        await ss(site, 'stake-no-popup');
        console.log('No stake TX popup');
      }
    }
  }

  // After staking, wallet should be connected in UI — verify
  await sleep(2000);
  const walletBtnAfter = await site.locator('header button').last().innerText().catch(() => '');
  console.log('Header after stake:', walletBtnAfter);

  // ===== STEP 3: SWAP + MINT =====
  console.log('\n=== STEP 3: SWAP + MINT ===');
  await navTo(site, 'DeFi', 'Swap');
  await ss(site, 'swap-page');

  // Check if wallet connected on swap page
  const swapBtnText = await site.locator('.swap-action-btn, button.lbtn').first().innerText().catch(() => '');
  console.log('Swap action button:', swapBtnText);

  // Enter amount
  const swapAmt = site.locator('[aria-label*="Amount"]').first();
  if (await swapAmt.isVisible({ timeout: 3000 }).catch(() => false)) {
    await swapAmt.fill('100');
    console.log('Amount: 100');
    await sleep(1000);
    await ss(site, 'swap-amount-entered');
  }

  // Flip direction
  const flipBtn = site.locator('[aria-label="Swap token direction"]');
  if (await flipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await flipBtn.click();
    await sleep(500);
    console.log('Flipped');
    await ss(site, 'swap-flipped');
  }

  // Slippage
  const slipBtn = site.locator('[aria-label*="Slippage"]').first();
  if (await slipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await slipBtn.click();
    await sleep(500);
    const slipOptions = site.locator('.slip-btn');
    if (await slipOptions.first().isVisible({ timeout: 1000 }).catch(() => false)) {
      await slipOptions.nth(1).click();
      console.log('Set slippage');
    }
    await ss(site, 'swap-slippage');
  }

  // Pools tab
  const poolsTab = site.locator('.max-w-560 button', { hasText: 'Pools' });
  if (await poolsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await poolsTab.click();
    await sleep(2000);
    await ss(site, 'swap-pools');
    console.log('Pools tab');
    await site.locator('.max-w-560 button', { hasText: 'Swap' }).click();
    await sleep(1000);
  }

  // Liquidity modal
  const liqBtn = site.locator('[aria-label="Toggle liquidity panel"]');
  if (await liqBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await liqBtn.click();
    await sleep(1500);
    await ss(site, 'swap-liquidity');
    console.log('Liquidity panel');
    const closeX = site.locator('.liq-card button, .liq-overlay [aria-label="Close"]').first();
    if (await closeX.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeX.click();
    } else {
      await site.keyboard.press('Escape');
    }
    await sleep(500);
  }

  // Mint 1K MINE
  const mintBtn = site.locator('button', { hasText: '1K MINE' });
  if (await mintBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Clicking 1K MINE...');
    await mintBtn.click();
    await sleep(3000);

    const txPopup = await waitPopup(ctx, 'notification', 12000);
    if (txPopup) {
      await signTX(ctx, txPopup, 'mint-mine');
      await site.bringToFront();
      await sleep(3000);
      await ss(site, 'after-mint-mine');
      console.log('MINE mint signed!');
    } else {
      console.log('No mint TX popup');
      await ss(site, 'mint-no-popup');
    }
  }

  // Mint 1K VIBE
  const mintVibe = site.locator('button', { hasText: '1K VIBE' });
  if (await mintVibe.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Clicking 1K VIBE...');
    await mintVibe.click();
    await sleep(3000);

    const txPopup = await waitPopup(ctx, 'notification', 12000);
    if (txPopup) {
      await signTX(ctx, txPopup, 'mint-vibe');
      await site.bringToFront();
      await sleep(3000);
      await ss(site, 'after-mint-vibe');
      console.log('VIBE mint signed!');
    } else {
      console.log('No VIBE mint TX popup');
    }
  }

  // ===== STEP 4: MARKETPLACE =====
  console.log('\n=== STEP 4: MARKETPLACE ===');
  await navTo(site, 'DeFi', 'Market');
  await ss(site, 'market-list');

  // Search
  const search = site.locator('input[placeholder*="Search"]').first();
  if (await search.isVisible({ timeout: 3000 }).catch(() => false)) {
    await search.fill('MINE');
    await sleep(1500);
    await ss(site, 'market-search');
    console.log('Searched MINE');
    await search.clear();
    await sleep(1000);
  }

  // Click MINE token
  const mineCard = site.locator('[role="listitem"]').first();
  if (await mineCard.isVisible({ timeout: 3000 }).catch(() => false)) {
    await mineCard.scrollIntoViewIfNeeded();
    await mineCard.click({ force: true });
    await sleep(3000);
    await ss(site, 'market-orderbook');
    console.log('Orderbook opened');

    // Check if Create Order button visible (means wallet connected)
    const sellAmt = site.locator('[aria-label="Amount to sell"]');
    if (await sellAmt.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sellAmt.fill('100000');
      const price = site.locator('[aria-label="Price in sats per token"]');
      if (await price.isVisible()) await price.fill('0.5');
      await sleep(500);
      await ss(site, 'market-sell-filled');
      console.log('Sell order: 100K at 0.5 sats');

      const submitBtn = site.locator('button.lbtn, button', { hasText: /Place Sell Order|Create Order|Connect Wallet|Submit/i }).first();
      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        const btnText = await submitBtn.innerText();
        console.log(`Order button: "${btnText}"`);

        if (btnText.includes('Place Sell Order') || btnText.includes('Create Order')) {
          await submitBtn.click();
          await sleep(3000);
          const txPopup = await waitPopup(ctx, 'notification', 10000);
          if (txPopup) {
            await signTX(ctx, txPopup, 'sell-order');
            await site.bringToFront();
            await sleep(3000);
            await ss(site, 'market-sell-result');
            console.log('Sell order TX signed!');
          }
        }
      }
    }

    // Switch to Buy
    const buyToggle = site.locator('button', { hasText: /Buy Tokens/i });
    if (await buyToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await buyToggle.click();
      await sleep(1000);
      await ss(site, 'market-buy-mode');
      console.log('Buy mode');

      const buyAmt = site.locator('[aria-label="Amount you want"]');
      if (await buyAmt.isVisible({ timeout: 2000 }).catch(() => false)) {
        await buyAmt.fill('50000');
        await sleep(500);
        await ss(site, 'market-buy-filled');
        console.log('Buy amount: 50K');
      }
    }

    // Back to list
    const backBtn = site.locator('button', { hasText: /Back/i }).first();
    if (await backBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await backBtn.click();
      await sleep(2000);
      console.log('Back to token list');
    }
  }

  // ===== STEP 5: CROSSCHAIN (FractalSwap) =====
  console.log('\n=== STEP 5: CROSSCHAIN ===');
  await navTo(site, 'DeFi', 'Cross');
  await ss(site, 'crosschain-page');

  // Stats
  const ccStats = await site.locator('body').innerText().catch(() => '');
  const activeOrders = ccStats.match(/ACTIVE ORDERS[^\d]*(\d+)/i);
  const volume = ccStats.match(/TOTAL VOLUME[^\d]*([\d.]+\s*BTC)/i);
  if (activeOrders) console.log(`Active Orders: ${activeOrders[1]}`);
  if (volume) console.log(`Volume: ${volume[1]}`);

  // Fill form
  const allInputs = site.locator('input');
  const inputCount = await allInputs.count();
  console.log(`Inputs: ${inputCount}`);
  if (inputCount >= 2) {
    await allInputs.nth(0).fill('0.001');
    console.log('BTC: 0.001');
  }
  if (inputCount >= 3) {
    await allInputs.nth(2).fill('bc1ptestfractaladdr');
    console.log('Fractal address set');
  }
  await ss(site, 'crosschain-filled');

  // Toggle direction
  const fbToggle = site.locator('button', { hasText: /I have FB, want BTC/i });
  if (await fbToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
    await fbToggle.click();
    await sleep(1000);
    await ss(site, 'crosschain-fb-mode');
    console.log('Switched to FB→BTC');
  }

  // Connect OPWallet
  const connectOP = site.locator('button', { hasText: /Connect OPWallet/i });
  if (await connectOP.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Clicking Connect OPWallet...');
    await connectOP.click();
    await sleep(3000);
    const ccPopup = await waitPopup(ctx, 'notification', 10000);
    if (ccPopup) {
      await ccPopup.waitForLoadState('networkidle').catch(() => {});
      await sleep(2000);
      await clickOPWalletDiv(ccPopup, 'Connect');
      await sleep(3000);
    }
    await site.bringToFront();
    await sleep(2000);
    await ss(site, 'crosschain-after-connect');
  }

  // ===== STEP 6: TOKEN EXPLORER =====
  console.log('\n=== STEP 6: TOKEN EXPLORER ===');
  await navTo(site, 'Tokens', 'Explorer');
  await ss(site, 'explorer-page');

  // Search
  const expSearch = site.locator('input[placeholder*="Search"]').first();
  if (await expSearch.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expSearch.fill('MINE');
    await sleep(1500);
    await ss(site, 'explorer-search');
    console.log('Searched MINE');
    await expSearch.clear();
    await sleep(500);
  }

  // Featured tab
  const featTab = site.locator('button', { hasText: 'Featured' });
  if (await featTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await featTab.click();
    await sleep(2000);
    await ss(site, 'explorer-featured');
    console.log('Featured tab');
  }

  // My tokens
  const myTab = site.locator('button', { hasText: /My/ });
  if (await myTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await myTab.click();
    await sleep(2000);
    await ss(site, 'explorer-my-tokens');
    console.log('My tokens');
  }

  // Sort: Holders
  const allTab = site.locator('button', { hasText: /All Tokens/i });
  if (await allTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await allTab.click();
    await sleep(2000);
    const holdersSort = site.locator('button', { hasText: 'Holders' });
    if (await holdersSort.isVisible({ timeout: 2000 }).catch(() => false)) {
      await holdersSort.click();
      await sleep(2000);
      await ss(site, 'explorer-sorted');
      console.log('Sorted by Holders');
    }
  }

  // ===== STEP 7: TOKEN TOOLS + FAUCET MINT =====
  console.log('\n=== STEP 7: TOKEN TOOLS ===');
  await navTo(site, 'Tokens', 'Tools');
  await ss(site, 'tools-page');

  // Converter
  const btcAmtInput = site.locator('[aria-label="BTC amount"]');
  if (await btcAmtInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btcAmtInput.fill('1');
    await sleep(500);
    await ss(site, 'tools-converter');
    console.log('Converter: 1 BTC');
  }

  // Faucet
  const faucetTab = site.locator('[role="tab"]', { hasText: /Faucet/i });
  if (await faucetTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await faucetTab.click();
    await sleep(2000);
    await ss(site, 'tools-faucet');

    const faucetBtn = site.locator('button', { hasText: /Mint.*MINE/i }).first();
    if (await faucetBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const txt = await faucetBtn.innerText();
      console.log(`Faucet button: "${txt}"`);

      // Click to mint from faucet
      console.log('Clicking Faucet Mint...');
      await faucetBtn.click();
      await sleep(3000);

      const txPopup = await waitPopup(ctx, 'notification', 12000);
      if (txPopup) {
        await signTX(ctx, txPopup, 'faucet-mint');
        await site.bringToFront();
        await sleep(3000);
        await ss(site, 'after-faucet-mint');
        console.log('Faucet MINE mint signed!');
      } else {
        console.log('No faucet TX popup');
        await ss(site, 'faucet-no-popup');
      }
    }
  }

  // UTXO
  const utxoTab = site.locator('[role="tab"]', { hasText: /UTXO/i }).first();
  if (await utxoTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await utxoTab.click();
    await sleep(2000);
    await ss(site, 'tools-utxo');
    console.log('UTXO tab');

    const addrInput = site.locator('[aria-label="Bitcoin or OPNet address"]');
    if (await addrInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addrInput.fill('opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my');
      await sleep(500);
      await ss(site, 'tools-utxo-addr');
      console.log('UTXO address entered');
    }
  }

  // ===== STEP 8: LAUNCHPAD =====
  console.log('\n=== STEP 8: LAUNCHPAD ===');
  await navTo(site, 'Tokens', 'Launchpad');
  await ss(site, 'launchpad-page');

  const deployBtn = site.locator('button', { hasText: /Deploy/i }).first();
  if (await deployBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Deploy button visible');
    await deployBtn.click();
    await sleep(2000);
    await ss(site, 'launchpad-deploy-form');
    console.log('Deploy form opened');
  }

  const mineToken = site.locator('text=MINE').first();
  if (await mineToken.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('MINE listed on Launchpad');
  }

  // ===== FINAL REPORT =====
  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║       FULL E2E TEST REPORT            ║');
  console.log('╠═══════════════════════════════════════╣');
  console.log(`║ Console errors:  ${String(errors.length).padStart(3)}                  ║`);
  console.log(`║ Screenshots:     ${String(step).padStart(3)}                  ║`);
  console.log('╚═══════════════════════════════════════╝');

  if (errors.length > 0) {
    console.log('\nConsole errors:');
    for (const e of errors) {
      console.log(`  [${e.page.substring(0, 40)}]`);
      console.log(`    ${e.text.substring(0, 200)}`);
    }
  }

  console.log(`\nScreenshots saved: ${SS}/`);
  console.log('Test complete!');
  browser.close();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
