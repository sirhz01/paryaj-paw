import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement, le serveur Vite (http://localhost:5173) relaie /api vers le back-end NestJS
// (http://localhost:3000) : pas de CORS à configurer. En production, le build est servi sur la même
// origine que l'API (ou derrière un reverse-proxy), donc /api/v1 fonctionne aussi tel quel.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
