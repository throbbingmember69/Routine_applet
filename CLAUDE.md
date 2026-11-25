# Routine Applet

Offline-first, installable PWA (Android phone) for daily activities tracked like a workout routine: activities are done in **blocks** (the "sets") with **rests** between them, against a **weekly target** in the activity's own unit. Single user, all data on-device in IndexedDB. Hosted on GitHub Pages at `/Routine_applet/`. A fork of Exersise-Applet (same architecture, its own data model and database).

## Source of truth (read before designing anything)
- `docs/DECISIONS.md`: binding user decisions and adopted defaults. It wins over everything else.
- `docs/DESIGN.md`: the data model, domain rules, services and screens.
- `docs/UI.md`: UI conventions for every screen (layout, components, states, number formats, accessibility).

Ask the user before making architectural decisions not covered by these docs.

## Commands
Node isn't on PATH in some shells on this machine. Prefix bash commands with `export PATH="/c/Program Files/nodejs:$PATH"`.

- `npm run dev` / `npm run build` / `npm run preview`
- `npm test`: Vitest projects `domain` (node), `db` (node + fake-indexeddb), `ui` (happy-dom). Run one with `npx vitest run --project domain`.
- `npm run lint`, `npm run typecheck`, `npm run check` (lint + typecheck + format + test)

## Architecture rules
- **`src/domain/` is pure.** No React, Dexie, DOM, or app-layer imports. No `Date.now()`, argument-less `new Date()` or `Math.random()`; "now"/"today" is always a parameter. ESLint enforces this.
- **The UI goes through `src/services/`** for reads (functions used with `useLiveQuery`) and writes. `features/` and `ui/` never import `@/db` or `dexie` (ESLint enforces this). Services take a `ServiceCtx` (`db`, `now`, `newId`) from `services/context.ts`, so tests use `createTestCtx()`.
- **Amounts are plain numbers in the activity's own unit** (`unitLabel` is a display label only). Only `ui/format.ts` rounds for display.
- **Dates are local `YYYY-MM-DD` strings** (`LocalDate`), with day math via `domain/dates.ts`. Never `new Date('YYYY-MM-DD')` (it parses as UTC).
- **Every tunable number lives in `domain/settings/registry.ts`,** and is editable. No magic numbers in engine code.
- **History is never overwritten.** Finished sessions change only through explicit Edit mode (`db/guards.ts`). `sessionItems` snapshots are immutable. Deletes are soft (`voidedAt`, `archivedAt`). Weekly targets and progress are derived from activities and logged blocks, never stored.
- **Dexie:** compute first, then write in one transaction. Never await non-Dexie promises inside a transaction. Never index booleans or nulls. Keep every old `db.version(n)` declaration. The database name (`routine-applet`) must stay distinct from the workout app's: both share the github.io origin.

## Testing
- Every domain change comes with Vitest tests next to the module (`foo.ts` → `foo.test.ts`).
- Services are tested against a throwaway database (`createTestCtx()`); screens with `renderScreen` from `app/testing.tsx`.

## Library notes (versions are newer than many examples online)
- react-router **8**: import from `react-router` (hash router: `createHashRouter` + `RouterProvider`).
- Vite **8** (Rolldown), Vitest **5** (`test.projects` in `vitest.config.ts`), TypeScript **6** (`types` must be listed explicitly in tsconfig), ESLint **10** flat config.
- Import local TS files with extensions only in config files. App code uses extensionless imports and the `@/` alias for `src/`.
