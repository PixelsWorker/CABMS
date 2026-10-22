# CABMS G00 - Planned vs Implemented: Consolidated Workflow and UI/UX Audit

**Report date:** 22 October 2026  
**Repository:** PixelsWorker/CABMS  
**Branch inspected:** main  
**Pinned commit:** `6862b78113cc0b46b1e66b2c73e755ef823d217e`  
**Review status:** RESEARCH / READ-ONLY AUDIT - NOT AN IMPLEMENTATION AUTHORIZATION  
**Recommendation:** Do not mark G00 complete or authorize G01 on the basis of this snapshot.

## Executive verdict

The repository contains a substantial React/TypeScript/Vite demo, not an empty scaffold. The ten main view components cover much of the planned information architecture. However, **screen coverage is materially ahead of connected workflow coverage**. Several screens describe workflows that their actions and shared state do not implement, and several current paths display incorrect customer, issuer, signature or permission context.

The immediate work is to finish and correct **the existing G00 mock application**, not to add production integrations, replace the framework or start a new product. This is suitable for an explicitly labelled early feedback walkthrough, not final G00 acceptance.

This report incorporates the detailed assessment Rockson supplied during the audit. Corroborated findings are retained, duplicates are consolidated, and additional source-supported issues are added. It also qualifies statements that would otherwise overreach the evidence: failure of a test result is not automatically a legal bar to every type of job closure; local operational drafts need not be prohibited when MYOB is unavailable, but must not masquerade as resolved financial records; no real runtime or image audit has been claimed.

**Register:** 42 issue clusters: 7 P0 G00-acceptance blockers, 28 P1 material workflow/export gaps, 7 P2 usability/governance refinements. These are review priorities, not vulnerability severity ratings or an estimated percentage complete. P1 core scope must also be resolved or explicitly excepted before final acceptance.

## 1. Evidence, baseline and limitations

### 1.1 What was actually read

The complete supplied `FULLSTACK-PROJECT-RULES.md` and `CABMS-DEVELOPMENT-MANAGER-STARTER-G00.txt`; the repository's own group plan, full Build prompt and focused iteration prompts; all ten view implementations; shared context/actions; types; seed data; pure business logic; all seven test definitions; shell/navigation/demo/denied components; manifest; HTML/entry/style/build/TypeScript configuration; environment example and ignore rules. The source register at the end records the exact paths.

GitHub metadata established public visibility, only `main` in the returned branch list and the pinned commit above. Pull requests, workflow runs, commit checks and status entries returned no records at the time of inspection. These observations do not prove that no local tests, external approvals or AI Studio walkthrough ever occurred. [META-BRANCH] [META-ROOT] [META-PRS] [META-RUNS] [META-CHECKS] [META-STATUS]

### 1.2 What was not done

No dependency installation, type-check, build, ESLint run, unit-test execution, Playwright/browser walkthrough, network interception, actual print/PDF inspection, deployment or live-provider verification was performed. The seven committed PNGs were counted from Git metadata but not visually reviewed. The uploaded screenshots from earlier conversation turns do not establish current-code behaviour. No full historical Git secret scan, licence/legal assessment or current package support/advisory audit was performed.

Observed code and inferred consequences are distinguished below. Reproduction steps are **proposed checks**, not successful execution receipts. No repository, branch, PR, setting, Drive source, email, integration or client record was changed. Only this requested review artifact was produced.

### 1.3 What G00 must and must not do

The supplied handoff and repository Build prompt require one complete, coherent mock application with A-J coverage, all ten original capability areas, shared typed synthetic state, meaningful interactions and representative error/denied states. Backend APIs and final operation-by-operation contracts are not prerequisites to G00. The later repository group plan reports React + TypeScript + Vite as the approved demo direction; this audit does not compare it against obsolete React Router/version proposals or recommend migration. [R01] [R02] [R03]

Real authentication, persistent server storage, live MYOB/Google/email calls, Gemini runtime, GCP provisioning, website rebuilding, detailed electronic signing and production legal validity are not G00 completion requirements. Detailed signing must remain visibly deferred, not declared delivered by manual referral. The $3,300 figure remains provisional rather than executable legal policy. [R02]

### 1.4 Corrections to the supplied assessment

- **Media count:** the inspected tree contains seven PNGs, not six. Their privacy/licence status remains unverified until reviewed. [META-MEDIA]
- **Office Staff:** viewing templates is a policy choice requiring consistency. The demonstrable defect is that a read-only/non-publishing staff persona can still mutate the template draft. [R08] [R10] [R06]
- **Failed results:** keep failing inspection results truthful and define applicable completion/rectification rules. Do not invent a universal rule that every Fail legally blocks every job closure. [R08] [R19]
- **Website failures:** a labelled unresolved operational draft can be a valid design. The current defect is the clean scheduled/invoiced conversion without carrying unresolved MYOB linkage. [R06]
- **Tooling files:** no CI, ESLint or a particular AGENTS/SETUP/TODO filename is not independently a product defect. Missing reproducible setup and actual acceptance evidence matters; use proportionate existing documents. [R21] [META-ROOT]
- **Library and platform remnants:** Gemini/Express packages and Cloud Run text do not prove a live service was used. They are configuration/intent drift requiring review. [R21] [R22] [R23]

## 2. What should be preserved

There is useful work here: a common shell and shared in-memory context, four demo personas, brand switching, customer search/entry and uncertainty UI, conditional job examples, separate operational/financial status types, a completion result rather than persisted COMPLETION_CHECK, reminder suppression, review duplicate guards, invalid acceptance-link scenarios, explicit deferred e-signing, unresolved certificate notices, a pending website inbox and seven pure-helper unit-test definitions. [R04] [R06] [R07] [R08] [R11] [R13] [R14] [R16] [R20]

Keep these foundations. In particular, do not remove the safety labels, restore amount-based legal routing, replace MYOB with an independent financial master, or introduce GCP services to compensate for missing frontend simulations.

## 3. A-J coverage comparison

| Area | Current assessment | Present in source | Material gap to the planned G00 |
|---|---|---|---|
| A. Shell/personas | Partial | Shared navigation, brand/persona selectors, demo banner, some denied screens | Sign-in simulation, consistent permissions, record-scoped navigation, reset and loading/error coverage |
| B. Super Admin | Partial | Single MYOB status model, partial brand fields, connection labels | Add Business/logo journey, contact/invoice mappings, editable Calendar/sender configuration, correct MYOB product wording |
| C. Owner settings | Major gaps | Template list, generic text editing, draft/publish buttons, static matrix | Working versions/review, bounded field/dropdown editing, email/reminder settings, simulated sample upload/mapping |
| D. Customers/jobs | Partial | Search, entry, job creation/list/detail and source ownership labels | Duplicate resolution, failed-draft recovery, assignment/lifecycle choices, actual customer/job history and financial handoff |
| E. Scheduling | Partial | Agenda, reschedule/cancel, suppressed-reminder history and Maps link | Correct lead times, editable mappings, event sync outcomes, usable date navigation, appointment/job separation |
| F. Technician forms | Major gaps | Five form families rendered, sign-off buttons, sample gallery, print modal | Editable fields, job-owned drafts, attachment links, truthful full-form previews and finalized snapshots |
| G. Completion | Partial | Missing-requirement result and state-preserving failure | Versioned applicable rules, complete-field validation, valid lifecycle transitions and explicit revisit/defect outcomes |
| H. Quotations | Partial / broken new-job path | One accepted fixture, quote preview, link-state simulator, deferred signing | Prepare/link/send workflow, no-quote state, safe scoped customer-link view and current Terms-version consumption |
| I. Communications | Major gaps | Review preview/deduplication, reminder rows, generic certificate copy | Event/clock-driven mock automation, confirmation/reminder bodies, selected-document delivery, pending/failed/recovery states |
| J. Website handoff | Mostly represented, unsafe failure path | Simulated pending inbox, convert/dismiss, processed log | Explicit match/type selection and preserved unresolved customer sync; no clean conversion on failed linkage |

Evidence: [R04]-[R19], [R32]. A visible screen is not equivalent to an implemented journey; no numeric completion percentage is assigned.

### Original ten-area requirement traceability

| Original requirement | G00 areas | Current outcome |
|---|---|---|
| REQ-01 Customers, operational jobs, history, permissions, mobile access | A/D/E/F/J | Partial; history, assignment, permission and new-job continuity incomplete |
| REQ-02 Quotes, contracts, acceptance and evidence | H/C | Basic accepted-quote presentation exists; prepare/accept-new journey unfinished; detailed signing deliberately deferred |
| REQ-03 Forms, reports, uploads/sign-off, PDFs and selected delivery | C/F/I | Major gaps in entry, document truthfulness and delivery |
| REQ-04 Three-brand branding | A/B/F/H/I | Partial; job-issued document identity is wrong in a cross-workspace case |
| REQ-05 Owner template/Terms/email editing | C | Major gaps in usable configuration/versioning |
| REQ-06 Appointment confirmations/reminders | E/I | Suppression represented; timing/processing/message configuration unfinished |
| REQ-07 Google review requests | B/I | Manual/dedup helpers present; automatic event and recovery journey unfinished |
| REQ-08 Mandatory completion requirements | C/G | Basic flags present; rule source/snapshot and contradictory transitions need work |
| REQ-09 MYOB, Calendar and Maps | B/D/E/H/I | Correctly mock-only; Maps example exists; MYOB/Calendar simulated operations incomplete |
| REQ-10 Maintainable future expansion | Shared types/state/config | A foundation exists; do not implement unrelated future modules |

The right remedy is to complete these minimum outcomes, not expand the MVP. [R01] [R02]

## 4. Critical journey breaks

