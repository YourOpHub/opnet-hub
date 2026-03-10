import { type Page } from '@playwright/test';

/** Mock all external API calls so E2E tests run offline and fast. */
export async function mockAPIs(page: Page): Promise<void> {
  // OPNet JSON-RPC
  await page.route('**/api/v1/json-rpc', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: null }) }),
  );

  // Binance price API
  await page.route('**/api.binance.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ price: '100000.00' }),
    }),
  );

  // Kraken price API
  await page.route('**/api.kraken.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: { XXBTZUSD: { c: ['100000.0'] } } }),
    }),
  );

  // Backend VPS API
  await page.route('**/188-137-250-160.sslip.io/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  // Bob AI proxy
  await page.route('**/api/bob/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

/** Mock marketplace token list API for P2P Market tests. */
export async function mockMarketplaceTokens(page: Page): Promise<void> {
  // Market tokens endpoint — return MINE and VIBE as available tokens
  await page.route('**/market/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

/** Mock token indexer API for TokenGallery tests. */
export async function mockTokenAPI(page: Page): Promise<void> {
  await page.route('**/api/tokens**', (route) => {
    const url = route.request().url();
    if (url.includes('/status')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 2, indexed: 2 }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          address: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
          symbol: 'MINE',
          name: 'Mine Token',
          decimals: 8,
          holders: 150,
          mintable: true,
          blockHeight: 1000,
        },
        {
          address: 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl',
          symbol: 'VIBE',
          name: 'Vibe Token',
          decimals: 8,
          holders: 120,
          mintable: true,
          blockHeight: 1001,
        },
      ]),
    });
  });
}
