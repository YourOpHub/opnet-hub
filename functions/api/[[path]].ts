/**
 * Cloudflare Pages Function — proxies /api/* to VPS backend.
 * Hides the VPS IP from browser (never appears in JS bundle).
 */
const VPS_ORIGIN = 'https://188-137-250-160.sslip.io';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const target = `${VPS_ORIGIN}${url.pathname}${url.search}`;

  const headers = new Headers(context.request.headers);
  headers.set('Host', '188-137-250-160.sslip.io');
  headers.delete('cookie');

  const resp = await fetch(target, {
    method: context.request.method,
    headers,
    body: context.request.method !== 'GET' && context.request.method !== 'HEAD'
      ? context.request.body
      : undefined,
  });

  const respHeaders = new Headers(resp.headers);
  respHeaders.set('Access-Control-Allow-Origin', '*');
  respHeaders.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  respHeaders.set('Access-Control-Allow-Headers', 'Content-Type,Mcp-Session-Id');

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: respHeaders });
  }

  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  });
};