| Journey | Intended connected sequence | Where the current source breaks it |
|---|---|---|
| New documentation job | Customer draft -> MYOB mock acknowledgement -> job/type/assignment -> quote -> appointment -> editable forms -> finalized documents -> completion -> selected delivery/review | Duplicate customer can be created; assignment forced; no quote preparation; new forms borrow signed seeds; message automation absent |
| Direct-to-invoice | Approved zero-form type -> operational job -> MYOB invoice preparation/status -> eligible review event | Checkbox can bypass requirements; invoice amount/reference generated without meaningful preparation; no invoice/review event transition |
| New website enquiry | Pending submission -> office match/review -> resolve MYOB customer -> select type -> draft/scheduled job | Failed customer sync still marked converted; forms/assignment/invoice invented by defaults |
| Template revision | Select synthetic sample -> review/mapping -> new revision -> publish -> new document uses revision -> prior signed record unchanged | No mapping action/review transition/new revision; published object is overwritten; new record does not consume published revision |
| Reschedule | New appointment revision -> old reminder suppressed -> new due time -> simulated calendar update -> one due message | Replacement reminder uses appointment time; Calendar status static; clock does not dispatch |
| Technician access | Sign-in persona -> assigned work only -> edit own forms -> demo sign-off -> lawful UX handoff | No sign-in; form job selector includes all work; office actions accessible; display can carry another job's signature |
| Customer acceptance | Prepare/link current MYOB quote -> scoped recipient view -> exact Terms -> consent -> one saved acceptance | Only seed quote already accepted; no new quote flow; fallback can show wrong quote or undefined; consent not bound/reset to selection |
| Brand/document control | Job-owned brand -> finalized issuer/content snapshot -> stable historical preview | Preview uses active workspace and live branding; signature/timestamp are unconditional |

Evidence: [R06] [R08]-[R19]. These are source-derived path analyses, not independently replayed UI test results.

### 4.1 Form-family detail: what the technician still cannot do

The field map in the repository Build prompt is more extensive than the form view currently implements. The following is a source comparison, not a legal assessment of statutory form completeness. Preserve all unresolved-source notices. [R02] [R09] [R07]

| Form family | Represented now | Missing or disconnected G00 behaviour |
|---|---|---|
| JSA / risk assessment | Site/personnel cards, hazard table, PPE/permit lists, emergency fields, one demo sign-off | Edit task/asset/personnel/date fields; meaningful induction/competency Yes/No; risk selections; add/edit/remove task rows; PPE Yes/No/N/A and notes; permit-required selections; complete document-control/review data. The UI displays green induction/competency/PPE checks and a fixed overall Low label rather than faithfully rendering all recorded values. |
| Electrical certificate | Test-results table, standards list, Part A placeholder, sign-off and missing-Part-B notice | Editable certificate/customer/occupier/contractor fields; repeatable tested-work/results; Pass/Fail selection; limitations/consumer-rights panels; signer context; full-form document output. Do not create the missing Part B. |
| Smoke-alarm certificate | Property summary, alarm table, provisional notice, sign-off | Editable issued-to/property/occupancy fields; scope-of-work checkboxes; add/edit/remove alarm rows; room/model selections; explicit per-test results/corrective notes; related electrical-certificate/attachment linkage and limitations. Button/interconnection tests are printed as Pass rather than using the corresponding boolean data. |
| TCA1 | Registered-cabler placeholder, work/location text, certification placeholder and sign-off | Editable cabler/employer/date/customer/contact/work fields; actual supervision choice; complete document output. The view prints supervision as Yes regardless of the underlying boolean. |
| TCA2 | Defect/risk/urgency/recommendation text, acknowledgement and office-review buttons | Editable scope/cabling types/locations/risk/urgency/party/target/quotation references; job-linked sample photo; scoped acknowledgement/version evidence; role-specific office review; a real mock follow-up record. The office-review toast says a rectification quote is queued, but the action only sets review flags. |

None of these requires collecting real signatures, opening real client files, adding cloud storage or implementing a general-purpose form designer. The approved G00 can use typed synthetic input, bounded fields and demo sign-off marks.

## 5. Consolidated findings register

Priorities: **P0** blocks truthful, coherent G00 acceptance; **P1** materially incomplete or inconsistent required workflow/export safety; **P2** usability, evidence or governance refinement whose final disposition must be explicit. None authorizes a code change. Corrections below are proposed acceptance outcomes, not an instruction to implement production services.

### G00-001 - Persona and assignment restrictions are not consistently enforced

**Priority:** P0 | **Area:** A/D/F/H/I/J | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Navigation marks restricted tabs as Denied but still invokes handleTabClick. QuotesAcceptanceView, CommunicationsView and WebsiteInboxView have no persona gate. ComplianceFormsView lists all jobs and exposes sign-off/customer-acknowledgement/office-review actions without assignment or role checks. JobsView denies an unassigned selected job, but its detail guard checks null assignment rather than ownership by the current technician. Office Staff can save template drafts even though publishing is disabled.

**Impact:** The mock demonstrates permissions that contradict its own role matrix. A technician can use ordinary UI controls to reach other work or office-only actions. This is a G00 behaviour defect, not a claim of a deployed security breach.

**Required correction:** Apply one demo permission policy to view entry, selected-record access and each protected mock action. Decide whether Office Staff may read templates; independently prevent unauthorized edits. Keep deliberate persona switching only in clearly labelled demo controls.

**Acceptance check:** Every restricted navigation action yields a coherent denied view; assigned-job filtering also applies to form and detail selectors. A second technician's job is denied. Office Staff cannot modify master templates. No denied action mutates state.

**Source locations:** [R05] [R04] [R09] [R10] [R12] [R13] [R15] [R16] [R08]

### G00-002 - The technician forms are primarily reports, not editable forms

**Priority:** P0 | **Area:** F | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** JSA hazards, risk levels, PPE, electrical results, smoke-alarm rows and TCA fields render as text/table cells. The main input is the job selector; most other interactions are sign-off buttons. updateJsaForm exists in context but is not consumed by the form view. There are no equivalent field-edit actions for the other certificates. Some test results and PPE indicators are rendered as fixed Pass/check marks.

**Impact:** The client cannot validate the actual onsite entry workflow, correction of failed results, repeated rows or required-field errors. A form-shaped screen does not deliver the planned digital-form demonstration.

**Required correction:** Add bounded editable fields from the sanitized specification, including Yes/No/N/A, Pass/Fail, text, dates and repeatable task/alarm/work rows. Save to the selected job's own mock record and validate before finalization. Do not add a general form builder.

**Acceptance check:** Edit a field and a failing test result in every form family; leave and return; preview the same values; show missing-field feedback. Add/remove a representative repeated row. Explicit demo sign-off binds the actual entered content.

**Source locations:** [R09] [R06] [R02]

### G00-003 - Document issuer comes from the workspace rather than the document/job

**Priority:** P0 | **Area:** B/F | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** The print-preview header and issuer/licence fields use activeBrand, while the selected job and form may belong to another brand. Changing a profile also changes the current brand object; no frozen issuer snapshot is used for historical output.

**Impact:** Selecting a CCTV job while the workspace remains Solarcell can show a Solarcell-issued document. Editing current branding can also change the presentation of a previously signed record.

**Required correction:** For drafts, resolve the issuer from the job's brand. At finalization, store the demo issuer/branding and template snapshot with the document. A workspace switch must not relabel a job or signed output.

**Acceptance check:** Preview a selected job under every workspace; the issuer stays correct. Rename/change the brand after signing; the prior document remains unchanged and a new draft uses the new branding.

**Source locations:** [R09] [R06] [R19]

### G00-004 - Certificate previews claim a signature that may not exist

**Priority:** P0 | **Area:** F/I | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** The print modal unconditionally says DEMO Sign-Off Applied and prints a fixed timestamp. It does not render the selected form's full answers. The certificate email preview enumerates formsRequired as Signed.pdf attachments without checking whether those records exist or are finalized.

**Impact:** An unsigned or missing document is presented as signed/ready to deliver. This misrepresents the core compliance workflow even with a demo banner.

**Required correction:** Render the selected document's actual draft/finalized state, signer, timestamp, answers, version and unresolved notices. Drive email attachment selection from real in-memory document records, not the required-form list.

**Acceptance check:** An unsigned form shows DRAFT/NOT SIGNED and no invented timestamp. A finalized form previews its own data and can be selected for mock delivery. Missing/unsigned forms cannot appear as signed attachments.

**Source locations:** [R09] [R15] [R06]

### G00-005 - New jobs inherit other jobs' forms and signed state

**Priority:** P0 | **Area:** D/F/G | **Origin:** Additional finding  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** ComplianceFormsView falls back to records for JOB-2026-101, JOB-2026-103 and JOB-2026-104 when the selected job has no form. Several fallback records are already signed. The sign-off actions separately initialize from constant seed objects and often replace only jobReference, retaining unrelated customer/site details. The completion helper, however, checks actual per-job state rather than these display fallbacks.

**Impact:** A newly created job can display another customer's answers/signature or have its sign button hidden because a fallback is signed, while completion reports its own document missing. The display and completion state disagree.

**Required correction:** Create an independent draft form instance for the job from template structure plus that job's fields. Never use another completed job's record as a fallback. Use explicit not-started/empty states, unique document IDs and correct job/customer/brand links.

**Acceptance check:** Create a new job requiring smoke/electrical/cabling forms. Each starts unsigned with the new site's details. It can be edited, signed and used by completion. Signing one job cannot sign or prefill unrelated job evidence.

**Source locations:** [R09] [R06] [R19]

### G00-006 - Quote fallback can show the wrong customer's quote or render undefined

