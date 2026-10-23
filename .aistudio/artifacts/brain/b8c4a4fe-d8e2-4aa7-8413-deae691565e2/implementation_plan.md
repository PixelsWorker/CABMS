# CABMS G00 — Remediation & Invariant Hardening Plan (Revised)

This plan defines the focused technical corrections for CABMS G00 based on the code review of commit `e33c45b9`. It hardens state invariants, preserves immutable signed demonstration documents with separate audit records, isolates non-operational draft business profiles from operational dispatch, and aligns verification tests with real application context operations.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following technical corrections and governance boundaries are incorporated into this revised plan:

- **1. TCA2 Completion Validation Dependency (P0)**:
  - `validateJobCompletion()` in `src/utils/cabmsLogic.ts` is updated to accept the separate `Tca2AuditRecord` alongside form records.
  - Verification of customer acknowledgement and office review reads strictly from `tca2AuditRecord.customerAcknowledged` and `tca2AuditRecord.officeReviewCompleted`, rather than looking for mutated properties on `Tca2CertData`.
  - `attemptCompleteJob()` in `src/context/CabmsContext.tsx` supplies `tca2AuditRecords[jobId]` to `validateJobCompletion()`.
  - Acceptance condition: A signed TCA2 notice with missing acknowledgement blocks job completion. Recording customer acknowledgement in `tca2AuditRecords` satisfies the validator without altering the technician's frozen certificate snapshot.
- **2. Single Authoritative State Atomicity & Ref Lifecycle (P0)**:
  - A unified atomic transition function `processOfficeReviewTca2()` computes the next state for both `tca2AuditRecords` and `jobs` in a single pass.
  - State atomicity is enforced at the controller level: synchronous execution tracking (`inFlightTca2ReviewsRef` and `createdFollowupJobIdsRef`) prevents duplicate work order generation from rapid consecutive clicks in the same tick.
  - Ref lifecycle is explicitly managed: refs are updated synchronously prior to state dispatch, reset upon `resetDemo()`, cleared if an operation fails or is rejected, and synchronized with committed state across re-renders.
- **3. Real Context-Action Integration Testing (P1)**:
  - Layer 6 tests exercise real `CabmsContext` operations (`officeReviewTca2`, `customerAckTca2`, `publishTemplateVersion`, `createJob`, `attemptCompleteJob`) alongside pure domain logic tests.
  - Recreated or imitation helper functions inside tests are eliminated.
  - Direct integration scenarios test consecutive synchronous calls to context actions without intervening React renders to verify duplicate rejection.
- **4. Observable Review PENDING State (P1)**:
  - Review dispatch establishes an observable `PENDING` state with an initial history entry before resolution to `SENT`, `FAILED`, or `UNCERTAIN`.
  - Pending-event processing is deterministically driven by the demo clock and dispatch lifecycle, allowing verification of duplicate dispatch blocking while in `PENDING` status.
  - Action-level guard on `reconcileReviewRequest()` restricts reconciliation strictly to requests with `status === 'UNCERTAIN'`.
- **5. Complete UI Coverage for Draft Business Profiles (P1)**:
  - Define a distinct `DraftBusinessProfile` type (`{ id, name, tagline, primaryColor, accentColor, logoGlyph, legalIssuerName, abnPlaceholder, isDraft: true, createdAt }`).
  - Drafts are stored in a dedicated `draftBusinesses` state array, completely separated from the operational `brands` map.
  - UI isolation is enforced across all surfaces:
    - `DemoControlsBar.tsx`: Brand selector displays strictly the 3 operational brands (`solarcell`, `smart_home`, `cctv`).
    - `SuperAdminSetupView.tsx`: Displays draft profiles in an independent "Draft Business Incubator (Non-Operational)" table with explicit draft badges.
    - `Navigation.tsx` & `JobsView.tsx`: Draft businesses cannot be selected for job creation, quoting, dispatch, or certificate issuance.
- **6. Dynamic Test Runner Reporting (P1)**:
  - Test scripts and documentation report actual test runner counts from `node:test` execution rather than hardcoded totals.
  - Skipped container tests (pixel-by-pixel rasterization in Layer 7 and real browser launch in Layer 8) are clearly flagged with diagnostic environmental reasons.
