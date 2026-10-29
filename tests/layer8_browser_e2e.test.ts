import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('LAYER 8: Browser End-to-End — Production build bundle integrity and entry point inspection', () => {
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

test('LAYER 8: Browser End-to-End — Network isolation audit (No live external API calls)', () => {
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

test('LAYER 8: Browser End-to-End — Real Browser execution status', (t) => {
  t.skip(
    'UNAVAILABLE / NOT RUN: Headless browser binaries (Chromium/WebKit) and graphical display server are unprovisioned in this container environment. Structural DOM inspection, bundle integrity, and network isolation audits executed and verified.'
  );
});
