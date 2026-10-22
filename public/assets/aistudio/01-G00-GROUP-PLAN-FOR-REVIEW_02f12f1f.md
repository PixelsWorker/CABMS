# CABMS G00 - AI Studio-first group plan

Prepared: 22 October 2026
Status: PREPARED FOR REVIEW - execution not authorised
Group: G00 - Complete Application UI/UX Demo

## 1. Approval record and sequencing

Rockson has approved the G00 demo architecture and A-J scope, React + TypeScript with Vite as the proposed frontend setup, deterministic resettable synthetic mocks, Google AI Studio authoring, ZIP-first export review, and preparation of this plan and its prompts.

This approval does NOT authorise application generation, package installation, repository/protected-file writes, branches/worktrees, commits, pushes, PRs, merges, deployment, licensing, or visibility changes. The two-week clock has NOT started. This is an executable task specification once the relevant action is separately authorised, not an instruction to start now.

Delivery sequence:

AI Studio groundwork -> whole-app manager/client walkthrough -> focused revisions in the SAME app -> reviewed ZIP -> separately authorised local/repository integration and quality checks -> final G00 acceptance and applicable PR closure.

An early client walkthrough does not require a GitHub import, public deployment or new repository. Use a controlled walkthrough or reviewed screenshots; account sharing/public links need their own applicable permission. Tests and privacy review accompany iteration; they are not postponed to a separate testing group.

## 2. Group brief

| Field | Definition |
|---|---|
| Goal | Validate the complete proposed three-brand operational experience before building real integrations. |
| Scope | A-J: shell/access; technical setup; owner content; customers/jobs; scheduling/navigation; technician forms/documents; completion; quotation/basic acceptance; communications/reviews; existing-site handoff. |
| Original capabilities | Retain all ten requested areas. Detailed contract/e-signature delivery is deferred to functional work, not removed or satisfied by manual referral. |
| Out of scope | Production auth/backend/database, Gemini runtime or AI features, MYOB/Calendar/email writes, Firebase, website rebuilding, inventory/payroll/subscriptions, route optimisation, unrestricted workflow builders, public SaaS registration, automatic deployment. |
| Human owner/operator | Rockson. AI Studio authors the approved demo; ChatGPT plans/reviews; Codex only performs separately authorised export/repository work. No separate development team assumed. |
| Application repository | Existing chinedigitaldeveloper-ui/CABMS only. |
| Historical baseline | main at bb48ca9755434c281bceef0c4bb9d2041ebf5eab; only .gitignore in the supplied successful snapshot. |
| Current repository limitation | Fresh get_repo read during this preparation returned 404. Current HEAD/tree/visibility NOT VERIFIED. Do not treat the historical snapshot as the current base. This affects repository actions, not this prompt preparation. |
| Proposed branch / PR | feat/g00-ui-demo; NOT CREATED. Normally one G00 PR targeting the verified accepted base. Do not assume dev exists. |
| Local checkout | UNAVAILABLE / NOT INSPECTED. No canonical/worktree path has been selected. |
| Contract | G00 mock data/behaviour specification only; NOT a real MYOB or CABMS API contract. |
| Effort / target | 60-90 focused Rockson hours; two-week G00 target from a later explicit start, not a guarantee. No estimate for the working test system is included. |
| Actual effort | NOT MEASURED for planning. Application execution NOT STARTED; no implementation/test receipts. |
| Acceptance | Whole-app evidence, actual checks, feedback/revisions, actual export/diff review, and Rockson's explicit G00 UI/UX acceptance. No automatic G01 authorisation. |

## 3. What happens in AI Studio versus later in Git

| Item | AI Studio groundwork | Later approved repository integration |
|---|---|---|
| React/TypeScript source, styles and fixtures | Generated and iterated in the one demo app after authoring approval. | Inspect then import selected reviewed files; do not overwrite the repository wholesale. |
| package.json and TypeScript/Vite configuration | Needed for the demo itself. Generated manifest is evidence to review, not an accepted production dependency set. | Inspect packages, scripts, licences, compatibility and install effects before local install. |
| Lockfile | Retain one if the preview actually generates it; do not fabricate or claim a lock exists. | Verify package-manager consistency and reproducibility; authorise lock creation/repair if needed. |
| Tests | Plan now; run available checks throughout approved authoring. Keep manual and automated results distinct. | Run actual revision-matched build/type/lint/demo tests with approved tooling. No guessed commands. |
| README | A short demo-only run note may accompany an export; it cannot override project policy. | Review/adapt documentation within exact approved paths. |
| Root/repository AGENTS.md, SETUP.md, TODO.md and .code-workspace | Not prerequisites to preparing the AI Studio prompt. Do not ask the builder to invent local workspace rules. | Read existing rules first. Draft only missing/scoped changes, with exact-path approval before writes. |
| Existing .gitignore | Leave remote untouched. | Preserve/review the actual existing file; any edits need applicable approval. It does not replace content review. |
| GitHub sync | Disabled/not used. | ZIP-first is the approved direction. Any later sync requires verified repository AND approved branch targeting plus explicit action permission. |

