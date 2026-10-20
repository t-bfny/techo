import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// The "/*" block of public/_headers (CSP etc.), so `vite preview` and the tests run under
// the same rules as the deployed site.
function siteHeaders() {
  const headers = {};
  let inAll = false;
  for (const line of readFileSync('public/_headers', 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { inAll = line.trim() === '/*'; continue; }
    const m = inAll && line.match(/^\s+([\w-]+):\s*(.*)$/);
    if (m) headers[m[1]] = m[2].trim();
  }
  return headers;
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  preview: { headers: siteHeaders() },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'techo',
        short_name: 'techo',
        lang: 'ja',
        start_url: '/',
        display: 'standalone',
        background_color: '#16171a',
        theme_color: '#16171a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
});
