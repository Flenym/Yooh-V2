import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/playmode/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/playmode-api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/playmode-api/, '/api')
      },
      '/playmode-socket': {
        target: 'http://127.0.0.1:4000',
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/playmode-socket/, '/socket.io'),
        configure: (proxy) => {
          proxy.on('error', (err) => {
            const code = String(err?.code || '');
            if (code === 'ECONNABORTED' || code === 'ECONNRESET' || code === 'EPIPE') return;
            // eslint-disable-next-line no-console
            console.error('[vite ws-proxy]', err?.message || err);
          });
        }
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true
  },
  define: {
    global: 'globalThis'
  }
});
