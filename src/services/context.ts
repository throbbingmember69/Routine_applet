// Services receive their dependencies explicitly so tests can use a throwaway database and a
// fixed clock. The UI gets the app-wide context from `useServices()`.
import { AppDB } from '@/db/schema'
import { localDateOf } from '@/domain/dates'
import type { LocalDate } from '@/domain/types'

export interface ServiceCtx {
  db: AppDB
  /** Current instant (epoch ms). */
  now: () => number
  /** Id generator for new rows. */
  newId: () => string
}

export function today(ctx: Pick<ServiceCtx, 'now'>): LocalDate {
  return localDateOf(ctx.now())
}

let appCtx: ServiceCtx | null = null

/** The app-wide context (real database, wall clock, random UUIDs). */
export function getAppCtx(): ServiceCtx {
  appCtx ??= {
    db: new AppDB(),
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
  }
  return appCtx
}

/**
 * A context for tests: isolated database, controllable clock, sequential ids. The database gets
 * the first-launch rows (the settings row) unless `seed` is false (completely empty).
 */
export function createTestCtx(opts: { dbName?: string; startMs?: number; seed?: boolean } = {}) {
  let t = opts.startMs ?? Date.UTC(2026, 10, 23, 17)
  let n = 0
  const seed = opts.seed ?? true
  const ctx: ServiceCtx & { setNow: (ms: number) => void; advance: (ms: number) => void } = {
    db: new AppDB(opts.dbName ?? `test-${crypto.randomUUID()}`, { seed }),
    now: () => t,
    newId: () => `id-${String(++n).padStart(4, '0')}`,
    setNow: (ms) => {
      t = ms
    },
    advance: (ms) => {
      t += ms
    },
  }
  return ctx
}
