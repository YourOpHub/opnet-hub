import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import type { UserConfig } from 'vitest/config';

// Base path: '/' for dev/preview, '/opnet-hub/' for GitHub Pages prod
const base = process.env.VITE_BASE || '/';

export default defineConfig({
    base,
    plugins: [
        nodePolyfills({
            globals: { Buffer: true, global: true, process: true },
            overrides: { crypto: 'crypto-browserify' },
        }),
        react(),
    ],
    resolve: {
        alias: {
            global: 'global',
        },
        dedupe: ['@noble/hashes', '@noble/curves', '@scure/base', '@scure/bip32', '@scure/bip39'],
    },
    optimizeDeps: {
        exclude: ['crypto-browserify'],
    },
    server: {
        port: 3000,
        open: true,
        proxy: {
            '/api/bob': {
                target: 'https://ai.opnet.org',
                changeOrigin: true,
                rewrite: (path: string) => path.replace(/^\/api\/bob/, '/mcp'),
                secure: true,
            },
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/__tests__/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/__tests__/**', 'src/vite-env.d.ts'],
            thresholds: {
                // 1556+ tests covering core utilities, hooks, and components
                lines: 20,
                branches: 14,
                functions: 20,
                statements: 20,
            },
        },
    } satisfies UserConfig['test'],
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom'],
                    'vendor-opnet-core': ['opnet'],
                    'vendor-btc': ['@btc-vision/bitcoin', '@btc-vision/transaction'],
                },
            },
        },
    },
});
