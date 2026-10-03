import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { allowAdminPreview } from './scripts/admin-preview-policy.mjs'
import { allowV2Preview } from './scripts/v2-preview-policy.mjs'
import { isolatedBuildOutput } from './scripts/isolated-build-output.mjs'

export default defineConfig(({ command }) => ({
  define: { __QCLUB_ADMIN_PREVIEW__: JSON.stringify(allowAdminPreview(process.env, command)), __QCLUB_V2_PREVIEW__: JSON.stringify(allowV2Preview(process.env, command)) },
  plugins: [
    isolatedBuildOutput({ adminPreview: allowAdminPreview(process.env, command), v2Preview: allowV2Preview(process.env, command) }),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [
          /^\/__checkout-preview(?:\/|$)/,
          /^\/__admin-preview(?:\/|$)/,
          /^\/api\/qclub-security(?:\/|$)/,
          /^\/QclubLedger(?:\/|$)/i,
          /^\/QclubPay(?:\/|$)/i,
          /^\/QclubQr(?:\/|$)/i,
          /^\/api\/snooker\/v1(?:\/|$)/i,
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/snooker/v1/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      includeAssets: [
        'apple-touch-icon.png',
        'maskable-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        'music.mp3'
      ],
      manifest: {
        name: 'The Q CLUB',
        short_name: 'Q CLUB',
        description: 'Pasighat • Play. Chill. Compete.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0b1020',
        theme_color: '#0b1020',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],

  // Avoid retaining preview output in production/PWA bundles.
  build: { emptyOutDir: true },
  server: {
    host: true,
    port: 5173
  }
}))
