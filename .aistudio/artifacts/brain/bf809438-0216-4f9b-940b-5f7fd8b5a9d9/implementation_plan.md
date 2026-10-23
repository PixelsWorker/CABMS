# Implementation Plan — CABMS G00 State Integrity, Action-Level RBAC & Snapshot Delivery Remediation (Revised)

## Executive Summary
This revised implementation plan incorporates the manager review directives for CABMS G00 (`PixelsWorker/CABMS` at HEAD `9a069ad`). It establishes a pure, synchronous authoritative state mutation model for jobs and audit records, enforces mandatory action-level persona authorization across all protected review operations, unifies strict structural validation for signed document snapshots (used identically for print previews and email deliveries), repairs seed fixtures for complete snapshot integrity, implements an atomic single-pass virtual clock processor, and specifies an executable mounted React integration harness for Layer 6 testing.

---

## 1. Corrective Technical Design & Architectural Specifications

### A. Pure Synchronous Authoritative Job & Audit State Mutations (P0)

#### Architectural Requirement
React state updater functions (`setJobs(prev => ...)`) are asynchronous, pure functions that React may execute multiple times in Strict Mode or defer during batching. Assigining side-effects like `authoritativeJobsRef.current = next` inside a `setJobs` callback is impure and non-deterministic.

#### Revised Implementation
1. **Synchronous Mutation Helper (`commitJobsState`)**:
   In `CabmsContext.tsx`:
   ```typescript
   const commitJobsState = (
     mutation: (currentJobs: Job[]) => Job[],
     auditMutation?: (currentAudits: Record<string, Tca2AuditRecord>) => Record<string, Tca2AuditRecord>
   ): Job[] => {
     // 1. Compute next immutable state directly from synchronous authoritative ref
     const nextJobs = mutation(authoritativeJobsRef.current);
     
     // 2. Synchronously update authoritative ref immediately BEFORE scheduling React state update
     authoritativeJobsRef.current = nextJobs;
     
     // 3. If coupled audit mutation provided, update audit ref & state atomically
     if (auditMutation) {
       const nextAudits = auditMutation(authoritativeAuditRecordsRef.current);
       authoritativeAuditRecordsRef.current = nextAudits;
       setTca2AuditRecords(nextAudits);
     }
     
     // 4. Schedule React render with the pre-computed nextJobs value (pure value pass)
     setJobs(nextJobs);
     
     return nextJobs;
   };
   ```
2. **Unified Routing**:
   Every job state mutation—including appointment rescheduling (`rescheduleAppointment`), quote creation/acceptance (`createQuote`, `acceptQuote`), invoice creation (`createInvoice`), attachment updates (`attachedSampleIds`), reminder updates, and status transitions—MUST execute through `commitJobsState`. Direct unmonitored calls to `setJobs()` are strictly eliminated.

---

### B. Action-Level Persona Authorization & Role Enforcement (P0)

#### Architectural Requirement
Updating `authoritativePersonaRef.current` in `simulateSignIn` fixes stale role tracking, but actions must also perform explicit permission enforcement at call time against `authoritativePersonaRef.current` (the active session persona).

#### Revised Implementation
1. **Session Persona Synchronization**:
   ```typescript
   const simulateSignIn = (role: Persona) => {
     authoritativePersonaRef.current = role;
     setPersona(role);
     setIsSimulatedSignedIn(true);
     showDemoNotification(`Signed in as ${role.toUpperCase()} (Simulated Demo Session).`, 'info');
   };
   ```
2. **Action-Level Permission Enforcement**:
   Every protected review and compliance action must evaluate `authoritativePersonaRef.current`:
   - `triggerReviewRequest(jobId)`: Enforce `verifyPersonaAccess(authoritativePersonaRef.current, 'assigned_job' | 'office_compliance_review')`. Non-admin/non-office roles (or technicians attempting unassigned jobs) are explicitly rejected (`{ success: false, message: 'Access Denied: Persona lacks review dispatch permission.' }`).
   - `resolvePendingReview(jobId)`: Restrict execution to non-technician roles (`authoritativePersonaRef.current !== 'technician'`). Optional actor parameters cannot override this check.
   - `retryReviewRequest(jobId)` / `reconcileReviewRequest(jobId)`: Strictly evaluate `authoritativePersonaRef.current` against required permissions before executing state mutations.

---

