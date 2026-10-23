# CABMS G00 Remediation & Workflow Integrity Implementation Plan

CABMS (Central Automated Business Management System) coordinates jobs, compliance workflows, and business automation across Solarcell, Gold Coast Smart Home Solutions, and Gold Coast CCTV. This plan provides the exact, focused technical and architectural remediation for commit `ba9296e` to achieve G00 approval.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were clarified and confirmed for this remediation:
> - **Review PENDING Resolution**: Customer review request transitions from `PENDING` to resolved via an instant resolve action button and automatic advancement on virtual clock steps, protected against duplicate dispatch.
> - **Fixture Brand Alignment**: `JOB-2026-101` smoke alarm certificate issuer is corrected to Solarcell Technologies to strictly match the job's brand identity.
> - **Draft Business Profile Fields**: All entered fields (Brand ID slug, Electrical Licence, ACMA Cabler, QBCC, and contact info) are fully persisted to the isolated draft business profile state with slug uniqueness validation and runtime isolation.

---

## 1. Overview & Core Concept

- **What It Does**: Resolves all functional, state machine, and test integrity blockers across job assignments, compliance verification (TCA2), customer review dispatch, master templates, and draft business profiles.
- **Target Audience / Persona**: Super Admin, Owner/Admin, Office Staff, and Field Technicians operating in an isolated, deterministic simulation environment.
- **Key Value Delivered**: Complete workflow integrity with atomic state transactions, authentic immutable document freezing, and genuine end-to-end integration test assertions.

---

## 2. Four Technical Amendments (Detailed Architecture)

### Amendment 1: Authoritative Coupled State Transition Model for TCA2 Office Review (P0)
- **Problem in `ba9296e`**: `jobs` and `tca2AuditRecords` are maintained as separate React states. Updating them in separate `setJobs` and `setTca2AuditRecords` calls creates a decoupled window where an audit record could point to a follow-up job that failed to insert, and repeated clicks risk race conditions.
- **Authoritative Coupled Architecture**:
  - Introduce a single coupled state transition handler: `commitCoupledTca2Review(jobId: string, followupJob: Job, updatedAuditRecord: Tca2AuditRecord, nextSeq: number)`.
  - Maintain an authoritative in-memory coupled state manager / synchronous ref (`coupledStateRef`) backing `jobs` and `tca2AuditRecords`. When an office review is executed:
    1. Synchronous mutex check: verify `jobId` is neither in-flight nor already completed (`createdFollowupJobIdsRef`).
    2. Atomic transition: `coupledStateRef.current.jobs` and `coupledStateRef.current.auditRecords` are mutated indivisibly.
    3. State synchronization: `setJobs` and `setTca2AuditRecords` are scheduled together from the identical authoritative transition receipt.
    4. Mutex lifecycle: remove `jobId` from `inFlightTca2ReviewsRef` immediately upon successful completion and store the mapping in `createdFollowupJobIdsRef` so subsequent clicks are handled cleanly as completed duplicates.
    5. Rejection safety: any validation failure or unauthorized role attempt aborts cleanly without altering jobs, audit records, or sequence counters.

### Amendment 2: Real Mounted-State Test Harness for Layer 6 Integration (P0)
- **Problem in `ba9296e`**: `renderToString()` in server environments executes a single synchronous render pass where React state setters do not trigger component re-renders or update returned closure variables. Assertions were verifying pure logic stubs rather than mounted application state.
- **Mounted-State Test Harness Architecture**:
  - Implement a dedicated test harness component that mounts `CabmsProvider`, subscribes to context state updates, and exposes a synchronous snapshot accessor `getAuthoritativeState()` that reads directly from the authoritative context state.
  - In `tests/layer6_workflow_integration.test.ts`:
    1. Invoke `ctx.officeReviewTca2('JOB-2026-104')` twice in succession.
    2. Assert that `state.jobs.filter(j => j.title.includes('Follow-up to JOB-2026-104'))` has length **exactly 1**.
    3. Assert that `state.tca2AuditRecords['JOB-2026-104'].rectificationFollowupJobId` strictly equals the ID of that newly created follow-up job.
    4. Assert that `state.tca2AuditRecords['JOB-2026-104'].officeReviewCompleted` is `true`.
    5. Assert that resetting the demo restores the clean baseline and clears all follow-up jobs and locks.

### Amendment 3: Deterministic Review Request PENDING Queue Mechanics (P1)
- **Problem in `ba9296e`**: `processReviewDispatch()` created a pending job in pure logic, but `triggerReviewRequest()` immediately saved only the resolved job, making `PENDING` invisible.
- **Queue Mechanics & Dual-Dispatch Protection**:
  - When `triggerReviewRequest(jobId)` is invoked:
    1. Transitions job to `reviewRequest.status = 'PENDING'` with timestamped queue log in `reviewRequest.history`.
    2. Persists the `PENDING` job into `jobs` state. The UI displays an amber `PENDING DISPATCH` badge and review counter.
  - Resolution paths (Instant Action or Virtual Clock):
    1. **Instant Resolution**: A dedicated **"Dispatch Pending Review"** action button in the Demo Controls Bar and Communications View, restricted to authorized operational personas (`super_admin`, `owner_admin`, `office_staff`).
    2. **Virtual Clock Advance**: When `advanceClock(hours)` is called, any review with `status === 'PENDING'` is automatically resolved using the configured simulation outcome.
  - **Deduplication Invariant**: Both resolution pathways check an atomic dispatch lock (`pendingReviewDispatchRef`) to guarantee that an item pending dispatch can only be resolved once. Repeat actions or rapid clicks on the resolve button produce a no-op advisory toast rather than duplicate invitations.

