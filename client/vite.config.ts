import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The ingest monitor and the virtual office are independent entry points
 * (`ingestmonitor.html`, `office.html`) rather than routes inside the terminal
 * app. This serves them at their extensionless paths in dev; the Node server
 * does the same for the built files.
 */
function extraEntryRoutes(): Plugin {
  const routes: Record<string, string> = {
    '/ingestmonitor': '/ingestmonitor.html',
    '/office': '/office.html',
  };

  return {
    name: 'as500-extra-entry-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? '').split('?');
        const target = routes[path.replace(/\/$/, '')];
        if (target) {
          req.url = `${target}${query ? `?${query}` : ''}`;
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
  plugins: [react(), extraEntryRoutes()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ingestmonitor: resolve(__dirname, 'ingestmonitor.html'),
        office: resolve(__dirname, 'office.html'),
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
