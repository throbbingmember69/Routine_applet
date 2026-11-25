// The logger's commands for the one session in progress, plus quick log.
//
// - startSession snapshots the routine's active items (with active activities) into
//   `sessionItems`; editing the routine later never changes the session. Without a routine the
//   session starts empty and activities are added ad hoc.
// - logBlock records one block at the item's planned size unless another amount is given; a
//   partial block counts its own amount toward the week.
// - quickLog records a finished one-activity session in one step, so a weekly target can be
//   filled without a routine (and on an earlier day, for something done away from the phone).
// - finish/abandon end the session. A finished or abandoned session then changes only through
//   Edit mode (edit.ts).
import {
  assertAmount,
  assertBlockNotVoided,
  assertBlockOf,
  assertCanLog,
  assertItemOf,
  assertNoLoggedBlocks,
  checkBlockPatch,
  nextBlockIndex,
  requireBlock,
  requireSession,
  requireSessionItem,
  type BlockPatch,
} from '@/db/guards'
import { compareLocalDate, isLocalDate } from '@/domain/dates'
import type {
  Activity,
  BlockLog,
  LocalDate,
  Routine,
  RoutineItem,
  Session,
  SessionItem,
} from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { assertBlockAmount, assertBlocks, cleanNote } from '../validate'

export type { BlockPatch }

/** appState key: the routine last started (Today offers it again). */
export const LAST_ROUTINE_ID_KEY = 'lastRoutineId'

// ── Start ────────────────────────────────────────────────────────────────────

/** Start a session from a routine (or empty, with null). Returns the new session id. */
export async function startSession(
  ctx: ServiceCtx,
  input: { routineId: string | null },
): Promise<string> {
  const { db } = ctx
  const now = ctx.now()
  const sessionId = ctx.newId()
  let routine: Routine | null = null
  let items: SessionItem[] = []
  if (input.routineId !== null) {
    if (typeof input.routineId !== 'string') {
      throw new ServiceError('routine_not_found', 'Pick a routine.', { routineId: input.routineId })
    }
    const r = await db.routines.get(input.routineId)
    if (!r) {
      throw new ServiceError('routine_not_found', 'That routine no longer exists.', {
        routineId: input.routineId,
      })
    }
    if (r.archivedAt !== null) {
      throw new ServiceError('routine_archived', `${r.name} is archived.`, { routineId: r.id })
    }
    routine = r
    const [routineItems, activities] = await Promise.all([
      db.routineItems.where('routineId').equals(r.id).toArray(),
      db.activities.toArray(),
    ])
    const byId = new Map(activities.map((a) => [a.id, a]))
    items = routineItems
      .filter((i) => i.archivedAt === null && byId.get(i.activityId)?.archivedAt === null)
      .sort((a, b) => a.order - b.order)
      .map((i, order) =>
        snapshotOf(i, byId.get(i.activityId)!, { id: ctx.newId(), sessionId, order, now }),
      )
  }

  const session: Session = {
    id: sessionId,
    date: today(ctx),
    startedAt: now,
    finishedAt: null,
    // Minutes east of UTC (`|| 0` turns UTC's -0 into 0).
    tzOffsetMin: -new Date(now).getTimezoneOffset() || 0,
    status: 'in_progress',
    source: 'logger',
    routineId: routine?.id ?? null,
    note: '',
    voidedAt: null,
    editedAt: null,
    createdAt: now,
  }

  await db.transaction('rw', [db.sessions, db.sessionItems, db.appState], async () => {
    // Checked under the write lock so two quick taps can't start two sessions.
    const racing = await inProgress(ctx)
    if (racing) throw inProgressError(racing.id)
    await db.sessions.add(session)
    if (items.length > 0) await db.sessionItems.bulkAdd(items)
    if (routine) await db.appState.put({ key: LAST_ROUTINE_ID_KEY, value: routine.id })
  })
  return sessionId
}

/** The session in progress, if any. */
export async function inProgress(ctx: Pick<ServiceCtx, 'db'>): Promise<Session | null> {
  const rows = await ctx.db.sessions.where('status').equals('in_progress').toArray()
  return rows.find((s) => s.voidedAt === null) ?? null
}

function inProgressError(sessionId: string): ServiceError {
  return new ServiceError(
    'session_in_progress',
    'A session is already in progress. Finish or abandon it first.',
    { sessionId },
  )
}

// ── Items ────────────────────────────────────────────────────────────────────

export interface AddItemInput {
  activityId: string
  /** Defaults to 1. */
  blocks?: number
  /** Defaults to the activity's block size. */
  blockAmount?: number
}

