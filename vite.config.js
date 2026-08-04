import { defineConfig } from 'vite';

export default defineConfig({
  //root: 'gestor-academico/dist',
  server: {
    port: 5000,
    host: true
  },
  preview: {
    port: 5000,
    host: true,
    //allowedHosts: ['gestoracadmicoyc.onrender.com', true]
    allowedHosts: true,
  },
  build: {
    outDir: 'dist'
    emptyOutDir: true
  }
});