# CABMS Branch Naming Plan

**Status:** Branch names remain proposals. Fact-checked 28 October 2026 to reflect the owner-approved Cloudflare hosting/delivery constraint; no feature branches are created by this plan.

## Planning baseline

- Repository: `PixelsWorker/CABMS`
- Current local base: `2b04f87bbb6dc4f81b65c6f2844d76488161e62d`
- Current planning branch/worktree: `dev`, `E:/Projects/CABMS/worktree/dev`
- Main checkout: same commit, local merge subject records PR #16
- Historical drafting base: `bbbdff6`, `docs/branch-naming-plan`; those are not the current worktree
- Current remote PR/issue state: not refreshed; network retrieval failed during this audit

The three planning documents were already untracked in `worktree/dev` when inspected. Earlier worktree-creation notes describe historical drafting only. Future implementation branches should start from the latest approved integration base when authorized. This audit creates no branch or commit. See [current fact-check](../../graphify-out/PLANNING-FACT-CHECK.md).

## Accepted hosting and delivery constraint

See [`ARCHITECTURE.md`](ARCHITECTURE.md) §§4, 11 and 14–16 for the authoritative hosting/build arrangement, FC-06 deployment hold, technical prerequisites and A0 gates; branch names add no execution authority.

## Naming convention

Use lowercase names in this form:

```text
<type>/<group>-<short-purpose>
```

Types: `docs` for architecture and decision documents, `feat` for approved business outcomes, `fix` for scoped defects, `chore` for separately approved technical prerequisites, and `test` for separately approved test-only corrective work. A technical prerequisite may use `<type>/<short-purpose>` without a G-group. Normal tests belong in their corresponding end-to-end G01+ feature branch; do not create a standalone test branch for routine group coverage. Keep names short, use hyphens, and include a G-group only after its identifier and scope are approved.

## Proposed branches

| Branch | Purpose | Gate |
|---|---|---|
| `docs/a0-part1-decision-memo` | Part 1 architecture research and proposed ADRs | A0 read-only research authorized; no implementation |
| `docs/a0-part2-backend-architecture` | Detailed architecture and API contracts | Part 1 reviewed and architecture direction approved |
| FC-06 corrective work — existing G00 review branch preferred; any separate name TBD | Separately scoped remediation under ARCHITECTURE §11 | VERIFIED local build inclusion of five planning files on 28 October; live exposure unknown. **Hard hold on any deployment, including public previews, until remediated.** A separate corrective branch requires explicit approval. |
| Historical separate technical-prerequisite proposal — superseded for G01 | Necessary technical work is included in the same identity/workspace/audited-settings feature group (ARCHITECTURE §§16.1/19.5). | No foundation-only, backend-only or UI-only sprint/branch. Execution remains gated. |
| `feat/g01-identity-workspaces` | Authentication → authorized workspace → persisted workspace/legal settings → atomic audit → frontend feedback and verification | **AUTHORIZED by Rockson (28 Oct 2026).** Core G01 decisions accepted (Firebase Auth Spark + Google Sign-In, D1 with Nonce Guard, 1:1 Legal Issuer, `/api/v1` API baseline). |
| `feat/g02-customers-jobs` | Approved customer and job operations | G02 scope and dependencies approved |
| `feat/g03-quotes-acceptance` | Quote and customer acceptance paths | G03 contract and execution scope approved |
| `feat/g0x-compliance-certificates` | Placeholder only; do not create yet | Wait for the final roadmap to resolve G05 versus the older P4/G5 labels |

Local history records G00 PR #16 merged at `2b04f87`; do not assume `feat/g00-full-review` is still an active unmerged workstream. Recheck the approved target/base before any further G00 correction. Do not create duplicate branches for the same work. Link issue numbers in the PR title or description when useful; do not make an issue number part of every branch name.

## Repository and PR boundaries

- Follow ARCHITECTURE §4 for source layout, package-manager governance, coordinated build and output boundaries; this plan intentionally does not duplicate that design.
- Use one focused approved vertical outcome per implementation branch and PR. Include its backend, API contract, frontend integration, permissions, failure handling and relevant tests.
- Keep frontend and Worker work for each vertical outcome on the same approved feature branch. Do not create parallel frontend/backend branches, extra Worker services or a separate API deployment merely because the source modules are separate. Routine group tests remain in that branch; separately approved corrective work may use the `test/` convention above.
- Deployment coordination does not remove contract compatibility, server-side authorization, database-migration or rollback requirements. Branch names and hosting selection do not authorize those execution steps.
- Keep A0 research branches document-only. Do not use them for backend code, migrations, provisioning, credentials, live integrations or deployment.
- The earlier separate-foundation proposal is retained as history and superseded for G01 by the 28 October handoff. Include necessary frontend/Worker/database/authorization/audit work in the one end-to-end G01 branch. A scaffold alone is not completion.
- Open implementation PRs against the integration branch designated by the approved delivery process. PR #14 targeted `dev` at the 27 October 2026 inspection; this is a dated snapshot, does not authorize a merge and does not establish a permanent PR-target rule.
- Do not force-push. Rebase or merge only under the repository's approved collaboration process.

## Decisions still needed

