import { defineConfig } from 'vite';

export default defineConfig({
  root: 'gestor-academico/dist',
  server: {
    port: 5000,
    host: true
  },
  build: {
    outDir: 'dist'
  }
});