/** Add an activity to the end of the in-progress session. Returns the new item's id. */
export async function addSessionItem(
  ctx: ServiceCtx,
  sessionId: string,
  input: AddItemInput,
): Promise<string> {
  const { db } = ctx
  const id = ctx.newId()
  const now = ctx.now()
  await db.transaction('rw', [db.sessions, db.sessionItems, db.activities], async () => {
    const session = requireSession(await db.sessions.get(sessionId), sessionId)
    assertCanLog(session)
    const activity = await requireActiveActivity(ctx, input.activityId)
    const rows = await db.sessionItems.where('sessionId').equals(sessionId).toArray()
    if (rows.some((r) => r.activityId === activity.id)) {
      throw new ServiceError(
        'activity_in_session',
        `${activity.name} is already in this session. Log more blocks there.`,
        { activityId: activity.id },
      )
    }
    const order = rows.reduce((next, r) => Math.max(next, r.order + 1), 0)
    const item = adHocItem(activity, input, { id, sessionId, order, now })
    await db.sessionItems.add(item)
  })
  return id
}

/** Remove an item with no blocks from the in-progress session (its voided blocks go with it). */
export async function removeSessionItem(ctx: ServiceCtx, sessionItemId: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', [db.sessions, db.sessionItems, db.blockLogs], async () => {
    const item = requireSessionItem(await db.sessionItems.get(sessionItemId), sessionItemId)
    const session = requireSession(await db.sessions.get(item.sessionId), item.sessionId)
    assertItemOf(item, session)
    assertCanLog(session)
    const blocks = await db.blockLogs.where('sessionItemId').equals(item.id).toArray()
    assertNoLoggedBlocks(item, blocks)
    await db.blockLogs.bulkDelete(blocks.map((b) => b.id))
    await db.sessionItems.delete(item.id)
  })
}

// ── Blocks ───────────────────────────────────────────────────────────────────

export interface LogBlockInput {
  sessionItemId: string
  /** Defaults to the item's planned block size. */
  amount?: number
  note?: string
}

/** Log a block of the in-progress session. Returns the new block id. */
export async function logBlock(ctx: ServiceCtx, input: LogBlockInput): Promise<string> {
  const { db } = ctx
  if (input.amount !== undefined) assertAmount(input.amount)
  const note = cleanNote(input.note)
  const id = ctx.newId()
  const now = ctx.now()
  await db.transaction('rw', [db.sessions, db.sessionItems, db.blockLogs], async () => {
    const item = requireSessionItem(
      await db.sessionItems.get(input.sessionItemId),
      input.sessionItemId,
    )
    const session = requireSession(await db.sessions.get(item.sessionId), item.sessionId)
    assertItemOf(item, session)
    assertCanLog(session)
    const existing = await db.blockLogs.where('sessionItemId').equals(item.id).toArray()
    await db.blockLogs.add(
      buildBlock(item, {
        id,
        blockIndex: nextBlockIndex(existing),
        amount: input.amount ?? item.blockAmount,
        note,
        loggedAt: now,
        editedAt: null,
      }),
    )
  })
  return id
}

/** Correct a block of the in-progress session (amount, note). */
export async function updateBlock(
  ctx: ServiceCtx,
  blockId: string,
  patch: BlockPatch,
): Promise<void> {
  const p = checkBlockPatch(patch)
  if (p.note !== undefined) p.note = cleanNote(p.note)
  if (Object.keys(p).length === 0) return
  const { db } = ctx
  await db.transaction('rw', [db.sessions, db.sessionItems, db.blockLogs], async () => {
    const { block } = await loadBlockForLogger(ctx, blockId)
    assertBlockNotVoided(block)
    // In-progress corrections don't stamp editedAt: that marks changes made in Edit mode.
    await db.blockLogs.update(block.id, p)
  })
}

/** Delete (soft-void) a block of the in-progress session. Its index is never reused. */
export async function voidBlock(ctx: ServiceCtx, blockId: string): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', [db.sessions, db.sessionItems, db.blockLogs], async () => {
    const { block } = await loadBlockForLogger(ctx, blockId)
    assertBlockNotVoided(block)
    await db.blockLogs.update(block.id, { voidedAt: now })
  })
}

async function loadBlockForLogger(ctx: Pick<ServiceCtx, 'db'>, blockId: string) {
  const { db } = ctx
  const block = requireBlock(await db.blockLogs.get(blockId), blockId)
  const item = requireSessionItem(
    await db.sessionItems.get(block.sessionItemId),
    block.sessionItemId,
  )
  const session = requireSession(await db.sessions.get(block.sessionId), block.sessionId)
  assertBlockOf(block, item, session)
  assertCanLog(session)
  return { block, item, session }
}

// ── Finish ───────────────────────────────────────────────────────────────────

/** Finish the in-progress session. Unlogged items are fine: only logged blocks count. */
export async function finishSession(
  ctx: ServiceCtx,
  sessionId: string,
  input: { note?: string } = {},
): Promise<void> {
  const note = input.note === undefined ? undefined : cleanNote(input.note)
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.sessions, async () => {
    assertCanLog(requireSession(await db.sessions.get(sessionId), sessionId))
    await db.sessions.update(sessionId, {
      status: 'finished',
      finishedAt: now,
      ...(note !== undefined && { note }),
    })
  })
}

/** Abandon the in-progress session: kept (restorable in Edit mode) but never counted. */
export async function abandonSession(ctx: ServiceCtx, sessionId: string): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.sessions, async () => {
    assertCanLog(requireSession(await db.sessions.get(sessionId), sessionId))
    await db.sessions.update(sessionId, { status: 'abandoned', finishedAt: now })
  })
}

