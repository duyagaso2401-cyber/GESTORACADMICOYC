import { defineConfig } from 'vite';

// En desarrollo: Vite (puerto 5000) proxía /api/* al servidor Express local (4173)
// En producción: Express sirve todo (dist/ + API)
const EXPRESS_DEV = 'http://localhost:4173';

export default defineConfig({
  server: {
    port: 5000,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: EXPRESS_DEV,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
