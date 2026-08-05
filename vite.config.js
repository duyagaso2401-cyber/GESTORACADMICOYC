import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5000,
    host: true
  },
  preview: {
    port: 5000,
    host: true,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});