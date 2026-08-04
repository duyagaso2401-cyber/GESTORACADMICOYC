import { defineConfig } from 'vite';

export default defineConfig({
  root: 'gestor-academico/dist',
  server: {
    port: 5000,
    host: true
  },
  preview: {
    host: true,
    allowedHosts: ['gestoracemicoyc.onrender.com', true]
  },
  build: {
    outDir: 'dist'
  }
});