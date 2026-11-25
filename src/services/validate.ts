// Input checks shared by the activity, routine and session commands. Each throws a ServiceError
// with a readable message, so the UI can show it as-is.
import { MAX_BLOCK_AMOUNT } from '@/db/guards'
import { ServiceError } from './errors'

export const MAX_NAME = 60
export const MAX_UNIT = 20
export const MAX_NOTE = 500
/** Longest rest between blocks, in seconds (an hour). */
export const MAX_REST_SEC = 3600
/** Most blocks one routine item or quick log may plan. */
export const MAX_BLOCKS = 50
/** Largest weekly target or progression cap, in any unit. */
export const MAX_WEEKLY = 1_000_000
/** Longest progression interval, in weeks. */
export const MAX_EVERY_WEEKS = 52

/** A trimmed, non-empty name of at most MAX_NAME characters. */
export function cleanName(name: unknown, what: string): string {
  const v = typeof name === 'string' ? name.trim() : ''
  if (v.length === 0) throw new ServiceError('invalid_name', `Give the ${what} a name.`)
  if (v.length > MAX_NAME) {
    throw new ServiceError('invalid_name', `Keep the name to ${MAX_NAME} characters.`)
  }
  return v
}

export function cleanUnit(unit: unknown): string {
  const v = typeof unit === 'string' ? unit.trim() : ''
  if (v.length === 0) {
    throw new ServiceError('invalid_unit', 'Give a unit, such as min, pages or km.')
  }
  if (v.length > MAX_UNIT) {
    throw new ServiceError('invalid_unit', `Keep the unit to ${MAX_UNIT} characters.`)
  }
  return v
}

export function cleanNote(note: unknown): string {
  if (note === undefined) return ''
  if (typeof note !== 'string' || note.length > MAX_NOTE) {
    throw new ServiceError(
      'invalid_note',
      `The note must be text of at most ${MAX_NOTE} characters.`,
    )
  }
  return note
}

/** A block size: more than 0, up to MAX_BLOCK_AMOUNT. */
export function assertBlockAmount(v: unknown, label = 'The block size'): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_BLOCK_AMOUNT) {
    throw new ServiceError('invalid_amount', `${label} must be more than 0.`, { value: v })
  }
}

export function assertBlocks(v: unknown): asserts v is number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_BLOCKS) {
    throw new ServiceError(
      'invalid_blocks',
      `Blocks must be a whole number from 1 to ${MAX_BLOCKS}.`,
      {
        value: v,
      },
    )
  }
}

/** A rest range in whole seconds: 0 ≤ min ≤ max ≤ MAX_REST_SEC. */
export function assertRest(minSec: unknown, maxSec: unknown): void {
  const ok = (s: unknown) =>
    typeof s === 'number' && Number.isInteger(s) && s >= 0 && s <= MAX_REST_SEC
  if (!ok(minSec) || !ok(maxSec) || (minSec as number) > (maxSec as number)) {
    throw new ServiceError('invalid_rest', 'Rest must be from 0 to 60 minutes.', {
      restMinSec: minSec,
      restMaxSec: maxSec,
    })
  }
}

export function assertBool(v: unknown, what: string): asserts v is boolean {
  if (typeof v !== 'boolean') throw new ServiceError('invalid_flag', `${what} must be yes or no.`)
}
