# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains all production code for the userscript.
- Core export/download logic lives in files like `api.ts`, `conversations.ts`, `downloads.ts`, `batchExport.ts`, and `autoSave*.ts`.
- UI code is under `src/ui/` (`components/`, `dialogs/`, `hooks/`), with HTML conversion utilities in `src/html/` and state helpers in `src/state/`.
- Build output is generated to `dist/chatgpt-multimodal-exporter.user.js`.
- `dev/` and `references/` store development examples and reference material; avoid coupling runtime code to these folders.

## Build, Test, and Development Commands
- `pnpm install`: install dependencies (Node.js `>=18` required).
- `pnpm dev`: start Vite dev server and expose the userscript install URL (via `vite-plugin-monkey`).
- `pnpm build`: run TypeScript checks (`tsc`) and produce production userscript in `dist/`.
- `pnpm preview`: preview built assets locally.

## Coding Style & Naming Conventions
- Language: TypeScript + Preact (`jsxImportSource: "preact"`, strict mode enabled).
- Use 2-space indentation and semicolons to match existing files.
- Prefer `camelCase` for variables/functions, `PascalCase` for UI component files (for example `FilePreviewDialog.tsx`), and descriptive module names (`autoSaveStore.ts`, `htmlGenerator.ts`).
- Keep modules focused: UI rendering in `src/ui/*`, data-fetch and transformation in top-level `src/*.ts` helpers.

## Testing Guidelines
- There is currently no dedicated automated test framework configured.
- Before opening a PR, run `pnpm build` and validate key flows manually on `chatgpt.com`:
  - single conversation export,
  - batch export (with/without attachments),
  - auto-save behavior.
- If adding non-trivial logic, include small, testable helper functions and document manual verification steps in the PR.

## Commit & Pull Request Guidelines
- Follow Conventional Commits used in history: `feat: ...`, `fix: ...`, `refactor: ...`, `chore: ...`.
- Keep commits scoped to one change and reference issues/PRs when relevant (for example `feat: add HTML export output (#6)`).
- PRs should include:
  - concise summary and motivation,
  - linked issue(s),
  - screenshots/GIFs for UI changes,
  - manual test notes (what was validated and where).

## Security & Configuration Tips
- Do not commit personal export data from `gptsave/`.
- Review userscript metadata changes in `vite.config.ts` carefully (`match`, `grant`, `connect`) since they affect runtime permissions.
