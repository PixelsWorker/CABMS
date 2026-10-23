# CABMS G00 — Remediation & Verification Plan (Revised)

This revised plan addresses the eight audit adjustments for CABMS G00. It strengthens state consistency, appointment modeling, document immutability, template and job-type version governance, and test integrity within the existing synthetic-only application.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following corrections from the G00 plan review are incorporated:

- **1. Certificate & Audit Record Separation**: The signed TCA2 document (`Tca2CertData`) remains strictly immutable once signed off. Customer acknowledgement, office review, and follow-up links are stored in separate audit structures (`tca2AuditEvents` / `Tca2AuditRecord`), eliminating post-signature mutations of the certificate object.
- **2. Idempotent TCA2 Follow-up Generation**: `officeReviewTca2(jobId)` performs atomic state-operation validation. It verifies role permission, confirms the prerequisite signed TCA2 exists, and checks that no follow-up job has already been queued for that certificate, preventing duplicate jobs from rapid consecutive clicks.
- **3. Complete Appointment Modeling**:
  - `appointmentStatus` type is updated to `'UNSCHEDULED' | 'SCHEDULED' | 'RESCHEDULED' | 'CANCELLED'`.
  - Unscheduled/unassigned jobs have `scheduledDate: null`, `scheduledTime: null`, no active appointment reminders, and `calendarSyncStatus: 'PENDING'`.
  - `JobsView` and `createJob` will no longer inject placeholder booking dates when an appointment has not been scheduled.
- **4. Operational Brands & Add Business Support**:
  - The three active operational brands remain `solarcell`, `smart_home`, and `cctv`.
  - The type system retains support for custom/draft business IDs (e.g. `BrandId = 'solarcell' | 'smart_home' | 'cctv' | (string & {})`) so the previously approved Add Business screen continues to function as a clearly labeled future-business draft preview without runtime type breakage or silent removal.
- **5. Job-Type Version Governance**:
  - Updating a job type's compliance matrix increments its version (e.g. `v4.2` → `v4.3`) and logs a revision history entry.
  - Existing jobs retain their original requirement snapshots (`formsRequired` and `jobTypeVersion`), preventing policy updates from retroactively altering in-flight or completed jobs.
- **6. UNCERTAIN State in Automation Lifecycle**:
  - Review automation models the complete lifecycle: `PENDING → SENT / FAILED / UNCERTAIN`.
  - An uncertain outcome remains in `UNCERTAIN` until a reconciliation action confirms delivery (transitioning to `SENT`) or confirms failure (transitioning to `FAILED` with retry enabled).
- **7. Real Context Operations in Test Suites**:
  - Layer 6 integration tests will invoke actual `CabmsContext` methods (`createJob`, `prepareQuoteForJob`, `acceptQuote`, `signOffJsa`, `signOffElectrical`, `completeJob`, `officeReviewTca2`) rather than manually constructing expected states or directly altering object properties.
  - Layer 4 component tests will verify interaction lifecycle and form submission handling in addition to static text assertions.
- **8. Honest Visual & Browser Test Reporting**:
  - Layers 7 and 8 are explicitly scoped to structural DOM contracts, viewport responsiveness attributes, bundle inspection, and network isolation checks.
  - Real browser execution (Chromium/Playwright) and pixel screenshot comparison are explicitly reported as `NOT RUN` / skipped when headless browser binaries are unavailable in the container environment.

---

### 1. Overview & Core Concept

- **What It Does**: Hardens operational state transitions, audit-trail separation, appointment scheduling, and configuration version control across the CABMS application without introducing external dependencies or altering the synthetic-only demo posture.
- **Target Audience / Persona**:
  - *Super Admin*: Brand identity, integration health, and business master configuration.
  - *Owner / Admin*: Template approval gates, financial authorizations, and job-type compliance matrices.
  - *Office Staff*: Customer intake, job dispatch, schedule coordination, and TCA2 defect follow-up reviews.
  - *Field Technician*: Safety JSA execution, on-site test recordings, and immutable certificate sign-offs.
- **Key Value**: Delivers auditable, reproducible business workflow demonstrations across all ten G00 application areas (A–J), ensuring that synthetic state transitions faithfully model real enterprise operations.

---

### 2. User Experience & Affected UI Components

- **`src/context/CabmsContext.tsx`**:
  - Core state controller: houses updated appointment statuses, immutable certificate handling, separate TCA2 audit storage, idempotent follow-up generation, job-type versioning, and automation lifecycles.
- **`src/views/JobsView.tsx`**:
  - Creation modal: allows leaving date/time blank when creating an unassigned job.
  - Job card & details: displays `'UNSCHEDULED'` badge in neutral/amber styling when unassigned; hides calendar booking times for unscheduled work.
- **`src/views/ScheduleView.tsx`**:
  - Clearly partitions scheduled and rescheduled appointments from unscheduled jobs awaiting assignment.
- **`src/views/ComplianceFormsView.tsx`**:
  - Displays frozen status badge and locks all inputs when a certificate is signed.
  - Attachment upload/removal buttons are disabled with tooltip explanation once signed.
  - TCA2 Defect view displays technician certification as permanently frozen, rendering customer acknowledgement and office review in a dedicated chronological audit panel.