- **7. Precision in Verification Terminology (P2)**:
  - Layer 4 is accurately identified as SSR DOM render contracts and component state checks, not full browser event interaction.
  - Layer 7 DOM hashes are identified as deterministic structural checks compared against stored approved baseline strings.
  - Layer 8 is identified as bundle integrity, entry point inspection, and static network isolation auditing, with real browser launching marked as skipped when unprovisioned in the container environment.
  - `npm run lint` is preserved as a TypeScript static type check (`tsc --noEmit`).
- **8. Calibrated Synthetic Demo Scope & Release Guardrails (P2)**:
  - Terminology reflects CABMS as an auditable synthetic demonstration system with frozen demonstration records, provisional compliance documents, and unresolved statutory extracts (e.g. Electrical Part B).
  - Existing dark slate theme and visual styling are preserved without unrelated typography changes or redesigns.
  - Strict release boundaries: Proposed branch is `g00-invariant-remediation`, base commit is `e33c45b9`. Zero automatic Git commits, pushes, package installations, or external deployments.

---

### 1. Overview & Core Concept

- **What It Does**: Hardens operational state transitions, compliance document immutability, multi-brand isolation, and appointment scheduling across the CABMS synthetic demonstration application.
- **Target Personas**:
  - *Super Admin*: Operational brand configuration and draft business incubation.
  - *Owner / Admin*: Template approval gates, financial authorizations, and job-type compliance matrices.
  - *Office Staff*: Job intake, dispatch coordination, schedule management, and TCA2 defect follow-up reviews.
  - *Field Technician*: Site safety assessments (JSA), electrical test recording, and immutable compliance sign-offs.
- **Key Value**: Delivers auditable synthetic workflow invariants, frozen demonstration records, and clearly labelled provisional compliance documents across all ten G00 application areas (A–J).

---

### 2. User Experience & Visual Design

- **Theme & Palette**: Preserves the established dark slate theme (`#0F172A` background, `#1E293B` structural surfaces) with brand accents:
  - Solarcell: `#EA580C` (Orange)
  - GC Smart Home: `#0284C7` (Sky Blue)
  - GC CCTV: `#059669` (Emerald)
- **Compliance Forms & Audit Presentation**:
  - The technician's signed defect notice is rendered as permanently frozen, with input controls locked upon sign-off.
  - On unsigned notices, customer acknowledgement actions are hidden and disabled, displaying an informational note ("Awaiting technician sign-off").
  - Once signed, customer acknowledgement is enabled for authorized roles. Once acknowledged, it transitions to a read-only timestamp record.
  - Office review triggers the follow-up work order creation and logs the resulting work order reference into the chronological audit trail.
- **Document Print & PDF Preview**:
  - The primary document body reflects the technician's findings at the moment of sign-off.
  - Post-inspection customer acknowledgement and office review events are presented in an appended "Post-Inspection Audit Appendix" with dedicated date stamps, preserving the primary certificate's frozen snapshot.
- **Brand Management**:
  - Active operational brand switcher is strictly restricted to the 3 operating businesses.
  - Draft business profiles created via "Add Business" are displayed in a separate draft preview section with distinct non-operational status indicators.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: TCA2 Completion Validation Linked to Audit Store**
  - *Chosen Approach*: `validateJobCompletion()` accepts `tca2AuditRecord` and checks `customerAcknowledged` and `officeReviewCompleted` on that audit record.
  - *Why*: Decouples completion validation from the signed certificate data, allowing post-signature workflow progression without mutating frozen certificate snapshots.
  - *Alternatives Considered*: Updating certificate properties post-signature (rejected because it invalidates document freeze invariants).
- **Decision 2: Authoritative State Transition Helper with Synchronous Ref Tracking**
  - *Chosen Approach*: Consolidate TCA2 follow-up logic into a pure transition function `processOfficeReviewTca2()`, executed within `CabmsContext` and guarded by synchronous in-flight refs (`inFlightTca2ReviewsRef`).
  - *Why*: Guarantees that multiple calls within the same JavaScript tick or before a React re-render will never create duplicate follow-up work orders.
  - *Alternatives Considered*: Pure functional state updates without ref guards (rejected because closure reads in rapid succession can pass guards before state dispatches queue).
- **Decision 3: Observable Review Lifecycle with Explicit PENDING Phase**
  - *Chosen Approach*: `triggerReviewRequest()` sets `status: 'PENDING'` with a dedicated history entry before resolving to `SENT`, `FAILED`, or `UNCERTAIN`.
  - *Why*: Accurately models asynchronous dispatch lifecycles and provides an observable pending state that blocks duplicate concurrent dispatches.
  - *Alternatives Considered*: Immediate transition to terminal states (rejected because it bypasses the pending state invariant).
