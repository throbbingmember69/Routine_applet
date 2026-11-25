// First-launch content: only the settings singleton (empty overrides = registry defaults). The
// user defines their own activities and routines. Runs inside Dexie's 'populate' transaction,
// which only fires when the database is first created.
import type Dexie from 'dexie'
import type { Transaction } from 'dexie'
import type { SettingsRow } from '@/domain/types'

/** Rows written on first launch, per table. */
export function seedRows() {
  const settings: SettingsRow = { id: 'singleton', values: {}, updatedAt: 0 }
  return { settings: [settings] } as const
}

/** Dexie 'populate' handler. Only synchronous Dexie calls: the transaction must stay alive. */
export function populateSeed(tx: Transaction): void {
  for (const [table, rows] of Object.entries(seedRows())) {
    void tx.table(table).bulkAdd(structuredClone([...rows]))
  }
}

/**
 * Dexie 'ready' fallback: seed a database that exists but was never populated (e.g. a first
 * launch interrupted after the stores were created). A restored backup always has settings.
 */
export async function ensureSeeded(db: Dexie): Promise<void> {
  if ((await db.table('settings').count()) > 0) return
  await db.transaction('rw', Object.keys(seedRows()), async () => {
    if ((await db.table('settings').count()) > 0) return
    for (const [table, rows] of Object.entries(seedRows())) {
      await db.table(table).bulkPut(structuredClone([...rows]))
    }
  })
}
