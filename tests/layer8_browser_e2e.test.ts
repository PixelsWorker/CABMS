import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer, preview } from 'vite';

test('LAYER 8: Build inspection - Production build bundle integrity and entry point inspection', () => {
  // Check dist output
  assert.ok(fs.existsSync('./dist/index.html'), 'Production build dist/index.html exists');
  const indexHtml = fs.readFileSync('./dist/index.html', 'utf-8');
  assert.ok(indexHtml.includes('<div id="root"></div>'));
  assert.ok(indexHtml.includes('CABMS'));

  // Ensure bundled JS and CSS assets exist
  const distAssets = fs.readdirSync('./dist/assets');
  const jsBundle = distAssets.find(f => f.endsWith('.js'));
  const cssBundle = distAssets.find(f => f.endsWith('.css'));
  assert.ok(jsBundle, `Found production JavaScript bundle: ${jsBundle}`);
  assert.ok(cssBundle, `Found production CSS bundle: ${cssBundle}`);
});

test('LAYER 8: Browser checks — Network isolation audit (No live external API calls)', () => {
  // Recursively inspect all src/ files for live external endpoint calls
  const findFiles = (dir: string): string[] => {
    let files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(findFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        files.push(fullPath);
      }
    }
    return files;
  };

  const srcFiles = findFiles('./src');
  const forbiddenPatterns = [
    /https:\/\/api\.myob\.com/,
    /https:\/\/www\.googleapis\.com\/calendar/,
    /https:\/\/firestore\.googleapis\.com/,
    /smtp\.sendgrid\.net/,
    /api\.mailgun\.net/,
  ];

  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(content),
        `File ${file} must not contain live production API endpoint: ${pattern}`
      );
    }
  }
});

test('LAYER 8: FC-06 — Production assetsignore and planning assets exclusion audit', () => {
  // 1. Verify dist/.assetsignore exists in build output
  assert.ok(fs.existsSync('./dist/.assetsignore'), 'dist/.assetsignore exists in production build output');
  const ignoreContent = fs.readFileSync('./dist/.assetsignore', 'utf-8');
  assert.ok(ignoreContent.includes('assets/aistudio/'), 'dist/.assetsignore contains assets/aistudio/ pattern');

  assert.equal(fs.existsSync('./dist/assets/aistudio'), false, 'Production output excludes planning assets');

  // 2. Verify all 5 planning asset files exist in public/assets/aistudio and are covered by .assetsignore
  const planningDir = './public/assets/aistudio';
  assert.ok(fs.existsSync(planningDir), 'Planning assets directory public/assets/aistudio exists');
  const planningFiles = fs.readdirSync(planningDir);
  assert.equal(planningFiles.length, 5, 'Exactly 5 planning assets exist in public/assets/aistudio');
  const expectedFiles = [
    '01-G00-GROUP-PLAN-FOR-REVIEW_02f12f1f.md',
    '02-AI-STUDIO-BUILD-PROMPT_d17e4a1a.txt',
    '03-AI-STUDIO-FOCUSED-ITERATION-PROMPTS_20cabc20.txt',
    'CABMS-G00-FULL-WORKFLOW-GAP-REPORT-2026-10-22_f5c4292c.md',
    'Paste_October_22__2026_-_9_37PM_7699a962',
  ];
  for (const expected of expectedFiles) {
    assert.ok(planningFiles.includes(expected), `Planning file ${expected} is present`);
  }
});

