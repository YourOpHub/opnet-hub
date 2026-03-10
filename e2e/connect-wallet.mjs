// Connect wallet via OP_WALLET extension - handles popup approval
import { chromium } from 'playwright';

const CDP_URL = 'http://localhost:9222';

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];

  // List all pages
  let pages = ctx.pages();
  console.log(`Pages: ${pages.length}`);
  for (const p of pages) console.log(`  ${p.url()}`);

  const sitePage = pages.find(p => p.url().includes('opnethub'));
  if (!sitePage) throw new Error('No site page');

  // Reload site to get fresh provider
  await sitePage.reload({ waitUntil: 'networkidle' });
  await sitePage.waitForTimeout(2000);

  const hasProvider = await sitePage.evaluate(() => !!window.opnet);
  console.log('Provider:', hasProvider);

  // Start requestAccounts (don't await - will resolve after popup approval)
  console.log('Triggering requestAccounts...');
  sitePage.evaluate(() => window.opnet.requestAccounts()).catch(() => {});

  // Poll for the notification popup
  console.log('Waiting for notification popup...');
  let popup = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    pages = ctx.pages();
    popup = pages.find(p => p.url().includes('notification'));
    if (popup) break;

    // Also try: maybe popup opened in a new window via extension API
    // Check via xdotool
    if (i === 5) {
      console.log(`  Still waiting... (${pages.length} pages)`);
    }
  }

  if (!popup) {
    // Try direct URL approach
    console.log('No popup detected via pages. Trying direct navigation...');
    popup = await ctx.newPage();
    await popup.goto('chrome-extension://dcbggdilciclhajiamaloohdajdkmcig/notification.html');
    await popup.waitForTimeout(3000);

    const text = await popup.locator('body').innerText().catch(() => '');
    console.log('Notification page text:', text.substring(0, 200));

    if (text.includes('Connect')) {
      // Click Connect
      await popup.locator('button', { hasText: 'Connect' }).last().click();
      console.log('Clicked Connect via direct navigation');
      await popup.waitForTimeout(3000);
    }
    await popup.close();
  } else {
    console.log('Found popup:', popup.url());
    await popup.waitForTimeout(2000);

    // Click Connect button
    const btns = popup.locator('button');
    const count = await btns.count();
    console.log(`Popup has ${count} buttons`);

    for (let i = 0; i < count; i++) {
      const text = await btns.nth(i).innerText();
      console.log(`  [${i}] "${text}"`);
      if (text.trim() === 'Connect') {
        await btns.nth(i).click();
        console.log('  => Clicked Connect!');
        break;
      }
    }
    await popup.waitForTimeout(3000);
  }

  // Check result
  await sitePage.bringToFront();
  await sitePage.waitForTimeout(2000);

  try {
    const accounts = await sitePage.evaluate(() =>
      window.opnet.getAccounts().catch(e => ({ error: e.message }))
    );
    console.log('Accounts:', JSON.stringify(accounts));
  } catch(e) {
    console.log('getAccounts error:', e.message);
  }

  try {
    const balance = await sitePage.evaluate(() =>
      window.opnet.getBalance().catch(e => ({ error: e.message }))
    );
    console.log('Balance:', JSON.stringify(balance));
  } catch(e) {
    console.log('getBalance error:', e.message);
  }

  // Reload and screenshot
  await sitePage.reload({ waitUntil: 'networkidle' });
  await sitePage.waitForTimeout(3000);
  await sitePage.screenshot({ path: '/tmp/e2e-screenshots/site-connected.png' });
  console.log('Screenshot saved');

  browser.close();
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
