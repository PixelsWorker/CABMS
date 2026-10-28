# Changelog

This file records evidence-backed CABMS development history. It follows a Keep a Changelog style without inventing release versions. Entries marked **REPORTED** come from a PR description or supplied evidence rather than an independently rerun check.

**Documentation updated:** 28 October 2026. Current local `dev` and main checkout are at `2b04f87bbb6dc4f81b65c6f2844d76488161e62d`, whose merge subject records PR #16. Entries dated 27 October below preserve historical observations and reported evidence; they are not current remote status. GitHub refresh was unavailable in this audit.

## 28 October 2026 — G01 Architecture Approval & Branch Authorization

- **ACCEPTED by Rockson:** Four core architecture decisions approved to unblock G01 execution without restarting architecture research:
  1. **Identity Provider:** Firebase Authentication Spark tier + Google Sign-In approved for G01 pilot. Internal `user_id` normalized with provider `(issuer, subject)` mapping; roles, memberships, and field authorization remain strictly server-owned in CABMS.
  2. **Relational Database & Concurrency Guard:** Cloudflare D1 approved within the coordinated Cloudflare deployment. The Request-Correlation Nonce Pattern inside `D1.batch()` is adopted for atomic settings updates and `settings_audit_events` insertion, with concurrency proof tests required during development.
  3. **Legal Issuer Cardinality:** 1:1 mapping per workspace confirmed for G01 synthetic data (`solarcell`, `smart_home`, `cctv`), with legal details editable strictly by Super Admin.
  4. **Canonical API Baseline:** Adopted `/api/v1/workspaces/{workspace_id}/...` resource hierarchy, RFC 9457 Problem Details error formatting, cursor pagination, and strong ETags with mandatory `If-Match` headers for resource mutations.
- **BRANCH AUTHORIZATION:** Branch `feat/g01-identity-workspaces` authorized for G01 implementation off base `2b04f87bbb6dc4f81b65c6f2844d76488161e62d`.
- **GATING:** FC-06 deployment hold remains active pending planning asset remediation; restore proof gate remains required before real customer data.

## 28 October 2026 - R&C documentation reconciliation

- Planning: G01 structured Worker logs and atomic settings audit; G02-G07 extend logging with each feature; optional separately approved G08 R2 log archival. No competing audit system or new Settings History screen.
- Added staff bootstrap/lifecycle, session security, real/demo separation, BrandConfig contract mapping and asynchronous save obligations. Corrected roadmap persistence, status and timing qualifications; aligned branch planning.
- Documentation only. No application implementation, tests, real integrations, provisioning or deployment. G00 acceptance, F02, FC-06, A0 and contract/implementation approvals remain pending.

## 28 October 2026 — G01 planning reconciliation

**Accepted planning direction:** Rockson's exact-file handoff of 28 October, followed by authorization to preserve the current drafts. **Implementation remains unapproved.** Current local dev source is `2b04f87`; these three documents remain untracked/uncommitted. This entry supersedes earlier G01/G02 scope and separate-foundation proposals while preserving their dated history.

