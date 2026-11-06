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

## Git and Change Safety

- Local development uses `dev` or feature branches. Do not modify or force-push `main`; promotion from `dev` requires Rockson’s separate release approval.
- Use imperative commit subjects, such as `Add initial project structure and repository guidelines`.
- Review `git status -sb` and `git diff --check` before finishing; inspect staged changes with `git diff --cached` when applicable.
- Architecture drafts and demo materials do not grant implementation, external integration, or publication authorization.

- Obtain exact-file approval before modifying protected AGENTS or setup files, Wrangler configuration or migrations. Preserve existing migrations; propose new reviewed migrations instead. Operator utilities require approval for the exact target.
