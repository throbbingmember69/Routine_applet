// Shared contract for every layer: persisted entity shapes (Dexie rows) and the engine types that
// cross module boundaries. Module-private types live in their own module.
//
// Conventions: calendar dates are LocalDate strings; instants are epoch milliseconds; `null` (never
// `undefined`) for "no value" in persisted rows. Amounts are in each activity's own unit
// (minutes, pages, km…), stored as written.

import type { Settings, SettingKey } from './settings/registry'

export type { Settings, SettingKey }

// ── Primitives ──────────────────────────────────────────────────────────────

/** Local calendar date `YYYY-MM-DD`. Create with `parseLocalDate` / `localDateOf`. */
export type LocalDate = string & { readonly __brand: 'LocalDate' }
export type EpochMs = number
/** 0 = Sunday … 6 = Saturday (Date#getDay convention). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** A rest range between blocks: "1–2 min" alerts at 1:00 and 2:00; equal values alert once. */
export interface RestRange {
  restMinSec: number
  restMaxSec: number
}

// ── Settings, app state ─────────────────────────────────────────────────────

export interface SettingsRow {
  id: 'singleton'
  /** Overrides merged over registry defaults by `resolveSettings`. */
  values: Partial<Record<SettingKey, number>>
  updatedAt: EpochMs
}

export interface AppStateRow {
  key: string
  value: unknown
}

// ── Activities and routines ─────────────────────────────────────────────────

/**
 * Optional weekly-target growth: the target rises by `stepAmount` every `everyWeeks` weeks from
 * `startDate`, never above `capAmount`. Derived from dates when read, never stored as a number.
 */
export interface TargetProgression {
  stepAmount: number
  everyWeeks: number
  capAmount: number
  /** First day of the training week the progression counts from. */
  startDate: LocalDate
}

/** Something done in blocks: "Study, 25 min blocks, 300 min a week". */
export interface Activity extends RestRange {
  id: string
  name: string
  /** The unit amounts are in: "min", "pages", "km", or anything the user types. */
  unitLabel: string
  /** A block's usual amount (the logger's target and quick-log default). */
  defaultBlockAmount: number
  /** Weekly total to reach, in `unitLabel`; null = no target (tracked only). */
  weeklyTarget: number | null
  /** null = the target never changes on its own. */
  progression: TargetProgression | null
  notes: string
  archivedAt: EpochMs | null
  createdAt: EpochMs
  updatedAt: EpochMs
}

/** A saved list of activities to run together (like a workout day). */
export interface Routine {
  id: string
  name: string
  /** Scheduled weekday, or null for "any day". */
  weekday: Weekday | null
  order: number
  note: string
  archivedAt: EpochMs | null
}

/** One line of a routine: an activity with its block count, block amount and rest. */
export interface RoutineItem extends RestRange {
  id: string
  routineId: string
  order: number
  activityId: string
  blocks: number
  blockAmount: number
  /** An extra that may be skipped: counts when done, left out of the routine's planned amount. */
  optional: boolean
  note: string
  archivedAt: EpochMs | null
}

// ── Sessions ────────────────────────────────────────────────────────────────

export type SessionStatus = 'in_progress' | 'finished' | 'abandoned'

/** One run of a routine, an ad hoc session, or a quick log. */
export interface Session {
  id: string
  /** Local date the session started. */
  date: LocalDate
  startedAt: EpochMs
  finishedAt: EpochMs | null
  tzOffsetMin: number
  status: SessionStatus
  /** null = ad hoc or a quick log. */
  routineId: string | null
  note: string
  /** Soft delete: excluded from every calculation, restorable. */
  voidedAt: EpochMs | null
  editedAt: EpochMs | null
  createdAt: EpochMs
}

/** What a session planned for one activity, snapshotted at start (never changes afterwards). */
export interface SessionItem extends RestRange {
  id: string
  sessionId: string
  order: number
  /** null for activities added ad hoc. */
  routineItemId: string | null
  adHoc: boolean
  activityId: string
  activityName: string
  unitLabel: string
  blocks: number
  blockAmount: number
  optional: boolean
  createdAt: EpochMs
}

/** One logged block. */
export interface BlockLog {
  id: string
  sessionId: string
  sessionItemId: string
  /** Denormalized from the session item for querying. */
  activityId: string
  blockIndex: number
  /** In the activity's unit. */
  amount: number
  note: string
  loggedAt: EpochMs
  editedAt: EpochMs | null
  voidedAt: EpochMs | null
}
