import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
    plugins: [react(), nodePolyfills()],
    resolve: {
        alias: {
            global: "global",
        },
    },
    server: {
        port: 5173,
        open: true,
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("node_modules")) {
                        return "vendor";
                    }
                },
            },
        },
    },
});