### Amendment 4: Complete Document Snapshot Validation Across All Five Form Families (P1)
- **Problem in `ba9296e`**: Seeded snapshots for Electrical and Smoke Alarm contained only 4–5 scalar fields. Printable forms and emails still read live fields or fell back to certificate metadata.
- **Immutable Snapshot Validation Architecture**:
  - Enforce full JSON serialization into `fullSnapshot` for **all five signed form families**:
    1. **JSA**: All hazard/control steps, PPE checklist items, emergency details, risk ratings, revision version, and sample attachments.
    2. **Electrical Certificate**: All tested work items, circuit results, insulation resistance, polarity, earth continuity, RCD trip times, standards relied on, limitations, and sample attachments.
    3. **Smoke Alarm Certificate**: All alarm schedule items, locations, brands/models, power sources, AS 3786 standards, test results, scope of work, and sample attachments.
    4. **TCA1 Cabling Advice**: Registered cabler, registration number, employer, location, scope of work, supervision, and certification statement.
    5. **TCA2 Cabling Defect Notice**: Inspected locations, cabling types/scope, defect description, risk category, urgency, standards reference, and rectification recommendation.
  - **Zero-Fallback Policy**:
    - When a form is signed (`signedOff: true`), printable preview and certificate delivery email MUST render content exclusively from `fullSnapshot`.
    - If `fullSnapshot` is missing or invalid JSON, render a high-visibility error boundary: `"DOCUMENT CORRUPTION ERROR: Immutable snapshot missing on finalized certificate. Live field fallback prohibited."`
    - In `validateJobCompletion`, check only `tca2Audit.customerAcknowledged` from the authoritative audit store. A missing audit record fails completion validation immediately without falling back to `tca2.customerAcknowledged`.

---

## 3. Additional Workflow Invariants & Edge Cases

### A. Scheduling & Reopening State Invariants
- **Unscheduled Assignment**: `createJob()` allows assigning a technician (`assignedTechId`, `assignedTechName`) while leaving `scheduledDate = null`, `scheduledTime = null`, `status = 'NEW'`, and `appointmentStatus = 'UNSCHEDULED'`.
- **Reopening Cancelled Jobs**: When `reopenCancelledJob(jobId)` is invoked:
  - If the cancelled job had a complete appointment tuple (tech + date + time), it reopens as `SCHEDULED`.
  - If date or time was absent or cleared upon cancellation, it MUST reopen as `status = 'NEW'` and `appointmentStatus = 'UNSCHEDULED'`, preventing orphan "SCHEDULED" states without bookings.

### B. Draft Business Profiles Isolation & Validation
- **Field Persistence**: Persist all draft form fields: `name`, `tagline`, `slug` (Brand ID), `primaryColor`, `accentColor`, `legalIssuerName`, `abnPlaceholder`, `electricalLicencePlaceholder`, `acmaCablerPlaceholder`, `qbccLicencePlaceholder`.
- **Slug Uniqueness**: Validate that the draft slug does not collide with existing operational brands (`solarcell`, `smart_home`, `cctv`) or existing draft businesses.
- **Runtime Isolation**: Ensure draft businesses cannot be selected in work order creation, invoicing, quotation, or compliance certificate workflows (enforced via explicit runtime brand checks, not just UI dropdown filtering).

---

## 4. Test Verification & Reporting Standards

Test results must follow calibrated reporting categories rather than misleading aggregate pass counts:
- **PASS**: Pure domain logic, component rendering, access control, state transitions, and integration tests executed in the Node.js/tsx environment.
- **SKIPPED / NOT RUN**: Pixel-by-pixel rendering and headless browser E2E tests where browser binaries or GPU rasterization engines are unprovisioned in the container environment.
- **FAILED**: Any test revealing an actual CABMS functional defect or regression.
- **UNAVAILABLE**: Any requested capability absent from the runtime environment.
- Keep `tsc --noEmit` static type-check results strictly distinct from ESLint/runtime tests.

---

## 5. Execution Appendix & Delivery Gates

| Item | Specification |
|---|---|
| **Product / Group** | CABMS / existing G00 Prototype Demo |
| **Baseline Main Commit** | `ba9296e373e5f6fad53cc603cafdc8b163426474` |
| **Working Branch** | Proposed `feat/g00-workflow-integrity` (subject to approval) |
| **In Scope** | Focused state model, coupled TCA2 transition, Layer 6 test harness, review PENDING queue, complete frozen snapshots, appointment reopening invariants, draft profile persistence, and fixture correction. |
| **Out of Scope** | External backend databases, live third-party cloud APIs, external OAuth redirects, unrelated visual redesigns. |
| **Estimated Effort** | 8–16 focused engineering hours (planning approximation). |
| **Acceptance Criteria** | 100% passing executed unit/integration tests (with explicit SKIPPED markings for unprovisioned browser layers), clean type-check/build output, atomic state transitions verified. |
| **Git & Release Safety** | Zero automatic commits, pushes, merges, resets, destructive cleanups, or production deployments without explicit user authorization. |
