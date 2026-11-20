import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { TemplatesSettingsView } from '../src/views/TemplatesSettingsView.tsx';

async function mountView(
  view: React.ReactNode,
  run: (ctx: ReturnType<typeof useCabms>, container: HTMLDivElement, window: JSDOM['window']) => Promise<void>
) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' });
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  let current!: ReturnType<typeof useCabms>;
  function Observer() {
    current = useCabms();
    return React.createElement(React.Fragment, null, view);
  }
  await act(async () => {
    root.render(React.createElement(CabmsProvider, null, React.createElement(Observer)));
  });
  const ctx = new Proxy({} as ReturnType<typeof useCabms>, { get: (_, key) => (current as any)[key] });
  try {
    await run(ctx, container, dom.window);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
}

test('C1: Brand affiliation resolves from brand definition, not job-type ID string pattern', async () => {
  await mountView(React.createElement(TemplatesSettingsView), async (ctx, container) => {
    // Add job type whose ID does not contain 'solar', but has brandId = 'solarcell'
    let id = '';
    await act(async () => {
      const res = ctx.addJobType({
        name: 'Industrial Inverter Overhaul',
        code: 'INV_OVERHAUL',
        brandId: 'solarcell',
        formsRequired: ['JSA', 'ELECTRICAL'],
        isDirectToInvoice: false,
      });
      assert.equal(res.success, true);
      id = res.id!;
    });

    const rows = Array.from(container.querySelectorAll('tbody tr'));
    const targetRow = rows.find(r => r.textContent?.includes('Industrial Inverter Overhaul'));
    assert.ok(targetRow, 'New job type row found');
    assert.ok(targetRow.textContent?.includes('Solarcell'), 'Resolved Solarcell from brandId');
    assert.ok(targetRow.textContent?.includes('JSA'), 'Contains JSA form');
    assert.ok(targetRow.textContent?.includes('ELECTRICAL'), 'Contains ELECTRICAL form');
    assert.ok(targetRow.textContent?.includes('Requires Signed Forms'), 'Correct completion rule');
  });
});

test('C1: Job Type configuration toggles Direct-to-Invoice exception and compliance forms', async () => {
  await mountView(React.createElement(TemplatesSettingsView), async (ctx, _container) => {
    const targetJt = ctx.jobTypes[0];
    const initialForms = targetJt.formsRequired;
    assert.equal(targetJt.isDirectToInvoice, false);

    // Toggle to Direct-to-Invoice exception
    await act(async () => {
      ctx.updateJobTypeConfig(targetJt.id, [], true);
    });

    const updated = ctx.jobTypes.find(j => j.id === targetJt.id)!;
    assert.equal(updated.isDirectToInvoice, true);
    assert.deepEqual(updated.formsRequired, []);
    assert.ok(updated.revisionHistory && updated.revisionHistory.length > 0);
    assert.deepEqual(updated.revisionHistory[0].formsRequired, initialForms);

    // Toggle back to requiring forms
    await act(async () => {
      ctx.updateJobTypeConfig(targetJt.id, ['JSA', 'ELECTRICAL', 'SMOKE_ALARM'], false);
    });

    const restored = ctx.jobTypes.find(j => j.id === targetJt.id)!;
    assert.equal(restored.isDirectToInvoice, false);
    assert.deepEqual(restored.formsRequired, ['JSA', 'ELECTRICAL', 'SMOKE_ALARM']);
  });
});

test('C1: Policy draft lifecycle transitions: Draft -> Review -> Published (frozen)', async () => {
  await mountView(React.createElement(TemplatesSettingsView), async (ctx, _container) => {
    const jt = ctx.jobTypes[0];

    // 1. Create draft policy version
    await act(async () => {
      ctx.createJobTypePolicyDraft(jt.id);
    });

    let current = ctx.jobTypes.find(j => j.id === jt.id)!;
    assert.ok(current.version.includes('-draft'), 'Version marked as draft');
    assert.equal(current.policyStatus, 'DRAFT');

    // 2. Submit policy for review
    await act(async () => {
      ctx.submitJobTypePolicyForReview(jt.id);
    });

    current = ctx.jobTypes.find(j => j.id === jt.id)!;
    assert.equal(current.policyStatus, 'REVIEW');

    // 3. Office staff denied publishing
    await act(async () => {
      ctx.setPersona('office_staff');
    });
    await act(async () => {
      ctx.approveJobTypePolicy(jt.id);
    });

    current = ctx.jobTypes.find(j => j.id === jt.id)!;
    assert.equal(current.policyStatus, 'REVIEW', 'Office staff cannot approve policy');

    // 4. Admin publishes policy
    await act(async () => {
      ctx.setPersona('owner_admin');
    });
    await act(async () => {
      ctx.approveJobTypePolicy(jt.id);
    });

    current = ctx.jobTypes.find(j => j.id === jt.id)!;
    assert.equal(current.policyStatus, 'PUBLISHED');
    assert.ok(!current.version.includes('-draft'), 'Draft suffix stripped on publish');
    assert.equal(current.revisionHistory![0].status, 'PUBLISHED');
  });
});

