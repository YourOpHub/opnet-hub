/**
 * Bob MCP Client — connects to ai.opnet.org MCP server
 * Uses Vite proxy in dev (/api/bob → ai.opnet.org/mcp)
 * Falls back to direct URL in production (may fail due to CORS)
 */

const MCP_URL = '/api/bob';
const DIRECT_URL = 'https://ai.opnet.org/mcp';

let sessionId: string | null = null;
let initialized = false;

function getUrl(): string {
  // In dev, use proxy; in production, try direct
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return MCP_URL;
  }
  return DIRECT_URL;
}

function parseSSE(text: string): unknown | null {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        return JSON.parse(line.slice(6));
      } catch { /* not valid JSON */ }
    }
  }
  // Try parsing as direct JSON
  try { return JSON.parse(text); } catch { return null; }
}

async function mcpCall(method: string, params?: Record<string, unknown>, id?: number): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const res = await fetch(getUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: id ?? Date.now() }),
  });

  // Capture session ID from response
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  const text = await res.text();
  const parsed = parseSSE(text);
  if (!parsed) throw new Error('Failed to parse MCP response');
  return parsed;
}

export async function initBob(): Promise<boolean> {
  if (initialized) return true;
  try {
    const res = await mcpCall('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'opnet-hub', version: '1.0.0' },
    }, 1) as { result?: { serverInfo?: { name: string } } };
    initialized = !!res?.result?.serverInfo;
    return initialized;
  } catch (e) {
    console.warn('[Bob MCP] Init failed:', e);
    return false;
  }
}

export async function searchKnowledge(query: string): Promise<string | null> {
  if (!initialized) {
    const ok = await initBob();
    if (!ok) return null;
  }
  try {
    const res = await mcpCall('tools/call', {
      name: 'opnet_knowledge_search',
      arguments: { query },
    }) as { result?: { content?: Array<{ text?: string }> } };
    const text = res?.result?.content?.[0]?.text;
    return text || null;
  } catch (e) {
    console.warn('[Bob MCP] Knowledge search failed:', e);
    return null;
  }
}

export async function getSkillDoc(skillName: string): Promise<string | null> {
  if (!initialized) {
    const ok = await initBob();
    if (!ok) return null;
  }
  try {
    const res = await mcpCall('tools/call', {
      name: 'opnet_skill_doc',
      arguments: { skill_name: skillName },
    }) as { result?: { content?: Array<{ text?: string }> } };
    return res?.result?.content?.[0]?.text || null;
  } catch (e) {
    console.warn('[Bob MCP] Skill doc failed:', e);
    return null;
  }
}

export async function getBtcMonitor(): Promise<string | null> {
  if (!initialized) {
    const ok = await initBob();
    if (!ok) return null;
  }
  try {
    const res = await mcpCall('tools/call', {
      name: 'opnet_btc_monitor',
      arguments: {},
    }) as { result?: { content?: Array<{ text?: string }> } };
    return res?.result?.content?.[0]?.text || null;
  } catch (e) {
    console.warn('[Bob MCP] BTC monitor failed:', e);
    return null;
  }
}

export function isConnected(): boolean {
  return initialized;
}
