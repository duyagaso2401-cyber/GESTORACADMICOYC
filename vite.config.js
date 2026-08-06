import { defineConfig } from 'vite';

const LEGACY_BACKEND = 'https://gestoracadmicoyc.onrender.com';

export default defineConfig({
  // Servidor de desarrollo local (npm run dev)
  server: {
    port: 5000,
    host: true,
    allowedHosts: true,
    // En dev, /api/inetis/* → backend legacy (eventos y notify aún no existen
    // allá, pero el error en dev es esperado; en prod lo maneja server.js).
    proxy: {
      '/api/inetis': {
        target: LEGACY_BACKEND,
        changeOrigin: true,
        secure: true,
      },
    },
  },
  // Build de producción → carpeta dist/
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
