/**
 * bob-mcp.test.ts -- Tests for src/bob-mcp.ts
 *
 * Covers: initBob, searchKnowledge, getSkillDoc, getBtcMonitor,
 *         getContractAddresses, bobRpc, getDevDocs, getAuditInfo,
 *         getCliHelp, getSkillCatalog, getCryptoFrontendDocs, isConnected.
 *
 * All fetch calls are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let initBob: typeof import('../bob-mcp').initBob;
let searchKnowledge: typeof import('../bob-mcp').searchKnowledge;
let getSkillDoc: typeof import('../bob-mcp').getSkillDoc;
let getBtcMonitor: typeof import('../bob-mcp').getBtcMonitor;
let getContractAddresses: typeof import('../bob-mcp').getContractAddresses;
let bobRpc: typeof import('../bob-mcp').bobRpc;
let getDevDocs: typeof import('../bob-mcp').getDevDocs;
let getAuditInfo: typeof import('../bob-mcp').getAuditInfo;
let getCliHelp: typeof import('../bob-mcp').getCliHelp;
let getSkillCatalog: typeof import('../bob-mcp').getSkillCatalog;
let getCryptoFrontendDocs: typeof import('../bob-mcp').getCryptoFrontendDocs;
let isConnected: typeof import('../bob-mcp').isConnected;

describe('bob-mcp', () => {
  const mockFetch = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    vi.resetModules();

    // Mock window.location.hostname as localhost for dev proxy
    vi.stubGlobal('window', {
      location: { hostname: 'localhost' },
    });

    const mod = await import('../bob-mcp');
    initBob = mod.initBob;
    searchKnowledge = mod.searchKnowledge;
    getSkillDoc = mod.getSkillDoc;
    getBtcMonitor = mod.getBtcMonitor;
    getContractAddresses = mod.getContractAddresses;
    bobRpc = mod.bobRpc;
    getDevDocs = mod.getDevDocs;
    getAuditInfo = mod.getAuditInfo;
    getCliHelp = mod.getCliHelp;
    getSkillCatalog = mod.getSkillCatalog;
    getCryptoFrontendDocs = mod.getCryptoFrontendDocs;
    isConnected = mod.isConnected;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockInitResponse() {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: (name: string) => name === 'mcp-session-id' ? 'session-123' : null },
      text: () => Promise.resolve(JSON.stringify({
        result: { serverInfo: { name: 'Bob' } },
      })),
    });
  }

  function mockToolCallResponse(text: string) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify({
        result: { content: [{ text }] },
      })),
    });
  }

  // ---- isConnected ----
  describe('isConnected', () => {
    it('returns false before initialization', () => {
      expect(isConnected()).toBe(false);
    });

    it('returns true after successful initialization', async () => {
      mockInitResponse();
      await initBob();
      expect(isConnected()).toBe(true);
    });
  });

  // ---- initBob ----
  describe('initBob', () => {
    it('initializes successfully with server info', async () => {
      mockInitResponse();
      const result = await initBob();
      expect(result).toBe(true);
      expect(isConnected()).toBe(true);
    });

    it('returns true if already initialized', async () => {
      mockInitResponse();
      await initBob();
      const result = await initBob();
      expect(result).toBe(true);
      // Only one fetch call (no re-initialization)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns false when server info is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ result: {} })),
      });
      // Fallback also fails
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await initBob();
      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));
      // Fallback also fails
      mockFetch.mockRejectedValueOnce(new Error('also fail'));
      const result = await initBob();
      expect(result).toBe(false);
    });

    it('sends correct initialize parameters', async () => {
      mockInitResponse();
      await initBob();
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body);
      expect(body.method).toBe('initialize');
      expect(body.params.protocolVersion).toBe('2024-11-05');
      expect(body.params.clientInfo.name).toBe('opnet-hub');
    });

    it('uses /api/bob URL on localhost', async () => {
      mockInitResponse();
      await initBob();
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/bob',
        expect.any(Object),
      );
    });
  });

  // ---- searchKnowledge ----
  describe('searchKnowledge', () => {
    it('returns search result text', async () => {
      mockInitResponse();
      mockToolCallResponse('OPNet uses sha256 selectors');

      const result = await searchKnowledge('selectors');
      expect(result).toBe('OPNet uses sha256 selectors');
    });

    it('auto-initializes if not connected', async () => {
      mockInitResponse();
      mockToolCallResponse('answer text');

      const result = await searchKnowledge('test');
      expect(result).toBe('answer text');
      // Two calls: init + tools/call
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns null on failure', async () => {
      mockInitResponse();
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await searchKnowledge('test');
      expect(result).toBeNull();
    });

    it('returns null when init fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await searchKnowledge('test');
      expect(result).toBeNull();
    });
  });

  // ---- getSkillDoc ----
  describe('getSkillDoc', () => {
    it('returns skill documentation', async () => {
      mockInitResponse();
      mockToolCallResponse('Skill: deploy contract');

      const result = await getSkillDoc('deploy');
      expect(result).toBe('Skill: deploy contract');
    });

    it('returns null on failure', async () => {
      mockInitResponse();
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await getSkillDoc('unknown');
      expect(result).toBeNull();
    });
  });

  // ---- getBtcMonitor ----
  describe('getBtcMonitor', () => {
    it('returns BTC monitor data', async () => {
      mockInitResponse();
      mockToolCallResponse('BTC: $65,000');

      const result = await getBtcMonitor();
      expect(result).toBe('BTC: $65,000');
    });
  });

  // ---- getContractAddresses ----
  describe('getContractAddresses', () => {
    it('returns contract addresses', async () => {
      mockInitResponse();
      mockToolCallResponse('NativeSwap: opt1sqp3...');

      const result = await getContractAddresses();
      expect(result).toBe('NativeSwap: opt1sqp3...');
    });
  });

  // ---- bobRpc ----
  describe('bobRpc', () => {
    it('calls opnet_rpc tool with method and params', async () => {
      mockInitResponse();
      mockToolCallResponse('{"result": "0x100"}');

      const result = await bobRpc('btc_blockNumber', '[]');
      expect(result).toBe('{"result": "0x100"}');
    });

    it('returns null on failure', async () => {
      mockInitResponse();
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await bobRpc('btc_blockNumber');
      expect(result).toBeNull();
    });
  });

  // ---- getDevDocs ----
  describe('getDevDocs', () => {
    it('returns dev docs without section', async () => {
      mockInitResponse();
      mockToolCallResponse('OPNet development guide');

      const result = await getDevDocs();
      expect(result).toBe('OPNet development guide');
    });

    it('returns dev docs with section', async () => {
      mockInitResponse();
      mockToolCallResponse('Storage section info');

      const result = await getDevDocs('storage');
      expect(result).toBe('Storage section info');
    });
  });

  // ---- getAuditInfo ----
  describe('getAuditInfo', () => {
    it('returns audit info', async () => {
      mockInitResponse();
      mockToolCallResponse('Audit: CEI pattern required');

      const result = await getAuditInfo();
      expect(result).toBe('Audit: CEI pattern required');
    });
  });

  // ---- getCliHelp ----
  describe('getCliHelp', () => {
    it('returns CLI help', async () => {
      mockInitResponse();
      mockToolCallResponse('CLI: npx opnet compile');

      const result = await getCliHelp('compile');
      expect(result).toBe('CLI: npx opnet compile');
    });
  });

  // ---- getSkillCatalog ----
  describe('getSkillCatalog', () => {
    it('returns skill catalog', async () => {
      mockInitResponse();
      mockToolCallResponse('78 skills available');

      const result = await getSkillCatalog();
      expect(result).toBe('78 skills available');
    });
  });

  // ---- getCryptoFrontendDocs ----
  describe('getCryptoFrontendDocs', () => {
    it('returns crypto frontend docs', async () => {
      mockInitResponse();
      mockToolCallResponse('Design system: gradient cards...');

      const result = await getCryptoFrontendDocs();
      expect(result).toBe('Design system: gradient cards...');
    });
  });
});
