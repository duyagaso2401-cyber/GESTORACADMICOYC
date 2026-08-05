import { defineConfig } from 'vite';

export default defineConfig({
  // Servidor de desarrollo local (npm run dev)
  server: {
    port: 5000,
    host: true,
    allowedHosts: true,
  },
  // Build de producción → carpeta dist/
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  // preview usa el puerto que llegue por CLI (--port $PORT en Render)
  // No se fija aquí para no colisionar con la variable de entorno
});
