import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // libraries change rarely: keeping them in their own files means a phone re-downloads only the app code after an update
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          if (id.includes('@supabase') || id.includes('node_modules/ws/')) return 'vendor-supabase';
          if (id.includes('lucide-react')) return 'vendor-icons';
          return undefined; // jspdf, pdf.js, OCR stay lazy (downloaded only when used)
        },
      },
    },
  },
});
