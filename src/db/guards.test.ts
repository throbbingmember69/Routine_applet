import { describe, expect, it } from 'vitest'
import type { BlockLog, LocalDate, Session, SessionItem } from '@/domain/types'
import { ServiceError } from '@/services/errors'
import {
  assertAmount,
  assertBlockNotVoided,
  assertBlockOf,
  assertCanEdit,
  assertCanLog,
  assertEditable,
  assertItemOf,
  assertNoLoggedBlocks,
  checkBlockPatch,
  checkSessionPatch,
  MAX_BLOCK_AMOUNT,
  nextBlockIndex,
  pickPatch,
  requireBlock,
  requireSession,
  requireSessionItem,
} from './guards'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    date: '2026-11-23' as LocalDate,
    startedAt: 1,
    finishedAt: null,
    tzOffsetMin: 0,
    status: 'in_progress',
    source: 'logger',
    routineId: null,
    note: '',
    voidedAt: null,
    editedAt: null,
    createdAt: 1,
    ...over,
  }
}

function item(over: Partial<SessionItem> = {}): SessionItem {
  return {
    id: 'i1',
    sessionId: 's1',
    order: 0,
    routineItemId: null,
    adHoc: true,
    activityId: 'a1',
    activityName: 'Study',
    unitLabel: 'min',
    blocks: 4,
    blockAmount: 25,
    restMinSec: 300,
    restMaxSec: 300,
    optional: false,
    createdAt: 1,
    ...over,
  }
}

function block(over: Partial<BlockLog> = {}): BlockLog {
  return {
    id: 'b1',
    sessionId: 's1',
    sessionItemId: 'i1',
    activityId: 'a1',
    blockIndex: 0,
    amount: 25,
    note: '',
    loggedAt: 1,
    editedAt: null,
    voidedAt: null,
    ...over,
  }
}

function code(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (e) {
    if (e instanceof ServiceError) return e.code
    throw e
  }
}

describe('existence', () => {
  it('returns the row or throws a not-found error', () => {
    expect(requireSession(session(), 's1').id).toBe('s1')
    expect(code(() => requireSession(undefined, 'x'))).toBe('session_not_found')
    expect(code(() => requireSessionItem(undefined, 'x'))).toBe('session_item_not_found')
    expect(code(() => requireBlock(undefined, 'x'))).toBe('block_not_found')
  })
})

describe('session state', () => {
  it('logs only into an in-progress, live session', () => {
    expect(code(() => assertCanLog(session()))).toBeNull()
    expect(code(() => assertCanLog(session({ status: 'finished' })))).toBe(
      'session_not_in_progress',
    )
    expect(code(() => assertCanLog(session({ voidedAt: 5 })))).toBe('session_not_in_progress')
  })

  it('edits only finished or abandoned sessions, and not voided ones', () => {
    expect(code(() => assertEditable(session()))).toBe('session_not_editable')
    expect(code(() => assertEditable(session({ status: 'abandoned', voidedAt: 5 })))).toBeNull()
    expect(code(() => assertCanEdit(session({ status: 'finished' })))).toBeNull()
    expect(code(() => assertCanEdit(session({ status: 'finished', voidedAt: 5 })))).toBe(
      'session_voided',
    )
  })

  it('removes an item only while it has no live blocks', () => {
    expect(code(() => assertNoLoggedBlocks(item(), [block({ voidedAt: 3 })]))).toBeNull()
    expect(code(() => assertNoLoggedBlocks(item(), [block({ sessionItemId: 'other' })]))).toBeNull()
    expect(code(() => assertNoLoggedBlocks(item(), [block()]))).toBe('has_blocks')
  })
})

describe('cross-row consistency', () => {
  it('rejects rows from another session or item', () => {
    expect(code(() => assertItemOf(item(), session()))).toBeNull()
    expect(code(() => assertItemOf(item({ sessionId: 's2' }), session()))).toBe('session_mismatch')
    expect(code(() => assertBlockOf(block(), item(), session()))).toBeNull()
    expect(code(() => assertBlockOf(block({ sessionItemId: 'i2' }), item(), session()))).toBe(
      'session_mismatch',
    )
    expect(code(() => assertBlockOf(block({ activityId: 'a2' }), item(), session()))).toBe(
      'session_mismatch',
    )
    expect(code(() => assertBlockNotVoided(block({ voidedAt: 2 })))).toBe('block_voided')
  })
})

describe('patches', () => {
  it('keeps whitelisted fields, drops undefined and rejects the rest', () => {
    expect(pickPatch({ amount: 3, note: undefined }, ['amount', 'note'], 'block')).toEqual({
      amount: 3,
    })
    expect(code(() => pickPatch({ id: 'x' }, ['amount'], 'block'))).toBe('field_not_editable')
  })

  it('validates block patches', () => {
    expect(checkBlockPatch({ amount: 12.5, note: 'ok' })).toEqual({ amount: 12.5, note: 'ok' })
    expect(code(() => checkBlockPatch({ amount: -1 }))).toBe('invalid_amount')
    expect(code(() => checkBlockPatch({ blockIndex: 3 } as never))).toBe('field_not_editable')
  })

  it('validates session patches: never back to in progress', () => {
    expect(checkSessionPatch({ status: 'abandoned' })).toEqual({ status: 'abandoned' })
    expect(code(() => checkSessionPatch({ status: 'in_progress' }))).toBe('invalid_status')
    expect(checkSessionPatch({ date: '2026-11-20' as never })).toEqual({ date: '2026-11-20' })
    expect(code(() => checkSessionPatch({ date: '2026-02-30' as never }))).toBe('invalid_date')
    expect(code(() => checkSessionPatch({ routineId: 'r' } as never))).toBe('field_not_editable')
  })
})

describe('values', () => {
  it('accepts amounts from 0 to the maximum', () => {
    for (const ok of [0, 0.5, 25, MAX_BLOCK_AMOUNT]) expect(code(() => assertAmount(ok))).toBeNull()
    for (const bad of [-0.1, Number.NaN, Infinity, MAX_BLOCK_AMOUNT + 1, '5']) {
      expect(code(() => assertAmount(bad))).toBe('invalid_amount')
    }
  })

  it('numbers blocks after the highest index used, voided ones included', () => {
    expect(nextBlockIndex([])).toBe(0)
    expect(nextBlockIndex([{ blockIndex: 0 }, { blockIndex: 2 }])).toBe(3)
  })
})
