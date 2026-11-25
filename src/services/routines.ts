// Routines: optional set lists of activities (like workout days), each item with its blocks, block
// size, rest and an optional flag. A routine can be pinned to a weekday so Today offers it first.
// Starting a routine snapshots its items into the session (sessions.ts), so editing a routine never
// changes past sessions. Removed items and routines are archived, not deleted, once used.
import { plannedByActivity, type PlannedAmount } from '@/domain/progress'
import { roundHalfAway } from '@/domain/rounding'
import type { Activity, Routine, RoutineItem, Weekday } from '@/domain/types'
import type { ServiceCtx } from './context'
import { ServiceError } from './errors'
import {
  assertBlockAmount,
  assertBlocks,
  assertBool,
  assertRest,
  cleanName,
  cleanNote,
} from './validate'

export interface RoutineInput {
  name: string
  weekday?: Weekday | null
  note?: string
}

export type RoutinePatch = Partial<RoutineInput>

export interface RoutineItemInput {
  activityId: string
  /** Defaults to 1. */
  blocks?: number
  /** Defaults to the activity's block size. */
  blockAmount?: number
  /** Default to the activity's rest. */
  restMinSec?: number
  restMaxSec?: number
  optional?: boolean
  note?: string
}

export type RoutineItemPatch = Partial<
  Pick<RoutineItem, 'blocks' | 'blockAmount' | 'restMinSec' | 'restMaxSec' | 'optional' | 'note'>
>

const ITEM_PATCH_FIELDS = [
  'blocks',
  'blockAmount',
  'restMinSec',
  'restMaxSec',
  'optional',
  'note',
] as const

// ── Routine commands ─────────────────────────────────────────────────────────

/** Create an empty routine, last in the list. Returns its id. */
export async function createRoutine(ctx: ServiceCtx, input: RoutineInput): Promise<string> {
  const { db } = ctx
  const name = cleanName(input.name, 'routine')
  const weekday = checkWeekday(input.weekday ?? null)
  const note = cleanNote(input.note)
  const id = ctx.newId()
  await db.transaction('rw', db.routines, async () => {
    const all = await db.routines.toArray()
    const order = all.reduce((next, r) => Math.max(next, r.order + 1), 0)
    await db.routines.add({ id, name, weekday, order, note, archivedAt: null })
  })
  return id
}

export async function updateRoutine(
  ctx: ServiceCtx,
  id: string,
  patch: RoutinePatch,
): Promise<void> {
  const changes: Partial<Routine> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (key === 'name') changes.name = cleanName(value, 'routine')
    else if (key === 'weekday') changes.weekday = checkWeekday(value)
    else if (key === 'note') changes.note = cleanNote(value)
    else {
      throw new ServiceError('field_not_editable', `A routine's ${key} can't be changed.`, {
        field: key,
      })
    }
  }
  const { db } = ctx
  await db.transaction('rw', db.routines, async () => {
    requireRoutine(await db.routines.get(id), id)
    if (Object.keys(changes).length > 0) await db.routines.update(id, changes)
  })
}

/** Move a routine one place up (-1) or down (+1) among the active routines. */
export async function moveRoutine(ctx: ServiceCtx, id: string, direction: -1 | 1): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', db.routines, async () => {
    const list = (await db.routines.toArray())
      .filter((r) => r.archivedAt === null)
      .sort((a, b) => a.order - b.order)
    await swapOrder(list, id, direction, (rid, order) => db.routines.update(rid, { order }))
  })
}

/** Archive a routine (hidden from Today and the list; past sessions keep its name). */
export async function archiveRoutine(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.routines, async () => {
    const r = requireRoutine(await db.routines.get(id), id)
    if (r.archivedAt === null) await db.routines.update(id, { archivedAt: now })
  })
}

export async function restoreRoutine(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', db.routines, async () => {
    const r = requireRoutine(await db.routines.get(id), id)
    if (r.archivedAt !== null) await db.routines.update(id, { archivedAt: null })
  })
}

/**
 * Delete a routine and its items outright. Only allowed while no session was started from it;
 * otherwise archive it ('routine_in_use').
 */