**Priority:** P0 | **Area:** D/H | **Origin:** Additional finding  
**Evidence status:** VERIFIED SOURCE PATH; wrong-record/undefined-render consequences inferred, not browser-reproduced

**Observed:** QuotesAcceptanceView uses currentJob.quote || jobs[0].quote!; the non-null assertion does not create a quote. The seed contains one quote and it is already ACCEPTED. createJob prepends a job with no quote. Therefore an unquoted selected job may display another job's quote, and after prepending a new unquoted job both operands can be undefined before rendering quote.brandId and other properties.

**Impact:** The central quote journey is unsafe and may fail at runtime. A clean new acceptance cannot be exercised from the supplied accepted-only quote fixture through the normal UI.

**Required correction:** Remove cross-job fallback. Render explicit no-quote state, provide a linked mock quote preparation/selection path and a new SENT-but-unaccepted fixture. Validate that quote, job, customer and brand agree before display or acceptance.

**Acceptance check:** Open Quotes for each seeded job and for a newly created job: no crash and no other customer's quote. Prepare/link a mock quote, accept it once, then demonstrate repeat rejection and invalid-link cases.

**Source locations:** [R13] [R06] [R19]

### G00-007 - Immutable versioning is claimed but no working version lifecycle exists

**Priority:** P0 | **Area:** C/F/H | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** createTemplateDraft mutates the existing template record's content/status. publishTemplateVersion changes its status to PUBLISHED but creates no version record, increments no version and has no review transition. Form finalization stores sign-off booleans rather than a complete frozen content/template/issuer snapshot. Existing quote Terms snapshots are stored strings, which is useful, but no new-quote flow consumes a newly published version.

**Impact:** The planned old-version/new-version demonstration cannot be completed. A prefilled old quote staying unchanged is not evidence that the application correctly versions newly created records.

**Required correction:** Keep a stable template identity and separate immutable published revisions. Create/review/publish a new draft revision; bind new records to it; freeze finalized form and accepted quote evidence. Keep old versions accessible without editing them.

**Acceptance check:** Finalize/accept version A, publish version B, create a new record using B, and reopen A unchanged. Review/mapping steps work; publication cannot simply relabel the same mutable object.

**Source locations:** [R06] [R10] [R13] [R07]

### G00-008 - Conditional hook ordering makes persona changes a runtime risk

**Priority:** P1 | **Area:** A/B/C/D | **Origin:** User finding, corroborated  
**Evidence status:** VERIFIED SOURCE PATTERN and official rule; runtime effect not reproduced

**Observed:** SuperAdminSetupView, TemplatesSettingsView and CustomersView return on persona checks before later useState calls. Switching persona while the same view is mounted changes the hook sequence. React's official rules identify hooks after early returns as invalid.

**Impact:** The intended role-denied demonstration may itself cause hook-order failures instead of a stable screen. No actual crash was replayed in this audit.

**Required correction:** Keep hooks unconditional, or render a separately mounted authorized child beneath an unconditional permission gate. Do not remove permission checks as a workaround.

**Acceptance check:** Switch allowed/denied personas repeatedly while each affected view is open; no runtime error, stale content or state leakage. Record actual browser results.

**Source locations:** [R32] [R10] [R11] [EXT-REACT]

### G00-009 - Duplicate customer detection does not stop duplicate creation

**Priority:** P1 | **Area:** D | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** simulateCustomerWriteThrough calls checkCustomerDuplicate, shows a warning, then continues into success and adds a new MYOB-referenced customer. CustomersView ignores the returned duplicate flag, clears the form and closes the modal. Its success notification can replace the warning.

**Impact:** The demo advertises duplicate prevention while teaching the opposite workflow.

**Required correction:** Branch to an explicit match/review decision before creating a new simulated master. Offer select-existing, correct details or an expressly allowed distinct-record decision. Keep repeat submission idempotent for the same attempt.

**Acceptance check:** Submit the same email/phone twice. The user sees the match, can link the existing customer, and no second master is created by default. The resulting job uses the selected customer's fake MYOB ID.

**Source locations:** [R06] [R11] [R08]

### G00-010 - Disconnected MYOB and failed drafts do not have a coherent recovery path

**Priority:** P1 | **Area:** B/D | **Origin:** Additional finding  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Customer write-through checks FAILED but not DISCONNECTED, so a disconnected link can still produce SYNCED success. FAILED entries have no retry/edit recovery action in the customer cards; only UNCERTAIN entries expose reconciliation. PENDING_WRITE is typed/displayable but not meaningfully exercised. Discarding an uncertain duplicate leaves it as a FAILED selectable record.

**Impact:** Connectivity status does not govern dependent behaviour, and recoverable draft is a label without a complete recovery journey.

**Required correction:** Treat disconnected as a no-write state. Preserve draft content and offer deterministic pending, failure, reconciliation and resolved/cancelled outcomes. Keep unsynced drafts distinguishable in downstream selectors.

**Acceptance check:** Disconnect, enter a customer and observe no success ID. Reconnect and recover the same draft without a duplicate. Confirm-found, confirmed-not-created and unresolved reconciliation outcomes remain distinct.

**Source locations:** [R06] [R11] [R32]

### G00-011 - Website handoff reports conversion success despite unresolved customer sync

**Priority:** P1 | **Area:** D/J | **Origin:** User finding, corroborated and refined  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** convertEnquiryToJob uses newCust.customer.id without checking newCust.success or syncStatus. It then creates a scheduled job, pre-attaches an invoice and marks the enquiry CONVERTED_TO_JOB. Every enquiry is assigned JSA plus TCA1 regardless of its service. The matched-customer field is prefilled rather than an editable review decision.

**Impact:** A failed MYOB write looks like a clean, fully linked work order. The handoff also inserts arbitrary form requirements rather than selecting a job type.

**Required correction:** Add explicit matching, customer-sync resolution and job-type selection. Either wait for simulated acknowledgement or create a clearly labelled operational draft with unresolved linkage; do not imply a clean financial handoff. Keep source enquiry identity and repeat-conversion protection.

**Acceptance check:** With MYOB failed, convert a new-customer enquiry: it stays pending or becomes an explicitly unresolved draft. Resolve it once, choose job type and create/link one job. Repeat conversion does not create another job.

**Source locations:** [R16] [R06] [R19]

### G00-012 - The displayed mandatory-form matrix does not control job requirements

**Priority:** P1 | **Area:** C/D/G | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** TemplatesSettingsView renders a static table; job creation accepts free-text jobType and independently selected form checkboxes. No versioned rule record links the two. validateJobCompletion returns immediate success for isDirectToInvoice even if formsRequired is non-empty.

**Impact:** A staff checkbox can act as an undocumented exemption rather than an application of an approved job type. Historical requirement snapshots are not demonstrated.

**Required correction:** Use a small configurable synthetic job-type matrix and snapshot its requirements at job creation. Separate invoice routing from documentation applicability. Any override must be explicit, role-controlled and marked as demo policy rather than legal permission.

**Acceptance check:** Change a demo job type's requirements; new jobs adopt the new version while existing finalized jobs retain theirs. Conflicting direct-to-invoice and required-form data does not silently skip checks.

**Source locations:** [R10] [R12] [R06] [R08]

### G00-013 - Technician selection and unscheduled-job creation are missing

**Priority:** P1 | **Area:** D/E | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** JobsView always passes TECH-001 and a fixed technician name. createJob also defaults falsy assignment to TECH-001, preventing a deliberate null assignment. It always starts SCHEDULED and supplies date/time defaults. The user cannot create a genuinely new unassigned/unscheduled job and assign it later.

**Impact:** The client cannot review one of the basic office-to-technician coordination journeys.

**Required correction:** Add a small synthetic technician/unassigned selector and intentional appointment selection. Preserve an explicitly unassigned value and distinguish NEW from booked SCHEDULED state.

**Acceptance check:** Create an unassigned NEW job; assign a different synthetic technician; schedule it; switch personas and see only the appropriate assigned work. Do not add workforce planning or dispatch optimisation.

**Source locations:** [R12] [R06]

### G00-014 - Appointment cancellation and operational lifecycle are conflated

**Priority:** P1 | **Area:** D/E/G | **Origin:** Additional finding  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** cancelJobAppointment changes job.status to CANCELLED. The schedule still includes the record because it filters by date, not cancellation. JobsView offers Complete Job for any status other than COMPLETED, and completion has no cancelled-state guard. updateJobStatus exists but start-work/revisit/reopen transitions are not exposed coherently.

**Impact:** Cancelling a visit can cancel the whole job, and a cancelled job can subsequently complete without an explicit reopening decision.

**Required correction:** Define minimal demo job and appointment transitions separately. Show cancel-visit versus cancel-job explicitly; restrict completion to valid states; expose relevant start-work/revisit actions without inventing a complex workflow engine.

**Acceptance check:** Cancel a visit and retain the intended job state; cancel a job and prevent completion until an allowed transition. Revisit and reschedule are reflected consistently in job and schedule views.

**Source locations:** [R06] [R12] [R14] [R08]

### G00-015 - Customer, job, document and activity history is incomplete

**Priority:** P1 | **Area:** D/F/I | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Customer cards have no detail/history view or approved edit-through journey. Jobs show current details, invoice fields and requirement labels, but no comprehensive linked activity history. There is no independent document register connecting finalization, version, preview and delivery; review history is a separate narrow list.

**Impact:** Staff cannot follow one customer's earlier jobs, certificates, quote acceptance, scheduling changes and communications as requested.

**Required correction:** Add compact customer/job detail tabs backed by the same in-memory records. Link existing quotes, documents and communication events rather than building a new CRM/accounting product.

**Acceptance check:** Open a shared customer, inspect jobs across permitted brands, open one job's versions and correspondence, and follow back-links without losing context. New actions append meaningful activity.