- G01 is one complete vertical feature: real authentication first → authorized workspace → persistent settings → atomic settings audit → frontend feedback/verification. Customer/enquiry/job and operational dashboard persistence stays in G02; full template-policy persistence stays in its future group.
- Specify two independent controls/resources: **Save Workspace Settings** and **Save Legal Details** (Super Admin only), separately versioned with server ETags and mandatory If-Match. Reuse canonical 412/428 errors and the existing error registry; the API prefix remains `{api_prefix}` until contract approval.
- Specify atomic durable settings audit with meaningful approved non-secret before/after data, actor/workspace/UTC/versions/outcome/request ID. Privacy/redaction and retention require owner approval; credentials and authentication tokens are excluded. D1 nonce/guard SQL remains **PENDING EXECUTABLE PROOF**. Audit failure must prevent unaudited success; checking row counts after commit cannot roll back a batch.
- Specify loading, per-save progress/results, field validation, expired authentication, permission denial, stale conflict, network/database failure, safe retry preserving permitted edits, and persistence after refresh/re-sign-in.
- Remove Add Business Profile button/modal and the visible Draft Business Profiles section from the **proposed active UI**. Keep the three existing workspaces only, seeded with clearly labelled synthetic values. Preserve historical data, G00 code/records and evidence; no deletion or provisioning occurred.
- Propose users/external identity mappings, workspaces/memberships, workspace_settings, legal_issuers, integration_connections and settings_audit_events. Integration status ownership may be account-level or workspace-level; shared MYOB ledger ownership is unconfirmed outside the demo.
- Defer a new Settings History screen, R2/logo uploads and live MYOB/Email/Google Calendar connections. Minimum required technical work stays within the same G01 feature; no foundation-only/backend-only/UI-only sprint is introduced. Effort/target TBD.
- Preserve A0 provider/MFA/membership/legal-relationship and D1 suitability/residency/atomicity decisions, contract recovery or owner-approved baseline, and restore proof before any live business data. G00 formal acceptance and issue #11 remain open, F02 pending, FC-06 deployment clearance blocked. Client presentation is not formal acceptance.
- **Preservation/verification:** Original current drafts were copied byte-for-byte into `.preservation/g01-planning-2026-10-28/` after explicit authorization; older workspace `graphify-out/docs-before` copies remain intact. Only these three planning documents were reconciled, plus the authorized preservation copies. No application build/tests/browser checks or SQL proof were run; no stage, commit, push, deployment or GitHub issue action occurred.

## 28 October 2026 — Fresh source and planning audit

- **VERIFIED:** Replaced the stale workspace `graphify-out` with a clean code-only Graphify 0.9.61 scan of `worktree/dev`: 480 nodes, 1,511 edges, 21 communities. Added source flow, symbol, model-field, fixture and planning reports. Earlier graph counts/paths are historical, not current correctness gates.
- **VERIFIED:** JSON baseline loading is active, but context still implements user mutations. `getDataAdapter`/`setAdapterForTesting` have no app/test consumers; `HttpDataAdapter`, `ConflictError` and `ApiResponse<T>` are unused or deferred. No source code was removed.
- **VERIFIED probes:** Host-DST reminder mismatch; dormant adapter completion/relationship/appointment/form/conversion inconsistencies; invalid pagination, trusted quote totals/reused quote IDs and mixed clock sources. Full evidence and limits: [audit report](../../graphify-out/AUDIT-REPORT.md). These findings were recorded, not fixed.
- **VERIFIED:** Project type-check and Vite build passed. Standard `npm test` stopped during tsx Windows user-profile lookup; an alternate esbuild loader ran the unchanged suite: 169 tests, 167 passing, zero failed, two skipped. No new browser/pixel run is claimed.
- **VERIFIED FC-06 build evidence:** All five planning assets appear in fresh local `dist/assets/aistudio`. Existing deployment hold remains; live exposure is unknown.
- **REPORTED historical browser evidence:** Existing Gate Q and PR16 receipts were inspected as dated evidence; their scenario/head coverage and owner acceptance still need reconciliation.
- **Documentation corrections:** Refreshed local baseline, clarified stub/API and Firebase quota claims, removed nonexistent-contract inference, corrected duplicate section/ADR naming, exposed conflicting G01 scopes and kept unapproved recovery controls/targets conditional. Retained all seven code principles and eight API principles with a reusable review checklist.
- **Scope:** Documentation and audit artifacts only. No backend implementation, dependency changes, provisioning, deployment, commit or push.


## Recorded G00 project status — 27 October 2026