## 4. Demo-only design decisions proposed by this packet

These make the mock executable, but are not confirmed production permissions, legal rules or API behaviour.

- Four personas: Super Admin manages technical profiles/mappings; Owner/Admin manages operational work and supported content; Office Staff coordinates customers/jobs/appointments/communications; Technician works assigned jobs and forms only. Technical connection controls are unavailable to Owner/Admin, Office Staff and Technician. Exact production permissions remain a later contract decision.
- A shared synthetic MYOB customer directory sits behind the mock adapter. Customer entry remains a pending draft until the mock MYOB acknowledgement supplies a fake external ID. Failed/uncertain submissions are not a second authoritative customer master.
- Every job has a brand. Switching the active brand changes the workspace filter, not a job's issuer or historical document snapshots. Technician direct-route access to an unassigned job returns a denied state.
- Mock operational states: NEW, SCHEDULED, IN_PROGRESS, NEEDS_REVISIT, COMPLETED, CANCELLED. Invoice/payment, quotation and integration states are separate. Completion is an operation, not a persisted state.
- An explicit scenario selector and fixed demo clock control errors/reminders. Reset clears all in-memory drafts, mock activity, versions, persona and brand to a documented starting state. No real storage/auth credentials.
- Use a simple versioned required-forms matrix for synthetic job types, not a general workflow engine. Historical completed/signed/accepted records retain their snapshots.
- Use print-ready branded document/PDF-preview UI. Browser print/save-as-PDF can be demonstrated where supported. Label HTML previews honestly; a PDF download is not delivered until a genuine PDF file exists and is checked.

## 5. Executable task order - all inside G00

All execution rows below are NOT STARTED. Do not start tasks merely because they appear here.

| ID | Task / owner | Requires | Done-when and evidence |
|---|---|---|---|
| G00-01 | Rockson: start the approved single AI Studio WEB app using prompt 02. | Explicit authoring/start permission, including permitted managed preview dependencies. | React/TS/Vite direction retained; demo runs without business credentials or Gemini runtime; package inventory and deviations reported. |
| G00-02 | AI Studio + Rockson: establish shared shell, personas, profiles and owner settings (A-C). | G00-01. | Desktop/mobile navigation, active brand, four personas, denied paths, shared MYOB setup and versioned content work together. |
| G00-03 | AI Studio + Rockson: connect customer/job, quote and incoming-site journeys (D/H/J). | Shared typed fixtures and mock boundary. | Pending/success/failed customer entry, duplicate warning, quote preparation/link/acceptance, direct invoice route and reviewed enquiry handoff update the same records. |
| G00-04 | AI Studio + Rockson: implement schedule/reminder and communications/review simulations (E/I). | Jobs and explicit scenario controls. | Reschedule/cancel preserves local state, stale reminders are suppressed, failures recover coherently, duplicate/uncertain review sends cannot silently create another send. |
| G00-05 | AI Studio + Rockson: implement mobile form/document and completion journeys (F/G). | Sanitised field map in Build prompt; synthetic applicability rules. | JSA, electrical, smoke-alarm, TCA1 and TCA2 sections represented; signed snapshots and branded previews; failed completion preserves status; simulated success and no-required-form paths work. |
| G00-06 | Rockson: inspect every route and critical state; use focused correction prompts. | Initial whole-app coverage. | No disconnected mockups/dead required controls; mobile, keyboard, labels, states and reset checked. Record actual checks, failures and screenshots against an export/checkpoint. |
| G00-07 | ChatGPT review + Rockson: evaluate ZIP/code and whole-app walkthrough. | An actual export and screenshots/interaction evidence. | Files/dependencies/network usage/privacy reviewed; unmet A-J criteria and source conflicts reported; no screenshot-only backend claims. |
| G00-08 | Rockson/client: consolidate feedback and revise same app. | Controlled review of complete demo. | Feedback entries classify defect/clarification/new scope, with acceptance/time effect; approved corrections retested. No silent capability removal. |
| G00-09 | Local Codex, only after separate permission: prepare host and integrate reviewed export. | Repository access, native preflight, exact protected-file/Git/package permissions. | One writable checkout; exact paths/base/HEAD recorded; original ZIP preserved; only approved files imported; actual diff and checks available. |
| G00-10 | ChatGPT + Rockson: final whole-group review and acceptance. | Current export/source identity, checks, feedback, privacy and actual diff review. | Rockson explicitly accepts full UI/UX; remaining exceptions named; any push/PR/merge separately authorised; G00 closure recorded. |