### C. Strict Signed Document Snapshot Contract & Seed Fixture Repair (P1)

#### Architectural Requirement
Validating JSON string syntax alone is insufficient. Signed document snapshots must satisfy a strict structural compliance contract containing all required metadata before rendering print previews or dispatching email deliveries.

#### Unified Snapshot Validation Contract (`validateSignedSnapshot`)
Implement a single shared validator in `src/utils/cabmsLogic.ts`:
```typescript
export interface SnapshotValidationResult {
  valid: boolean;
  error?: string;
  parsedSnapshot?: Record<string, any>;
}

export function validateSignedSnapshot(
  snapshotRaw?: string,
  expectedJobId?: string,
  formType?: string
): SnapshotValidationResult {
  if (!snapshotRaw || typeof snapshotRaw !== 'string' || snapshotRaw.trim() === '') {
    return { valid: false, error: 'Signed document snapshot is missing or empty.' };
  }
  try {
    const parsed = JSON.parse(snapshotRaw);
    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, error: 'Snapshot is not a valid JSON object.' };
    }
    if (parsed.signedOff !== true) {
      return { valid: false, error: 'Snapshot does not record finalized signedOff: true status.' };
    }
    if (expectedJobId && parsed.jobReference && parsed.jobReference !== expectedJobId) {
      return { valid: false, error: `Snapshot job reference (${parsed.jobReference}) mismatch with expected ${expectedJobId}.` };
    }
    if (!parsed.signedTimestamp && !parsed.signedAt && !parsed.signOffTimestamp) {
      return { valid: false, error: 'Snapshot lacks mandatory signed timestamp.' };
    }
    if (!parsed.signer && !parsed.technicianName && !parsed.businessCablerPlaceholder && !parsed.testerName) {
      return { valid: false, error: 'Snapshot lacks mandatory signer identity.' };
    }
    // Form-specific mandatory fields check
    if (formType === 'TCA2' && !parsed.reportReference) {
      return { valid: false, error: 'TCA2 snapshot lacks mandatory reportReference.' };
    }
    if (formType === 'ELECTRICAL' && !parsed.certificateNumber) {
      return { valid: false, error: 'Electrical snapshot lacks mandatory certificateNumber.' };
    }
    return { valid: true, parsedSnapshot: parsed };
  } catch (e: any) {
    return { valid: false, error: `Snapshot JSON syntax error: ${e.message}` };
  }
}
```

#### Shared Application Usage
1. **Print Preview (`ComplianceFormsView.tsx`)**: Call `validateSignedSnapshot(form.fullSnapshot, jobId, formType)`. If invalid, render the snapshot corruption error boundary UI.
2. **Email Delivery (`sendCertificateEmail` in `CabmsContext.tsx`)**: Call `validateSignedSnapshot(form.fullSnapshot, jobId, formType)`. If invalid, immediately log demo notification error, reject delivery (`return { success: false, message: result.error }`), and block `CertificateDeliveryRecord` creation.
3. **Seed Fixture Repair (`src/data/seedData.ts`)**: Repair signed JSA records for `JOB-2026-103` and `JOB-2026-104` to provide complete, compliant `fullSnapshot` string values including `jobReference`, `signer`, `signedTimestamp`, and task step records.

---

### D. Single-Pass Deterministic Virtual Clock Processor (P1)

#### Architectural Requirement
`advanceClock(hours)` must process due reminders and auto-resolve `PENDING` reviews in a single deterministic, non-recursive transition using `commitJobsState`.