**Source locations:** [R11] [R12] [R06] [R07]

### G00-016 - MYOB quote preparation and management cannot be demonstrated

**Priority:** P1 | **Area:** D/H | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** The quotation screen displays existing job.quote objects and can accept them, but exposes no create/link/prepare/update/send/revoke/revise mock workflow. Context exports quotes: {} and no quote-preparation action. The single seed quote is already accepted.

**Impact:** The owner requirement to prepare/manage quotes and the plan's customer/job-prefilled MYOB path are not represented end to end.

**Required correction:** Add a minimal mock MYOB quote reference/preparation experience using selected customer/job context and a source-branded fixture. Demonstrate issuing a basic acceptance link and revising/revoking it. Do not create a competing financial engine.

**Acceptance check:** A new job can obtain a mock MYOB quote, preview the right brand and Terms version, issue a simulated link and progress to accepted history.

**Source locations:** [R13] [R06] [R19] [R02]

### G00-017 - The customer-link experience and acceptance context are incomplete

**Priority:** P1 | **Area:** H | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Acceptance is embedded inside the staff screen, which still exposes job selection/navigation. Checkbox and feedback state are not reset when the selected job changes. Acceptance history writes hardcoded Terms v2.4 and signer from siteContact. Invalid-link outcomes are chosen by an independent scenario rather than a coherent quote/link revision state.

**Impact:** The client cannot evaluate the minimal standalone recipient experience, and a later multi-quote flow could carry consent/feedback from the wrong quote.

**Required correction:** Provide an isolated demo customer-link view with only its scoped quote, versioned Terms and explicit consent. Bind/reset consent to quote and revision; use actual demo acceptance evidence. Keep scenario controls separate from recipient UI.

**Acceptance check:** Open two different mock links: no consent carries between them. Valid, invalid, expired, revoked, superseded and already-accepted cases behave consistently, and repeat acceptance adds no duplicate success event.

**Source locations:** [R13] [R06] [R04]

### G00-018 - Invoice/payment preparation and uncertain-write recovery are only labels

**Priority:** P1 | **Area:** D/H/I | **Origin:** Additional finding  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** New jobs receive a default 350.00 invoice with a fake reference regardless of job content. The invoice panel is read-only; there is no mock prepare/link/status/reconciliation action. Direct-to-invoice completion therefore does not demonstrate the planned financial handoff.

**Impact:** Invoice-triggered review automation and the direct-to-invoice journey have no meaningful event to follow.

**Required correction:** Use an explicit minimal MYOB-linked invoice preparation/selection and status simulation. Keep financial state separate; require reconciliation before retrying an uncertain write. Do not implement tax, payments or accounting.

**Acceptance check:** A no-quote/no-form job can prepare/link a suitable synthetic MYOB invoice, show issued/payment states and simulate an uncertain result without inventing a second invoice.

**Source locations:** [R06] [R12] [R07] [R19]

### G00-019 - Reminder lead times are calculated incorrectly

**Priority:** P1 | **Area:** E/I | **Origin:** User finding, corroborated  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** rescheduleJobAppointment creates REMINDER_2HR at newDate + newTime, exactly the appointment time. createJob uses 07:00 irrespective of selected appointment time. There is no configurable reminder lead-time source.

**Impact:** The demo's central appointment automation shows the wrong send time despite correct suppression of old undelivered reminders.

**Required correction:** Derive reminder due times from the selected appointment and demo lead-time settings in one consistent business timezone. Retain suppression history and appointment revision identity.

**Acceptance check:** Book 14:00 with a two-hour reminder: it is due 12:00. Reschedule across a date boundary: old unsent reminder is suppressed and the replacement has the correct prior date/time.

**Source locations:** [R06] [R14] [R15]

### G00-020 - The virtual clock does not drive notification or Calendar outcomes

**Priority:** P1 | **Area:** E/I | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** advanceClock updates only the displayed clock and a toast. It does not process due reminders, send confirmations, change delivery outcomes or reconcile Calendar events. Calendar Synced labels are fixed presentation text, not per-appointment state.

**Impact:** The automation system's most important time-based behaviour cannot be reviewed even as a deterministic mock.

**Required correction:** Add a small in-memory event/due-action simulator controlled by the fixed clock and explicit outcomes. Booking, changing, cancelling and completion should create appropriate mock events without any live worker/API.

**Acceptance check:** Advance across a due time and see one pending-to-sent/failed/uncertain action. Advancing again does not resend. A failed Calendar update preserves the local appointment and shows recoverable sync status.

**Source locations:** [R06] [R14] [R17] [R15]

### G00-021 - Review requests have deduplication but no full trigger/recovery workflow

**Priority:** P1 | **Area:** I | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Manual actions jump directly to SENT or UNCERTAIN. No normal PENDING or definitive FAILED transition is generated. Job completion and invoice status do not invoke automatic scenarios. reconcileReviewRequest always confirms SENT; it cannot represent confirmed non-delivery or unresolved outcomes. The helper correctly blocks existing SENT/PENDING/UNCERTAIN requests.

**Impact:** The useful deduplication rule is not enough to demonstrate automatic versus manual review invitations and safe retry behaviour.

**Required correction:** Keep one logical request per job; add explicit manual and named automatic demo events, outcome transitions and reconciliation choices. Treat trigger policy as provisional. Do not invent a cross-job cooldown or sentiment gating.

**Acceptance check:** Manual and automatic triggers converge on the same request. Pending and uncertain block duplicate sends; confirmed non-delivery permits one controlled retry; unresolved stays uncertain; sent remains terminal for that invitation.

**Source locations:** [R06] [R08] [R15] [R17]

### G00-022 - Selected-certificate delivery and appointment email previews are unfinished

**Priority:** P1 | **Area:** F/I | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Communications shows review copy, reminder status rows and a generic certificate message. It does not offer a working selection of finalized documents, recipient/brand preview, mock dispatch action or delivery record. Appointment confirmation and reminder email body previews are not fully represented.

**Impact:** The owner cannot validate which reports are sent, what the recipient sees or how failure is recovered.

**Required correction:** Use finalized in-memory documents plus editable approved-template simulations to compose branded previews. Add a simulated send action and linked status/history for each message type.

**Acceptance check:** Select two finalized certificates, preview the intended recipient/brand/versions, simulate failed delivery and recover it without changing document content. Show confirmation and reminder previews reflecting a rescheduled visit.

**Source locations:** [R15] [R09] [R06]

### G00-023 - Calendar, sender and connection setup are mostly static

**Priority:** P1 | **Area:** B/E | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** SuperAdminSetupView displays a fixed sender/SMTP host and primary plus three hardcoded Calendar labels. There are no editable Calendar selections or permissions/error/reconnect scenarios. MYOB setup is status-toggle based rather than a coherent Connect MYOB consent-result mock. Contact/sender changes do not drive notification previews.

**Impact:** The configurable setup journey cannot be demonstrated. Four existing labels are not the same as choosing a primary plus zero-to-three optional calendars.

**Required correction:** Provide bounded synthetic mappings and connection state transitions. Tie selected settings to the affected schedule and messages. Keep all credentials and connections fake; these are not real OAuth/SMTP implementations.

**Acceptance check:** Configure primary only, then add/remove optional mappings. Simulate denied/failed/recovered connections. Changes appear in the associated previews without sending or storing secrets.

**Source locations:** [R32] [R14] [R06]

### G00-024 - Add Business, logo selection and full branding setup are not wired

**Priority:** P1 | **Area:** B | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** The view declares isAddProfileModalOpen and obtains addNewBrandProfile but does not render the Add Business flow. Four profiles are preseeded; that does not demonstrate creating one. There is no logo property/selection workflow. Contact and invoice-template editing is incomplete: invoice-template state exists without a visible input. Colour edits principally affect badges rather than the full planned preview.

**Impact:** A central workflow Rockson specifically requested is not usable, despite a convincing configuration page.

**Required correction:** Implement creation/editing of a demo branding profile, safe synthetic logo selection, contact/issuer placeholders and both mapping fields. Reflect supported theme changes consistently. Do not create independent-company infrastructure or public onboarding.

**Acceptance check:** Create a new profile through the UI, select a sample logo, change colour/contact/mappings, and see it used by new draft previews. Existing historical documents keep their saved branding.

**Source locations:** [R32] [R06] [R07] [R19]

### G00-025 - Owner configuration does not include the promised bounded editors

**Priority:** P1 | **Area:** C | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** The settings page edits a generic content textarea. It has no practical label/help/dropdown editor, reminder preferences, email templates or workflow-rule editor limited to supported job types. The five seeded templates contain Terms variants, JSA, smoke and electrical entries, but no TCA1/TCA2 master entries or usable email-template catalogue despite typed categories.

**Impact:** Owner self-management of routine wording, dropdown choices and reminder timing cannot be reviewed; users would need code changes for settings the scope assigns to them.

**Required correction:** Expose only the simple approved configuration surfaces and link them to the form/message previews. Keep technical connections restricted to Super Admin and version any published content.

**Acceptance check:** An Owner changes a permitted dropdown/help label, email subject/body and reminder setting; subsequent drafts/previews use them. Office Staff and Technician cannot publish or alter restricted master configuration.

**Source locations:** [R10] [R19] [R07] [R06]

### G00-026 - Template selection/upload review is descriptive rather than a workflow

**Priority:** P1 | **Area:** C | **Origin:** User finding, corroborated and refined  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** The template catalogue previews existing sample filenames/content, but there is no simulated import/selection transition, mapping-review action, unsupported/missing-document state or transition from review to a usable bounded form template.

