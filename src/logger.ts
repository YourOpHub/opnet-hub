/**
 * Centralized logger — wraps console methods with environment-aware filtering.
 * In production builds (import.meta.env.PROD), only warn/error are emitted.
 * In development, all levels are active.
 */

const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

export const logger = {
  debug(...args: unknown[]): void {
    if (isDev) console.debug(...args);
  },
  info(...args: unknown[]): void {
    if (isDev) console.info(...args);
  },
  warn(...args: unknown[]): void {
    console.warn(...args);
  },
  error(...args: unknown[]): void {
    console.error(...args);
  },
};

export default logger;
