import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read version from root package.json (falls back to client package.json)
const rootPkgPath = resolve(__dirname, '../package.json');
const localPkgPath = resolve(__dirname, 'package.json');
const pkg = JSON.parse(readFileSync(existsSync(rootPkgPath) ? rootPkgPath : localPkgPath, 'utf-8'));

const buildDate = new Date().toISOString().split('T')[0];

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version as string),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allow access from outside the container
    port: 5173,
  },
});
