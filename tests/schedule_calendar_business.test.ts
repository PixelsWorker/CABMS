import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import {
  ScheduleView,
  isValidCalendarDate,
  normalizeCalendarDate,
  buildCalendarDays,
  parseVisitDateTimeIso,
} from '../src/views/ScheduleView.tsx';
import { ComplianceWork } from '../src/views/ComplianceWork.tsx';
import { JobsView } from '../src/views/JobsView.tsx';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';
import { setApiBase, resetApiBase } from '../src/services/g01Client.ts';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
  });
  const keys = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLDialogElement',
    'Event',
    'IS_REACT_ACT_ENVIRONMENT',
  ];
  const saved = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of keys) {
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k],
    });
  }
  if (!(dom.window.HTMLDialogElement.prototype as any).showModal) {
    (dom.window.HTMLDialogElement.prototype as any).showModal = function () {
      this.setAttribute('open', '');
    };
    (dom.window.HTMLDialogElement.prototype as any).close = function () {
      this.removeAttribute('open');
    };
  }
  return {
    dom,
    cleanup: () => {
      dom.window.close();
      for (const k of keys) {
        const d = saved.get(k);
        if (d) Object.defineProperty(globalThis, k, d);
        else delete (globalThis as any)[k];
      }
    },
  };
}

function triggerReactChange(el: HTMLElement, value: string) {
  const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  assert.ok(propsKey, 'Expected React props on element');
  (el as any)[propsKey].onChange({ target: { value } });
}

test('ScheduleView date helpers reject invalid, empty, and 5+ digit year dates without throwing RangeError', () => {
  assert.equal(isValidCalendarDate('2026-11-02'), true);
  assert.equal(isValidCalendarDate('2024-02-29'), true);
  assert.equal(isValidCalendarDate(''), false);
  assert.equal(isValidCalendarDate('invalid'), false);
  assert.equal(isValidCalendarDate('20260-11-02'), false);
  assert.equal(isValidCalendarDate('12026-01-01'), false);
  assert.equal(isValidCalendarDate('2026-02-30'), false);
  assert.equal(isValidCalendarDate('2026-13-01'), false);

  assert.equal(normalizeCalendarDate('', '2026-11-02'), '2026-11-02');
  assert.equal(normalizeCalendarDate('20260-11-02', '2026-11-02'), '2026-11-02');
  assert.equal(normalizeCalendarDate('2026-11-05', '2026-11-02'), '2026-11-05');

  assert.deepEqual(buildCalendarDays('2026-12-30', 4), [
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
  ]);
  assert.deepEqual(buildCalendarDays('', 4, '2026-11-02'), [
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
  ]);
  assert.deepEqual(buildCalendarDays('20260-11-02', 4, '2026-11-02'), [
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
  ]);

  assert.equal(parseVisitDateTimeIso('2026-11-02', '09:00'), '2026-11-01T23:00:00.000Z');
  assert.equal(parseVisitDateTimeIso('20260-11-02', '09:00'), null);
  assert.equal(parseVisitDateTimeIso('', '09:00'), null);
  assert.equal(parseVisitDateTimeIso('2026-02-30', '09:00'), null);
  assert.equal(parseVisitDateTimeIso('2026-11-02', '25:00'), null);
});