**Impact:** The requested owner upload concept has not been explained through a usable demo, and the user cannot see the difference between storing a file and approving its mapped fields.

**Required correction:** Use the plan's built-in synthetic DOCX/PDF samples: select sample, inspect preview, mark pending mapping/review, demonstrate review outcome. Do not require real uploads or promise unrestricted document-to-form conversion.

**Acceptance check:** A sample moves through pending review/mapping to an explicitly approved demo template; an unsupported/missing sample shows a useful error; upload alone never certifies legal correctness.

**Source locations:** [R10] [R06] [R02]

### G00-027 - Sample attachments are a gallery, not job-linked evidence

**Priority:** P1 | **Area:** F | **Origin:** Additional finding  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Clicking an attachment sets selectedPhotoAttachment, but that state is not used to show a modal, attach it to the job or record it against a form. The sample library is global. There is no linked-file list, removal, loading/failure or missing-file journey.

**Impact:** The technician cannot demonstrate adding evidence to the specific work or checking that it travels into the document.

**Required correction:** Attach selected synthetic samples to the current job/form with preview, remove and named error states. Preserve that linkage in finalized document snapshots. Real file storage is not needed for G00.

**Acceptance check:** Attach a sample to one job; it appears only on that job/form/document. Preview/remove works; missing/failed sample selection is recoverable; reset removes the demo linkage.

**Source locations:** [R09] [R07] [R19]

### G00-028 - Completion, failed results and revisit policy need explicit separation

**Priority:** P1 | **Area:** F/G | **Origin:** User finding, refined to avoid inventing legal policy  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Completion mostly checks sign-off flags. A failing smoke alarm adds a warning. TCA2 office review is advisory, while the seeded job says remediation quotation is required before operational sign-off. After acknowledgement, a NEEDS_REVISIT job can therefore satisfy the current helper without a rectification workflow. Some seed certificates and previews label results compliant before such a decision.

**Impact:** The same job can be presented as requiring follow-up and as complete without explaining whether work, documentation, inspection and rectification are separate outcomes.

**Required correction:** Specify synthetic acceptance criteria for required answers, document finalization and unresolved defects. Keep a recorded Fail as Fail. Distinguish completion of an inspection from completion of rectification; obtain production rules later. Do not assume every failing test legally forbids every kind of job completion.

**Acceptance check:** Demonstrate a failed-result/revisit scenario with the right outstanding action and truthful document. Show a permitted inspection closure separately from unresolved rectification only where the demo rule explicitly allows it.

**Source locations:** [R08] [R19] [R06] [R09]

### G00-029 - Workspace, selected record and visible data can disagree

**Priority:** P1 | **Area:** A/D/E/F | **Origin:** Additional finding  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Brand switching changes activeBrandId but not selectedJobId. Jobs filter the list by brand while showing a separately selected detail. Schedule, Quotes, Communications and forms often enumerate all jobs. Dashboard filters by brand but not technician assignment. Guided scenarios select a job without consistently selecting its workspace.

**Impact:** Users can see one brand in the shell, another in the detail and a different scope in the list. This contributes to wrong-document identity and unclear role boundaries.

**Required correction:** Define per-view scope explicitly: active brand or authorized all-brand overview. Synchronize navigation context or visibly identify cross-brand mode. Resolve selected-record access on both brand and persona changes.

**Acceptance check:** Switch brand/persona with every detail open; no stale denied record remains. All-brand screens are clearly labelled and preserve each record's identity. Guided journeys open a coherent workspace.

**Source locations:** [R06] [R12] [R14] [R13] [R15] [R09] [R18] [R17]

### G00-030 - Reset and scenario controls are not fully deterministic

**Priority:** P1 | **Area:** A/E/I | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** IDs in customer drafts and rescheduled reminders use Date.now(). Named scenarios mutate some existing records rather than restoring a known baseline; selecting default does not undo a failed MYOB scenario. A completed job can acquire an unsigned form through scenario mutation. Some component-local drafts/dialog state is not governed by a reset epoch. Clock-derived timestamps are formatted inconsistently before/after ISO conversion.

**Impact:** The same walkthrough can produce different IDs, stale failures or contradictory signed/completed states, weakening repeatable review and tests.

**Required correction:** Use deterministic counters, a coherent scenario initializer and an explicit whole-demo reset. Clear local interaction state and pending feedback callbacks. Apply consistent business-time rendering and duration arithmetic.

**Acceptance check:** Run the same scripted journey twice after reset: same records, IDs, timing and outcomes. Failure -> default restores the documented baseline. Reset closes dialogs and clears unsaved draft/scenario state.

**Source locations:** [R06] [R17] [R11] [R12] [R14] [R13]

### G00-031 - AI/GCP-related scaffold declarations contradict the no-live-service demo

**Priority:** P1 | **Area:** Isolation | **Origin:** User finding, corroborated  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** package.json includes @google/genai, Express and dotenv; metadata.json declares MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API; .env.example says a Gemini API key is required and describes Cloud Run injection. No corresponding live Gemini/business API call or application backend was established in the inspected source.

**Impact:** The export falsely implies runtime dependencies outside G00 and could invite unnecessary credential setup or cloud work.

**Required correction:** Review and remove or clearly separate unused scaffold dependencies/configuration after approval. Preserve required preview tooling. Document that G00 needs no Gemini key, MYOB secret, live Google service or GCP provisioning.

**Acceptance check:** Run the reviewed mock frontend with no business/AI credentials; dependency/configuration inventory agrees with actual imports and behaviour; permitted network navigation is documented.

**Source locations:** [R21] [R22] [R23] [R25] [R02]

### G00-032 - Planning prompts and unreviewed media are committed

**Priority:** P1 | **Area:** Public export | **Origin:** User finding, corrected count and qualified impact  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Three planning/prompt files are under public/assets/aistudio/. Seven PNGs, not six, are in .aistudio/artifacts/brain/.../.tempmediaStorage. The PNGs were not visually inspected in this audit. The three text planning files were read; no private Drive/Notebook URLs were identified in them. Vite documents that public assets are served/copied as-is.

**Impact:** Internal planning material is a public source asset and may also ship with a deployed build. Unreviewed screenshots could disclose content beyond sanitized app fixtures; their presence is not proof that they do.

**Required correction:** Review each asset's purpose/content/provenance before another publication. Exclude internal material from distributable public assets via separately approved changes; preserve legitimate evidence privately. Do not delete provenance or rewrite history automatically.

**Acceptance check:** An approved export contains only required sanitized assets. All seven images have an explicit review disposition. Any published-content concern is handled with an owner-approved preservation/remediation plan.

**Source locations:** [R01] [R02] [R03] [META-MEDIA] [EXT-VITE]

### G00-033 - The Apache SPDX header requires provenance and approval review

**Priority:** P1 | **Area:** Governance | **Origin:** User finding, corroborated and qualified  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** src/App.tsx contains SPDX-License-Identifier: Apache-2.0. The handoff/build instructions did not authorize choosing a project licence. This audit did not establish whether the header is generated boilerplate or necessary third-party attribution.

**Impact:** The repository may communicate a licensing decision not documented in the supplied approval evidence.

**Required correction:** Have the owner verify origin and required attribution, then approve the correct licensing treatment. Do not assume the entire project is licensed under that identifier or remove legitimate notices blindly.

**Acceptance check:** Public source notices match the approved licence/attribution decision and recorded provenance. No automatic project licence is inferred from public visibility.

**Source locations:** [R04] [R02]

### G00-034 - Reproducibility and revision-matched quality evidence are absent

**Priority:** P1 | **Area:** Evidence/setup | **Origin:** User finding, corroborated and qualified  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** No lockfile, test script, ESLint configuration or CI workflow appears in the inspected tree. npm run lint invokes tsc --noEmit rather than ESLint. TypeScript strict is not explicitly enabled. Seven pure-helper tests exist, but no browser integration tests were found. GitHub returned zero workflow runs and zero check runs/status entries at the inspected commit.

**Impact:** The exported dependency set and end-to-end demo quality are not demonstrated. Helper-test source does not establish that the application paths use those helpers correctly.

**Required correction:** After approval, establish one package-manager/lockfile, honest script names and actual type/build/unit/UI checks. Preserve the current frontend instead of migrating to an earlier proposed framework. CI is optional at this stage; reproducible results are not.

**Acceptance check:** Provide source-SHA-matched command/output/exit evidence, a reviewed lockfile and interaction checks for the defects in this report. Mark unavailable tests NOT RUN; do not substitute generator summaries for receipts.

**Source locations:** [R21] [R24] [R20] [META-ROOT] [META-RUNS] [META-CHECKS] [META-STATUS]

### G00-035 - The UI substitutes AccountRight and production wording for the reported product

**Priority:** P1 | **Area:** B/D | **Origin:** User finding, corroborated  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** The banner/setup/customer panels say MYOB AccountRight or AccountRight Live. Shared connection fixtures call the file Production AccountRight File. The client-reported baseline is MYOB Business with payroll, one file; product/API capability verification remains outstanding.

**Impact:** The demo teaches an unapproved product and production connection assumption, despite being mock-only.

**Required correction:** Use MYOB Business - client-reported shared company file, simulated, plus generic fake IDs. Keep real API template-selection capability unverified. Do not infer separate legal entities from fabricated brand company names.

**Acceptance check:** Every connection, customer and financial label matches the client-reported model without suggesting live access or verified AccountRight-only features.

**Source locations:** [R27] [R32] [R11] [R12] [R06]

### G00-036 - A simulated sign-in/session experience is missing

**Priority:** P2 | **Area:** A | **Origin:** User finding, corroborated  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** The app starts directly as owner_admin and uses a persona dropdown; no sign-in/logout/session-expired simulation is present.

