// Write guards for session history. Every session command checks these before it writes, so the
// immutability rules live in one tested place:
// - An in-progress session is logged freely through the logger (session service).
// - A finished or abandoned session changes only through explicit Edit mode, and only in the
//   whitelisted fields below. It never goes back to in progress.
// - `sessionItems` snapshots are never edited. While a session is in progress an item can be
//   removed only before any (non-voided) block is logged against it.
// - A command only ever touches rows of the one session it was aimed at.
// Guards are pure checks that throw a ServiceError with a stable code and a readable message.
import type { BlockLog, Session, SessionItem } from '@/domain/types'
import { ServiceError } from '@/services/errors'

/** Largest amount one block may record (a typo guard, in any unit). */
export const MAX_BLOCK_AMOUNT = 100_000

/** Block fields that can change: freely while in progress, in Edit mode afterwards. */
export const BLOCK_EDITABLE_FIELDS = ['amount', 'note'] as const
/** Session fields Edit mode can change (void/restore have their own commands). */
export const SESSION_EDITABLE_FIELDS = ['note', 'status'] as const
/** Statuses Edit mode may set: finished ↔ abandoned, never back to in progress. */
export const EDITABLE_STATUSES = ['finished', 'abandoned'] as const

export type BlockPatch = Partial<Pick<BlockLog, (typeof BLOCK_EDITABLE_FIELDS)[number]>>
export type SessionPatch = Partial<Pick<Session, (typeof SESSION_EDITABLE_FIELDS)[number]>>

// ── Existence ────────────────────────────────────────────────────────────────

export function requireSession(session: Session | undefined, id: string): Session {
  if (!session)
    throw new ServiceError('session_not_found', 'That session no longer exists.', { id })
  return session
}

export function requireSessionItem(item: SessionItem | undefined, id: string): SessionItem {
  if (!item) {
    throw new ServiceError('session_item_not_found', 'That activity is no longer in the session.', {
      id,
    })
  }
  return item
}

export function requireBlock(block: BlockLog | undefined, id: string): BlockLog {
  if (!block) throw new ServiceError('block_not_found', 'That block no longer exists.', { id })
  return block
}

// ── Session state ────────────────────────────────────────────────────────────

/** The logger may write to this session: it is in progress (and not voided). */
export function assertCanLog(session: Session): void {
  if (session.status !== 'in_progress' || session.voidedAt !== null) {
    throw new ServiceError(
      'session_not_in_progress',
      'This session is finished. Use Edit session to change it.',
      { sessionId: session.id, status: session.status },
    )
  }
}

/** Edit mode may be entered: the session is finished or abandoned (voided is allowed). */
export function assertEditable(session: Session): void {
  if (session.status === 'in_progress') {
    throw new ServiceError(
      'session_not_editable',
      'This session is still in progress. Change it in the logger.',
      { sessionId: session.id },
    )
  }
}

/** Edit mode may change this session's data: editable and not voided (restore it first). */
export function assertCanEdit(session: Session): void {
  assertEditable(session)
  if (session.voidedAt !== null) {
    throw new ServiceError('session_voided', 'This session is deleted. Restore it to edit it.', {
      sessionId: session.id,
    })
  }
}

/** An item can be removed only while no block is logged against it. */
export function assertNoLoggedBlocks(item: SessionItem, blocks: readonly BlockLog[]): void {
  if (blocks.some((b) => b.sessionItemId === item.id && b.voidedAt === null)) {
    throw new ServiceError(
      'has_blocks',
      `${item.activityName} already has blocks logged. Delete them first.`,
      { sessionItemId: item.id },
    )
  }
}

// ── Cross-row consistency ────────────────────────────────────────────────────

/** The item belongs to the session (commands never reach into another session). */
export function assertItemOf(item: SessionItem, session: Session): void {
  if (item.sessionId !== session.id) {
    throw new ServiceError('session_mismatch', 'That activity belongs to a different session.', {
      sessionItemId: item.id,
      sessionId: session.id,
    })
  }
}

/** The block belongs to the session and to the item it names. */
export function assertBlockOf(block: BlockLog, item: SessionItem, session: Session): void {
  if (
    block.sessionId !== session.id ||
    block.sessionItemId !== item.id ||
    item.sessionId !== session.id ||
    block.activityId !== item.activityId
  ) {
    throw new ServiceError('session_mismatch', 'That block belongs to a different session.', {
      blockId: block.id,
      sessionId: session.id,
    })
  }
}

export function assertBlockNotVoided(block: BlockLog): void {
  if (block.voidedAt !== null) {
    throw new ServiceError('block_voided', 'That block is deleted. Restore it first.', {
      blockId: block.id,
    })
  }
}

// ── Patches ──────────────────────────────────────────────────────────────────

/**
 * The patch restricted to the whitelisted fields, with undefined values dropped. Any other key
 * (ids, dates, timestamps, snapshot data) is rejected rather than silently ignored.
 */
export function pickPatch<K extends string>(
  patch: Readonly<Record<string, unknown>>,
  allowed: readonly K[],
  what: string,
): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!(allowed as readonly string[]).includes(key)) {
      throw new ServiceError('field_not_editable', `A ${what}'s ${key} can't be changed.`, {
        field: key,
      })
    }
    if (value !== undefined) out[key as K] = value
  }
  return out
}

export function checkBlockPatch(patch: BlockPatch): BlockPatch {
  const p = pickPatch(patch, BLOCK_EDITABLE_FIELDS, 'block') as BlockPatch
  if (p.amount !== undefined) assertAmount(p.amount)
  if (p.note !== undefined && typeof p.note !== 'string') {
    throw new ServiceError('invalid_note', 'The note must be text.')
  }
  return p
}

export function checkSessionPatch(patch: SessionPatch): SessionPatch {
  const p = pickPatch(patch, SESSION_EDITABLE_FIELDS, 'session') as SessionPatch
  if (p.status !== undefined && !(EDITABLE_STATUSES as readonly string[]).includes(p.status)) {
    throw new ServiceError(
      'invalid_status',
      'A past session can only be marked finished or abandoned.',
      { status: p.status },
    )
  }
  if (p.note !== undefined && typeof p.note !== 'string') {
    throw new ServiceError('invalid_note', 'The note must be text.')
  }
  return p
}

// ── Values ───────────────────────────────────────────────────────────────────

/** A block's amount: a finite number from 0 (a skipped block) to MAX_BLOCK_AMOUNT. */
export function assertAmount(amount: unknown): asserts amount is number {
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > MAX_BLOCK_AMOUNT
  ) {
    throw new ServiceError('invalid_amount', 'Enter an amount of 0 or more.', { amount })
  }
}

/** 1 + the highest blockIndex already used by the item (voided blocks included), else 0. */
export function nextBlockIndex(blocks: readonly Pick<BlockLog, 'blockIndex'>[]): number {
  return blocks.reduce((next, b) => Math.max(next, b.blockIndex + 1), 0)
}
