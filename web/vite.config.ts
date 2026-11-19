import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };
import { ICON_FONT_URL } from "./src/ui/icons";

// GitHub Pages serves the site from /<repo>/; a relative base also works for local preview.
const base = process.env.VITE_BASE || "./";

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  server: { fs: { allow: [".."] } },
  optimizeDeps: { include: ["maplibre-gl"] },
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 900 },
  plugins: [
    {
      name: "kgp-icon-font",
      transformIndexHtml: (html) => html.replace("%KGP_ICON_FONT%", ICON_FONT_URL.replace(/&/g, "&amp;")),
    },
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png", "snapshots/*.jpg"],
      manifest: {
        name: "Карта городских проблем",
        short_name: "Карта проблем",
        lang: "ru",
        description: "Сообщайте о проблемах городской среды Красноярска",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f2f5f6",
        theme_color: "#0a6670",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,webmanifest}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // A new version takes over at once (the page reloads itself), instead of waiting until every tab is closed.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Only tiles the user has actually viewed get cached (OSM tile usage policy: no bulk prefetch).
            urlPattern: ({ url }) => /(^|\.)tile\.openstreetmap\.(org|de|fr)$/.test(url.hostname),
            handler: "CacheFirst",
            options: {
              cacheName: "kgp-tiles",
              expiration: { maxEntries: 1500, maxAgeSeconds: 14 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Vector map: the TileJSON, glyphs and tiles the user has viewed (no bulk prefetch).
            // The TileJSON points to the current dated tile set: always ask the network first.
            urlPattern: ({ url }) => url.hostname === "tiles.openfreemap.org" && url.pathname === "/planet",
            handler: "NetworkFirst",
            options: { cacheName: "kgp-vector-index", networkTimeoutSeconds: 5, expiration: { maxEntries: 2 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === "tiles.openfreemap.org" && url.pathname !== "/planet",
            handler: "CacheFirst",
            options: {
              cacheName: "kgp-vector",
              expiration: { maxEntries: 2500, maxAgeSeconds: 14 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === "api.open-meteo.com" || url.hostname === "air-quality-api.open-meteo.com",
            handler: "NetworkFirst",
            options: { cacheName: "kgp-weather", networkTimeoutSeconds: 6, expiration: { maxEntries: 6 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "kgp-fonts", expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