Permitted change surface during approved AI Studio work is only the chosen AI Studio app's frontend, mock data/services, synthetic assets and approved tests/configuration. Repository write paths remain NONE under the present approval.

## 6. Ten-capability traceability

| Original capability | G00 representation | Explicit boundary |
|---|---|---|
| 1. Customer & Job Management | A, D, E, F, J | MYOB write-through UX simulation, not competing master data. |
| 2. Quotations, Contracts & Electronic Acceptance | H | Quote preparation/management through MYOB simulation and basic acceptance; detailed e-signature deferred, still owed in later accepted scope. |
| 3. Forms, Compliance & Certificates | C, F, I | Supplied structures with synthetic fields; no legal/statutory approval. |
| 4. Three-Business Dashboard & Branding | A, B, H, F, I | Configurable profiles, not verified separate legal entities or deployments. |
| 5. Administrator Access & Template Management | B, C | Supported fields/content and review/version states; no arbitrary document-to-form conversion. |
| 6. Automated Customer Notifications & Reminders | E, I | Explicit deterministic simulation; no real send/scheduler. |
| 7. Google Review Request Automation | B, I | Manual/automatic scenarios, brand link preview and per-job deduplication. |
| 8. Mandatory Job Completion Requirements | C, G | Versioned synthetic applicability, missing-items/success result; not backend enforcement. |
| 9. Integrations | B, D, E, H, I | MYOB/Calendar/email are mocks; Maps is only a user-clicked safe public example link. |
| 10. Future Expansion | Typed configuration and mock boundaries | Maintainable seams, not implementation of future/unapproved modules. |

## 7. Acceptance tests inside this group

All tests are PLANNED / NOT RUN. No passing counts or coverage are claimed.

| Test | Observable assertion |
|---|---|
| T01 Shell/access | All personas, three brands and required navigation render; technician cannot open unassigned work or settings, including direct routes. |
| T02 Brand correctness | Switching workspace does not relabel another job or historical document; previews retain the job's brand and version. |
| T03 Customer sync | Duplicate warning; successful fake external ID; failure leaves recoverable draft; uncertain result uses reconciliation before a retry. |
| T04 Conditional work | Documentation-required and direct-to-invoice jobs both work; absent form requirements are explicitly explained. |
| T05 Quote/acceptance | Prepare/link synthetic MYOB quote; exact quote/Terms snapshot accepted; repeated acceptance does not create duplicate events; invalid/expired/revoked/superseded links cannot accept. |
| T06 Signing boundary | Detailed signing is visibly deferred; no price-based legal routing; no customer dashboard or claim that manual referral delivers e-signing. |
| T07 Versioning | Edit/publish a new Terms/form/email version; old accepted/signed output and history remain unchanged. |
| T08 Template upload | Synthetic document preview moves to pending review/mapping, not automatic working form or approved contract. |
| T09 Forms/documents | JSA/electrical/smoke/TCA1/TCA2 sections, checkboxes/dropdowns/Pass-Fail, sample attachments and demo sign-off appear; missing/disputed sections stay visible. |
| T10 Completion | Missing items returned with original operational state unchanged; finalised applicable demo forms allow simulated success; unresolved actual compliance remains disclosed. |
| T11 Schedule/reminders | Primary + 0-3 optional mappings; reschedule/cancel invalidates old reminders; provider failure does not lose appointment/job data. |
| T12 Reviews/delivery | Correct brand preview, explicit manual/automatic trigger, one logical request per job, sent/failed/uncertain recovery without blind duplicate sending. |
| T13 Site handoff | Synthetic submission remains pending review before becoming job/customer work; no external website call. |
| T14 Reset/determinism | Reset restores all seed state; virtual clock/scenarios are repeatable; role/brand switching does not leak stale privileged views. |
| T15 Usability/states | Desktop/tablet/phone, keyboard/focus/labels/contrast, validation, loading, empty, denied, expired, missing-file and integration-failure states inspected. |
| T16 Isolation/privacy | App-owned network operations, source/assets/config/metadata/logs inspected; no business APIs, secrets, real identifiers, AI runtime, telemetry, camera/geolocation or deployment. Explicit Maps click is separately identified. |
| T17 Quality/export | Actual exported manifest scripts establish exact commands; build/types/lint/demo test results, failures/skips and source identity recorded. No unverified command labelled passed. |