- **Decision 4: Strict Three-Brand Typing with Separate Draft Business Store**
  - *Chosen Approach*: Operational `BrandId` is typed strictly as `'solarcell' | 'smart_home' | 'cctv'`. Draft profiles use `DraftBusinessProfile` and are stored in a dedicated `draftBusinesses` array.
  - *Why*: Completely isolates operational dispatch and compliance workflows from non-operational draft entities while preserving the "Add Business" incubation feature.
  - *Alternatives Considered*: Permitting arbitrary string brand IDs (rejected because it weakens operational boundaries).

---

### 4. Technical Architecture & Data Strategy

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             CABMS Operational Shell                              │
│   Operational Brands: Solarcell  │  GC Smart Home  │  GC CCTV                    │
│   Draft Profiles: draftBusinesses[] (Isolated from operational switcher)        │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         CabmsContext State Controller                            │
│                                                                                  │
│  ┌──────────────────────────┐  ┌────────────────────────┐  ┌──────────────────┐  │
│  │ Compliance Certificates  │  │ Authoritative Audit    │  │ Job Scheduling   │  │
│  │ - JSA / Electrical       │  │ - TCA2 Audit Store     │  │ - Complete Tuple │  │
│  │ - Smoke Alarm / TCA1     │  │ - Atomic Follow-up     │  │   (Tech+Date+Time)│  │
│  │ - TCA2 (Pre-frozen)      │  │   Ref Guard & Reset    │  │ - Nullable Dates │  │
│  │ - Multi-form Attach Sync │  │ - Signed-only Cust Ack │  │ - UNSCHEDULED    │  │
│  └──────────────────────────┘  └────────────────────────┘  └──────────────────┘  │
│  ┌──────────────────────────┐  ┌────────────────────────┐  ┌──────────────────┐  │
│  │ Review Automation Engine │  │ Completion Validator   │  │ Template History │  │
│  │ - PENDING → SENT/FAIL/UNC│  │ - Form Records +       │  │ - Retain Review  │  │
│  │ - Reconcile UNCERTAIN    │  │   TCA2 Audit Record    │  │   Audit Event in │  │
│  │ - Controlled Retry       │  │ - Defect Ack Required  │  │   revisions[]    │  │
│  └──────────────────────────┘  └────────────────────────┘  └──────────────────┘  │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        Authoritative Test Verification                           │
│  L1: Toolchain Smoke (Sequential build verification, tsc --noEmit check)         │
│  L2: Domain & Business Rule Invariants (Real calculations & validators)          │
│  L3: Navigation & Access Boundaries (Role-based access matrix)                   │
│  L4: Component Render Contracts (SSR DOM structure & interactive attributes)     │
│  L5: Static Types & Interface Soundness                                         │
│  L6: Workflow Integration (Context actions + pure domain logic; no local mocks)  │
│  L7: Structural DOM Viewport Contracts (Approved baseline hash comparison)       │
│  L8: Bundle Inspection & Network Isolation (Real browser skipped with note)      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

#### Detailed Code Changes

1. **`src/types/cabms.ts`**:
   - `BrandId`: Strict union `'solarcell' | 'smart_home' | 'cctv'`.
   - New `DraftBusinessProfile`: `{ id: string; name: string; tagline: string; primaryColor: string; accentColor: string; logoGlyph: string; legalIssuerName: string; abnPlaceholder: string; isDraft: true; createdAt: string }`.
   - `Tca2AuditRecord`: Retain independent audit structure (`customerAcknowledged`, `customerAckTimestamp`, `officeReviewCompleted`, `reviewedByOfficeStaff`, `officeReviewTimestamp`, `rectificationFollowupJobId`, `history`).
   - `CertificateDeliveryRecord`: Requires `fullFrozenDocumentSnapshot: string`.
2. **`src/utils/cabmsLogic.ts`**:
   - Update `validateJobCompletion()` signature to accept `(job: Job, forms: FormMap, tca2Audit?: Tca2AuditRecord)`.
   - Update TCA2 validation check: verify `tca2Audit?.customerAcknowledged` and `tca2Audit?.officeReviewCompleted` rather than reading mutated fields on the certificate.
   - Add `processOfficeReviewTca2()`: Pure transition helper computing the atomic follow-up job and updated audit record.
   - Add `processCustomerAckTca2()`: Pure validator enforcing `tca2Cert.signedOff === true`, allowed actor, and unacknowledged precondition.
   - Add `recalculateJobAttachments()`: Computes the union of attachment IDs across all forms on a job, preserving evidence on signed forms.
   - Add `processPublishTemplate()`: Enforces `activeStatus === 'REVIEW'` and preserves the reviewed revision in `revisions[]`.
   - Add `processReviewDispatch()`: Manages transitions through `PENDING` to terminal states.
