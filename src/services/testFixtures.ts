// Shared setup for service tests: throwaway databases on a fixed clock, and a couple of activities
// and a routine to log against.
import { afterEach } from 'vitest'
import { createActivity, type ActivityInput } from './activities'
import { createTestCtx } from './context'
import { isServiceError } from './errors'
import { addRoutineItem, createRoutine } from './routines'

export type TestCtx = ReturnType<typeof createTestCtx>

/** Monday 2026-11-23, 17:00 UTC. */
export const MON = Date.UTC(2026, 10, 23, 17)
export const DAY = 86_400_000

/** A fresh context per call, disposed after each test. Call at the top of a test file. */
export function testCtxFactory(): (opts?: Parameters<typeof createTestCtx>[0]) => TestCtx {
  const ctxs: TestCtx[] = []
  afterEach(async () => {
    for (const c of ctxs.splice(0)) {
      c.db.close()
      await c.db.delete()
    }
  })
  return (opts) => {
    const c = createTestCtx({ startMs: MON, ...opts })
    ctxs.push(c)
    return c
  }
}

export const STUDY: ActivityInput = {
  name: 'Study',
  unitLabel: 'min',
  defaultBlockAmount: 25,
  restMinSec: 300,
  restMaxSec: 300,
  weeklyTarget: 300,
}

export const READING: ActivityInput = {
  name: 'Reading',
  unitLabel: 'pages',
  defaultBlockAmount: 20,
  restMinSec: 0,
  restMaxSec: 0,
  weeklyTarget: null,
}

/** Study and Reading, plus a "Morning" routine: Study 4 × 25 min, then optional Reading 1 × 20. */
export async function setupMorning(c: TestCtx) {
  const study = await createActivity(c, STUDY)
  const reading = await createActivity(c, READING)
  const routine = await createRoutine(c, { name: 'Morning', weekday: 1 })
  const studyItem = await addRoutineItem(c, routine, { activityId: study, blocks: 4 })
  const readingItem = await addRoutineItem(c, routine, { activityId: reading, optional: true })
  return { study, reading, routine, studyItem, readingItem }
}

/** Expect a promise to reject with a ServiceError of this code. */
export async function rejectsWith(p: Promise<unknown>, code: string): Promise<void> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  )
  if (!isServiceError(e, code)) {
    throw new Error(`expected ServiceError ${code}, got ${e === null ? 'success' : String(e)}`)
  }
}
