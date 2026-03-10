/**
 * logger.test.ts -- Tests for src/logger.ts
 *
 * Covers: logger.debug, logger.info, logger.warn, logger.error
 * with environment-aware filtering (DEV vs PROD).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('logger', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('in dev mode (import.meta.env.DEV = true)', () => {
    let logger: typeof import('../logger').logger;

    beforeEach(async () => {
      // Vitest runs in test mode where DEV is true
      const mod = await import('../logger');
      logger = mod.logger;
    });

    it('logger.warn always calls console.warn', () => {
      logger.warn('warning message', 42);
      expect(consoleWarnSpy).toHaveBeenCalledWith('warning message', 42);
    });

    it('logger.error always calls console.error', () => {
      logger.error('error message', new Error('test'));
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message', expect.any(Error));
    });

    it('logger.warn with no arguments', () => {
      logger.warn();
      expect(consoleWarnSpy).toHaveBeenCalledWith();
    });

    it('logger.error with no arguments', () => {
      logger.error();
      expect(consoleErrorSpy).toHaveBeenCalledWith();
    });

    it('logger.warn passes multiple arguments', () => {
      logger.warn('a', 'b', 'c', 1, 2, 3);
      expect(consoleWarnSpy).toHaveBeenCalledWith('a', 'b', 'c', 1, 2, 3);
    });

    it('logger.error passes multiple arguments', () => {
      logger.error('err1', 'err2', { detail: 'info' });
      expect(consoleErrorSpy).toHaveBeenCalledWith('err1', 'err2', { detail: 'info' });
    });
  });

  describe('logger exports', () => {
    it('exports logger as named and default export', async () => {
      const mod = await import('../logger');
      expect(mod.logger).toBeDefined();
      expect(mod.default).toBeDefined();
      expect(mod.logger).toBe(mod.default);
    });

    it('logger has all four methods', async () => {
      const mod = await import('../logger');
      expect(typeof mod.logger.debug).toBe('function');
      expect(typeof mod.logger.info).toBe('function');
      expect(typeof mod.logger.warn).toBe('function');
      expect(typeof mod.logger.error).toBe('function');
    });
  });
});
