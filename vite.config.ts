import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// Baked into the bundle so a running client knows which build it IS. The server reports which
// build it is serving at /api/version, and the difference is what raises the update prompt.
// Falls back to a dev stamp when build-info.json has not been generated (plain `vite dev`).
function buildInfo(): { buildId: string; buildTime: number } {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, 'build-info.json'), 'utf8');
    const parsed = JSON.parse(raw) as { buildId: string; buildTime: number };
    return { buildId: parsed.buildId, buildTime: parsed.buildTime };
  } catch {
    return { buildId: 'dev', buildTime: 0 };
  }
}

const info = buildInfo();

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(info.buildId),
    __BUILD_TIME__: JSON.stringify(info.buildTime),
  },
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