test('PersistentCalendar handles empty, invalid, and 5+ digit year inputs without RangeError and supports 4-day navigation', async t => {
  const { dom, cleanup } = setupDom();
  const origFetch = globalThis.fetch;
  let saveCalls = 0;
  setApiBase('http://localhost');
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const path = url.pathname;
    if (path.endsWith('/visits') && req.method === 'GET') {
      return Response.json([]);
    }
    if (path.endsWith('/visits') && req.method === 'POST') {
      saveCalls += 1;
      return Response.json({ ok: true });
    }
    if (path.endsWith('/compliance-jobs') && url.searchParams.get('view') === 'technicians') {
      return Response.json([{ id: 'tech-1', display_name: 'Dave' }]);
    }
    if (path.endsWith('/compliance-jobs')) {
      return Response.json({
        jobs: [
          {
            id: 'job-1',
            workspace_id: 'solarcell',
            title: 'Inverter Service',
            status: 'OPEN',
            assignee_id: 'tech-1',
            technician: 'Dave',
            customer_name: 'Alice',
            site_address: '10 Solar Way',
          },
        ],
        after: null,
      });
    }
    return Response.json({});
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = origFetch;
    resetApiBase();
    cleanup();
  });

  const session: Session = {
    profile: {
      user: { id: 'u1', email: 'office@solarcell.test', display_name: 'Office' },
      memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role: 'office_staff' }],
    },
    workspaceId: 'solarcell',
    selectWorkspace: () => {},
    token: async () => 'test-token',
    login: async () => {},
    logout: async () => {},
    invalidate: () => {},
    loading: false,
    error: '',
  };

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const flush = async () => act(async () => { await new Promise(r => setTimeout(r, 20)); });

  await act(async () => {
    root.render(
      React.createElement(
        SessionContext.Provider,
        { value: session },
        React.createElement(CabmsProvider, null, React.createElement(ScheduleView))
      )
    );
  });
  await flush();

  const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]')!;
  assert.ok(dateInput, 'Calendar date input rendered');

  for (const badDate of ['', 'invalid', '20260-11-02', '2026-02-30']) {
    await act(async () => {
      triggerReactChange(dateInput, badDate);
    });
    assert.match(container.textContent || '', /Enter a valid 4-digit year date/);
  }

  await act(async () => {
    triggerReactChange(dateInput, '2026-11-10');
  });
  assert.doesNotMatch(container.textContent || '', /Enter a valid 4-digit year date/);
  assert.match(container.textContent || '', /Viewing appointments for:\s*2026-11-10/);

  const nextBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Next 4 days')!;
  await act(async () => {
    nextBtn.click();
  });
  assert.match(container.textContent || '', /Viewing appointments for:\s*2026-11-14/);

  const scheduleBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Schedule visit')!;
  await act(async () => {
    scheduleBtn.click();
  });
  const form = container.querySelector('form')!;
  const visitDateInput = form.querySelector<HTMLInputElement>('input[type="date"]')!;
  await act(async () => {
    triggerReactChange(visitDateInput, '20260-11-14');
  });
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(saveCalls, 0, 'Invalid 5-digit year visit date must not call saveVisit');
  assert.match(container.textContent || '', /Enter a valid visit date/);

  await act(async () => {
    root.unmount();
  });
});