1. Approve the final G01+ group sequence and resolve the compliance group identifier before naming its implementation branch.
2. Confirm the integration branch and PR target for each delivery group after G00 acceptance.
3. Decide whether documentation branches are reviewed independently or included with the corresponding architecture review packet.
4. Resolve database, identity, retention, data-location and resource/build details through A0 within the Cloudflare constraint before authorizing implementation work.
5. Approve the detailed G01 identity, membership, legal-issuer, privacy/retention and database design/proofs. Minimum technical work belongs inside G01; restore evidence must pass before the first live business data, even if introduced before G02.

Creating this plan and its planning branch does not create or approve any proposed delivery branch.

## Audit carry-forward — 28 October 2026

Keep `feat/g01-identity-workspaces` scoped to the approved identity/workspace/settings outcome. The 28 October handoff resolves the boundary: customer/enquiry/job and operational dashboard persistence remains G02 unless separately changed by the owner. Do not add R2, replication, queues or fixed recovery targets merely to match a roadmap table. Apply ARCHITECTURE §§10.2/12 and its reusable review checklist to each slice: seven code principles, eight API principles, source/field/data-flow evidence and explicit scope exclusions.

## G01 reconciled planning boundary — 28 October 2026

**Accepted planning direction; implementation NOT authorized.** Proposed branch `feat/g01-identity-workspaces` is retained; it has not been created/switched to. ARCHITECTURE §19.5 is the detailed scope and acceptance reference.

- **Deliverable:** Real authentication → authorized workspace → persistent settings → atomic settings audit → frontend feedback/verification, including necessary frontend, modular Worker, database, runtime validation, server-side authorization and audit tests in the same feature group.
- **Two Save controls:** Save Workspace Settings and Super Admin-only Save Legal Details operate on separate resources with independent versions/ETags and mandatory If-Match. Use `{api_prefix}` until the authoritative contract selects it. Handle 412 PRECONDITION_FAILED and 428 PRECONDITION_REQUIRED via ARCHITECTURE §10.4; report each save independently.
- **Audit:** Meaningful approved non-secret before/after values plus actor/workspace/UTC/version/outcome/request evidence. Privacy/redaction and retention require approval. Credentials/tokens are excluded. Exact D1 nonce/guard SQL remains PENDING EXECUTABLE PROOF; audit failure must atomically prevent an unaudited update. Post-commit row counts cannot roll back a batch.
- **System logging:** G01 includes structured Worker request/error/performance logs and atomic settings audit. G02–G07 extend logging and durable audit with their feature changes and real provider outcomes. G08 may assess separately approved R2 system-log archival, with export/retrieval/access/redaction/failure/recovery tests; it is not a G01 dependency. Keep logs distinct from business audit and signed compliance evidence; no competing audit store or G01 Settings History screen.
- **Three existing businesses only:** Synthetic seed values; no new-business provisioning. Remove Add Business Profile button/modal and visible Draft Business Profiles from the proposed active UI. Preserve historical data/code/evidence; no deletion is authorized here.
- **Excluded/deferred:** G02 customer/enquiry/job/operational-dashboard persistence; full template-policy persistence; Settings History administration screen; R2/logo uploads; live MYOB/Email/Google Calendar; separate foundation/backend/UI sprints and unnecessary infrastructure.
- **Integration ownership:** Necessary status records/fakes may be account-owned or workspace-owned. A shared MYOB company file remains a demo assumption pending ledger ownership confirmation.
- **Tests required when execution is authorized:** Frontend loading/saving/error/conflict and independent outcomes; Worker identity/membership/field checks; database concurrent saves, stale/missing versions, audit insertion failure, zero-row update and cross-workspace isolation; privacy-safe durable audit verification; retry without losing permitted edits; persisted values after refresh/re-sign-in.
- **Dependencies/risks:** G00 acceptance and issue #11 remain open; F02 pending; FC-06 deployment clearance blocked. A0 must settle provider/MFA/session policy, memberships, legal-issuer relationships, D1 suitability/residency, privacy/retention and supported atomic guard. Recover the authentic contract or obtain owner-approved replacement baseline. Prove restore before any live business data, including G01 if applicable.
- **Owner approval / target:** Rockson/R&C review and architecture submission precede explicit implementation approval. Effort and target are TBD / unestimated; no existing illustrative estimate commits this revised group. Preserve accepted Cloudflare deployment direction and established group history.

## R&C completion requirements - 28 October 2026

G01 includes controlled first-admin/staff lifecycle, session security, explicit real/demo separation, the BrandConfig contract mapping and asynchronous draft/save rules in ARCHITECTURE section 19.5. Contract approval covers exact ETag parsing and existing error conventions. Validate real frontend-to-Worker/database logging and atomic audit; mock success does not establish integration completion. Preserve the deferred Settings History screen.

Each G02-G07 feature extends structured logs, durable audit and provider history where applicable, with integration/security/error evidence in the same feature group. G08 expands monitoring, alerting and retention; optional R2 log archival requires separate approval and actual export/retrieval/access/redaction/failure/recovery tests. No additional logging sprint or G01 R2 dependency is created. G02 retains NEEDS_REVISIT and restore proof on approved persistence; G03 timing remains production-policy pending; G05 quotation bypass does not waive applicable compliance forms/signatures.
