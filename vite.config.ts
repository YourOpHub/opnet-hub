import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
    base: '/',
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
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('@btc-vision') || id.includes('opnet')) return 'opnet';
                        return 'vendor';
                    }
                },
            },
        },
    },
});
