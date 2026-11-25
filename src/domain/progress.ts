// Weekly volume: what each activity's weekly target is, and how much of it is done.
//
// - A week runs from `weekStart(date, weekStartDay)` for seven days.
// - An activity's target for a week is its weeklyTarget, or with progression
//   base + step × floor(weeks since the progression's start week / everyWeeks), capped. It's
//   derived from dates every time it's read, never stored.
// - Done = the sum of live block amounts from counted sessions dated in the week. A session counts
//   while in progress and once finished, unless it's voided or abandoned.
// - Planned routine amounts (blocks × block amount) count required items; optional items are
//   reported apart, as they count only once done.
import { addDays, compareLocalDate, daysBetween, weekStart } from './dates'
import { roundHalfAway } from './rounding'
import type {
  Activity,
  BlockLog,
  LocalDate,
  RoutineItem,
  Session,
  TargetProgression,
  Weekday,
} from './types'

const DAYS_PER_WEEK = 7
/** Sums are rounded to this many decimals so float noise (0.7 + 0.1 + 0.1 + 0.1) can't block "met". */
const SUM_DECIMALS = 6

/** The training week containing `date`: [start, end] inclusive. */
export function weekOf(
  date: LocalDate,
  weekStartDay: Weekday,
): { start: LocalDate; end: LocalDate } {
  const start = weekStart(date, weekStartDay)
  return { start, end: addDays(start, DAYS_PER_WEEK - 1) }
}

/**
 * Whole progression steps reached by the week starting `weekStartDate`: 0 before the
 * progression's start week, then +1 every `everyWeeks` weeks.
 */
export function progressionSteps(
  p: Pick<TargetProgression, 'everyWeeks' | 'startDate'>,
  weekStartDate: LocalDate,
  weekStartDay: Weekday,
): number {
  const first = weekStart(p.startDate, weekStartDay)
  const days = daysBetween(first, weekStartDate)
  if (days < 0 || p.everyWeeks <= 0) return 0
  return Math.floor(Math.floor(days / DAYS_PER_WEEK) / p.everyWeeks)
}

/** An activity's weekly target for the week starting `weekStartDate` (null = no target). */
export function targetForWeek(
  activity: Pick<Activity, 'weeklyTarget' | 'progression'>,
  weekStartDate: LocalDate,
  weekStartDay: Weekday,
): number | null {
  const base = activity.weeklyTarget
  if (base === null) return null
  const p = activity.progression
  if (!p) return base
  const grown = base + progressionSteps(p, weekStartDate, weekStartDay) * p.stepAmount
  return Math.max(base, Math.min(p.capAmount, grown))
}

/** A session counts toward volume while in progress or finished, unless voided or abandoned. */
export function countsTowardVolume(session: Pick<Session, 'status' | 'voidedAt'>): boolean {
  return session.voidedAt === null && session.status !== 'abandoned'
}

export type ProgressStatus = 'none' | 'under' | 'met'

export interface ActivityProgress {
  activityId: string
  /** null = the activity has no weekly target. */
  target: number | null
  done: number
  /** Still to do (0 once met; null without a target). */
  remaining: number | null
  /** 0–1 share of the target done (capped at 1); null without a target. */
  fraction: number | null
  status: ProgressStatus
  /** Live blocks logged this week. */
  blocks: number
}

/** Amount done per activity in [start, end], from live blocks of counted sessions. */
export function doneByActivity(
  input: {
    sessions: readonly Pick<Session, 'id' | 'date' | 'status' | 'voidedAt'>[]
    blockLogs: readonly Pick<BlockLog, 'sessionId' | 'activityId' | 'amount' | 'voidedAt'>[]
  },
  start: LocalDate,
  end: LocalDate,
): Map<string, { amount: number; blocks: number }> {
  const inWeek = new Set(
    input.sessions
      .filter(
        (s) =>
          countsTowardVolume(s) &&
          compareLocalDate(s.date, start) >= 0 &&
          compareLocalDate(s.date, end) <= 0,
      )
      .map((s) => s.id),
  )
  const out = new Map<string, { amount: number; blocks: number }>()
  for (const b of input.blockLogs) {
    if (b.voidedAt !== null || !inWeek.has(b.sessionId)) continue
    const cur = out.get(b.activityId) ?? { amount: 0, blocks: 0 }
    out.set(b.activityId, {
      amount: roundHalfAway(cur.amount + b.amount, SUM_DECIMALS),
      blocks: cur.blocks + 1,
    })
  }
  return out
}

/** Every active activity's progress for the week containing `date`, in the given order. */
export function weeklyProgress(
  input: {
    activities: readonly Pick<Activity, 'id' | 'weeklyTarget' | 'progression' | 'archivedAt'>[]
    sessions: readonly Pick<Session, 'id' | 'date' | 'status' | 'voidedAt'>[]
    blockLogs: readonly Pick<BlockLog, 'sessionId' | 'activityId' | 'amount' | 'voidedAt'>[]
  },
  date: LocalDate,
  weekStartDay: Weekday,
): ActivityProgress[] {
  const { start, end } = weekOf(date, weekStartDay)
  const done = doneByActivity(input, start, end)
  return input.activities
    .filter((a) => a.archivedAt === null)
    .map((a) => {
      const target = targetForWeek(a, start, weekStartDay)
      const d = done.get(a.id) ?? { amount: 0, blocks: 0 }
      if (target === null || target <= 0) {
        return {
          activityId: a.id,
          target,
          done: d.amount,
          remaining: null,
          fraction: null,
          status: 'none',
          blocks: d.blocks,
        }
      }
      return {
        activityId: a.id,
        target,
        done: d.amount,
        remaining: Math.max(0, roundHalfAway(target - d.amount, SUM_DECIMALS)),
        fraction: Math.min(1, d.amount / target),
        status: d.amount >= target ? 'met' : 'under',
        blocks: d.blocks,
      }
    })
}

export interface PlannedAmount {
  /** Σ blocks × block amount of required items. */
  required: number
  /** Σ blocks × block amount of optional items. */
  optional: number
}

/** Planned amount per activity across routine items (archived items skipped). */
export function plannedByActivity(
  items: readonly Pick<
    RoutineItem,
    'activityId' | 'blocks' | 'blockAmount' | 'optional' | 'archivedAt'
  >[],
): Map<string, PlannedAmount> {
  const out = new Map<string, PlannedAmount>()
  for (const it of items) {
    if (it.archivedAt !== null) continue
    const cur = out.get(it.activityId) ?? { required: 0, optional: 0 }
    const amount = it.blocks * it.blockAmount
    out.set(
      it.activityId,
      it.optional
        ? { ...cur, optional: cur.optional + amount }
        : { ...cur, required: cur.required + amount },
    )
  }
  return out
}