test('ComplianceWork Business filter scopes displayed jobs and new-job destination without switching activeWorkspace', async t => {
  const { dom, cleanup } = setupDom();
  t.after(cleanup);

  const jobsByWorkspace: Record<string, any[]> = {
    solarcell: [
      { id: 'j-solar', workspace_id: 'solarcell', title: 'Solar Job', status: 'OPEN', customer_name: 'Alice', site_address: '1 Sun St', technician: 'Dave' },
    ],
    smart_home: [
      { id: 'j-smart', workspace_id: 'smart_home', title: 'Smart Home Job', status: 'OPEN', customer_name: 'Bob', site_address: '2 Home Ave', technician: 'Eve' },
    ],
    cctv: [
      { id: 'j-cctv', workspace_id: 'cctv', title: 'CCTV Job', status: 'OPEN', customer_name: 'Cara', site_address: '3 Cam Rd', technician: 'Max' },
    ],
  };

  const api: any = {
    list: async (ws: string) => jobsByWorkspace[ws] ?? [],
    publishedTypes: async () => [
      { id: 'jt-1', name: 'Standard Service', current_policy_version_id: 'pol-1', missing_mandatory_forms: [] },
    ],
    technicians: async () => [{ id: 't1', display_name: 'Dave' }],
  };

  const memberships = [
    { workspace_id: 'solarcell', name: 'Solarcell', role: 'owner_admin' },
    { workspace_id: 'smart_home', name: 'Gold Coast Smart Home Solutions', role: 'owner_admin' },
    { workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'owner_admin' },
  ];

  const workspaceChanges: string[] = [];
  let currentWorkspace = 'solarcell';
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const flush = async () => act(async () => { await new Promise(r => setTimeout(r, 20)); });

  const renderWork = async () => {
    await act(async () => {
      root.render(
        React.createElement(ComplianceWork as any, {
          actorId: 'u1',
          api,
          activeWorkspace: currentWorkspace,
          onWorkspace: (ws: string) => {
            workspaceChanges.push(ws);
            currentWorkspace = ws;
          },
          memberships,
          screen: 'jobs',
          onJobs: () => {},
          onForm: () => {},
          onLogin: async () => {},
        })
      );
    });
    await flush();
  };

  await renderWork();

  const businessSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Business"]')!;
  assert.ok(businessSelect, 'Business filter select is rendered');
  assert.equal(businessSelect.value, 'all');

  // Filtering by CCTV updates displayed records and Create New Job destination without calling onWorkspace
  await act(async () => {
    triggerReactChange(businessSelect, 'cctv');
  });
  await flush();
  assert.equal(workspaceChanges.length, 0, 'Business filter must not invoke onWorkspace');
  assert.match(container.textContent || '', /CCTV Job/);
  assert.doesNotMatch(container.textContent || '', /Solar Job/);

  const createBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Create New Job'))!;
  await act(async () => {
    createBtn.click();
  });
  await flush();
  assert.match(container.textContent || '', /Destination business:\s*Gold Coast CCTV/);

  const cancelBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Cancel')!;
  await act(async () => {
    cancelBtn.click();
  });

  // Resetting Business filter to 'all' uses activeWorkspace as destination
  await act(async () => {
    triggerReactChange(businessSelect, 'all');
  });
  await flush();
  assert.equal(workspaceChanges.length, 0, 'Resetting Business filter to all must not invoke onWorkspace');
  assert.match(container.textContent || '', /Solar Job/);
  assert.match(container.textContent || '', /CCTV Job/);

  const createBtn2 = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Create New Job'))!;
  await act(async () => {
    createBtn2.click();
  });
  await flush();
  assert.match(container.textContent || '', /Destination business:\s*Solarcell/);

  const cancelBtn2 = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Cancel')!;
  await act(async () => {
    cancelBtn2.click();
  });

  // When activeWorkspace changes while Business === 'all', new-job destination follows activeWorkspace
  currentWorkspace = 'smart_home';
  await renderWork();
  const createBtn3 = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Create New Job'))!;
  await act(async () => {
    createBtn3.click();
  });
  await flush();
  assert.match(container.textContent || '', /Destination business:\s*Gold Coast Smart Home Solutions/);

  await act(async () => {
    root.unmount();
  });
});

test('JobsView (Simulated) separates Active business (theme/destination) from Filter jobs by business (display only)', async t => {
  const { dom, cleanup } = setupDom();
  t.after(cleanup);

  let ctxRef!: ReturnType<typeof useCabms>;
  const Probe: React.FC = () => {
    ctxRef = useCabms();
    return React.createElement(JobsView);
  };

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(CabmsProvider, null, React.createElement(Probe)));
  });

  const activeSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Active business"]')!;
  const filterSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Filter jobs by business"]')!;
  assert.ok(activeSelect && filterSelect);
  assert.equal(ctxRef.activeBrandId, 'solarcell');

  // Filter jobs by business -> all: shows CCTV & Smart Home jobs without changing activeBrandId
  await act(async () => {
    triggerReactChange(filterSelect, 'all');
  });
  assert.equal(ctxRef.activeBrandId, 'solarcell', 'Filter jobs by business must not change activeBrandId/theme');
  assert.match(container.textContent || '', /Emergency Aircon Automation Inverter Reset/);

  // Create New Job destination remains Solarcell
  const createBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Create New Job'))!;
  await act(async () => {
    createBtn.click();
  });
  assert.match(container.textContent || '', /Destination business:\s*Solarcell/);
  const closeBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')!;
  await act(async () => {
    closeBtn.click();
  });

  // Changing Active business -> smart_home updates activeBrandId/theme and Create New Job destination
  await act(async () => {
    triggerReactChange(activeSelect, 'smart_home');
  });
  assert.equal(ctxRef.activeBrandId, 'smart_home');
  const createBtn2 = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Create New Job'))!;
  await act(async () => {
    createBtn2.click();
  });
  assert.match(container.textContent || '', /Destination business:\s*Smart Home Solutions/);

  await act(async () => {
    root.unmount();
  });
});
