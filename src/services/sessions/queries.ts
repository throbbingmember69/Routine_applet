// Read models for the screens. Everything is derived on read from activities, routines, sessions
// and blocks (nothing about progress is stored), so a correction anywhere shows up everywhere.
import { addDays, compareLocalDate, dateRange, weekday as weekdayOf } from '@/domain/dates'
import {
  countsTowardVolume,
  weekOf,
  weeklyProgress,
  type ActivityProgress,
} from '@/domain/progress'
import { roundHalfAway } from '@/domain/rounding'
import { finishCheck, itemProgress, type FinishCheck, type ItemProgress } from '@/domain/session'
import type {
  Activity,
  BlockLog,
  LocalDate,
  Routine,
  Session,
  SessionItem,
  Weekday,
} from '@/domain/types'
import type { ServiceCtx } from '../context'
import { listRoutines, type RoutineView } from '../routines'
import { getAppState, loadSettings } from '../settings'
import { inProgress, LAST_ROUTINE_ID_KEY } from './session'

const SUM_DECIMALS = 6

export interface ActivityWeekRow extends ActivityProgress {
  name: string
  unitLabel: string
  defaultBlockAmount: number
  /** Amount done on each day of the week, first day first (7 entries). */
  byDay: number[]
}

/** Each active activity's progress in the week containing `date`, with per-day amounts. */
async function weekRows(
  ctx: Pick<ServiceCtx, 'db'>,
  date: LocalDate,
): Promise<{ start: LocalDate; end: LocalDate; rows: ActivityWeekRow[]; weekStartDay: Weekday }> {
  const { db } = ctx
  const [settings, activities, sessions, blockLogs] = await Promise.all([
    loadSettings(ctx),
    db.activities.toArray(),
    db.sessions.toArray(),
    db.blockLogs.toArray(),
  ])
  const weekStartDay = settings.weekStartDay as Weekday
  const { start, end } = weekOf(date, weekStartDay)
  const progress = weeklyProgress({ activities, sessions, blockLogs }, date, weekStartDay)
  const byId = new Map(activities.map((a) => [a.id, a]))
  const days = dateRange(start, end)
  const sessionDay = new Map(
    sessions
      .filter((s) => countsTowardVolume(s) && compareLocalDate(s.date, start) >= 0)
      .filter((s) => compareLocalDate(s.date, end) <= 0)
      .map((s) => [s.id, days.indexOf(s.date)]),
  )
  const byDay = new Map<string, number[]>()
  for (const b of blockLogs) {
    const day = sessionDay.get(b.sessionId)
    if (b.voidedAt !== null || day === undefined || day < 0) continue
    const row = byDay.get(b.activityId) ?? days.map(() => 0)
    row[day] = roundHalfAway(row[day]! + b.amount, SUM_DECIMALS)
    byDay.set(b.activityId, row)
  }
  const rows = progress
    .map((p) => {
      const a = byId.get(p.activityId)!
      return {
        ...p,
        name: a.name,
        unitLabel: a.unitLabel,
        defaultBlockAmount: a.defaultBlockAmount,
        byDay: byDay.get(a.id) ?? days.map(() => 0),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return { start, end, rows, weekStartDay }
}

// ── Today ────────────────────────────────────────────────────────────────────

export interface TodayView {
  date: LocalDate
  weekStart: LocalDate
  weekEnd: LocalDate
  /** Days left in the week, today included. */
  daysLeft: number
  /** Activities with a target first (least done first), then the rest by name. */
  activities: (ActivityWeekRow & { today: number })[]
  /** Routines pinned to today's weekday. */
  routinesToday: RoutineView[]
  /** Every other active routine (the last one started first). */
  otherRoutines: RoutineView[]
  inProgress: { id: string; routineName: string | null; startedAt: number } | null
  hasActivities: boolean
}

export async function getToday(ctx: Pick<ServiceCtx, 'db'>, date: LocalDate): Promise<TodayView> {
  const { db } = ctx
  const [{ start, end, rows }, routines, current, lastRoutineId, activityCount] = await Promise.all(
    [
      weekRows(ctx, date),
      listRoutines(ctx),
      inProgress(ctx),
      getAppState<string>(ctx, LAST_ROUTINE_ID_KEY),
      db.activities.filter((a) => a.archivedAt === null).count(),
    ],
  )
  const dayIndex = dateRange(start, end).indexOf(date)
  const wd = weekdayOf(date)
  const activities = rows
    .map((r) => ({ ...r, today: r.byDay[dayIndex] ?? 0 }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const currentRoutine = current?.routineId
    ? (routines.find((r) => r.id === current.routineId) ??
      (await db.routines.get(current.routineId)))
    : null
  return {
    date,
    weekStart: start,
    weekEnd: end,
    daysLeft: dateRange(date, end).length,
    activities,
    routinesToday: routines.filter((r) => r.weekday === wd),
    otherRoutines: routines
      .filter((r) => r.weekday !== wd)
      .sort((a, b) => Number(b.id === lastRoutineId) - Number(a.id === lastRoutineId)),
    inProgress: current
      ? { id: current.id, routineName: currentRoutine?.name ?? null, startedAt: current.startedAt }
      : null,
    hasActivities: activityCount > 0,
  }
}

/** Under target first (least done first), then met, then no target. */
function rank(r: ActivityProgress): number {
  if (r.status === 'under') return r.fraction ?? 0
  if (r.status === 'met') return 2
  return 3
}

// ── Week ─────────────────────────────────────────────────────────────────────

export interface WeekView {
  start: LocalDate
  end: LocalDate
  prevDate: LocalDate
  nextDate: LocalDate
  /** The week contains `today` (no next week to show). */
  isCurrent: boolean
  days: LocalDate[]
  rows: ActivityWeekRow[]
  /** Activities with a target that are met. */
  met: number
  /** Activities with a target. */
  withTarget: number
}

export async function getWeek(
  ctx: Pick<ServiceCtx, 'db'>,
  date: LocalDate,
  today: LocalDate,
): Promise<WeekView> {
  const { start, end, rows } = await weekRows(ctx, date)
  return {
    start,
    end,
    prevDate: addDays(start, -7),
    nextDate: addDays(start, 7),
    isCurrent: compareLocalDate(today, start) >= 0 && compareLocalDate(today, end) <= 0,
    days: dateRange(start, end),
    rows,
    met: rows.filter((r) => r.status === 'met').length,
    withTarget: rows.filter((r) => r.target !== null && r.target > 0).length,
  }
}

// ── Logger and session detail ────────────────────────────────────────────────

export interface SessionItemView extends SessionItem {
  progress: ItemProgress
  /** Live blocks, oldest first (`blocks` is the planned count). */
  entries: BlockLog[]
  /** Voided blocks (Edit mode can restore them). */
  voided: BlockLog[]
}

export interface SessionView {
  session: Session
  routineName: string | null
  /** 'log' while in progress; 'edit' once finished or abandoned. */
  mode: 'log' | 'edit'
  items: SessionItemView[]
  finish: FinishCheck
  /** Total per unit, e.g. [{ unitLabel: 'min', amount: 95 }]. */
  totals: { activityId: string; activityName: string; unitLabel: string; amount: number }[]
  /** Active activities not yet in the session (what "Add activity" offers). */
  addable: Activity[]
}

export async function getSessionView(
  ctx: Pick<ServiceCtx, 'db'>,
  sessionId: string,
): Promise<SessionView | null> {
  const { db } = ctx
  const session = await db.sessions.get(sessionId)
  if (!session) return null
  const [items, blocks, activities, routine] = await Promise.all([
    db.sessionItems.where('sessionId').equals(sessionId).toArray(),
    db.blockLogs.where('sessionId').equals(sessionId).toArray(),
    db.activities.toArray(),
    session.routineId ? db.routines.get(session.routineId) : Promise.resolve(undefined),
  ])
  items.sort((a, b) => a.order - b.order)
  blocks.sort((a, b) => a.blockIndex - b.blockIndex)
  const views = items.map((item) => {
    const mine = blocks.filter((b) => b.sessionItemId === item.id)
    return {
      ...item,
      progress: itemProgress(item, mine),
      entries: mine.filter((b) => b.voidedAt === null),
      voided: mine.filter((b) => b.voidedAt !== null),
    }
  })
  const inSession = new Set(items.map((i) => i.activityId))
  return {
    session,
    routineName: routine?.name ?? null,
    mode: session.status === 'in_progress' ? 'log' : 'edit',
    items: views,
    finish: finishCheck(items, blocks),
    totals: views
      .filter((v) => v.progress.logged > 0)
      .map((v) => ({
        activityId: v.activityId,
        activityName: v.activityName,
        unitLabel: v.unitLabel,
        amount: v.progress.amount,
      })),
    addable: activities
      .filter((a) => a.archivedAt === null && !inSession.has(a.id))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
  }
}

/** The id of the session in progress, or null. */
export async function getInProgressId(ctx: Pick<ServiceCtx, 'db'>): Promise<string | null> {
  return (await inProgress(ctx))?.id ?? null
}

// ── History ──────────────────────────────────────────────────────────────────

export interface HistoryRow {
  id: string
  date: LocalDate
  startedAt: number
  status: Session['status']
  voided: boolean
  edited: boolean
  /** Routine name; null for a quick log or an empty start. */
  routineName: string | null
  quickLog: boolean
  /** "Study 75 min", one per activity with blocks. */
  totals: { activityName: string; unitLabel: string; amount: number }[]
  blocks: number
}

/** Past sessions (not the one in progress), newest first. */
export async function listHistory(
  ctx: Pick<ServiceCtx, 'db'>,
  opts: { limit?: number } = {},
): Promise<HistoryRow[]> {
  const { db } = ctx
  const [sessions, items, blocks, routines] = await Promise.all([
    db.sessions.toArray(),
    db.sessionItems.toArray(),
    db.blockLogs.toArray(),
    db.routines.toArray(),
  ])
  const routineName = new Map(routines.map((r: Routine) => [r.id, r.name]))
  const itemsBySession = groupBy(items, (i) => i.sessionId)
  const blocksBySession = groupBy(
    blocks.filter((b) => b.voidedAt === null),
    (b) => b.sessionId,
  )
  const rows = sessions
    .filter((s) => s.status !== 'in_progress')
    .sort((a, b) => compareLocalDate(b.date, a.date) || b.startedAt - a.startedAt)
    .slice(0, opts.limit ?? Infinity)
    .map((s): HistoryRow => {
      const mine = (itemsBySession.get(s.id) ?? []).sort((a, b) => a.order - b.order)
      const live = blocksBySession.get(s.id) ?? []
      return {
        id: s.id,
        date: s.date,
        startedAt: s.startedAt,
        status: s.status,
        voided: s.voidedAt !== null,
        edited: s.editedAt !== null,
        routineName: s.routineId ? (routineName.get(s.routineId) ?? null) : null,
        quickLog: s.source === 'quick',
        totals: mine
          .map((i) => ({
            activityName: i.activityName,
            unitLabel: i.unitLabel,
            amount: itemProgress(i, live).amount,
            logged: itemProgress(i, live).logged,
          }))
          .filter((t) => t.logged > 0)
          .map(({ logged: _l, ...t }) => t),
        blocks: live.length,
      }
    })
  return rows
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = out.get(k)
    if (list) list.push(r)
    else out.set(k, [r])
  }
  return out
}
