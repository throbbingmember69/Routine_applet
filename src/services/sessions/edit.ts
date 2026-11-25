// Edit mode: explicit corrections to a finished or abandoned session, entered from the session
// detail after a confirm (a session in progress is changed in the logger, session.ts). It can fix
// a block's amount or note, add a missed block, delete (void) and restore blocks, change the
// session's note, date and finished/abandoned status, and delete (void) or restore the whole
// session. Every change stamps `editedAt` on the row it touches and on its session. Weekly
// progress is derived from blocks, so a correction shows up everywhere without rewriting anything.
//
// The snapshots (`sessionItems`) are never modified: every write transaction here is scoped to
// `sessions` and `blockLogs` only, so Dexie itself would refuse a snapshot write.
import {
  assertAmount,
  assertBlockNotVoided,
  assertBlockOf,
  assertCanEdit,
  assertEditable,
  assertItemOf,
  checkBlockPatch,
  checkSessionPatch,
  nextBlockIndex,
  requireBlock,
  requireSession,
  requireSessionItem,
  type BlockPatch,
  type SessionPatch,
} from '@/db/guards'
import { compareLocalDate } from '@/domain/dates'
import type { BlockLog, Session } from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { cleanNote } from '../validate'
import { buildBlock } from './session'

export type { BlockPatch, SessionPatch }

/** Correct a block of a finished or abandoned session. */
export async function editBlock(
  ctx: ServiceCtx,
  blockId: string,
  patch: BlockPatch,
): Promise<void> {
  const p = checkBlockPatch(patch)
  if (p.note !== undefined) p.note = cleanNote(p.note)
  if (Object.keys(p).length === 0) return
  await withEditableBlock(ctx, blockId, async (block, now) => {
    assertBlockNotVoided(block)
    await ctx.db.blockLogs.update(block.id, { ...p, editedAt: now })
  })
}

/** Add a block that was missed while logging. Returns the new block id. */
export async function addBlockInEdit(
  ctx: ServiceCtx,
  input: { sessionItemId: string; amount: number; note?: string },
): Promise<string> {
  const { db } = ctx
  assertAmount(input.amount)
  const note = cleanNote(input.note)
  // Snapshots never change after the session starts, so reading one outside the transaction is safe.
  const item = requireSessionItem(
    await db.sessionItems.get(input.sessionItemId),
    input.sessionItemId,
  )
  const id = ctx.newId()
  const now = ctx.now()
  await db.transaction('rw', [db.sessions, db.blockLogs], async () => {
    const session = requireSession(await db.sessions.get(item.sessionId), item.sessionId)
    assertItemOf(item, session)
    assertCanEdit(session)
    const existing = await db.blockLogs.where('sessionItemId').equals(item.id).toArray()
    await db.blockLogs.add(
      buildBlock(item, {
        id,
        blockIndex: nextBlockIndex(existing),
        amount: input.amount,
        note,
        loggedAt: now,
        editedAt: now,
      }),
    )
    await db.sessions.update(session.id, { editedAt: now })
  })
  return id
}

/** Delete (soft-void) a block of a finished or abandoned session. Restorable. */
export async function voidBlockInEdit(ctx: ServiceCtx, blockId: string): Promise<void> {
  await withEditableBlock(ctx, blockId, async (block, now) => {
    assertBlockNotVoided(block)
    await ctx.db.blockLogs.update(block.id, { voidedAt: now, editedAt: now })
  })
}

/** Restore a voided block of a finished or abandoned session. */
export async function restoreBlock(ctx: ServiceCtx, blockId: string): Promise<void> {
  await withEditableBlock(ctx, blockId, async (block, now) => {
    if (block.voidedAt === null) {
      throw new ServiceError('block_not_voided', "That block isn't deleted.", { blockId })
    }
    await ctx.db.blockLogs.update(block.id, { voidedAt: null, editedAt: now })
  })
}

/** Change a finished or abandoned session's note, date or status (finished ↔ abandoned). */
export async function editSession(
  ctx: ServiceCtx,
  sessionId: string,
  patch: SessionPatch,
): Promise<void> {
  const p = checkSessionPatch(patch)
  if (p.note !== undefined) p.note = cleanNote(p.note)
  if (p.date !== undefined && compareLocalDate(p.date, today(ctx)) > 0) {
    throw new ServiceError('future_date', "A session can't be dated in the future.", {
      date: p.date,
    })
  }
  if (Object.keys(p).length === 0) return
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.sessions, async () => {
    const session = requireSession(await db.sessions.get(sessionId), sessionId)
    assertCanEdit(session)
    const changes = Object.fromEntries(
      Object.entries(p).filter(([k, v]) => session[k as keyof Session] !== v),
    )
    if (Object.keys(changes).length === 0) return
    await db.sessions.update(sessionId, { ...changes, editedAt: now })
  })
}

/** Delete (soft-void) a finished or abandoned session: kept, restorable, excluded everywhere. */
export async function voidSession(ctx: ServiceCtx, sessionId: string): Promise<void> {
  await withEditableSession(ctx, sessionId, async (session, now) => {
    if (session.voidedAt !== null) {
      throw new ServiceError('session_voided', 'This session is already deleted.', { sessionId })
    }
    await ctx.db.sessions.update(sessionId, { voidedAt: now, editedAt: now })
  })
}

/** Restore a voided session. */
export async function restoreSession(ctx: ServiceCtx, sessionId: string): Promise<void> {
  await withEditableSession(ctx, sessionId, async (session, now) => {
    if (session.voidedAt === null) {
      throw new ServiceError('session_not_voided', "This session isn't deleted.", { sessionId })
    }
    await ctx.db.sessions.update(sessionId, { voidedAt: null, editedAt: now })
  })
}

async function withEditableSession(
  ctx: ServiceCtx,
  sessionId: string,
  write: (session: Session, now: number) => Promise<void>,
): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.sessions, async () => {
    const session = requireSession(await db.sessions.get(sessionId), sessionId)
    assertEditable(session)
    await write(session, now)
  })
}

/**
 * Run a block edit: the block, its item and its session are checked to belong together and to be
 * editable, then `write` runs and the session's `editedAt` is stamped, all in one transaction.
 */
async function withEditableBlock(
  ctx: ServiceCtx,
  blockId: string,
  write: (block: BlockLog, now: number) => Promise<void>,
): Promise<void> {
  const { db } = ctx
  const pre = requireBlock(await db.blockLogs.get(blockId), blockId)
  const item = requireSessionItem(await db.sessionItems.get(pre.sessionItemId), pre.sessionItemId)
  const now = ctx.now()
  await db.transaction('rw', [db.sessions, db.blockLogs], async () => {
    const block = requireBlock(await db.blockLogs.get(blockId), blockId)
    const session = requireSession(await db.sessions.get(block.sessionId), block.sessionId)
    assertBlockOf(block, item, session)
    assertCanEdit(session)
    await write(block, now)
    await db.sessions.update(session.id, { editedAt: now })
  })
}