- **`src/views/TemplatesSettingsView.tsx`**:
  - Template versioning enforces the three-step flow: `DRAFT` → `REVIEW` → `PUBLISHED`.
  - Job Type settings enable versioned policy updates: editing required compliance forms creates a new version while displaying historical version tags.
  - Add Business screen remains accessible as a labeled future-business draft preview.
- **`src/views/CommunicationsView.tsx`**:
  - Customer review automation displays `PENDING`, `SENT`, `FAILED`, and `UNCERTAIN` statuses with reconciliation and controlled retry controls.
  - Certificate delivery log shows complete frozen snapshot content and recipient details.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Separate Certificate Audit Storage from Signed Forms**
  - *Chosen Approach*: `tca2Certs[jobId]` represents the technician's signed defect report, frozen in its entirety at signature time. Subsequent events (customer acknowledgement and office review) are stored in `tca2AuditEvents[jobId]` with independent timestamps, actor personas, and follow-up job references.
  - *Why*: Prevents modifying signed certificate data and avoids snapshot divergence.
- **Decision 2: Atomic Guard for TCA2 Follow-up Creation**
  - *Chosen Approach*: `officeReviewTca2(jobId)` checks if a follow-up job is already recorded in `tca2AuditEvents[jobId]?.rectificationFollowupJobId` or if an existing job references this TCA2. If present, the operation exits immediately with an informative message.
  - *Why*: Eliminates race conditions and duplicate job generation from rapid UI clicks.
- **Decision 3: Nullable Booking Dates for Unscheduled Jobs**
  - *Chosen Approach*: When a job is created without an assigned technician or booking slot, `scheduledDate` and `scheduledTime` are set to `null` (or empty string in UI fields), and `appointmentStatus` is set to `'UNSCHEDULED'`. No reminder entries are generated.
  - *Why*: Eliminates phantom appointments and misleading calendar sync states.
- **Decision 4: Versioned Job-Type Policy Governance**
  - *Chosen Approach*: Updating a job type creates an updated config record with an incremented version (e.g. `v4.3`), while existing jobs retain their created `formsRequired` and `jobTypeVersion`.
  - *Why*: Prevents policy changes from altering compliance requirements on in-progress or closed jobs.
- **Decision 5: Ordered Build & Test Execution**
  - *Chosen Approach*: Configure the test script in `package.json` to run TypeScript validation and Vite build sequentially before executing test layers, ensuring dependent asset checks (such as `dist/` bundle inspection in Layer 8) never suffer from race conditions.
  - *Why*: Guarantees deterministic, reproducible test results on clean checkouts.

---