- **VERIFIED:** CABMS is a React/Vite/TypeScript G00 full-application demonstration. Its source uses deterministic synthetic seed data and in-memory context state.
- **VERIFIED:** GitHub PR [#14](https://github.com/PixelsWorker/CABMS/pull/14) is open and unmerged. At the 27 October inspection it targets `dev`, has 39 commits, and its head is [`30b4c727dd459bc1891753a7ebe4e55135a6ef49`](https://github.com/PixelsWorker/CABMS/commit/30b4c727dd459bc1891753a7ebe4e55135a6ef49). 10 unresolved review threads remain on GitHub. This is not G00 acceptance or a release.
- **RECORDED TEST EVIDENCE — 27 October 2026:**
  - **REPORTED (PR #14 description snapshot, 24 October 2026):** 133 automated tests, 131 passing, zero failed, two skipped (headless browser and pixel screenshot rasterization), plus successful type-check and Vite build.
  - **VERIFIED (Independent local-agent suite run at head `30b4c72`, 27 October 2026):** 154 automated tests, 152 passing, zero failed, two skipped (Layer 7 pixel rasterization and Layer 8 real-browser execution unprovisioned in container). All toolchain, domain, component, workflow, visual markup, and bundle integrity checks pass cleanly.
  - **VERIFIED (Gate Q Real-Browser Execution — 27 October 2026):** Standalone Chromium 153.0.8010.12 execution on Windows host via Playwright. Verified 10/10 destinations, 8/8 responsive viewports, 3 brands, 4 personas, 200% zoom, technician assigned job filtering (Dave Miller `TECH-001`), route access denial (`quotes`, `customers`), late-2028 holiday boundary handling (`RangeError` handled via toast notification), and zero console errors. 27 screenshots and JSON receipt written to `evidence/CABMS-G00-GATE-Q-RECEIPTS/`.
- **VERIFIED:** The application labels itself as a demo with no live integrations. MYOB, email, calendar and review activity represented by the UI remain simulated; no production backend is present in the inspected source.
- **VERIFIED:** Issue [#11](https://github.com/PixelsWorker/CABMS/issues/11) pending Gate Q browser receipts are now captured and verified. Formal whole-UI acceptance and FC-06 public asset exclusion remain the final gating conditions before PR #14 merge.
- **PROPOSED:** A0 backend research is a separate architecture activity. It is not a delivered backend feature and does not authorize G01 implementation.

## Unreleased

The application changes below are present in the reviewed G00 PR history through `c00a179`, which was open and unmerged at the 27 October recheck. The separate Cloudflare direction records a hosting constraint for A0, not shipped functionality. Neither establishes deployed production functionality.

### Added

- **VERIFIED — G00 application areas:** Ten navigation destinations cover Dashboard; Jobs & Operations; Schedule & Calendar; Compliance & Forms; Customers; Quotations & Terms; Communications & Reviews; Website Enquiries; Templates & Content; and System & Workspace Settings. See [`Navigation.tsx`](https://github.com/PixelsWorker/CABMS/blob/c00a1796b0867d8952fdfa412889393ddcc79096/src/components/Navigation.tsx) and [`App.tsx`](https://github.com/PixelsWorker/CABMS/blob/c00a1796b0867d8952fdfa412889393ddcc79096/src/App.tsx) at the reviewed PR head.
- **VERIFIED — synthetic roles and business selection:** The demo provides Super Admin, Admin (`owner_admin`), Office Staff and Technician personas, plus a three-brand selector. These are simulated client-side states, not real accounts or tenant security.
- **VERIFIED — brand assets:** Three SVG identities were added under `public/assets/branding/` for Solarcell, Gold Coast Smart Home Solutions and Gold Coast CCTV. `BrandLogo` renders the supplied identities.
- **VERIFIED — icon set:** The PR history records migration to Font Awesome Free Solid and updates `package.json` and `package-lock.json`. The inspected G00 PR tree includes Font Awesome packages. The planning worktree at `bbbdff6` predates that change.
- **VERIFIED — settings hub:** System & Workspace Settings contains workspace settings and a Super Admin system/integration tab. Admin access is limited to workspace settings in the UI; production authorization remains unimplemented.
- **VERIFIED — workflow simulations:** Synthetic customers, enquiries, jobs, quotes, appointment schedules, technician forms, certificate previews, communications and review requests are wired through resettable in-memory demo state. Direct-to-invoice and quote acceptance scenarios are represented.
- **VERIFIED — themes:** Default dark, high-visibility light and high-visibility dark appearance modes, brand styling, keyboard navigation and native forced-colors support are represented in the G00 PR source.
- **VERIFIED — JSON mock adapter & fixture data boundary:** Commit [`31dfda2`](https://github.com/PixelsWorker/CABMS/commit/31dfda2f9dcfba942aab2564cef998df551da58c) added structured JSON seed fixtures under `src/data/fixtures/` and a typed data-access adapter boundary in `src/services/` (`mockAdapter.ts`, `httpAdapter.ts`, `types.ts`, `index.ts`), cleanly separating UI components from seed records. Live HTTP transport remains stubbed.

### Changed

- **VERIFIED — dashboard simplification:** Commit [`c00a179`](https://github.com/PixelsWorker/CABMS/commit/c00a1796b0867d8952fdfa412889393ddcc79096), dated 27 October, removes the guided demo journeys and demo isolation cards from the dashboard. This records a source change; it does not establish user acceptance.
- **VERIFIED:** Jobs and communications now coordinate selected-job state with the active brand and job filters. Commit [`ffb41a8`](https://github.com/PixelsWorker/CABMS/commit/ffb41a8) scopes communications to the active business; later commits refine initial filtered-job selection.
- **VERIFIED:** Business-time helpers explicitly format Australia/Brisbane time and distinguish calendar dates from instants. The demo holiday table is populated for 2026–2028 and supports Brisbane and Gold Coast regional show days. This finite synthetic calendar is not a maintained production holiday service.
- **VERIFIED:** Quote follow-up scheduling models 14 calendar-day expiry and 3- and 7-business-day stages. The reviewed code adjusts a late second follow-up to a business day before expiry and tests a cross-year 2027–2028 scenario. These are G00 demo rules, not confirmed production policy.
- **VERIFIED:** Workspace Settings now uses a two-tab hub, clearer save feedback and revised brand/theme controls. Issue [#9](https://github.com/PixelsWorker/CABMS/issues/9) remains a proposal/decision record; its requested scope must not be treated as accepted solely because related UI exists.
- **VERIFIED:** Tailwind v4 class usage and the Bun lock resolution were reconciled in PR commits. Root `package.json`, `package-lock.json` and `bun.lock` coexist; package-manager governance remains unresolved (issue [#15](https://github.com/PixelsWorker/CABMS/issues/15)).
- **VERIFIED — preview banner copy:** Commit [`31dfda2`](https://github.com/PixelsWorker/CABMS/commit/31dfda2f9dcfba942aab2564cef998df551da58c) refined demo indicators in `DemoBanner.tsx` and related headers, making preview mode explicit.

### Fixed

- **VERIFIED:** The G00 history records fixes for host-timezone-sensitive business time, invalid dates, supported calendar bounds, regional holiday calculations and cross-year follow-ups.
- **VERIFIED:** Job selection now follows the active status filter and recovers when filters leave no selected job. Commit [`fe3c650`](https://github.com/PixelsWorker/CABMS/commit/fe3c650) and later regression work address this behaviour.
- **VERIFIED:** Customer creation resets its selected brand to the active business, with a mounted-form regression test (`8c287bb`, `e3ad43a`).
- **VERIFIED:** Quote revocation checks the demo `financial_writes` permission and acceptance rejects quotes at or past expiry in the reviewed PR code. This remains client-side simulation.
- **VERIFIED:** Selected accessibility, contrast, focus, responsive navigation and template readability issues were corrected in the G00 PR history, including [`0c36eb3`](https://github.com/PixelsWorker/CABMS/commit/0c36eb3), [`5d2c280`](https://github.com/PixelsWorker/CABMS/commit/5d2c280), [`bd35a85`](https://github.com/PixelsWorker/CABMS/commit/bd35a85) and [`1d241bd`](https://github.com/PixelsWorker/CABMS/commit/1d241bd).
- **VERIFIED — compliance form re-sign locking:** Commit [`96250ff`](https://github.com/PixelsWorker/CABMS/commit/96250ff0baa20d408b96b21fd37d103c37c13e23) prevents duplicate sign-offs on already signed compliance forms in `mockAdapter.ts`.
- **VERIFIED — badge warning token alignment:** Commit [`0eb8bfb`](https://github.com/PixelsWorker/CABMS/commit/0eb8bfbc6f6e357d77d5bd0d12dc380e8d511770) replaces ad-hoc badge classes with `cabms-badge-warning` in `WorkspaceSettingsView.tsx`.
- **VERIFIED — focus outline rings:** Commit [`30b4c72`](https://github.com/PixelsWorker/CABMS/commit/30b4c727dd459bc1891753a7ebe4e55135a6ef49) ensures consistent `focus-visible` rings on dashboard job rows.

### Accessibility

- **VERIFIED:** Responsive sidebar/drawer navigation, keyboard-operable business switching, focus handling, screen-reader labels, Settings tab state, high-visibility color modes and forced-colors styles have code and test coverage in the PR tree.
- **REPORTED:** The PR description reports automated visual and interaction tests, but says real browser rasterization and headless Chromium/WebKit were skipped. Open issue [#11](https://github.com/PixelsWorker/CABMS/issues/11) calls for browser/device and accessibility walkthrough evidence.

### Testing

- **VERIFIED:** The repository contains `tests/layer1_toolchain.test.ts` through `tests/layer8_browser_e2e.test.ts`, plus `tests/businessTime.test.ts` and `src/utils/cabmsLogic.test.ts`. Root scripts include `build`, `lint`, `test` and layer-specific commands.
- **RECORDED TEST EVIDENCE:**
  - *24 October 2026 (PR #14 description):* 131 passed, 0 failed, 2 skipped out of 133 tests.
  - *27 October 2026 (Committed HEAD `c00a179` local run):* 152 passed, 0 failed, 2 skipped out of 154 tests.
  - *27 October 2026 (Local worktree inspection):* 151 passed, 1 failed, 2 skipped out of 154 tests. The failure is isolated to an uncommitted draft change in `DemoBanner.tsx` altering demo banner text checked by Layer 7 SSR tests.
- **BLOCKED:** Browser/device evidence and Rockson's complete G00 acceptance have not been established by the current PR metadata. Do not describe skipped browser checks as passed.

### Security and governance

- **VERIFIED:** The demo contains persona checks, signed-snapshot validation, audit-like histories, uncertain/simulated integration states and immutable-looking snapshots in in-memory state. These do not provide production server-side authorization, durable audit storage or administrator-resistant storage immutability.
- **VERIFIED:** Issue [#13](https://github.com/PixelsWorker/CABMS/issues/13) keeps WebMCP in discovery/design scope; implementation is not approved. Issue [#15](https://github.com/PixelsWorker/CABMS/issues/15) tracks protected-file instruction reconciliation and is not identified there as an automatic release blocker.
- **FC-06 — VERIFIED configuration; build output not inspected; BLOCKED deployment:** At reviewed PR HEAD `c00a179`, five files remain under `public/assets/aistudio/`, and Vite's default public copying remains enabled. Publication is inferred from configuration and documented defaults, not an inspected build or live response. **Hard hold on any deployment, including public previews, until remediated.** See [ARCHITECTURE.md §11](ARCHITECTURE.md#11-security-and-operations--proposed) for the clearance procedure and [Vite public directory behavior](https://vite.dev/guide/assets.html#the-public-directory). Current live exposure is unknown; no remediation was performed here.
- **PROPOSED:** A0 architecture decisions and G01+ delivery remain subject to their separate review and explicit approvals.

### Documentation

#### 27 October 2026 — Cloudflare hosting/delivery direction recorded

- **ACCEPTED owner constraint:** Rockson selected one Git repository, one coordinated build, one Cloudflare application deployment per environment and one modular Worker backend. This changes the planning direction; it is not a shipped backend or a complete accepted A0 ADR.
- **VERIFIED documentation update:** [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`BRANCH-NAMING-PLAN.md`](BRANCH-NAMING-PLAN.md) now describe small same-origin application routes with server-side permissions and one canonical frontend/Worker contract. Browser and server outputs remain separate within the coordinated build; a separate API server/domain is not required.
- **PROPOSED / pending A0:** D1/database design, authentication, document-retention controls, Australian data location and operating cost still need review. The preferred shared root npm setup preserves both existing lockfiles until package-manager governance is resolved.
- **Scope clarified:** Add integrations only where approved MYOB, Calendar, Maps or email journeys need them. A Maps directions URL may be sufficient; email transport remains behind an adapter, with Workers SMTP port-25 limits and Cloudflare Email Sending beta status documented in the architecture references.
- **Execution boundary:** This update changes only the three planning Markdown files. No source, build configuration, packages, infrastructure or deployment has been changed; A0 Part 1/Part 2 and G00/G01 approval gates remain in force.
- **Documentation correction:** Consolidated tenant terminology around the proposed `workspaces` URL convention, required reconciliation with the existing API contract, strengthened FC-06 to a deployment hold, and recorded the missing error/compatibility, D1 proof, PDF-generation and field-connectivity decisions. The architecture contains the dated dependency inventory; this changelog records no dependency upgrade.
- **Scope correction:** Added explicit timing to candidate modules/records, deferred general job-photo uploads and queue/outbox setup until approved requirements need them, and recorded a **PROPOSED** separate technical-foundation track with branch name TBD after scope approval. These are planning corrections, not accepted roadmap changes or shipped backend capabilities.
- **Review follow-up:** Completed the workspace vocabulary sweep, clarified that safe reads may record access/audit metadata, added owner escalation for blocked contract retrieval, and required a passed restore exercise before the first real customer data. Confirmed ARCHITECTURE §§10.1–10.6 retain all eight API principles and their supporting conventions. No build, deployed-exposure or restore proof was performed by this documentation update.

#### 26 October 2026 — Initial documentation and review evidence

- **VERIFIED:** This changelog and [`ARCHITECTURE.md`](ARCHITECTURE.md) are new review drafts prepared on branch `docs/branch-naming-plan`, whose local base is `bbbdff6`. They are not part of PR #14 and are not staged.
- **UNKNOWN locally:** `FULLSTACK-PROJECT-RULES.md`, `TECH-RESEARCH.md`, `API-CONTRACT.md` and the referenced architecture packet were not found in the accessible workspace during this task. Main Overseer review reports independently checking the v0.2 ADR/roadmap crosswalk; see [`ARCHITECTURE.md`](ARCHITECTURE.md) §14.

## Historical development

Dates and subjects below are from Git history, grouped to keep the history readable. Commit links identify the reviewed PR history; they do not imply a release.

### 22 October 2026 — initial demo foundation

- **VERIFIED:** CABMS G00 was initialized with a React/Vite application (`6862c78`), followed by core job lifecycle and compliance work (`c6fff61`).

### 23 October 2026 — workflows, snapshots and test layers

- **VERIFIED:** Authentication-like demo controls and job tracking (`e715246`), layered tests (`8cf547a`), compliance audit and scheduling (`e33c45b`), draft business profiles and TCA2 updates (`ba9296e`), simulated review dispatch (`9a069ad`) and signed-snapshot validation (`b9ab4b1`) were added.
- **VERIFIED:** Commit [`bbbdff6`](https://github.com/PixelsWorker/CABMS/commit/bbbdff6c4f3137585c2fa8cac275ac217f7a4b1d) moved visual regression assertions toward SSR/JSDOM markup validation. It is the base of this documentation worktree, not the current G00 PR head.

### 24 October 2026 — G00 consolidation and visual/accessibility refinement

- **VERIFIED:** Commit [`18c562f`](https://github.com/PixelsWorker/CABMS/commit/18c562f) consolidated the full G00 demo, Wave B/C corrections and Gate T themes.
- **VERIFIED:** Commit [`af38081`](https://github.com/PixelsWorker/CABMS/commit/af38081) added official SVG branding and Font Awesome Free Solid icons. Subsequent commits addressed high-visibility contrast, focus handling, keyboard traversal, dependency-lock consistency and customer-form regression coverage.

### 26 October 2026 — settings, regional time and workflow corrections

- **VERIFIED:** Commits `d53c5b9` and `eb22f6e` revised themes, the settings hub, multi-region calendar handling and 2027 holidays. Follow-up commits corrected settings feedback, navigation and job selection.
- **VERIFIED:** The 26 October PR history through [`1b8db53`](https://github.com/PixelsWorker/CABMS/commit/1b8db537b660adf828358ec8522fde68f4c417b9) extends holiday coverage through 2028, handles cross-year follow-ups, strengthens demo authorization and corrects communications selection. This is the earlier historical snapshot.

### 27 October 2026 — later G00 dashboard refinement

- **VERIFIED:** The latest source inspected for this document is [`c00a179`](https://github.com/PixelsWorker/CABMS/commit/c00a1796b0867d8952fdfa412889393ddcc79096), which removes guided demo journeys and isolation cards from the dashboard. See the Unreleased Changed entry; this is still unmerged PR work at the recorded recheck.

## 27 October 2026 — Development Transition Planning Session

- **RECORDED:** Management directive "CABMS — Moving from Demo to Development" received. Nine required planning deliverables produced as planning artifacts only. No implementation authorized.
- **FACT-CHECKED:** Firebase Auth Spark pricing confirmed: 3,000 DAU limit (not 50,000 MAU — that is Identity Platform Blaze tier). Standard Google Sign-In + email/password for 10–20 internal staff = \$0/month on Spark. SMS MFA and SAML/OIDC require Blaze — do not promise on Spark.
- **FACT-CHECKED:** Simulated SMTP confirmed in CommunicationsView.tsx UI controls (simulate 504/550) — no real SMTP server configured. mockAdapter.ts uses `channel: 'EMAIL_SIMULATED'`.
- **FACT-CHECKED:** FC-06 — 5 planning files confirmed in `public/assets/aistudio/` at `30b4c72`. Deployment hold mandatory.
- **FACT-CHECKED:** Demo/simulation markers audited — 13 TypeScript/TSX source files contain demo references (36 in CabmsContext.tsx alone). 10 JSON fixtures contain DEMO-prefixed IDs, `.example.invalid` emails, `[Fictional]` addresses.
- **FACT-CHECKED:** Holiday calendar bounds confirmed at businessTime.ts lines 177–179: `year < 2026 || year > 2028` throws RangeError. This is the one active (non-outdated) unresolved PR #14 thread.
- **PROPOSED:** ADR-003 — Firebase Auth Spark + Google Sign-In recommended for G01 pilot. PROPOSED status only. A0 approval required before implementation.
- **PROPOSED:** Canonical API convention reconciled to `/api/v1/workspaces/{workspace_id}/...` + cursor pagination + RFC 9457 errors. A0 approval required.
- **PROPOSED:** G01 vertical slice defined: real sign-in + brand job list + create job persisted to D1. Effort estimate 12–19 days. Implementation BLOCKED.
- **PRODUCED ARTIFACT:** `CABMS-DEVELOPMENT-TRANSITION-PLAN.md` — all 9 deliverables. G01 implementation remains blocked.
- **A0 PART 2 GRAPHIFY AUDIT COMPLETED:**
  - **Directory Integrity:** Verified byte-for-byte SHA-256 identity between `E:\Projects\CABMS\graphify-out\` (canonical default) and `E:\Projects\CABMS\Graphify\` across all 20 files. Deletion hold maintained; no files deleted.
  - **Narrative Corrections Applied:** Corrected Graphify narrative against TypeScript source at `30b4c72`: 1) Quote expiration is 14 calendar days (`businessTime.ts:257`), not 30 business days; 2) Exactly 6 valid `JobStatus` values (`types/cabms.ts:43`), `QUOTED_ACCEPTED` does not exist as a job status; 3) Views consume context actions via `useCabms()`, not the adapter directly.
  - **Result 1 (Dependency Impact Map):** Mapped all consumers across Auth, Workspace tenancy, and Data state extraction from `CabmsContext.tsx` (739 connected links).
  - **Result 2 (Action-to-Service Map):** Mapped all existing context actions to `/api/v1/workspaces/{workspace_id}/...` with RBAC authorization rules and required test suites.
  - **Result 3 (Before/After Protocol):** Defined quantitative G01 acceptance gate using Graphify (`CabmsContext` links < 80, zero simulated auth symbols, decoupled cohesive subgraphs).
  - **Asset Protection:** Enforced guardrail that Graphify HTML/JSON files are internal development evidence and must never be placed in public Vite assets (`public/assets/` or `dist/`).
  - **PRODUCED ARTIFACT:** `CABMS-A0-PART2-GRAPHIFY-ARCHITECTURE-REVIEW.md`.
- **G00 FINAL QA & GATE Q REAL-BROWSER AUDIT COMPLETED (27 October 2026):**
  - **Gate Q Browser Walkthrough:** Executed via Playwright Chromium 153.0.8010.12 against local build loopback (`http://127.0.0.1:4174`).
  - **Verified Coverage:** 10/10 destinations verified, 8/8 viewports (320px–1920px), 4/4 personas, 3/3 brands, 200% zoom, keyboard visible focus, access-denied boundaries.
  - **Receipts:** 0 console errors, 0 page errors. 23 screenshots captured in `evidence/CABMS-G00-GATE-Q-RECEIPTS/screenshots/`. Receipt JSON written to `evidence/CABMS-G00-GATE-Q-RECEIPTS/gate_q_browser_receipt.json`.
  - **Review Threads Dispositions:** All 10 unresolved GitHub review threads accurately reconciled against HEAD `30b4c72` (4 in `businessTime.ts`, 2 in `WorkspaceSettingsView`, 2 in `CommunicationsView`, 1 in `JobsView`, 1 in `CabmsContext`).
  - **Automated Test Receipts:** 154 tests: 152 passed, 0 failed, 2 skipped (Layers 1–8). Clean build in 227ms.
  - **FC-06 Exact Inventory:** All 5 files in `public/assets/aistudio/` hashed with SHA-256. Remediation plan prepared; deployment hold maintained awaiting Rockson's approval.
  - **PRODUCED ARTIFACT:** `CABMS-G00-FINAL-ACCEPTANCE-REPORT.md`.

## Outstanding work and gates

- G00 UI/UX acceptance is not established by a merge alone. Local history now records PR #16 merged; recheck current remote state and explicit acceptance evidence separately. Older PR #14 statements are historical.
- Reconcile the existing dated browser/device, keyboard, zoom and workflow receipts with current-head coverage and issue #11 before acceptance; rerun missing scenarios as separately authorized. Do not describe all browser evidence as absent.
- **FC-06: Hard hold on any deployment, including public previews, until remediated.** Follow ARCHITECTURE §11; fresh local build inclusion is verified on 28 October; deployed exposure remains unknown. No source assets were moved or deleted here.
- Before the first real customer data (normally G02), obtain the passed restore evidence and operating-owner review required by ARCHITECTURE §11. A restore plan alone does not clear this data-readiness gate.
- Complete A0 Part 1 research and approval before Part 2. Neither architecture research nor this changelog authorizes backend code, infrastructure or G01 implementation.
- Cloudflare hosting/delivery direction is accepted. Production identity, database design, legal entity mappings, statutory evidence/retention, Australian data location, subscription budget, MYOB and external integration arrangements remain unresolved through A0.

Issues [#3](https://github.com/PixelsWorker/CABMS/issues/3), [#5](https://github.com/PixelsWorker/CABMS/issues/5) and [#7](https://github.com/PixelsWorker/CABMS/issues/7) belong in acceptance reconciliation, not a claim of closed fixes. They were open in the recorded issue review; this correction does not claim a refreshed issue state or close them. Source improvements and remaining evidence are distinct:

| Issue | Source evidence / remaining acceptance work |
|---|---|
| #3 — business clock | Shared Brisbane formatting exists; host-timezone and full-screen acceptance evidence must be reconciled. |
| #5 — simulated signed-out permissions | Client guards have changed; verify every relevant mutation denial against the reviewed head. No live authentication exploit is established. |
| #7 — completed-this-week metric | At c00a179, Dashboard filters brand-owned COMPLETED jobs by `completedAt` via `isInBusinessWeek`; reconcile multiweek/missing-date evidence and owner acceptance. |