#### Revised Implementation
```typescript
const advanceClock = (hours: number) => {
  const current = new Date(demoClock);
  current.setHours(current.getHours() + hours);
  const newClockIso = current.toISOString();
  setDemoClock(newClockIso);

  let deliveredRemindersCount = 0;
  let resolvedReviewsCount = 0;

  commitJobsState(currentJobs => {
    return currentJobs.map(job => {
      let updatedJob = { ...job };

      // 1. Process due reminders
      const updatedReminders = updatedJob.reminders.map(r => {
        if (!r.delivered && !r.suppressed) {
          const schedDate = new Date(r.scheduledFor.replace(' ', 'T') + ':00+10:00');
          if (schedDate <= current) {
            deliveredRemindersCount++;
            return { ...r, delivered: true, deliveredAt: newClockIso.slice(0, 16) };
          }
        }
        return r;
      });
      updatedJob.reminders = updatedReminders;

      // 2. Automated system resolution for PENDING review requests
      if (updatedJob.reviewRequest?.status === 'PENDING') {
        resolvedReviewsCount++;
        updatedJob.reviewRequest = {
          ...updatedJob.reviewRequest,
          status: 'SENT',
          sentTimestamp: newClockIso.slice(0, 16),
          history: [
            ...updatedJob.reviewRequest.history,
            {
              timestamp: newClockIso.slice(0, 16),
              status: 'SENT',
              note: 'Automated simulated dispatch completed on virtual clock advance.',
              actorPersona: 'system_daemon',
            },
          ],
        };
      }

      return updatedJob;
    });
  });

  showDemoNotification(
    `Demo clock advanced ${hours}h. ${deliveredRemindersCount} reminder(s) delivered, ${resolvedReviewsCount} review(s) resolved.`,
    'info'
  );
};
```

---

### E. Executable Mounted React Integration Test Harness for Layer 6 (P1)

#### Environment & Setup
Layer 6 tests execute in Node.js with `jsdom` global DOM simulation installed. We utilize `react-dom/client` `createRoot` and React's `act()` from `react` (or `react-dom/test-utils`) to mount `CabmsProvider` inside a real DOM container div.

#### Harness Structure (`tests/layer6_workflow_integration.test.ts`)
```typescript
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import React from 'react';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';

export async function withMountedContext(
  testFn: (ctx: ReturnType<typeof useCabms>, container: HTMLDivElement) => Promise<void> | void
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let currentContext!: ReturnType<typeof useCabms>;

  function TestObserver() {
    currentContext = useCabms();
    return <div id="test-observer-mounted">Mounted</div>;
  }

  await act(async () => {
    root.render(
      <CabmsProvider>
        <TestObserver />
      </CabmsProvider>
    );
  });

  try {
    await testFn(currentContext, container);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
}
```

---

## 2. Test Verification Strategy & Regression Verification Matrix

### Verification Evidence Checklist (Pending Execution)

| Regression Scenario | Acceptance Condition | Verification Status |
|---|---|---|
| **Scenario 1: State Survival across Workflow** | Create a quote & invoice, reschedule appointment, then execute TCA2 office review. Verify quote, invoice, schedule date, and reminders exist unmodified in `authoritativeJobsRef.current`. | `[ ] Pending Verification` |
| **Scenario 2: Double TCA2 Office Review Idempotency** | Execute `processOfficeReviewTca2` twice synchronously in the same tick. Verify exactly 1 follow-up job created, 1 audit link established, 1 sequence increment. | `[ ] Pending Verification` |
| **Scenario 3: Action-Level Technician RBAC** | Call `simulateSignIn('technician')` and directly call `triggerReviewRequest`, `resolvePendingReview`, and `retryReviewRequest`. Verify all actions are explicitly denied. | `[ ] Pending Verification` |
| **Scenario 4: Corrupt/Missing Snapshot Rejection** | Attempt `sendCertificateEmail` on an unsigned form or form with invalid `fullSnapshot`. Verify action returns `{ success: false }`, no `CertificateDeliveryRecord` is created, and source form is unmodified. | `[ ] Pending Verification` |
| **Scenario 5: Single-Pass Virtual Clock Execution** | Advance demo clock by 24 hours with pending reminders and a `PENDING` review request. Verify reminders delivered, review status transitions to `SENT` with `system_daemon` actor, and state updates atomically. | `[ ] Pending Verification` |
| **Scenario 6: Reset Demo Restoration** | Execute full workflow mutations then invoke `resetDemo()`. Verify clean seed state restored, refs reset, and locks cleared. | `[ ] Pending Verification` |
| **Scenario 7: Mounted React State & DOM Harness** | Run Layer 6 mounted integration harness tests. Assert context state and DOM updates after `act()` steps. | `[ ] Pending Verification` |

---

## 3. Plan Verification Commands

After completing code changes, run the following commands sequentially:

1. **Static Analysis & Type Checking**:
   `npm run lint` (`tsc --noEmit`)
2. **Build Verification**:
   `compile_applet`
3. **Layer 6 Integration Suite**:
   `npx tsx --test tests/layer6_workflow_integration.test.ts`
4. **Full Test Suite Run**:
   `npm test`
