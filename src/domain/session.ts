// Where a session stands, item by item: how many blocks are logged against the plan, and what a
// finish would leave undone. Optional items never hold a session back; their blocks still count
// toward the week once logged (domain/progress.ts).
import { roundHalfAway } from './rounding'
import type { BlockLog, SessionItem } from './types'

const SUM_DECIMALS = 6

export interface ItemProgress {
  sessionItemId: string
  /** Live blocks logged. */
  logged: number
  /** Planned blocks (the snapshot's). */
  planned: number
  /** Sum of the live blocks' amounts. */
  amount: number
  /** Planned total (blocks × block amount). */
  plannedAmount: number
  /** The index the next block would be shown as (1-based, may pass `planned`). */
  nextBlockNumber: number
  complete: boolean
}

/** Progress of one item from the session's blocks (voided blocks ignored). */
export function itemProgress(
  item: Pick<SessionItem, 'id' | 'blocks' | 'blockAmount'>,
  blocks: readonly Pick<BlockLog, 'sessionItemId' | 'amount' | 'voidedAt'>[],
): ItemProgress {
  const live = blocks.filter((b) => b.sessionItemId === item.id && b.voidedAt === null)
  const amount = roundHalfAway(
    live.reduce((sum, b) => sum + b.amount, 0),
    SUM_DECIMALS,
  )
  return {
    sessionItemId: item.id,
    logged: live.length,
    planned: item.blocks,
    amount,
    plannedAmount: roundHalfAway(item.blocks * item.blockAmount, SUM_DECIMALS),
    nextBlockNumber: live.length + 1,
    complete: live.length >= item.blocks,
  }
}

export interface FinishCheck {
  /** Required items with fewer blocks than planned, with how many are missing. */
  missing: { sessionItemId: string; activityName: string; blocks: number }[]
  /** Optional items with nothing logged (listed, never required). */
  skippedOptional: { sessionItemId: string; activityName: string }[]
  /** True when no block at all is logged (finishing would record an empty session). */
  empty: boolean
}

/** What finishing now would leave undone. */
export function finishCheck(
  items: readonly Pick<
    SessionItem,
    'id' | 'activityName' | 'blocks' | 'blockAmount' | 'optional'
  >[],
  blocks: readonly Pick<BlockLog, 'sessionItemId' | 'amount' | 'voidedAt'>[],
): FinishCheck {
  const missing: FinishCheck['missing'] = []
  const skippedOptional: FinishCheck['skippedOptional'] = []
  let any = false
  for (const item of items) {
    const p = itemProgress(item, blocks)
    if (p.logged > 0) any = true
    if (item.optional) {
      if (p.logged === 0)
        skippedOptional.push({ sessionItemId: item.id, activityName: item.activityName })
    } else if (!p.complete) {
      missing.push({
        sessionItemId: item.id,
        activityName: item.activityName,
        blocks: p.planned - p.logged,
      })
    }
  }
  return { missing, skippedOptional, empty: !any }
}
