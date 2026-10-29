import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function excludePlanningAssetsPlugin(): Plugin {
  return {
    name: 'exclude-planning-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (
          url &&
          (url === '/assets/aistudio' ||
            url.startsWith('/assets/aistudio/') ||
            url === '/public/assets/aistudio' ||
            url.startsWith('/public/assets/aistudio/') ||
            url.includes('assets/aistudio'))
        ) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }
        next();
      });
    },
    closeBundle() {
      const distAistudio = path.resolve(import.meta.dirname, 'dist/assets/aistudio');
      if (fs.existsSync(distAistudio)) {
        fs.rmSync(distAistudio, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), excludePlanningAssetsPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