test('LAYER 8: Browser checks — Browser smoke test (Google sign-in button visibility)', async (t) => {
  const isE2EEnabled = process.env.CABMS_RUN_BROWSER_E2E === 'true' || process.env.CABMS_RUN_BROWSER_E2E === '1';

  if (!isE2EEnabled) {
    t.skip(
      'UNAVAILABLE / NOT RUN: Browser smoke execution requires provisioned browser binaries (Playwright/Chromium) and CABMS_RUN_BROWSER_E2E=true. Structural DOM inspection, bundle integrity, and network isolation audits executed and verified.'
    );
    return;
  }

  // Executable browser test runner for provisioned CI/local environment:
  let chromium: any;
  try {
    // Dynamic import allows execution in provisioned environments without failing imports when uninstalled
    const pw = await import('' + 'playwright');
    chromium = pw.chromium;
  } catch {
    t.skip(
      'UNAVAILABLE / NOT RUN: playwright package is not installed. To execute the browser smoke test, install playwright and run `npx playwright install chromium`.'
    );
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const baseUrl = process.env.CABMS_APP_URL || 'http://localhost:3000';

    // 1. Navigate to CABMS application
    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    // Check only the sign-in button; authentication is not exercised.
    const signInButton = page.locator('button:has-text("Sign in with Google")');
    await signInButton.waitFor({ state: 'visible', timeout: 15_000 });
    assert.ok(await signInButton.isVisible(), 'Sign in with Google button must be visible');

    // 3. Worker session handshake: verify /api/v1/auth/me resolves identity and memberships
    // 4. Workspace selection: switch between authorized workspaces
    // 5. Independent settings saves: mutate workspace settings and legal details, verifying distinct ETags
    // 6. Direct local D1 persistence verification
    // 7. Page refresh and session re-hydration
    // 8. RBAC boundary verification (permission denial for unauthorized resources)
  } finally {
    await page.close();
    await browser.close();
  }
});


test('LAYER 8: FC-06 blocks case and encoding variants over dev and preview HTTP', async () => {
  const filename = '01-G00-GROUP-PLAN-FOR-REVIEW_02f12f1f.md';
  const sourcePath = path.resolve('public/assets/aistudio', filename);
  const source = fs.readFileSync(sourcePath);
  assert.ok(source.length > 256);
  assert.equal(fs.existsSync(path.resolve('dist/assets/aistudio', filename)), false);
  // Keep the dev server close hook away from existing build outputs.
  const devOut = path.join(os.tmpdir(), `cabms-fc06-unused-${randomUUID()}`);
  assert.equal(fs.existsSync(devOut), false);
  const dev = await createServer({ logLevel: 'silent', build: { outDir: devOut }, server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let previewServer: Awaited<ReturnType<typeof preview>> | undefined;
  try {
    await dev.listen();
    previewServer = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
    const paths = [
      `/assets/aistudio/${filename}`, `/assets/AISTUDIO/${filename}`, `/assets/AiStUdIo/${filename}`,
      `/assets/%61istudio/${filename}`, `/assets/%41ISTUDIO/${filename}`, `/assets%2fAISTUDIO/${filename}`,
      `/assets/other/../AISTUDIO/${filename}`, `/assets/other/%2e%2e/AISTUDIO/${filename}`,
      `/assets%5cAISTUDIO%5c${filename}`, `/public/assets/AISTUDIO/${filename}`,
      `/@fs/${path.resolve('public/assets/AISTUDIO', filename).replace(/\\/g, '/')}`,
    ];
    const request = (port: number, url: string) => new Promise<{status: number; body: Buffer}>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: url, headers: { Accept: '*/*' } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.setTimeout(10000, () => req.destroy(new Error('HTTP probe timed out'))); req.on('error', reject);
    });
    for (const server of [dev.httpServer!, previewServer.httpServer]) {
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      for (const url of paths) {
        const result = await request(address.port, url);
        assert.equal(result.status, 404, `${url} must be blocked`);
        assert.equal(result.body.includes(source.subarray(0, 256)), false, `${url} must not disclose planning content`);
      }
      assert.equal((await request(address.port, '/assets/%ZZ')).status, 400);
      assert.equal((await request(address.port, '/assets/branding/solarcell_logo.svg')).status, 200);
    }
    assert.deepEqual(fs.readFileSync(sourcePath), source);
  } finally {
    if (previewServer) await new Promise<void>((resolve, reject) => previewServer!.httpServer.close(error => error ? reject(error) : resolve()));
    await dev.close();
  }
});
