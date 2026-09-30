import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const buildHash = env.VITE_BUILD_HASH ?? process.env.GITHUB_SHA ?? 'local';

  return {
    define: {
      'import.meta.env.VITE_BUILD_HASH': JSON.stringify(buildHash),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        manifest: {
          name: 'Beth Menahem — Écran communautaire',
          short_name: 'Beth Menahem',
          description: 'Écran communautaire de Beth Menahem, Paris 19e.',
          start_url: '/display',
          scope: '/',
          display: 'fullscreen',
          background_color: '#f3eee3',
          theme_color: '#fbf7ef',
        },
        workbox: {
          globPatterns: ['**/*.{css,html,js,png,svg,woff,woff2}'],
          navigateFallback: 'index.html',
          navigateFallbackAllowlist: [/^\/$/, /^\/display(?:\/|$)/, /^\/admin(?:\/|$)/],
          navigateFallbackDenylist: [/^\/(?:rest|functions)\/v1\//],
          runtimeCaching: [],
        },
      }),
    ],
  };
});
