# Design

How Routine Applet is built: the data model, the domain rules, the services and the screens. Decisions behind it are in `DECISIONS.md`; UI conventions in `UI.md`.

## Architecture

The same layering as Exersise-Applet (it's a fork):

| Layer | Folder | Rules |
|---|---|---|
| Domain | `src/domain/` | Pure functions and types. No React, Dexie or clock: "today" is a parameter. |
| Database | `src/db/` | Dexie schema, write guards (`guards.ts`), backup row schemas and migrations. |
| Services | `src/services/` | Commands and queries taking a `ServiceCtx` (`db`, `now`, `newId`). Compute first, then write in one transaction. |
| Screens | `src/features/`, `src/ui/` | Read with `useLive`, write with `useCommand`. Never import `@/db` or Dexie. |
| Platform | `src/platform/` | Rest alerts (vibrate, beep, notification), wake lock, file save/share. |

## Data model (schema v1, database `routine-applet`)

| Table | Key and indexes | Row |
|---|---|---|
| `settings` | `id` (`'singleton'`) | Overrides of the registry defaults. |
| `appState` | `key` | Rest timer, last backup time, last routine started. |
| `activities` | `id`, `name` | name, unitLabel, defaultBlockAmount, restMinSec/restMaxSec, weeklyTarget \| null, progression \| null (`stepAmount`, `everyWeeks`, `capAmount`, `startDate`), notes, archivedAt, createdAt, updatedAt |
| `routines` | `id`, `order` | name, weekday \| null, order, note, archivedAt |
| `routineItems` | `id`, `routineId`, `[routineId+order]`, `activityId` | routineId, order, activityId, blocks, blockAmount, rest, optional, note, archivedAt |
| `sessions` | `id`, `date`, `status`, `startedAt`, `routineId` | date (local), startedAt, finishedAt, tzOffsetMin, status (`in_progress` / `finished` / `abandoned`), source (`logger` / `quick`), routineId \| null, note, voidedAt, editedAt, createdAt |
| `sessionItems` | `id`, `sessionId`, `activityId`, `routineItemId`, `[sessionId+order]` | Immutable snapshot at start: activity name and unit, blocks, blockAmount, rest, optional, adHoc, routineItemId |
| `blockLogs` | `id`, `sessionId`, `sessionItemId`, `activityId` | blockIndex (never reused), amount (≥ 0, the activity's unit), note, loggedAt, editedAt, voidedAt |

Amounts are plain numbers in the activity's unit; `unitLabel` is only a label. Nothing derived (targets, progress, completion) is stored.

## Domain rules

- **Week** (`progress.weekOf`): seven days from `weekStart(date, weekStartDay)`.
- **Target for a week** (`progress.targetForWeek`): the weekly target, or with progression `max(base, min(cap, base + step × floor(floor(days since the start week ÷ 7) ÷ everyWeeks)))`, where the start week is the week containing `progression.startDate`. Before the start week the base applies.
- **Done** (`progress.doneByActivity`): the sum of live block amounts from counted sessions dated in the week. A session counts while in progress and once finished, unless abandoned or voided. Sums round to 6 decimals.
- **Status:** `met` once done ≥ target, `under` below it, `none` without a target; `remaining = max(0, target − done)`.
- **Planned** (`progress.plannedByActivity`): Σ blocks × blockAmount of a routine's active items, required and optional apart.
- **Item progress** (`session.itemProgress`): live blocks against the snapshot's planned count; complete at the planned count, extra blocks still count.
- **Finish check** (`session.finishCheck`): required items short of their plan, optional items with nothing logged, and whether anything is logged at all.
- **Rest timer** (`restTimer.ts`): timestamp-based, survives reloads; alerts at the minimum and again at the maximum when they differ; `+N s` shifts both.

## Services

| Module | Commands | Queries |
|---|---|---|
| `activities.ts` | create, update, archive, restore, delete (only unused) | listActivities, getActivity (with `deletable`) |
| `routines.ts` | create, update, move, archive, restore, delete (only never started); add/update/move/remove items | listRoutines, getRoutine (items with activity names, planned amounts) |
| `sessions/session.ts` | startSession (snapshots the routine), addSessionItem, removeSessionItem, logBlock, updateBlock, voidBlock, finishSession, abandonSession, quickLog | inProgress |
| `sessions/edit.ts` | editBlock, addBlockInEdit, voidBlockInEdit, restoreBlock, editSession (note, date, status), voidSession, restoreSession | |
| `sessions/queries.ts` | | getToday, getWeek, getSessionView, getInProgressId, listHistory |
| `sessions/restTimerState.ts` | startRestTimer, extendRestTimer, clearRestTimer | getRestTimer |
| `data/backup.ts`, `data/csvExport.ts` | importBackup, markBackupSaved | exportBackup, getBackupReminder, exportCsv (`blocks`) |
| `settings.ts` | updateSettings, resetSettings, setAppState | loadSettings, getAppState |

Write guards (`db/guards.ts`): the logger writes only to the session in progress; Edit mode only to finished or abandoned, non-voided sessions, and never back to in progress; every command checks its rows belong to the session it names; patches are whitelisted (`amount`, `note` for blocks; `note`, `status`, `date` for sessions).

## Backup and CSV

- **Backup:** every table as JSON with format `routine-applet-backup` and schema version 1. Restore validates the whole file first (JSON → migrations → row schemas → one settings row → references), asks before restoring a file with less of any kind of data than the device (activities, routines, routine items, sessions, blocks), then replaces every table in one transaction. A workout-app backup is refused.
- **CSV:** one row per live block (`routine-blocks-YYYY-MM-DD.csv`): date, session id and status, routine, activity, unit, block index, amount, planned amount, optional, note. Voided blocks and voided sessions are left out; cells that look like formulas are escaped.

## Screens

| Route | Screen |
|---|---|
| `/` | **Today:** session in progress (Resume); each activity's weekly progress bar and line, today's amount, a Log button (quick log sheet); routines for today's weekday first, then the others, with Start; Start empty session. First launch: "Create your first activity". |
| `/session/:id` | **Logger:** a card per item ("Block 2 of 4 · 25 min", logged blocks, amount field with the planned size as placeholder, "Done (25 min)"), Optional badge, Remove for untouched items, Add activity, Finish sheet (what's left, optional skipped, note), Abandon, rest timer bar with +N s and Skip, wake lock while logging. |
| `/week` | **Week:** week navigation (`?d=`), targets met, per-activity progress and seven day cells. |
| `/history`, `/history/:id` | **History:** past sessions newest first with totals and badges; detail with blocks per item, and Edit mode. |
| `/more` | Activities, Routines, Settings, Data & backup. |
| `/activities`, `/activities/new`, `/activities/:id` | Activity list (archived on request) and editor: name, unit, block size, rest, weekly target, progression (step, every N weeks, cap), notes; archive, restore, delete. |
| `/routines`, `/routines/:id` | Routine list and editor: weekday, items (blocks, size, rest, optional, note, order), planned totals, Start routine, archive, restore, delete. |
| `/settings`, `/settings/data` | Settings (week start, rest extend, default rest, backup reminder) and Data (backup, restore, CSV, storage). |
