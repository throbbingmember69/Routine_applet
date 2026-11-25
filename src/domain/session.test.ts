import { describe, expect, it } from 'vitest'
import { finishCheck, itemProgress } from './session'

const item = (id: string, blocks: number, blockAmount: number, optional = false) => ({
  id,
  activityName: id.toUpperCase(),
  blocks,
  blockAmount,
  optional,
})
const b = (sessionItemId: string, amount: number, voidedAt: number | null = null) => ({
  sessionItemId,
  amount,
  voidedAt,
})

describe('itemProgress', () => {
  it('counts live blocks and their amounts against the plan', () => {
    const blocks = [b('study', 25), b('study', 20), b('study', 25, 1), b('read', 10)]
    expect(itemProgress(item('study', 4, 25), blocks)).toEqual({
      sessionItemId: 'study',
      logged: 2,
      planned: 4,
      amount: 45,
      plannedAmount: 100,
      nextBlockNumber: 3,
      complete: false,
    })
  })

  it('is complete at the planned count, and keeps counting extra blocks', () => {
    const p = itemProgress(item('walk', 1, 2.5), [b('walk', 2.5), b('walk', 1.2)])
    expect(p).toMatchObject({ logged: 2, complete: true, amount: 3.7, nextBlockNumber: 3 })
  })
})

describe('finishCheck', () => {
  it('lists required items short of their plan, and optional items left untouched', () => {
    const items = [item('study', 4, 25), item('read', 1, 20, true), item('walk', 1, 2)]
    expect(finishCheck(items, [b('study', 25), b('walk', 2)])).toEqual({
      missing: [{ sessionItemId: 'study', activityName: 'STUDY', blocks: 3 }],
      skippedOptional: [{ sessionItemId: 'read', activityName: 'READ' }],
      empty: false,
    })
  })

  it('flags a session with nothing logged (voided blocks don’t count)', () => {
    expect(finishCheck([item('study', 1, 25)], [b('study', 25, 9)]).empty).toBe(true)
    expect(finishCheck([], []).empty).toBe(true)
  })
})