3. **`src/context/CabmsContext.tsx`**:
   - Incorporate `draftBusinesses` state and `createDraftBusiness()`.
   - Integrate `processOfficeReviewTca2()` with `inFlightTca2ReviewsRef` and `createdFollowupJobIdsRef` to guarantee single follow-up work order creation across rapid synchronous calls.
   - Add ref reset logic in `resetDemo()`.
   - Update `attemptCompleteJob()` to pass `tca2AuditRecords[jobId]` to `validateJobCompletion()`.
   - Update `customerAckTca2()` to require `signedOff === true` and permitted persona.
   - Update `removeSampleFromJobForm()` to recalculate job-level attachments using `recalculateJobAttachments()`.
   - Update `createJob()` to require complete appointment tuple (`assignedTechId`, `scheduledDate`, `scheduledTime`) before assigning `SCHEDULED`; otherwise set `UNSCHEDULED` and clear dates to `null`.
   - Update `reconcileReviewRequest()` with an action guard requiring `status === 'UNCERTAIN'`.
4. **`src/views/SuperAdminSetupView.tsx` & `src/components/DemoControlsBar.tsx`**:
   - `DemoControlsBar.tsx`: Restrict operational brand selector to the 3 active brands.
   - `SuperAdminSetupView.tsx`: Render draft business profiles in a separate incubator panel with draft tags; preserve the "Add Business" creation modal saving to `draftBusinesses`.
5. **`src/views/ComplianceFormsView.tsx`**:
   - Hide/disable customer acknowledgement button if `!currentTca2.signedOff` or if already acknowledged.
   - Update print modal to render the frozen TCA2 document body and append a separate dated "Post-Inspection Audit Appendix" displaying `currentTca2Audit` data.
6. **`src/data/seedData.ts`**:
   - Pre-populate `frozenIssuerSnapshot` and `fullSnapshot` in all initial signed certificate fixtures (`INITIAL_SMOKE_ALARM_CERT`, `INITIAL_ELECTRICAL_CERT`, `INITIAL_TCA1_CERT`, `INITIAL_TCA2_CERT`).
7. **Test Suites (`tests/`)**:
   - `layer6_workflow_integration.test.ts`:
     - Refactor to exercise real `CabmsContext` operations and authoritative logic helpers.
     - Add test for TCA2 completion validation: verify completion is blocked on unsigned/unacknowledged TCA2, and succeeds once acknowledged in the audit store without modifying the frozen certificate.
     - Add test for atomic office review: invoke two consecutive calls without intervening re-render, asserting exactly one follow-up job is created.
     - Add test for multi-form attachment recalculation: verify removing an attachment from JSA does not remove it from the job if Electrical still uses it.
     - Add test for observable `PENDING` review state and duplicate blocking.
   - `layer7_visual_regression.test.ts`:
     - Compare rendered DOM strings against approved baseline hashes.
     - Mark pixel rasterization as skipped with environmental notice.
   - `layer8_browser_e2e.test.ts`:
     - Mark real browser execution as skipped with environmental notice; verify bundle assets and network isolation.
   - `layer1_toolchain.test.ts` & `package.json`:
     - Update Layer 1 to inspect the build output of `npm run build` instead of triggering a concurrent rebuild.
     - Ensure test scripts run sequentially without build races.

---

### 5. Verification & Acceptance Criteria

- **Automated Verification Pipeline**:
  - `npm run lint` (`tsc --noEmit`) passes with 0 errors.
  - `npm run build` builds production bundle cleanly in `dist/`.
  - `npm test` runs all layers sequentially and reports runner totals with 0 failures and transparent skips for unprovisioned browser/rasterization tests.
- **Operating Guardrails & Release Boundaries**:
  - Target branch: `g00-invariant-remediation` (Base commit: `e33c45b9`).
  - Scope strictly limited to CABMS G00 application and tests.
  - Zero external network dependencies, live OAuth calls, or external service endpoints.
  - No Git commits, pushes, package additions, or external deployments.
