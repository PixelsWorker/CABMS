import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { renderSimulatedTemplatePreview, updateTemplateDraftContent } from '../backend/modules/templates/templatesRepo.ts';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { createWorker } from '../backend/index.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';
import { CabmsProvider } from '../src/context/CabmsContext.tsx';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';
import { setApiFetchHandler, resetApiFetchHandler, setApiBase, resetApiBase } from '../src/services/g01Client.ts';
import { extractTemplatePlaceholders, renderSimulatedDocumentPreview, TemplatesSettingsView } from '../src/views/TemplatesSettingsView.tsx';

function setupDom() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:3000' });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'File', 'Event', 'MouseEvent', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of keys) {
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k],
    });
  }
  return {
    dom,
    restore() {
      dom.window.close();
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete (globalThis as any)[k];
      }
    },
  };
}

function getReactProps(el: Element): any {
  const key = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  return key ? (el as any)[key] : null;
}

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

  it('persists and rehydrates dynamic_fields, layout, category, sample_file_name, and mapping_status through TemplatesSettingsView and API', async (t) => {
    const db = createLocalD1Database() as LocalD1Database;
    t.after(() => db.getSqliteHandle().close());
    await runLocalMigrations(db, { disposableTest: true });
    await installG01TestAuthFixtures(db);

    const fixture = await createFirebaseFixture();
    const worker = createWorker(createAuthenticationService(fixture.transport));
    const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
    const ownerToken = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);

    // Seed a published document type and published form definition for linked output persistence checks
    const docTypeRes = await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/document-types', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'SOLAR-CERT', title: 'Solar Certificate' }),
    }), env);
    assert.equal(docTypeRes.status, 201);
    const docType = await docTypeRes.json() as { id: string };
    assert.equal((await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/document-types/${docType.id}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    }), env)).status, 200);
    assert.equal((await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/document-types/${docType.id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    }), env)).status, 200);

    const formRes = await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/form-definitions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'PV Safety Sheet',
        code: 'PV-SAFE-01',
        description: 'Safety form',
        category: 'Safety',
        brand_id: 'solarcell',
        schema: { sections: [{ title: 'Main', fields: [{ key: 'ok', label: 'OK', type: 'PASS_FAIL', required: true }] }] },
      }),
    }), env);
    assert.equal(formRes.status, 201);
    const form = await formRes.json() as { id: string; revision_id: string };
    const formDetail = await (await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/form-definitions/${form.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    }), env)).json() as any;
    assert.equal((await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/form-definitions/${form.id}/revisions/${form.revision_id}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_updated_at: formDetail.revisions[0].updated_at }),
    }), env)).status, 200);
    assert.equal((await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/form-definitions/${form.id}/revisions/${form.revision_id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    }), env)).status, 200);

    const createRes = await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/templates', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Custom Handover Pack',
        code: 'custom_handover_pack',
        templateType: 'COMPLIANCE_DISCLAIMER',
        content: 'Initial terms for {{client_entity}}.',
        sampleFileName: 'initial-handover.docx',
      }),
    }), env);
    assert.equal(createRes.status, 201);
    const createdTpl = await createRes.json() as { id: string; revisionId: string };

    const { dom, restore } = setupDom();
    const rootEl = dom.window.document.getElementById('root')!;
    setApiBase('http://localhost');
    setApiFetchHandler(req => worker.fetch(req, env));

    const session: Session = {
      profile: {
        user: { id: G01_TEST_AUTH.ownerAdmin.userId, email: G01_TEST_AUTH.ownerAdmin.email, display_name: 'Owner' },
        memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role: 'owner_admin' }],
      },
      workspaceId: 'solarcell',
      selectWorkspace: () => {},
      token: async () => ownerToken,
      login: async () => {},
      logout: async () => {},
      invalidate: () => {},
      loading: false,
      error: '',
    };

    const settle = async () => {
      await act(async () => { await new Promise(r => setTimeout(r, 40)); });
    };
    const waitForCondition = async (check: () => boolean, label: string) => {
      for (let i = 0; i < 40; i++) {
        if (check()) return;
        await settle();
      }
      assert.ok(check(), `Timed out waiting for: ${label}`);
    };

    let activeRoot: ReturnType<typeof createRoot> | null = createRoot(rootEl);
    try {
      await act(async () => {
        activeRoot!.render(
          React.createElement(SessionContext.Provider, { value: session },
            React.createElement(CabmsProvider, null, React.createElement(TemplatesSettingsView))
          )
        );
      });
      await waitForCondition(() => Boolean(rootEl.textContent?.includes('Custom Handover Pack')), 'Custom Handover Pack loaded');

      // Select the newly created template
      const card = Array.from(rootEl.querySelectorAll('div.cursor-pointer')).find(el => el.textContent?.includes('Custom Handover Pack'));
      assert.ok(card, 'Custom Handover Pack card should be visible');
      await act(async () => { (card as HTMLElement).click(); });
      await waitForCondition(() => (rootEl.querySelector('textarea') as HTMLTextAreaElement | null)?.value === 'Initial terms for {{client_entity}}.', 'Initial template hydrated');

      // Upload a text sample file with custom placeholders
      const fileInput = rootEl.querySelector('input[aria-label="Upload sample template file"]') as HTMLInputElement;
      assert.ok(fileInput, 'Sample upload input must exist');
      const uploadedSample = new dom.window.File(
        ['Issued by {{business.name}} to {{client_entity}} for {{project_ref}}.'],
        'handover-sample-v2.txt',
        { type: 'text/plain' }
      );
      Object.defineProperty(uploadedSample, 'text', {
        value: async () => 'Issued by {{business.name}} to {{client_entity}} for {{project_ref}}.',
      });
      await act(async () => {
        await getReactProps(fileInput).onChange({ target: { files: [uploadedSample], value: 'fakepath' } });
      });

      // Map placeholders and configure output category, layout, document type, linked form, and mapping status
      const clientSelect = rootEl.querySelector('select[aria-label="Map placeholder client_entity"]') as HTMLSelectElement;
      const projectSelect = rootEl.querySelector('select[aria-label="Map placeholder project_ref"]') as HTMLSelectElement;
      const categorySelect = rootEl.querySelector('select[aria-label="Template output category"]') as HTMLSelectElement;
      const layoutSelect = rootEl.querySelector('select[aria-label="Template paper layout"]') as HTMLSelectElement;
      const docTypeSelect = rootEl.querySelector('select[aria-label="Template document type"]') as HTMLSelectElement;
      const linkedFormSelect = rootEl.querySelector('select[aria-label="Template linked form"]') as HTMLSelectElement;

      assert.ok(clientSelect && projectSelect && categorySelect && layoutSelect && docTypeSelect && linkedFormSelect);
      await act(async () => {
        getReactProps(clientSelect).onChange({ target: { value: 'customer.name' } });
        getReactProps(projectSelect).onChange({ target: { value: 'job.id' } });
        getReactProps(categorySelect).onChange({ target: { value: 'Terms' } });
        getReactProps(layoutSelect).onChange({ target: { value: 'LETTER' } });
        getReactProps(docTypeSelect).onChange({ target: { value: docType.id } });
        getReactProps(linkedFormSelect).onChange({ target: { value: form.revision_id } });
      });

      // Save Draft Revision
      const saveBtn = Array.from(rootEl.querySelectorAll('button')).find(b => b.textContent?.includes('Save Draft Revision')) as HTMLButtonElement;
      assert.ok(saveBtn, 'Save Draft Revision button must exist');
      await act(async () => { saveBtn.click(); });
      await waitForCondition(() => Boolean(rootEl.textContent?.includes('output configuration, and field mappings saved')), 'Save confirmation shown');

      // Verify server persisted both content and full output + sample_file_name + mapping_status
      const serverAfterSave = await (await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/templates/${createdTpl.id}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      }), env)).json() as any;
      assert.equal(serverAfterSave.sample_file_name, 'handover-sample-v2.txt');
      assert.equal(serverAfterSave.mapping_status, 'Mapped');
      assert.equal(serverAfterSave.revisions[0].content, 'Issued by {{business.name}} to {{client_entity}} for {{project_ref}}.');
      assert.deepEqual(serverAfterSave.revisions[0].output, {
        category: 'Terms',
        brand_id: 'solarcell',
        linked_form_revision_id: form.revision_id,
        document_type_id: docType.id,
        layout: { paper: 'LETTER' },
        dynamic_fields: {
          'business.name': 'business.name',
          client_entity: 'customer.name',
          project_ref: 'job.id',
        },
      });

      // Verify simulated preview API also preserves SIMULATED_TEXT_PREVIEW labeling and resolves mapped fields
      const previewApiRes = await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/templates/${createdTpl.id}/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionId: createdTpl.revisionId }),
      }), env);
      assert.equal(previewApiRes.status, 200);
      const previewApiJson = await previewApiRes.json() as any;
      assert.equal(previewApiJson.rendering_mode, 'SIMULATED_TEXT_PREVIEW');
      assert.equal(previewApiJson.sample_file_name, 'handover-sample-v2.txt');
      assert.match(previewApiJson.rendered_text, /Brisbane Commercial Properties Pty Ltd/);
      assert.match(previewApiJson.rendered_text, /JOB-2026-101/);

      // Simulate full reload by unmounting and remounting fresh TemplatesSettingsView
      await act(async () => { activeRoot!.unmount(); activeRoot = null; });
      activeRoot = createRoot(rootEl);
      await act(async () => {
        activeRoot!.render(
          React.createElement(SessionContext.Provider, { value: session },
            React.createElement(CabmsProvider, null, React.createElement(TemplatesSettingsView))
          )
        );
      });
      await waitForCondition(() => Boolean(rootEl.textContent?.includes('Custom Handover Pack')), 'Reloaded Custom Handover Pack visible');

      const reloadedCard = Array.from(rootEl.querySelectorAll('div.cursor-pointer')).find(el => el.textContent?.includes('Custom Handover Pack'));
      assert.ok(reloadedCard, 'Reloaded card must exist');
      await act(async () => { (reloadedCard as HTMLElement).click(); });
      await waitForCondition(
        () => (rootEl.querySelector('select[aria-label="Map placeholder client_entity"]') as HTMLSelectElement | null)?.value === 'customer.name',
        'Reloaded dynamic_fields hydrated'
      );

      assert.match(rootEl.textContent || '', /handover-sample-v2\.txt/, 'Uploaded sample file name must persist across reload');
      const reloadedClientSelect = rootEl.querySelector('select[aria-label="Map placeholder client_entity"]') as HTMLSelectElement;
      const reloadedProjectSelect = rootEl.querySelector('select[aria-label="Map placeholder project_ref"]') as HTMLSelectElement;
      const reloadedLayoutSelect = rootEl.querySelector('select[aria-label="Template paper layout"]') as HTMLSelectElement;
      const reloadedCategorySelect = rootEl.querySelector('select[aria-label="Template output category"]') as HTMLSelectElement;
      const reloadedDocTypeSelect = rootEl.querySelector('select[aria-label="Template document type"]') as HTMLSelectElement;
      const reloadedLinkedFormSelect = rootEl.querySelector('select[aria-label="Template linked form"]') as HTMLSelectElement;
      const reloadedTextarea = rootEl.querySelector('textarea') as HTMLTextAreaElement;

      assert.equal(reloadedTextarea.value, 'Issued by {{business.name}} to {{client_entity}} for {{project_ref}}.');
      assert.equal(reloadedClientSelect.value, 'customer.name');
      assert.equal(reloadedProjectSelect.value, 'job.id');
      assert.equal(reloadedLayoutSelect.value, 'LETTER');
      assert.equal(reloadedCategorySelect.value, 'Terms');
      assert.equal(reloadedDocTypeSelect.value, docType.id);
      assert.equal(reloadedLinkedFormSelect.value, form.revision_id);

      // Open Preview Document after reload to verify hydrated mappings + SIMULATED notice render
      const previewBtn = Array.from(rootEl.querySelectorAll('button')).find(b => b.textContent?.includes('Preview Document')) as HTMLButtonElement;
      await act(async () => { previewBtn.click(); });
      const dialog = rootEl.querySelector('[role="dialog"]')!;
      assert.match(dialog.textContent || '', /Simulated \/ synthetic document rendering/);
      assert.match(dialog.textContent || '', /handover-sample-v2\.txt/);
      assert.match(dialog.textContent || '', /Brisbane Commercial Properties Pty Ltd/);
      assert.match(dialog.textContent || '', /JOB-2026-101/);
    } finally {
      if (activeRoot) {
        await act(async () => { activeRoot!.unmount(); });
      }
      await settle();
      resetApiFetchHandler();
      resetApiBase();
      restore();
    }
  });

  it('rejects stale expectedUpdatedAt concurrent saves (412) and atomically preserves content, sample_file_name, and output.dynamic_fields', async (t) => {
    const db = createLocalD1Database() as LocalD1Database;
    t.after(() => db.getSqliteHandle().close());
    await runLocalMigrations(db, { disposableTest: true });
    await installG01TestAuthFixtures(db);

    const fixture = await createFirebaseFixture();
    const worker = createWorker(createAuthenticationService(fixture.transport));
    const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
    const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

    const createRes = await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/templates', {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Concurrent Guard Template',
        templateType: 'QUOTE_TERMS',
        content: 'Initial {{a}}',
        sampleFileName: 'initial.txt',
        output: { category: 'Terms', brand_id: 'solarcell', layout: { paper: 'A4' }, dynamic_fields: { a: 'business.name' } },
      }),
    }), env);
    assert.equal(createRes.status, 201);
    const created = await createRes.json() as { id: string; revisionId: string; updated_at: string };

    // Two concurrent PATCH saves starting from the same expected_updated_at
    const saveWinner = worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/templates/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision_id: created.revisionId,
        expected_updated_at: created.updated_at,
        content: 'Winner content {{winner_field}}',
        sample_file_name: 'winner.txt',
        mapping_status: 'Mapped',
        output: {
          category: 'Terms',
          brand_id: 'solarcell',
          linked_form_revision_id: null,
          document_type_id: null,
          layout: { paper: 'A4' },
          dynamic_fields: { winner_field: 'customer.name' },
        },
      }),
    }), env);

    const saveStale = worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/templates/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision_id: created.revisionId,
        expected_updated_at: created.updated_at,
        content: 'Stale content {{stale_field}}',
        sample_file_name: 'stale.txt',
        mapping_status: 'Pending Review',
        output: {
          category: 'Compliance',
          brand_id: 'solarcell',
          linked_form_revision_id: null,
          document_type_id: null,
          layout: { paper: 'LETTER' },
          dynamic_fields: { stale_field: 'job.id' },
        },
      }),
    }), env);

    const [res1, res2] = await Promise.all([saveWinner, saveStale]);
    assert.deepEqual([res1.status, res2.status].sort((a, b) => a - b), [200, 412]);
    const winnerRes = res1.status === 200 ? res1 : res2;
    const winnerWasFirst = res1.status === 200;

    const detailAfter = await (await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/templates/${created.id}`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    }), env)).json() as any;

    const expectedFile = winnerWasFirst ? 'winner.txt' : 'stale.txt';
    const expectedStatus = winnerWasFirst ? 'Mapped' : 'Pending Review';
    const expectedContent = winnerWasFirst ? 'Winner content {{winner_field}}' : 'Stale content {{stale_field}}';
    const expectedOutput = winnerWasFirst
      ? { category: 'Terms', brand_id: 'solarcell', linked_form_revision_id: null, document_type_id: null, layout: { paper: 'A4' }, dynamic_fields: { winner_field: 'customer.name' } }
      : { category: 'Compliance', brand_id: 'solarcell', linked_form_revision_id: null, document_type_id: null, layout: { paper: 'LETTER' }, dynamic_fields: { stale_field: 'job.id' } };

    assert.equal(detailAfter.sample_file_name, expectedFile);
    assert.equal(detailAfter.mapping_status, expectedStatus);
    assert.equal(detailAfter.revisions[0].content, expectedContent);
    assert.equal(detailAfter.revisions[0].sample_file_name, expectedFile);
    assert.deepEqual(detailAfter.revisions[0].output, expectedOutput);

    // Direct repo test: if output write triggers an error, template_revisions and document_templates roll back completely
    const winnerUpdatedAt = (await winnerRes.json() as { updated_at: string }).updated_at;
    await assert.rejects(() =>
      updateTemplateDraftContent(
        db,
        'solarcell',
        { userId: G01_TEST_AUTH.officeStaff.userId, providerSubjectId: G01_TEST_AUTH.officeStaff.uid, email: G01_TEST_AUTH.officeStaff.email, displayName: null, providerId: 'firebase' },
        created.id,
        created.revisionId,
        winnerUpdatedAt,
        'Rolled back content {{bad}}',
        {
          sampleFileName: 'rolled-back.txt',
          mappingStatus: 'Unsupported',
          output: {
            category: 'Compliance',
            brand_id: 'solarcell',
            linked_form_revision_id: 'nonexistent-form-rev',
            document_type_id: null,
            layout: { paper: 'LETTER' },
            dynamic_fields: { bad: 'job.id' },
          },
        }
      )
    );

    const afterRollback = await (await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/templates/${created.id}`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    }), env)).json() as any;
    assert.equal(afterRollback.sample_file_name, expectedFile);
    assert.equal(afterRollback.mapping_status, expectedStatus);
    assert.equal(afterRollback.revisions[0].content, expectedContent);
    assert.equal(afterRollback.revisions[0].updated_at, winnerUpdatedAt);
    assert.deepEqual(afterRollback.revisions[0].output.dynamic_fields, expectedOutput.dynamic_fields);
  });
});
