import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The ingest monitor is a second, independent entry point (`ingestmonitor.html`)
 * rather than a route inside the terminal app. This serves it at the extensionless
 * path `/ingestmonitor` in dev; the Node server does the same for the built file.
 */
function ingestMonitorRoute(): Plugin {
  return {
    name: 'as500-ingestmonitor-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? '').split('?');
        if (path === '/ingestmonitor' || path === '/ingestmonitor/') {
          req.url = `/ingestmonitor.html${query ? `?${query}` : ''}`;
        }
        next();
      });
    },
  };
}

// Read version from root package.json (falls back to client package.json)
let pkg: { version: string };
try {
  pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));
} catch {
  pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
}

const buildDate = new Date().toISOString().split('T')[0];

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [react(), ingestMonitorRoute()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ingestmonitor: resolve(__dirname, 'ingestmonitor.html'),
      },
    },
  },
  server: {
    host: '0.0.0.0', // Allow access from outside the container
    port: 5173,
    watch: {
      // Docker volumes on Windows don't propagate native FS events into the
      // container, so Vite must poll for changes instead.
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/api/documents/upload': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      '/docs-images': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const session = req.headers['x-as500-session'];
            if (typeof session === 'string' && session.trim()) {
              proxyReq.setHeader('X-AS500-Session', session.trim());
            }
          });
        },
      },
      '/docs-pages': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const session = req.headers['x-as500-session'];
            if (typeof session === 'string' && session.trim()) {
              proxyReq.setHeader('X-AS500-Session', session.trim());
            }
          });
        },
      },
    },
  },
});
