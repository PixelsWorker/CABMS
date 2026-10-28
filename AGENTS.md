# CABMS Repository Instructions

## Project Structure

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

Run commands from this directory (or active worktree). Both npm (verified Windows workflow with Node 20+) and Bun (`bun.lock`) are supported via `package.json`:

- `npm run dev` / `bun run dev`: start the Vite development server on port 3000.
- `npm run build` / `bun run build`: build the production app.
- `npm run lint` / `bun run lint`: run the TypeScript compiler without emitting files (`tsc --noEmit`).
- `npm test` / `bun test`: run the configured application and test suite via the package script.
- Individual layers: `npm run test:layer1` through `npm run test:layer8` (or `bun run ...`).
- Alternate loader fallback (if tsx runner encounters Windows environment limits): `node --import ../../graphify-out/audit-loader.mjs --test src/utils/cabmsLogic.test.ts tests/*.test.ts`.

Use `package.json` scripts as the source of truth if these commands change. Do not claim tests passed unless they were run and passed.

## Code Style

- Use TypeScript and React, matching the existing code and formatting in each file.
- Keep components and view-specific behavior in their established directories; put reusable domain logic in `src/utils/` and shared types in `src/types/`.
- Use `snake_case` for serialized contract keys where applicable; follow existing TypeScript naming conventions for code identifiers.
- Keep demo fixtures and simulated outcomes clearly identified as such.

## Testing

The repository includes layered tests and a test for `src/utils/cabmsLogic.ts`. Add or update focused tests for domain changes and preserve the layer boundaries. Check documentation against the actual implementation.

## Git and Change Safety

- Local development uses the `dev` branch. Preserve local and remote `main` histories until a reconciliation plan is authorized; do not force-push.
- Use imperative commit subjects, such as `Add initial project structure and repository guidelines`.
- Review `git status -sb` and `git diff --check` before finishing; inspect staged changes with `git diff --cached` when applicable.
- Architecture drafts and demo materials do not grant implementation, external integration, or publication authorization.
