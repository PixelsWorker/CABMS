import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderSimulatedTemplatePreview } from '../backend/modules/templates/templatesRepo.ts';
import { extractTemplatePlaceholders, renderSimulatedDocumentPreview } from '../src/views/TemplatesSettingsView.tsx';

describe('Template Library & Sample Selection: Preview, Mapping & Business Terminology', () => {
  it('extractTemplatePlaceholders extracts unique placeholder keys in order', () => {
    const keys = extractTemplatePlaceholders(
      'Issued by {{business.name}} for {{customer.name}} at {{site.address}} ({{customer.name}}).'
    );
    assert.deepEqual(keys, ['business.name', 'customer.name', 'site.address']);
  });

  it('renderSimulatedDocumentPreview substitutes mapped placeholders and reports unmapped ones', () => {
    const res = renderSimulatedDocumentPreview(
      'Provider: {{company}} | Client: {{customer.name}} | Custom: {{custom_token}}',
      { company: 'business.name' },
      { 'customer.name': 'Acme Solar Pty Ltd' }
    );
    assert.equal(
      res.renderedText,
      'Provider: Solarcell Electrical & Solar | Client: Acme Solar Pty Ltd | Custom: {{custom_token}}'
    );
    assert.deepEqual(res.unmappedPlaceholders, ['custom_token']);
  });

  it('backend renderSimulatedTemplatePreview includes simulated rendering notice when binary engine is absent', () => {
    const res = renderSimulatedTemplatePreview(
      'Quote for {{customer.name}} — Total: {{quote.total}}',
      {},
      {}
    );
    assert.equal(res.rendering_mode, 'SIMULATED_TEXT_PREVIEW');
    assert.match(res.notice, /binary DOCX\/PDF engine is not installed/i);
    assert.match(res.rendered_text, /Brisbane Commercial Properties Pty Ltd/);
    assert.match(res.rendered_text, /\$18,450\.00/);
    assert.deepEqual(res.unmapped_placeholders, []);
  });

  it('FormLibrary and TemplatesSettingsView use consistent Business terminology with zero Brand Affiliation labels', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const formLibrarySrc = fs.readFileSync(path.join(root, 'src/components/FormLibrary.tsx'), 'utf8');
    const templatesViewSrc = fs.readFileSync(path.join(root, 'src/views/TemplatesSettingsView.tsx'), 'utf8');
    const policyEditorSrc = fs.readFileSync(path.join(root, 'src/components/CatalogPolicyEditor.tsx'), 'utf8');

    assert.doesNotMatch(formLibrarySrc, /Brand Affiliation/i);
    assert.doesNotMatch(templatesViewSrc, /Brand Affiliation/i);
    assert.match(formLibrarySrc, /'Business'/);
    assert.match(templatesViewSrc, /<th className="p-3">Business<\/th>/);
    assert.match(templatesViewSrc, /Simulated \/ synthetic document rendering/);
    assert.match(policyEditorSrc, /for this business\./);
  });
});