### 4. Technical Architecture & Data Strategy

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             CABMS Application Shell                              │
│   Solarcell (#f59e0b)  │  GC Smart Home (#0284c7)  │  GC CCTV (#059669)          │
│   + Future Business Draft Preview Mode                                           │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         CabmsContext State Controller                            │
│                                                                                  │
│  ┌──────────────────────────┐  ┌────────────────────────┐  ┌──────────────────┐  │
│  │ Compliance Certificates  │  │ TCA2 Independent Audit │  │ Job & Dispatch   │  │
│  │ - JSA / Electrical       │  │ - Customer Ack Record  │  │ - UNSCHEDULED    │  │
│  │ - Smoke Alarm / TCA1     │  │ - Office Review Record │  │ - SCHEDULED      │  │
│  │ - TCA2 (Frozen Snapshot) │  │ - Single Follow-up Link│  │ - RESCHEDULED    │  │
│  └──────────────────────────┘  └────────────────────────┘  └──────────────────┘  │
│  ┌──────────────────────────┐  ┌────────────────────────┐  ┌──────────────────┐  │
│  │ Review Automation Engine │  │ Template & Job Types   │  │ Attachment Lock  │  │
│  │ - PENDING → SENT         │  │ - DRAFT→REVIEW→PUB     │  │ - Form-signed    │  │
│  │ - FAILED / UNCERTAIN     │  │ - Versioned Job Types  │  │   check across   │  │
│  │ - Reconcile / Retry      │  │ - Job snapshot lock    │  │   all 5 types    │  │
│  └──────────────────────────┘  └────────────────────────┘  └──────────────────┘  │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        Eight-Layer Verification Suite                            │
│  L1: Toolchain Smoke (Ordered Build & Typecheck)                                │
│  L2: Domain & Business Rule Invariants (Real calculations)                       │
│  L3: Navigation & Access Boundaries (4 Personas)                                │
│  L4: Component Interaction Lifecycle (SSR DOM & Handlers)                       │
│  L5: Static Types & Interface Soundness                                         │
│  L6: Workflow Integration (Real context operations across journeys)             │
│  L7: Structural Viewport Contracts & DOM Invariants (Pixel tests marked NOT RUN)│
│  L8: Bundle Inspection & Network Isolation (Playwright marked NOT RUN if absent) │
└──────────────────────────────────────────────────────────────────────────────────┘
```

#### Detailed File Modifications

1. **`src/types/cabms.ts`**:
   - `BrandId`: `'solarcell' | 'smart_home' | 'cctv' | (string & {})` (three active operational brands plus extensible custom draft preview support).
   - `AppointmentStatus`: `'UNSCHEDULED' | 'SCHEDULED' | 'RESCHEDULED' | 'CANCELLED'`.
   - `Job`: `scheduledDate: string | null`, `scheduledTime: string | null`.
   - New `Tca2AuditRecord`: `{ jobId: string; customerAcknowledged: boolean; customerAckTimestamp?: string; officeReviewCompleted: boolean; reviewedByOfficeStaff?: string; officeReviewTimestamp?: string; rectificationFollowupJobId?: string }`.
   - `CertificateDeliveryRecord`: stores `fullFrozenDocumentSnapshot: string`.
   - `ReviewRequestStatus`: `'NOT_SENT' | 'PENDING' | 'SENT' | 'FAILED' | 'UNCERTAIN'`.
2. **`src/context/CabmsContext.tsx`**:
   - Add `tca2AuditEvents` state map.
   - `createJob`: Set `appointmentStatus` to `'UNSCHEDULED'` and dates to `null` if no active technician assignment is provided.
   - `signOffTca2`: Freeze document snapshot.
   - `customerAckTca2`: Mutate only `tca2AuditEvents`, leaving `tca2Certs` unmodified.
   - `officeReviewTca2`: Check `tca2AuditEvents[jobId]?.rectificationFollowupJobId` to ensure idempotent single follow-up creation.
   - `attachSampleToJobForm` & `removeSampleFromJobForm`: Check `!form.signedOff` across JSA, Electrical, Smoke Alarm, TCA1, and TCA2 before modifying job or form attachments.
   - `publishTemplateVersion`: Enforce that the active revision is in `'REVIEW'` status.
   - `submitTemplateForReview`: Transition target revision to `'REVIEW'`.
   - `updateJobTypeConfig`: Increment job type version and log revision.
   - `triggerReviewRequest`: Transition through `PENDING → SENT / FAILED / UNCERTAIN` with reconciliation and retry methods.
   - `sendCertificateEmail`: Capture `fullSnapshot` in delivery record.
3. **`src/views/JobsView.tsx` & `src/views/ScheduleView.tsx`**:
   - Support nullable dates, render `'UNSCHEDULED'` badge, and omit booking times for unscheduled jobs.
4. **`src/views/ComplianceFormsView.tsx`**:
   - Render TCA2 audit events from `tca2AuditEvents` in a dedicated audit section; disable attachment buttons on signed forms.
5. **`src/views/TemplatesSettingsView.tsx`**:
   - Wire template review gate and job-type version updates; preserve Add Business draft preview.
6. **`src/views/CommunicationsView.tsx`**:
   - Wire `PENDING`, `UNCERTAIN`, and `FAILED` review states with reconciliation and retry actions.
7. **`tests/layer6_workflow_integration.test.ts`**:
   - Realign Journey A to use JT-001 (`formsRequired: ['JSA', 'ELECTRICAL']`).
   - Call real context operations and verify that repeated `officeReviewTca2` calls create exactly one follow-up work order.
8. **`tests/layer4_components_interaction.test.ts`**:
   - Test component render states and interaction guards.
9. **`tests/layer7_visual_regression.test.ts` & `tests/layer8_browser_e2e.test.ts`**:
   - Reframe layer descriptions to structural/contract verification and report unavailable browser/pixel coverage as `NOT RUN` / skipped.
10. **`package.json`**:
    - Order test scripts so that build prerequisites complete prior to bundle and asset checks.

---

### 5. Verification & Acceptance Criteria

- **Acceptance Invariants**:
  1. *Signed TCA2 Invariance*: Calling `customerAckTca2` and `officeReviewTca2` does not mutate `tca2Certs[jobId]`.
  2. *TCA2 Follow-up Idempotency*: Multiple calls to `officeReviewTca2` on the same defect create exactly one follow-up job.
  3. *Truthful Scheduling*: An unassigned job has `appointmentStatus === 'UNSCHEDULED'`, `scheduledDate === null`, and zero scheduled reminders.
  4. *Universal Attachment Immutability*: Attempts to attach or remove files from signed forms (JSA, Electrical, Smoke Alarm, TCA1, TCA2) are rejected without touching job-level attachments.
  5. *Job Type Version Isolation*: Changing job-type rules increments the version; previously created jobs retain their historical required forms.
  6. *Review State Fidelity*: Review dispatches support `PENDING`, `SENT`, `FAILED`, and `UNCERTAIN` with controlled retry and reconciliation.
  7. *Test Honesty & Determinism*: `npm run build && npm run test` passes reproducibly without race conditions; unavailable browser environments are reported as `NOT RUN`.
- **Operating Guardrails**:
  - No commits, pushes, merges, or external deployments.
  - Zero live external network calls (pure synthetic isolation).
  - Scope remains strictly within CABMS G00.