export async function deleteRoutine(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', [db.routines, db.routineItems, db.sessions], async () => {
    requireRoutine(await db.routines.get(id), id)
    if ((await db.sessions.where('routineId').equals(id).count()) > 0) {
      throw new ServiceError(
        'routine_in_use',
        'Sessions were started from this routine, so it can only be archived.',
        { id },
      )
    }
    await db.routineItems.where('routineId').equals(id).delete()
    await db.routines.delete(id)
  })
}

// ── Item commands ────────────────────────────────────────────────────────────

/** Add an activity to the end of a routine, with the activity's block size and rest by default. */
export async function addRoutineItem(
  ctx: ServiceCtx,
  routineId: string,
  input: RoutineItemInput,
): Promise<string> {
  const { db } = ctx
  const id = ctx.newId()
  await db.transaction('rw', [db.routines, db.routineItems, db.activities], async () => {
    const routine = requireRoutine(await db.routines.get(routineId), routineId)
    if (routine.archivedAt !== null) {
      throw new ServiceError('routine_archived', `${routine.name} is archived.`, { routineId })
    }
    const activity = await requireActiveActivity(ctx, input.activityId)
    const restMinSec = input.restMinSec ?? activity.restMinSec
    const item: RoutineItem = {
      id,
      routineId,
      order: 0,
      activityId: activity.id,
      blocks: input.blocks ?? 1,
      blockAmount: input.blockAmount ?? activity.defaultBlockAmount,
      restMinSec,
      restMaxSec: input.restMaxSec ?? Math.max(restMinSec, activity.restMaxSec),
      optional: input.optional ?? false,
      note: input.note ?? '',
      archivedAt: null,
    }
    checkItem(item)
    const siblings = await db.routineItems.where('routineId').equals(routineId).toArray()
    item.order = siblings.reduce((next, s) => Math.max(next, s.order + 1), 0)
    item.note = cleanNote(item.note)
    await db.routineItems.add(item)
  })
  return id
}

export async function updateRoutineItem(
  ctx: ServiceCtx,
  id: string,
  patch: RoutineItemPatch,
): Promise<void> {
  for (const key of Object.keys(patch)) {
    if (!(ITEM_PATCH_FIELDS as readonly string[]).includes(key)) {
      throw new ServiceError('field_not_editable', `A routine item's ${key} can't be changed.`, {
        field: key,
      })
    }
  }
  const { db } = ctx
  await db.transaction('rw', db.routineItems, async () => {
    const current = requireItem(await db.routineItems.get(id), id)
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    const next = { ...current, ...defined } as RoutineItem
    checkItem(next)
    next.note = cleanNote(next.note)
    next.blockAmount = roundHalfAway(next.blockAmount, 6)
    await db.routineItems.put(next)
  })
}

/** Remove an item from its routine (archived: past sessions still name the item they came from). */
export async function removeRoutineItem(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.routineItems, async () => {
    const item = requireItem(await db.routineItems.get(id), id)
    if (item.archivedAt === null) await db.routineItems.update(id, { archivedAt: now })
  })
}

/** Move an item one place up (-1) or down (+1) within its routine. */
export async function moveRoutineItem(
  ctx: ServiceCtx,
  id: string,
  direction: -1 | 1,
): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', db.routineItems, async () => {
    const item = requireItem(await db.routineItems.get(id), id)
    const list = (await db.routineItems.where('routineId').equals(item.routineId).toArray())
      .filter((i) => i.archivedAt === null)
      .sort((a, b) => a.order - b.order)
    await swapOrder(list, id, direction, (iid, order) => db.routineItems.update(iid, { order }))
  })
}

// ── Queries ──────────────────────────────────────────────────────────────────

export interface RoutineItemView extends RoutineItem {
  activityName: string
  unitLabel: string
  /** The activity is archived (the item is skipped when the routine starts). */
  activityArchived: boolean
}

export interface RoutineView extends Routine {
  items: RoutineItemView[]
  /** Planned amount per activity (required and optional apart). */
  planned: { activityId: string; activityName: string; unitLabel: string; amount: PlannedAmount }[]
}

