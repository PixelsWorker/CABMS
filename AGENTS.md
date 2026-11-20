# CABMS Repository Instructions

## Project Structure

- `backend/`: Worker routes, authorization and repositories.
- `contracts/`: API and shared contract definitions.
- `migrations/`: reviewed database migrations.
- `scripts/`: local and operator utilities; target-specific operations require approval.
- `src/`: React and TypeScript application.
- `src/components/`: shared interface components.
- `src/views/`: application views.
- `src/context/`: shared application state.
- `src/data/`: demo and seed data.
- `src/types/`: domain types.
- `src/utils/`: domain logic and related tests.
- `tests/`: layered toolchain, domain, UI, workflow, and browser tests.
- `public/assets/aistudio/`: imported reference and planning material. Preserve source evidence when making repository copies or edits.

The parent workspace has `evidence/` for reference originals and `worktree/` reserved for additional Git worktrees. Check the parent `AGENTS.md` for workspace-level guidance.

## Commands

Run commands from this directory (or active worktree). Both npm (Node `^22.22.2 || ^24.15.0`, as declared in `package.json` `engines`; `node:sqlite` is required for backend tests) and Bun (`bun.lock`) are supported via `package.json`:

- `npm run dev` / `bun run dev`: start the Vite development server on port 3000 (UI development; requires `npx wrangler dev --port 8787` for local Worker API & D1 session proxying).
- `npx wrangler dev --port 8787`: run the local Cloudflare Worker and D1 database for authenticated local API requests. Wrangler serves `./dist`; build the frontend first on a clean checkout and use an authorized local environment.
- `npm run build` / `bun run build`: build the production app.
- `npm run lint` / `bun run lint`: run the TypeScript compiler without emitting files (`tsc --noEmit`).
- `npm test` / `bun run test`: run the configured application and test suite via the package script.
- Individual layers: `npm run test:layer1` through `npm run test:layer8` (or `bun run ...`).

Use `package.json` scripts as the source of truth if these commands change. Do not claim tests passed unless they were run and passed.

## Code Style

- Use TypeScript and React, matching the existing code and formatting in each file.
- Keep components and view-specific behavior in their established directories; put reusable domain logic in `src/utils/` and shared types in `src/types/`.
- Use `snake_case` for serialized contract keys where applicable; follow existing TypeScript naming conventions for code identifiers.
- Keep demo fixtures and simulated outcomes clearly identified as such.

## Testing

The repository includes layered tests and a test for `src/utils/cabmsLogic.ts`. Add or update focused tests for domain changes and preserve the layer boundaries. Check documentation against the actual implementation. Until AUDIT-08 is fixed and verified, standalone Layer 1 can reuse existing `dist` and is not fresh-build evidence; `npm test` builds first.

### Testing and QA Policy Standard

All repository development follows this testing standard:

1. **Behavior-Distinguishing Tests:** Protect material behavior changes with tests that distinguish correct from incorrect behavior. Use coverage diagnostically on changed code, not as a 100% quota.
2. **Test-First Regressions:** Bug and security fixes begin with a failing test and preserve pre-fix failure and post-fix passing receipts. Pure refactors may rely on adequate existing tests; document justified exceptions.
3. **Boundary Verification:** HTTP handlers, SQL/D1 transactions, auth decisions, external-input validators, and operator CLI utilities require success, rejection, and failure-path tests. Do not silently delete, skip, or weaken security assertions.
4. **Risk-Based Tiers:**
   - **Tier 1 (Critical):** Auth, signing, privileged enrollment, money/GST, migrations, triggers, concurrency, state machines, trust boundaries, CI gates, and security-sensitive configuration. Test success, failure, and edge cases; require real local Worker/D1 tests where relevant and adversarial review.
   - **Tier 2 (Standard):** Branched business logic, reminders, duplicate checks, and application validation. Cover meaningful branches and API schemas.
   - **Tier 3 (Simple):** Pure types and straightforward presentation glue. Require typechecking and existing regression coverage; add focused tests where behavior warrants them.
5. **Runtime Evidence:** In-memory SQLite or other adapters do not prove real local Worker/D1 behavior. Mark required checks accurately as PASSED, NOT RUN, UNVERIFIED, or BLOCKED; never present simulations as full runtime acceptance.
6. **External QA:** External QA tooling supplements, but never replaces, real-runtime integration tests or human review and approval.
7. **Changed-Unit Inventory:** Reconcile a machine-readable test inventory for changed code on each review cycle, and preserve receipts under the approved workspace evidence and archive procedures.

## Git and Change Safety

- Local development uses `dev` or feature branches. Do not modify or force-push `main`; promotion from `dev` requires Rockson’s separate release approval.
- Use imperative commit subjects, such as `Add initial project structure and repository guidelines`.
- Review `git status -sb` and `git diff --check` before finishing; inspect staged changes with `git diff --cached` when applicable.
- Architecture drafts and demo materials do not grant implementation, external integration, or publication authorization.

- Obtain exact-file approval before modifying protected AGENTS or setup files, Wrangler configuration or migrations. Preserve existing migrations; propose new reviewed migrations instead. Operator utilities require approval for the exact target.
