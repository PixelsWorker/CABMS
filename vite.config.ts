import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';

function blockPlanningAssetRequests(server: { middlewares: { use: (handler: (req: { url?: string }, res: { statusCode: number; end: (body: string) => void }, next: () => void) => void) => void } }) {
  server.middlewares.use((req, res, next) => {
    let url: string | undefined;
    try {
      url = req.url ? path.posix.normalize(decodeURIComponent(req.url.split('?')[0]).replace(/\\/g, '/')) : undefined;
    } catch {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }
    url = url?.toLowerCase();
    if (url && (url === '/assets/aistudio' || url.startsWith('/assets/aistudio/') ||
        url === '/public/assets/aistudio' || url.startsWith('/public/assets/aistudio/') || url.includes('assets/aistudio'))) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    next();
  });
}

function excludePlanningAssetsPlugin(): Plugin {
  let resolved: ResolvedConfig | undefined;
  return {
    name: 'exclude-planning-assets',
    configResolved(config) {
      resolved = config;
    },
    configureServer: blockPlanningAssetRequests,
    configurePreviewServer: blockPlanningAssetRequests,
    closeBundle() {
      if (!resolved) throw new Error('Vite configuration was not resolved before asset exclusion');
      const root = path.resolve(resolved.root);
      const outDir = path.resolve(root, resolved.build.outDir);
      const outputRoot = path.resolve(outDir, 'assets');
      const planningAssets = path.resolve(outputRoot, 'aistudio');
      const relativeTarget = path.relative(outputRoot, planningAssets);
      const sourceAssets = path.resolve(resolved.publicDir || path.join(root, 'public'), 'assets/aistudio');
      const sourceReal = fs.existsSync(sourceAssets) ? fs.realpathSync(sourceAssets) : sourceAssets;
      const targetReal = fs.existsSync(planningAssets) ? fs.realpathSync(planningAssets) : planningAssets;
      const outputReal = fs.existsSync(outputRoot) ? fs.realpathSync(outputRoot) : outputRoot;
      if (outDir === root || !relativeTarget || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget) ||
          planningAssets === sourceAssets || planningAssets.startsWith(sourceAssets + path.sep) ||
          targetReal === sourceReal || targetReal.startsWith(sourceReal + path.sep) ||
          (fs.existsSync(outputRoot) && outputReal.toLowerCase() !== outputRoot.toLowerCase()) ||
          (fs.existsSync(planningAssets) && !targetReal.startsWith(outputReal + path.sep))) {
        throw new Error(`Refusing unsafe planning-asset cleanup target: ${planningAssets}`);
      }
      if (fs.existsSync(planningAssets)) fs.rmSync(planningAssets, { recursive: true, force: true });
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