/** Active routines in list order, each with its active items. */
export async function listRoutines(
  ctx: Pick<ServiceCtx, 'db'>,
  opts: { includeArchived?: boolean } = {},
): Promise<RoutineView[]> {
  const { db } = ctx
  const [routines, items, activities] = await Promise.all([
    db.routines.toArray(),
    db.routineItems.toArray(),
    db.activities.toArray(),
  ])
  const byId = new Map(activities.map((a) => [a.id, a]))
  return routines
    .filter((r) => opts.includeArchived || r.archivedAt === null)
    .sort((a, b) => a.order - b.order)
    .map((r) => routineView(r, items, byId))
}

export async function getRoutine(
  ctx: Pick<ServiceCtx, 'db'>,
  id: string,
): Promise<RoutineView | null> {
  const { db } = ctx
  const routine = await db.routines.get(id)
  if (!routine) return null
  const [items, activities] = await Promise.all([
    db.routineItems.where('routineId').equals(id).toArray(),
    db.activities.toArray(),
  ])
  return routineView(routine, items, new Map(activities.map((a) => [a.id, a])))
}

function routineView(
  routine: Routine,
  allItems: readonly RoutineItem[],
  activities: ReadonlyMap<string, Activity>,
): RoutineView {
  const items = allItems
    .filter((i) => i.routineId === routine.id && i.archivedAt === null)
    .sort((a, b) => a.order - b.order)
    .map((i) => {
      const a = activities.get(i.activityId)
      return {
        ...i,
        activityName: a?.name ?? 'Unknown activity',
        unitLabel: a?.unitLabel ?? '',
        activityArchived: a?.archivedAt != null,
      }
    })
  const planned = [...plannedByActivity(items.filter((i) => !i.activityArchived))].map(
    ([activityId, amount]) => {
      const a = activities.get(activityId)
      return {
        activityId,
        activityName: a?.name ?? 'Unknown activity',
        unitLabel: a?.unitLabel ?? '',
        amount,
      }
    },
  )
  return { ...routine, items, planned }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function checkWeekday(v: unknown): Weekday | null {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 6) {
    throw new ServiceError('invalid_weekday', 'Pick a day of the week, or none.', { weekday: v })
  }
  return v as Weekday
}

function checkItem(i: RoutineItem): void {
  assertBlocks(i.blocks)
  assertBlockAmount(i.blockAmount)
  assertRest(i.restMinSec, i.restMaxSec)
  assertBool(i.optional, 'Optional')
}

async function swapOrder<T extends { id: string; order: number }>(
  list: readonly T[],
  id: string,
  direction: -1 | 1,
  write: (id: string, order: number) => Promise<unknown>,
): Promise<void> {
  const i = list.findIndex((r) => r.id === id)
  const j = i + direction
  if (i < 0 || j < 0 || j >= list.length) return
  // Renumber the whole list so equal or sparse orders can't make a move a no-op.
  const reordered = [...list]
  ;[reordered[i], reordered[j]] = [reordered[j]!, reordered[i]!]
  for (const [order, row] of reordered.entries()) {
    if (row.order !== order) await write(row.id, order)
  }
}

function requireRoutine(r: Routine | undefined, id: string): Routine {
  if (!r) throw new ServiceError('routine_not_found', 'That routine no longer exists.', { id })
  return r
}

function requireItem(i: RoutineItem | undefined, id: string): RoutineItem {
  if (!i) throw new ServiceError('routine_item_not_found', 'That item no longer exists.', { id })
  return i
}

async function requireActiveActivity(ctx: Pick<ServiceCtx, 'db'>, id: string): Promise<Activity> {
  const a = typeof id === 'string' ? await ctx.db.activities.get(id) : undefined
  if (!a) throw new ServiceError('activity_not_found', 'Pick an activity.', { id })
  if (a.archivedAt !== null) {
    throw new ServiceError('activity_archived', `${a.name} is archived.`, { id })
  }
  return a
}
