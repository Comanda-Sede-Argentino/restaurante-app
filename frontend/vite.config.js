import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Sello de versión (fecha/hora de compilación), para ver en la app si es la última
  define: {
    __BUILD__: JSON.stringify(new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
