import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Served from the kiosk site at /app/ (see README: Deploy).
export default defineConfig({
    base: "/app/",
    server: { port: 5174 },
    plugins: [
        VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["favicon.svg"],
            manifest: {
                name: "RAISE",
                short_name: "RAISE",
                description: "Your RAISE Pass, points, receipts and shopping list.",
                theme_color: "#13211c",
                background_color: "#13211c",
                display: "standalone",
                start_url: "/app/",
                scope: "/app/",
                icons: [
                    { src: "icon-192.png", sizes: "192x192", type: "image/png" },
                    { src: "icon-512.png", sizes: "512x512", type: "image/png" },
                    { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
                ],
            },
            workbox: {
                globPatterns: ["**/*.{js,css,html,svg,png,wasm}"],
                maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
                navigateFallback: "/app/index.html",
            },
        }),
    ],
});