**Impact:** The client cannot review the entry/session experience promised under Area A.

**Required correction:** Add a lightweight deterministic sign-in/session demo while retaining separate reviewer persona controls. Do not implement actual authentication or store credentials.

**Acceptance check:** Enter as a permitted demo role, show an invalid/expired session case, log out and return without bypassing the intended UX.

**Source locations:** [R04] [R06] [R17] [R02]

### G00-037 - Navigation has no browser-addressable record/link behaviour

**Priority:** P2 | **Area:** A/H | **Origin:** User finding, refined  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** App.tsx switches views through activeTab state; the customer acceptance experience remains embedded and there is no demonstrated deep-link/back/forward handling.

**Impact:** Customer-specific link review and direct-record recovery are difficult to validate. State-driven tabs alone are not inherently wrong; the missing behaviour is what matters.

**Required correction:** Choose the smallest approved navigation mechanism that supports scoped demo links and predictable back navigation. A new routing library is not automatically required.

**Acceptance check:** Open/reopen a specific demo acceptance or job context and return predictably. Direct denied navigation still yields a denied result rather than stale content.

**Source locations:** [R04] [R13] [R05]

### G00-038 - Keyboard and dialog accessibility are not demonstrated

**Priority:** P2 | **Area:** Usability | **Origin:** User finding, corroborated as source risk  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Several cards/list rows are clickable divs without corresponding keyboard interaction. Many visible labels lack an explicit association with their inputs. Modal implementations lack demonstrated dialog semantics, focus trapping, Escape dismissal and focus restoration.

**Impact:** Core workflows may be unusable or confusing for keyboard/screen-reader users. This audit does not claim a formal accessibility conformance result.

**Required correction:** Use semantic controls and properly labelled inputs. Implement coherent accessible dialog/focus behaviour using approved existing tools. Test rather than infer accessibility from screenshots.

**Acceptance check:** Complete creation, form editing, acceptance and recovery with keyboard only. Focus returns sensibly after dialogs and errors are announced and attached to their fields.

**Source locations:** [R09] [R10] [R11] [R12] [R13] [R14] [R16]

### G00-039 - Mobile layouts and print output need actual verification

**Priority:** P2 | **Area:** Usability | **Origin:** User finding, qualified  
**Evidence status:** SOURCE-IDENTIFIED RISKS; visual/browser/print audit NOT RUN

**Observed:** Large form tables, many 10-12px text classes and long fixed modal content require phone review. The stylesheet contains only the Tailwind import; no application print-isolation stylesheet was found. window.print() is invoked from a modal, but actual printed output was not inspected.

**Impact:** Content may be cramped, clipped or include the surrounding application in printed output. These are risks to verify, not reported observed browser failures.

**Required correction:** Test representative phone/tablet/desktop widths and print preview. Reflow task-critical fields and isolate the selected document for printing while retaining demo and unresolved-source notices.

**Acceptance check:** No hidden primary actions/fields at the tested widths. A print/PDF preview contains the selected document, not navigation/controls, and matches its actual answers/version/status.

**Source locations:** [R09] [R26] [R11] [R12] [R14]

### G00-040 - Representative loading, empty, error and recovery states are uneven

**Priority:** P2 | **Area:** A-J | **Origin:** User finding, corroborated and expanded  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Some denied and empty states exist, especially the schedule/inbox and customer sync outcomes. Customer/job lists can simply render nothing when empty. No shared meaningful loading flow, missing-attachment recovery or full calendar/email error scenario is connected. A spinner icon alone is not a state transition.

**Impact:** A polished populated screenshot hides what staff will do when records are absent or an action is interrupted.

**Required correction:** Map required representative states to concrete journeys and deterministic scenario controls. Use clear empty-state next actions and recoverable errors, without inventing a universal workflow engine.

**Acceptance check:** Review loading, empty, field-validation, denied, expired, missing-document and integration-failure states in the affected screens, with usable recovery and no state loss.

**Source locations:** [R11] [R12] [R14] [R16] [R17] [R02]

### G00-041 - Synthetic fixtures contain unapproved product/policy assumptions

**Priority:** P2 | **Area:** Scope/data | **Origin:** Additional finding  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** Models and copy repeatedly add SMS_AND_EMAIL_SIMULATED although the stated MVP requests email. Four profiles are seeded before Add Business works. Fixtures use realistic-looking legal/licence/phone values and specific safety/regulatory wording despite a requirement for generic placeholders and unapproved legal text. They are labelled fictional; no actual client-secret leak was established.

**Impact:** The client may interpret invented channels, issuers, services, results or policy details as agreed functionality or authoritative guidance.

**Required correction:** Keep the three-brand baseline; make any fourth profile a demonstrated explicit action. Use generic non-operational identifiers and neutral demo policy text. Remove SMS from the proposed baseline unless separately approved. Preserve source uncertainty and avoid detailed invented statutory claims.

**Acceptance check:** Demo copy and fixtures match approved scope. No review implies confirmed legal validity, actual issuer identity, unapproved messaging channels or genuine personal/account data.

**Source locations:** [R07] [R19] [R15] [R02]

### G00-042 - Repository identity and execution/acceptance status need reconciliation

**Priority:** P2 | **Area:** Governance | **Origin:** Additional finding  
**Evidence status:** VERIFIED SOURCE CONTENT; runtime reproduction not performed

**Observed:** The current user-supplied application repository is PixelsWorker/CABMS. The bundled group plan still names chinedigitaldeveloper-ui/CABMS and says execution not authorized/not started. The new repository has app code on main, no returned PRs and no repository-local README/setup/acceptance receipt in the inspected tree. External approvals may exist; their absence here is not proof none were granted.

**Impact:** A manager or agent may act on the wrong repository or confuse prepared plans with completed/accepted work.

**Required correction:** Record the current repository/base, actual execution evidence and approval references in the authoritative manager records. Provide proportionate run/quality notes; do not create every possible governance filename merely to satisfy a checklist.

**Acceptance check:** One clearly identified application target, current status, reproducible instructions, reviewed change evidence and Rockson's explicit G00 acceptance. No inference of approval from main-branch code or a generated completion message.

**Source locations:** [R01] [META-BRANCH] [META-PRS] [META-ROOT]

## 6. Minimal domain relationships the demo needs

This is a clarification of the existing mock-state boundary, not a proposal for production database tables or extra services. The current typed model is useful, but a few missing relationships explain many defects. [R06] [R07]

| Mock concept | Minimum relationship / behaviour | Why it matters |
|---|---|---|
| Business profile | Stable ID; current branding; technical mapping settings | A selected workspace is not a document issuer |
| Simulated MYOB connection | One shared file; status and recoverable outcomes | Connect state must govern write-through |
| Customer submission | Draft/attempt identity, match decision, external reference and resolution | A failed draft is not another customer master |
| Operational job | Customer, site, brand, assignment and separate appointment/financial state | Prevent forced scheduling/accounting shortcuts |
| Job-type requirement snapshot | Versioned applicable forms and explicit demo exceptions | Current settings must not rewrite historical completion |
| Form instance | Job/customer/brand, template revision, editable answers and state | No cross-job seed fallback |
| Finalized document | Frozen answers, issuer, version, sign-off and attachment references | Truthful preview and historical preservation |
| Quote and acceptance | External reference, job/customer/brand, revision and exact Terms snapshot | No wrong-quote fallback or reused consent |
| Appointment revision | Time, assignment, cancellation and simulated provider sync state | Rescheduling invalidates the correct reminders |
| Communication attempt | Trigger, recipient, brand, document versions, pending/sent/failed/uncertain and logical dedupe key | Event-based automation and recovery can be demonstrated |
| Activity event | Job/customer/document reference, actor role, action and demo time | History across screens comes from actual actions |

One small in-memory store/mock-service boundary can implement these relationships. G00 does not require a SQL database, queue service, cloud project, OAuth secrets or real notification delivery.

## 7. Proposed repair order - still ONE G00 group

These are dependency-ordered correction batches inside G00, not new delivery groups or a backend sprint. Keep the current app and its frontend direction. Reforecast only after an authorized implementation plan and actual evidence; this audit gives no new two-week guarantee.

| Order | Repair outcome | Findings addressed | Exit evidence |
|---|---|---|---|
| 1 | Stabilize permission, record identity and navigation safety | 001, 003, 005, 006, 008, 029 | Role-switch and new-job paths do not expose wrong records or crash; issuer belongs to the job |
| 2 | Make one new customer/job flow coherent | 009-015, 018 | Resolve duplicate/failed customer state; create and assign a new job; explicit type and financial handoff |
| 3 | Complete editable forms and versioned documents | 002, 004, 007, 025-028 | Enter values -> finalize -> truthful full preview -> old/new versions preserved |
| 4 | Complete quote and minimal recipient-link journey | 016-017 plus 006 | Prepare/link -> send mock link -> accept once -> scoped history; detailed signing stays deferred |
| 5 | Connect schedule and communication simulations | 019-023, 030 | Correct due time, cancellation/suppression, Calendar failures, selected-certificate sends and review event dedupe |
| 6 | Finish profile/settings/sample import and UX | 024-026, 036-041 | Add profile/logo/settings; accessible mobile inputs; required states and reset checked |
| 7 | Review export, evidence and acceptance | 031-035, 042 | Sanitized asset/dependency review, actual test receipts, client feedback and Rockson's explicit approval |

Some tasks can overlap after shared-state conventions are agreed, but no new backend work should be used to hide unfinished G00 interactions. In particular, adding live Google services will not repair a disconnected mock workflow.

## 8. Reproduction and regression checklist

**All rows below are PLANNED / NOT RUN by this audit.** Use the current accepted source/export identity when executing. Each result must include actual observations and not merely a statement that AI Studio completed the work.

