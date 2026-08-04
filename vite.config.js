import { defineConfig } from 'vite';

export default defineConfig({
  root: 'gestor-academico/dist',
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: 'dist'
  }
});
