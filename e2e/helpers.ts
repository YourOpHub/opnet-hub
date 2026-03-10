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