| Check | Starting state and action | Expected corrected result |
|---|---|---|
| QA-01 Unsigned preview | Reset; open unsigned JSA; open document preview | DRAFT/NOT SIGNED, no invented signer/time; full JSA answers visible |
| QA-02 Brand isolation | Select CCTV job while Solarcell workspace remains selected; preview | CCTV job issuer, not Solarcell workspace issuer |
| QA-03 New form instances | Create new job requiring smoke/electrical/TCA forms; open each | Independent unsigned records, correct customer/site; no inherited signature |
| QA-04 Quote empty state | Create a new job; open Quotes | Clear no-quote state, not a crash or another job's quote |
| QA-05 Successful acceptance | Prepare/link unaccepted quote; consent and accept; retry | One acceptance event, correct Terms/quote revision; retry blocked |
| QA-06 Consent scope | Check consent on quote A, move to quote B | Consent/feedback reset; no implicit acceptance of B |
| QA-07 Persona views | Technician -> Quotes, Communications, Website Inbox, unassigned/other-tech form | Denied or approved read-only behaviour; no forbidden mutation |
| QA-08 Office template permissions | Office Staff attempts save draft/publish | No prohibited template mutation |
| QA-09 Role switching stability | Change allowed/denied persona while Customers, Templates and Setup are open | No hook/runtime error or stale privileged state |
| QA-10 Duplicate customer | Submit existing fixture email/phone | Explicit existing-record choice; no automatic duplicate |
| QA-11 Disconnected customer | Disconnect MYOB, submit, reconnect and recover | Draft stays unresolved until acknowledged; same attempt linked once |
| QA-12 Website failure | Failed MYOB; convert new-customer enquiry | Pending or visibly unresolved operational draft; no clean financial conversion |
| QA-13 Assignment | New unassigned job -> assign second technician -> view as first | Correct restrictions and no forced TECH-001 default |
| QA-14 Requirement snapshot | Create under matrix A; publish matrix B; open old/new jobs | Old job preserves A; new job uses B; invoice path does not bypass applicable forms |
| QA-15 Form entry | Change PPE/risk/Pass-Fail/row fields; leave and return | Values persist in mock record, validation and document preview agree |
| QA-16 Attachment linkage | Select sample -> attach to one form -> remove -> simulate missing | Only target record changes; meaningful preview/error |
| QA-17 Versioning | Finalize document A -> publish template B -> new record -> reopen A | True old/new revision behaviour; no metadata/signature rewrite |
| QA-18 Two-hour reminder | Reschedule visit to 14:00 | New reminder due 12:00 in correct business time; old unsent reminder suppressed |
| QA-19 Due clock | Advance through due time twice | One message transition, not zero and not a duplicate |
| QA-20 Cancel versus complete | Cancel visit/job, then try completion | Explicit allowed state transition; no accidental cancelled-to-completed jump |
| QA-21 Defect/revisit | Record failure/TCA2 acknowledgement with follow-up outstanding | Honest failed/defect result; approved demo closure/rectification boundary visible |
| QA-22 Calendar failure | Fail simulated sync after reschedule; recover | Local appointment preserved; visible event state and safe retry |
| QA-23 Review events | Trigger manual and automatic event for same job; inject unknown result | One logical request; pending/uncertain block duplicates; reconcile before retry |
| QA-24 Certificate selection | Select finalized docs for delivery; include a draft candidate | Only finalized selected snapshots sent in mock; draft blocked/not represented as signed |
| QA-25 Profile configuration | Add a profile; sample logo; contact and both template mappings | Settings appear in new drafts and do not rewrite historical documents |
| QA-26 Sample import | Select valid, unsupported and missing synthetic template samples | Pending mapping/review and explicit error states; no automatic legal approval |
| QA-27 Reset | Change data/settings, open dialogs, fail MYOB, then reset | Complete baseline restored; deterministic identifiers and no stale callbacks/drafts |
| QA-28 Keyboard/phone | Exercise critical journeys at representative widths and by keyboard | Visible actions, usable inputs, labelled controls, coherent dialog focus |
| QA-29 Print | Print selected draft and finalized document | Only intended document, truthful state, complete content and demo notice |
| QA-30 Export checks | Inspect files/assets/deps, run approved build/types/tests, inspect network | No unapproved live runtime/secrets; actual result receipts pinned to revision |

## 9. Tests, source evidence and what a pass would mean

Seven test definitions are present. They cover: zero-form/direct-invoice completion; unsigned-JSA failure; success after required sign-offs; review duplicate prevention for an existing SENT state; suppression of undelivered reminders; customer match detection; and persona helper decisions. [R20]

These are useful unit-level tests, but their source does not establish execution or whole-app coverage. In particular:

- A duplicate detector can pass while the write-through caller ignores the result.
- A permission helper can pass while views/actions never use it.
- A completion helper can pass while forms display fallback records that are not in its per-job state.
- A suppression helper can pass while replacement due times are wrong and the clock never dispatches anything.

The required evidence is therefore a combination of pure-rule tests, connected mock-state tests and browser/interaction checks for the scenarios above. Report source revision, command/environment, actual result/exit, failures/skips and relevant screenshots or recordings. Do not conflate `npm run lint` with an ESLint pass: its current script is only `tsc --noEmit`. No successful run is independently claimed in this review. [R21]

GitHub returned no PRs, Actions runs, check runs or status entries for the inspected context. A pending combined status with an empty statuses list is not a running test and not a failed test; it is an absence of submitted status evidence. [META-PRS] [META-RUNS] [META-CHECKS] [META-STATUS]

## 10. Privacy, publication and GCP boundary

The requested work is a workflow audit. **Absence of real GCP infrastructure is not a G00 gap.** Google AI Studio is the authoring tool; Google Calendar/Maps are product integrations represented as mocks/safe navigation; Cloud Run/Gemini-related scaffold text is not proof of either a deployment or a requirement. [R02] [R22] [R23]

Before the next approved export/publication, review the Gemini/backend scaffold leftovers, prompt files under public assets, all seven PNGs, synthetic identifiers and licence header. No real client secret was established in this textual inspection; this is not a full secret-scan certification. The normal plan remains synthetic-only public code and separately authorized restricted test environments.

Vite states that its public directory is served/copied as-is. GitHub states that public forks remain public after the origin becomes private. Therefore the later intention to make CABMS private is not a substitute for reviewing current public contents. These are source-backed publication risks, not permission to alter visibility, delete files or rewrite history. [EXT-VITE] [EXT-GITHUB]

## 11. Matters that are not G00 defects

| Item | Correct treatment |
|---|---|
| No real MYOB connection | Expected; complete the mock flow and verify real APIs in an authorized functional group |
| No real Google Calendar/SMTP | Expected; demo settings/outcomes must still be interactive |
| No GCP deployment/backend database | Expected; do not provision services for G00 |
| No full high-value e-signature implementation | Agreed deferral; keep placeholder/manual referral and later obligation visible |
| $3,300 not used as automatic routing | Correct; legal applicability remains unresolved |
| Missing Electrical Part B source text | Do not invent it; preserve explicit notice in every affected preview |
| Unapproved smoke/cabler/issuer fields | Use provisional generic placeholders, not invented final values |
| No true PDF binary | Not automatically a gap if a truthful complete print-ready preview is the agreed demo outcome; current generic/false-signing preview still needs correction |
| No persistence after browser refresh | Allowed for this in-memory demo; explain and reset coherently |
| No full customer account portal | Correct exclusion; only a scoped minimal recipient-link experience is required |
| No SMS, payroll, inventory or route optimiser | Correct exclusions unless separately approved |
| No CI/ESLint/specific manager filename | Not automatically a feature blocker; reproducible quality evidence and applicable rules remain necessary |

## 12. Remaining decisions versus avoidable re-discovery

The workload figures, three brand names, single MYOB file report and G00-first direction are already established; do not ask for them again. The source-based defects above can be corrected using safe synthetic scenarios without waiting for final client legal documents.

Still unresolved for the relevant functional groups: final issuer identity, approved template versions/Part B, trade-specific form/sign-off rules, retention schedule, detailed contract/signature policy, real MYOB product entitlements/template operations, Calendar sync direction, final review triggers and website integration details. Do not convert these into invented production rules while repairing G00.

Before G00 acceptance, decisions are narrower: confirm the demo persona policy (including template read access), intended cross-brand overview behaviour, synthetic defect/rectification closure semantics, correction scope/export permissions, and recorded client feedback. Separate these from the actual future legal/integration approvals.

## 13. Definition of repaired G00 completion

G00 becomes review-ready when the client can follow the same newly created synthetic customer/job through its applicable path without relying on unrelated pre-completed seed records. Every critical action must update the shared mock state and dependent screens; documents must show their true issuer, version and sign-off state; declined/failed/uncertain actions must preserve coherent data and offer recovery.

Final acceptance additionally needs the required responsive/keyboard/state checks, revision-matched quality results, reviewed public export, feedback/revisions and Rockson's explicit UI/UX acceptance. The entire repair remains within one G00 group. No G01, real integration, repository write, package change, push/PR/merge, licence change, visibility change or deployment is authorized by this report.

**Bottom line:** preserve the existing demo's useful shell and scenarios, but finish the business journeys before treating it as the complete G00. The largest gap is not the number of screens; it is the absence of consistent ownership, transitions, evidence and recovery between them.

## Appendix A. Source register

All repository links below are pinned to the inspected commit. Source-file claims above refer to the named component/function/section, not to unverified runtime behaviour.

