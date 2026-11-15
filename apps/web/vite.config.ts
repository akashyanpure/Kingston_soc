import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * HTTPS=1 pnpm --filter @soc/web dev  → self-signed HTTPS so phones on the LAN get a
 * secure context (camera via getUserMedia, crypto.subtle). Without it the app still
 * works on a phone: photos fall back to <input capture> and hashing to pure-JS SHA-256.
 */
const https = process.env.HTTPS === '1';
const apiTarget = process.env.API_URL ?? 'http://localhost:4000';

const plugins: PluginOption[] = [
  react(),
  VitePWA({
    registerType: 'autoUpdate',
    injectRegister: false, // registered in src/main.tsx
    includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
    manifest: {
      name: 'Kingston SOC',
      short_name: 'Kingston SOC',
      description: 'Schedule of Condition and inventory for Private Sector Schemes officers.',
      theme_color: '#faf6ee',
      background_color: '#faf6ee',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      scope: '/',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
  }),
];
if (https) plugins.push(basicSsl());

export default defineConfig({
  plugins,
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  preview: {
    host: true,
    port: 4173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 700 },
});
