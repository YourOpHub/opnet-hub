import '@testing-library/jest-dom/vitest';

// Polyfill IntersectionObserver for jsdom
if (typeof IntersectionObserver === 'undefined') {
  // @ts-expect-error polyfill for jsdom
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor(public callback: IntersectionObserverCallback) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