- **R01** - G00 group plan: `public/assets/aistudio/01-G00-GROUP-PLAN-FOR-REVIEW_02f12f1f.md`.
- **R02** - AI Studio Build prompt: `public/assets/aistudio/02-AI-STUDIO-BUILD-PROMPT_d17e4a1a.txt`.
- **R03** - Focused iteration prompts: `public/assets/aistudio/03-AI-STUDIO-FOCUSED-ITERATION-PROMPTS_20cabc20.txt`.
- **R04** - Application shell: `src/App.tsx`.
- **R05** - Navigation: `src/components/Navigation.tsx`.
- **R06** - Shared state and actions: `src/context/CabmsContext.tsx`.
- **R07** - Domain types: `src/types/cabms.ts`.
- **R08** - Business-rule helpers: `src/utils/cabmsLogic.ts`.
- **R09** - Technician forms and document preview: `src/views/ComplianceFormsView.tsx`.
- **R10** - Owner template settings: `src/views/TemplatesSettingsView.tsx`.
- **R11** - Customers: `src/views/CustomersView.tsx`.
- **R12** - Jobs: `src/views/JobsView.tsx`.
- **R13** - Quotes and acceptance: `src/views/QuotesAcceptanceView.tsx`.
- **R14** - Schedule: `src/views/ScheduleView.tsx`.
- **R15** - Communications: `src/views/CommunicationsView.tsx`.
- **R16** - Website inbox: `src/views/WebsiteInboxView.tsx`.
- **R17** - Demo controls: `src/components/DemoControlsBar.tsx`.
- **R18** - Dashboard: `src/views/DashboardView.tsx`.
- **R19** - Seed data: `src/data/seedData.ts`.
- **R20** - Seven unit-test definitions: `src/utils/cabmsLogic.test.ts`.
- **R21** - Dependency manifest and scripts: `package.json`.
- **R22** - AI Studio metadata: `metadata.json`.
- **R23** - Environment example: `.env.example`.
- **R24** - TypeScript configuration: `tsconfig.json`.
- **R25** - Vite configuration: `vite.config.ts`.
- **R26** - Stylesheet: `src/index.css`.
- **R27** - Demo banner: `src/components/DemoBanner.tsx`.
- **R28** - Denied-access screen: `src/components/AccessDeniedView.tsx`.
- **R29** - Git ignore rules: `.gitignore`.
- **R30** - React entry point: `src/main.tsx`.
- **R31** - HTML entry point: `index.html`.
- **R32** - Super Admin setup: `src/views/SuperAdminSetupView.tsx`.

External verification used only to support material review mechanics, not to select new dependencies:

- EXT-REACT: React official rules-of-hooks guidance (hooks after early returns / stable call order).
- EXT-VITE: Vite official public-directory handling.
- EXT-GITHUB: GitHub official repository visibility consequences.

The baseline handoff and complete Project rules were read from the supplied Project files; no manager-notebook access or cross-Project transfer is assumed. The incoming user assessment was compared against the pinned source rather than treated as execution evidence.

## Appendix B. Compact issue index

| ID | Priority | Area | Issue |
|---|---|---|---|
| G00-001 | P0 | A/D/F/H/I/J | Persona and assignment restrictions are not consistently enforced |
| G00-002 | P0 | F | The technician forms are primarily reports, not editable forms |
| G00-003 | P0 | B/F | Document issuer comes from the workspace rather than the document/job |
| G00-004 | P0 | F/I | Certificate previews claim a signature that may not exist |
| G00-005 | P0 | D/F/G | New jobs inherit other jobs' forms and signed state |
| G00-006 | P0 | D/H | Quote fallback can show the wrong customer's quote or render undefined |
| G00-007 | P0 | C/F/H | Immutable versioning is claimed but no working version lifecycle exists |
| G00-008 | P1 | A/B/C/D | Conditional hook ordering makes persona changes a runtime risk |
| G00-009 | P1 | D | Duplicate customer detection does not stop duplicate creation |
| G00-010 | P1 | B/D | Disconnected MYOB and failed drafts do not have a coherent recovery path |
| G00-011 | P1 | D/J | Website handoff reports conversion success despite unresolved customer sync |
| G00-012 | P1 | C/D/G | The displayed mandatory-form matrix does not control job requirements |
| G00-013 | P1 | D/E | Technician selection and unscheduled-job creation are missing |
| G00-014 | P1 | D/E/G | Appointment cancellation and operational lifecycle are conflated |
| G00-015 | P1 | D/F/I | Customer, job, document and activity history is incomplete |
| G00-016 | P1 | D/H | MYOB quote preparation and management cannot be demonstrated |
| G00-017 | P1 | H | The customer-link experience and acceptance context are incomplete |
| G00-018 | P1 | D/H/I | Invoice/payment preparation and uncertain-write recovery are only labels |
| G00-019 | P1 | E/I | Reminder lead times are calculated incorrectly |
| G00-020 | P1 | E/I | The virtual clock does not drive notification or Calendar outcomes |
| G00-021 | P1 | I | Review requests have deduplication but no full trigger/recovery workflow |
| G00-022 | P1 | F/I | Selected-certificate delivery and appointment email previews are unfinished |
| G00-023 | P1 | B/E | Calendar, sender and connection setup are mostly static |
| G00-024 | P1 | B | Add Business, logo selection and full branding setup are not wired |
| G00-025 | P1 | C | Owner configuration does not include the promised bounded editors |
| G00-026 | P1 | C | Template selection/upload review is descriptive rather than a workflow |
| G00-027 | P1 | F | Sample attachments are a gallery, not job-linked evidence |
| G00-028 | P1 | F/G | Completion, failed results and revisit policy need explicit separation |
| G00-029 | P1 | A/D/E/F | Workspace, selected record and visible data can disagree |
| G00-030 | P1 | A/E/I | Reset and scenario controls are not fully deterministic |
| G00-031 | P1 | Isolation | AI/GCP-related scaffold declarations contradict the no-live-service demo |
| G00-032 | P1 | Public export | Planning prompts and unreviewed media are committed |
| G00-033 | P1 | Governance | The Apache SPDX header requires provenance and approval review |
| G00-034 | P1 | Evidence/setup | Reproducibility and revision-matched quality evidence are absent |
| G00-035 | P1 | B/D | The UI substitutes AccountRight and production wording for the reported product |
| G00-036 | P2 | A | A simulated sign-in/session experience is missing |
| G00-037 | P2 | A/H | Navigation has no browser-addressable record/link behaviour |
| G00-038 | P2 | Usability | Keyboard and dialog accessibility are not demonstrated |
| G00-039 | P2 | Usability | Mobile layouts and print output need actual verification |
| G00-040 | P2 | A-J | Representative loading, empty, error and recovery states are uneven |
| G00-041 | P2 | Scope/data | Synthetic fixtures contain unapproved product/policy assumptions |
| G00-042 | P2 | Governance | Repository identity and execution/acceptance status need reconciliation |

## Reference links

[R01]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/public/assets/aistudio/01-G00-GROUP-PLAN-FOR-REVIEW_02f12f1f.md
[R02]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/public/assets/aistudio/02-AI-STUDIO-BUILD-PROMPT_d17e4a1a.txt
[R03]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/public/assets/aistudio/03-AI-STUDIO-FOCUSED-ITERATION-PROMPTS_20cabc20.txt
[R04]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/App.tsx
[R05]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/components/Navigation.tsx
[R06]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/context/CabmsContext.tsx
[R07]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/types/cabms.ts
[R08]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/utils/cabmsLogic.ts
[R09]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/views/ComplianceFormsView.tsx
[R10]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/views/TemplatesSettingsView.tsx
[R11]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/views/CustomersView.tsx
[R12]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/views/JobsView.tsx
[R13]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/views/QuotesAcceptanceView.tsx
[R14]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/views/ScheduleView.tsx
[R15]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/views/CommunicationsView.tsx
[R16]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/views/WebsiteInboxView.tsx
[R17]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/components/DemoControlsBar.tsx
[R18]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/views/DashboardView.tsx
[R19]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/data/seedData.ts
[R20]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/utils/cabmsLogic.test.ts
[R21]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/package.json
[R22]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/metadata.json
[R23]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/.env.example
[R24]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/tsconfig.json
[R25]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/vite.config.ts
[R26]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/index.css
[R27]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/components/DemoBanner.tsx
[R28]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/components/AccessDeniedView.tsx
[R29]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/.gitignore
[R30]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/main.tsx
[R31]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/index.html
[R32]: https://github.com/PixelsWorker/CABMS/blob/6862b78113cc0b46b1e66b2c73e755ef823d217e/src/views/SuperAdminSetupView.tsx
[META-BRANCH]: https://api.github.com/repos/PixelsWorker/CABMS/branches/main
[META-ROOT]: https://api.github.com/repos/PixelsWorker/CABMS/git/trees/6862b78113cc0b46b1e66b2c73e755ef823d217e?recursive=1
[META-MEDIA]: https://api.github.com/repos/PixelsWorker/CABMS/git/trees/e31bdd9adb640dc4fb0a28793e41a3b8a6e19839
[META-PRS]: https://api.github.com/repos/PixelsWorker/CABMS/pulls?state=all&per_page=100
[META-RUNS]: https://api.github.com/repos/PixelsWorker/CABMS/actions/runs?per_page=10
[META-CHECKS]: https://api.github.com/repos/PixelsWorker/CABMS/commits/6862b78113cc0b46b1e66b2c73e755ef823d217e/check-runs
[META-STATUS]: https://api.github.com/repos/PixelsWorker/CABMS/commits/6862b78113cc0b46b1e66b2c73e755ef823d217e/status
[EXT-REACT]: https://react.dev/reference/eslint-plugin-react-hooks/lints/rules-of-hooks
[EXT-VITE]: https://vite.dev/guide/assets
[EXT-GITHUB]: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