Capture command, working directory or AI Studio environment, actual result/exit, counts, skipped reason, checkpoint/export hash and affected journey. Screenshots establish appearance, not completed interactions or server security. Platform preview/network traffic must be distinguished from CABMS application-owned requests.

## 8. Local/repository integration gate - later, not now

Before any local agent modifies CABMS, explicitly read workspace-root AGENTS.md, canonical repository AGENTS.md and applicable nested instructions. Discover exact host paths rather than assuming a drive or username. Inspect repository identity, remote, branch, upstream, base/current HEAD, staged/unstaged/untracked changes, local-only commits, unfinished operations, worktree registrations and existing workspace entries.

If rules are absent, inspect local Codex capabilities; use /init or a verified generator only to draft a scoped proposal, with exact-file permission before writing. Preserve existing rules. Root-only workspace mode is preferred; preserve a single '.' entry and do not add duplicate child mounts. No automatic relocation.

For an approved group worktree, separately approve creation from a verified safe base, designate one writable checkout, identify dedicated group evidence, verify both paths are reachable, and record exact paths/base/opening HEAD. Dirty or diverged state requires a preservation plan; never stash/reset/clean automatically.

Preserve the original AI Studio ZIP and review its full member inventory before extraction/import. Reject unsafe paths/symlinks and unexpected executable/install hooks. Compare actual changes against the verified base. Proposed later documentation paths are <WORKSPACE_ROOT>/AGENTS.md, <CANONICAL_REPO>/AGENTS.md, <CANONICAL_REPO>/SETUP.md, <CANONICAL_REPO>/TODO.md and relevant README/workspace configuration; these are placeholders, NOT exact-path write permission.

Before any approved publication inspect the real diff, tracked files, generated documents/assets, screenshots/logs and any environment example. No licence, visibility change, public test deployment or secret exposure is implied. Later archival follows acceptance, verified approved merge or explicit no-merge closure, verified preservation and separate exact-path retirement approval. No cleanup is part of G00 authoring permission.

## 9. Effort forecast and scope control

| Work | Focused hours |
|---|---:|
| Setup decisions, sanitised mapping, prompt preparation | 6-10 |
| AI Studio full-app authoring and connected journey iteration | 24-34 |
| Mobile/accessibility/error-state and mock checks/corrections | 12-18 |
| Client walkthrough and up to two bounded feedback rounds | 10-16 |
| Export/integration/privacy/final acceptance evidence | 8-12 |
| Total | 60-90 |

Assumptions: one frontend; Rockson as sole human developer; safe mocks; placeholder branding; no actual e-signature or integrations; no website rebuild; timely consolidated feedback. Waiting and new scope can extend elapsed duration. This estimate is retained from the approved review, not a new promise or measured actual. Reforecast when actual export complexity or defects provide evidence.

## 10. Source and uncertainty record

Basis: CABMS-DEVELOPMENT-MANAGER-STARTER-G00.txt; Rockson's current approval; the complete FULLSTACK-MANAGER.md and supplied FULLSTACK-PROJECT-RULES.md reviewed in the preceding review; SETUP/sprint references and portable worktree/evidence/archive rule.

A focused follow-up read used 04_CLIENT_FORMS_TEXT.md, a supplied text-extraction reading copy of unapproved form variants. Field groups in the Build prompt are sanitised from those extracts. The original DOCX visual layout, logos and signatures were NOT visually revalidated. The prompt does not choose a final variant, reproduce original legal clauses, or fill missing Electrical Part B. Smoke-alarm per-row Pass/Fail and room/model/expiry notes remain explicitly provisional; cabler expiry and issuer conflicts remain placeholders.

External workflow verification: official Google AI Studio Build documentation, checked 22 October 2026, supports web generation/iteration and ZIP export and describes optional full-stack provisioning. This is tool-workflow evidence, not approval of those optional services. No AI Studio app was created or operated in this review.

## 11. Next gate

Review the prepared Build and iteration prompts. The next execution permission is AI Studio-only demo authoring with its explicitly bounded preview tooling and an explicit G00 start decision. Repository setup/access, local packages and Git actions remain separate later gates. Do not re-request the already approved A-J scope or reopen broad discovery.