test('C1: Archive and Restore preserves historical Job Types and prohibits active deletion', async () => {
  await mountView(React.createElement(TemplatesSettingsView), async (ctx, _container) => {
    const target = ctx.jobTypes[1];

    // Attempt to delete active job type -> rejected
    await act(async () => {
      const res = ctx.deleteJobTypeDraft(target.id);
      assert.equal(res.success, false);
      assert.equal(res.error, 'Only drafts can be deleted');
    });

    // Archive job type
    await act(async () => {
      ctx.archiveJobType(target.id);
    });

    let current = ctx.jobTypes.find(j => j.id === target.id)!;
    assert.equal(current.status, 'ARCHIVED');

    // Restore job type
    await act(async () => {
      ctx.restoreJobType(target.id);
    });

    current = ctx.jobTypes.find(j => j.id === target.id)!;
    assert.equal(current.status, 'ACTIVE');
  });
});

test('C1: Delete draft Job Type succeeds only for unreferenced drafts', async () => {
  await mountView(React.createElement(TemplatesSettingsView), async (ctx, _container) => {
    // Add draft job type with initial status DRAFT
    let draftId = '';
    await act(async () => {
      const res = ctx.addJobType({
        name: 'Experimental Drone Roof Scan',
        brandId: 'solarcell',
        formsRequired: ['JSA'],
        isDirectToInvoice: false,
        status: 'DRAFT',
      });
      draftId = res.id!;
    });

    assert.ok(ctx.jobTypes.some(j => j.id === draftId));

    // Delete unused draft -> succeeds
    await act(async () => {
      const delRes = ctx.deleteJobTypeDraft(draftId);
      assert.equal(delRes.success, true);
    });

    assert.ok(!ctx.jobTypes.some(j => j.id === draftId), 'Draft removed from catalog');
  });
});

test('C1: Template Library CRUD: Add, Draft Revision, Review, Publish, Archive and Delete', async () => {
  await mountView(React.createElement(TemplatesSettingsView), async (ctx, _container) => {
    // 1. Add template
    let tplId = '';
    await act(async () => {
      const res = ctx.addTemplate({
        name: 'Smart Lock Installation Warranty',
        type: 'TERMS',
        content: 'Smart Lock Warranty standard clauses v1.0',
        sampleFileName: 'smart-lock-warranty.docx',
      });
      assert.equal(res.success, true);
      tplId = res.id!;
    });

    let tpl = ctx.templates.find(t => t.id === tplId)!;
    assert.ok(tpl, 'Template created');
    assert.equal(tpl.activeStatus, 'PUBLISHED');

    // 2. Create Draft Revision
    await act(async () => {
      ctx.createTemplateDraftRevision(tplId, 'Smart Lock Warranty clauses v1.1 with 5-year hardware coverage.');
    });

    tpl = ctx.templates.find(t => t.id === tplId)!;
    assert.equal(tpl.activeStatus, 'DRAFT');
    assert.equal(tpl.revisions.length, 2);

    // 3. Submit for Review
    await act(async () => {
      ctx.submitTemplateForReview(tplId);
    });

    tpl = ctx.templates.find(t => t.id === tplId)!;
    assert.equal(tpl.activeStatus, 'REVIEW');

    // 4. Publish Version
    await act(async () => {
      ctx.publishTemplateVersion(tplId);
    });

    tpl = ctx.templates.find(t => t.id === tplId)!;
    assert.equal(tpl.activeStatus, 'PUBLISHED');

    // 5. Archive & Restore
    await act(async () => {
      ctx.archiveTemplate(tplId);
    });
    tpl = ctx.templates.find(t => t.id === tplId)!;
    assert.equal(tpl.status, 'ARCHIVED');

    await act(async () => {
      ctx.restoreTemplate(tplId);
    });
    tpl = ctx.templates.find(t => t.id === tplId)!;
    assert.equal(tpl.status, 'ACTIVE');

    // 6. Delete published template is rejected
    await act(async () => {
      const delFail = ctx.deleteTemplateDraft(tplId);
      assert.equal(delFail.success, false);
      assert.equal(delFail.error, 'Cannot delete published templates');
    });

    // 7. Discard draft revision on published template
    await act(async () => {
      ctx.createTemplateDraftRevision(tplId, 'Temporary draft content to be discarded');
    });
    await act(async () => {
      const discardRes = ctx.deleteTemplateDraft(tplId);
      assert.equal(discardRes.success, true);
    });
    tpl = ctx.templates.find(t => t.id === tplId)!;
    assert.equal(tpl.activeStatus, 'PUBLISHED', 'Template restored to published after draft discard');

    // 8. Add pure draft template (never published) and delete it permanently
    let pureDraftId = '';
    await act(async () => {
      const res = ctx.addTemplate({
        name: 'Disposable Scratch Template',
        type: 'TERMS',
        content: 'Draft scratch terms',
        status: 'DRAFT',
      });
      pureDraftId = res.id!;
    });
    assert.ok(ctx.templates.some(t => t.id === pureDraftId));
    await act(async () => {
      const delOk = ctx.deleteTemplateDraft(pureDraftId);
      assert.equal(delOk.success, true);
    });
    assert.ok(!ctx.templates.some(t => t.id === pureDraftId), 'Pure draft template permanently deleted');
  });
});
