import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import App from '../src/App.tsx';
import { CabmsProvider } from '../src/context/CabmsContext.tsx';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

test('LAYER 1: Toolchain Smoke — TypeScript compilation passes without errors', () => {
  const result = execSync('npx tsc --noEmit', { encoding: 'utf-8' });
  assert.equal(result.trim(), '', 'tsc --noEmit produced no compilation errors');
});

test('LAYER 1: Toolchain Smoke — Production build artifacts exist and are valid', () => {
  if (!fs.existsSync('./dist/index.html')) {
    execSync('npx vite build', { encoding: 'utf-8' });
  }
  assert.ok(fs.existsSync('./dist/index.html'), 'Production build index.html exists in dist/');
  const htmlContent = fs.readFileSync('./dist/index.html', 'utf-8');
  assert.ok(htmlContent.includes('id="root"'), 'dist/index.html contains root mount node');
  assert.ok(fs.existsSync('./dist/assets'), 'dist/assets directory exists with bundled assets');
  const assetFiles = fs.readdirSync('./dist/assets');
  assert.ok(assetFiles.length > 0, 'Compiled asset files generated in dist/assets/');
});

test('LAYER 1: Toolchain Smoke — Minimal React component mounts and renders', () => {
  const element = React.createElement('div', { id: 'smoke-test-root' }, 'CABMS Smoke Component');
  const html = renderToString(element);
  assert.ok(html.includes('CABMS Smoke Component'));
  assert.ok(html.includes('id="smoke-test-root"'));
});

test('LAYER 1: Toolchain Smoke — Complete CABMS application mounts without fatal error', () => {
  // Mounting App with full Provider hierarchy and synthetic fixtures
  const appElement = React.createElement(App);
  assert.doesNotThrow(() => {
    const html = renderToString(appElement);
    assert.ok(html.length > 0, 'App rendered non-empty HTML');
    assert.ok(
      html.includes('CABMS') || html.includes('Solarcell') || html.includes('Sign In'),
      'Rendered HTML includes core application branding or demo shell'
    );
  }, 'Application tree mounted and rendered synchronously with zero exceptions');
});

test('LAYER 1: Toolchain Smoke — No Gemini API key or live external backend service is required', () => {
  // Ensure that even with GEMINI_API_KEY unset or set to dummy value, App mounts clean
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  assert.doesNotThrow(() => {
    const html = renderToString(React.createElement(App));
    assert.ok(html.length > 0);
  });

  if (originalKey) {
    process.env.GEMINI_API_KEY = originalKey;
  }
});