// ── Quick log ────────────────────────────────────────────────────────────────

export interface QuickLogInput {
  activityId: string
  /** Size of each block (e.g. 45 for 45 min). */
  blockAmount: number
  /** Defaults to 1. */
  blocks?: number
  /** Defaults to today; never in the future. */
  date?: LocalDate
  note?: string
}

/**
 * Record `blocks` blocks of `blockAmount` as a finished one-activity session (no routine). Works
 * while another session is in progress. Returns the new session id.
 */
export async function quickLog(ctx: ServiceCtx, input: QuickLogInput): Promise<string> {
  const { db } = ctx
  assertBlockAmount(input.blockAmount, 'The amount')
  const blocks = input.blocks ?? 1
  assertBlocks(blocks)
  const note = cleanNote(input.note)
  const date = input.date ?? today(ctx)
  if (typeof date !== 'string' || !isLocalDate(date)) {
    throw new ServiceError('invalid_date', 'Pick a valid date.', { date })
  }
  if (compareLocalDate(date, today(ctx)) > 0) {
    throw new ServiceError('future_date', "You can't log a day that hasn't happened yet.", { date })
  }
  const now = ctx.now()
  const sessionId = ctx.newId()
  const itemId = ctx.newId()
  const blockIds = Array.from({ length: blocks }, () => ctx.newId())
  await db.transaction(
    'rw',
    [db.activities, db.sessions, db.sessionItems, db.blockLogs],
    async () => {
      const activity = await requireActiveActivity(ctx, input.activityId)
      const item = adHocItem(
        activity,
        { activityId: activity.id, blocks, blockAmount: input.blockAmount },
        { id: itemId, sessionId, order: 0, now },
      )
      await db.sessions.add({
        id: sessionId,
        date,
        startedAt: now,
        finishedAt: now,
        tzOffsetMin: -new Date(now).getTimezoneOffset() || 0,
        status: 'finished',
        source: 'quick',
        routineId: null,
        note,
        voidedAt: null,
        editedAt: null,
        createdAt: now,
      })
      await db.sessionItems.add(item)
      await db.blockLogs.bulkAdd(
        blockIds.map((id, blockIndex) =>
          buildBlock(item, {
            id,
            blockIndex,
            amount: input.blockAmount,
            note: '',
            loggedAt: now,
            editedAt: null,
          }),
        ),
      )
    },
  )
  return sessionId
}

// ── Row builders ─────────────────────────────────────────────────────────────

function snapshotOf(
  ri: RoutineItem,
  activity: Activity,
  meta: { id: string; sessionId: string; order: number; now: number },
): SessionItem {
  return {
    id: meta.id,
    sessionId: meta.sessionId,
    order: meta.order,
    routineItemId: ri.id,
    adHoc: false,
    activityId: activity.id,
    activityName: activity.name,
    unitLabel: activity.unitLabel,
    blocks: ri.blocks,
    blockAmount: ri.blockAmount,
    restMinSec: ri.restMinSec,
    restMaxSec: ri.restMaxSec,
    optional: ri.optional,
    createdAt: meta.now,
  }
}

function adHocItem(
  activity: Activity,
  input: AddItemInput,
  meta: { id: string; sessionId: string; order: number; now: number },
): SessionItem {
  const blocks = input.blocks ?? 1
  const blockAmount = input.blockAmount ?? activity.defaultBlockAmount
  assertBlocks(blocks)
  assertBlockAmount(blockAmount)
  return {
    id: meta.id,
    sessionId: meta.sessionId,
    order: meta.order,
    routineItemId: null,
    adHoc: true,
    activityId: activity.id,
    activityName: activity.name,
    unitLabel: activity.unitLabel,
    blocks,
    blockAmount,
    restMinSec: activity.restMinSec,
    restMaxSec: activity.restMaxSec,
    optional: false,
    createdAt: meta.now,
  }
}

/** A new block row (shared with Edit mode's addBlock). */
export function buildBlock(
  item: SessionItem,
  v: Pick<BlockLog, 'id' | 'blockIndex' | 'amount' | 'note' | 'loggedAt' | 'editedAt'>,
): BlockLog {
  return {
    id: v.id,
    sessionId: item.sessionId,
    sessionItemId: item.id,
    activityId: item.activityId,
    blockIndex: v.blockIndex,
    amount: v.amount,
    note: v.note,
    loggedAt: v.loggedAt,
    editedAt: v.editedAt,
    voidedAt: null,
  }
}

async function requireActiveActivity(ctx: Pick<ServiceCtx, 'db'>, id: string): Promise<Activity> {
  const a = typeof id === 'string' ? await ctx.db.activities.get(id) : undefined
  if (!a) throw new ServiceError('activity_not_found', 'Pick an activity.', { id })
  if (a.archivedAt !== null) {
    throw new ServiceError('activity_archived', `${a.name} is archived.`, { id })
  }
  return a
}
