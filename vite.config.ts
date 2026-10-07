import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (/\/node_modules\/(?:react|react-dom|scheduler)\//u.test(id)) return 'react-vendor';
          if (/\/node_modules\/(?:leaflet|react-leaflet|@react-leaflet\/core)\//u.test(id)) return 'map-vendor';
        },
      },
    },
  },
});
