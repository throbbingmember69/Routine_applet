// Full JSON backup and restore (user decision: one device, IndexedDB, no cloud). Export dumps every
// table; restore validates the whole file first (JSON → migrate → schema), then replaces every
// table in one transaction, so a bad file or a failed write leaves the current data untouched.
// Restoring a backup with less history than the device asks for confirmation first.
import { MigrationError, migrateBackup } from '@/db/migrations'
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  PRIMARY_KEYS,
  TABLE_NAMES,
  parseBackup,
  type Backup,
  type BackupTables,
  type TableName,
} from '@/db/backupSchema'
import { daysBetween, localDateOf } from '@/domain/dates'
import type { EpochMs, LocalDate } from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { getAppState, loadSettings, setAppState } from '../settings'

/** appState key: when a backup file was last saved (epoch ms). */
export const LAST_BACKUP_AT_KEY = 'lastBackupAt'

/** Rows per table. */
export type TableCounts = { [K in TableName]: number }

/** What a restore could lose, per table: everything the user logged or created. */
export const HISTORY_TABLES = [
  'activities',
  'routines',
  'routineItems',
  'sessions',
  'blockLogs',
] as const

export type HistoryTable = (typeof HISTORY_TABLES)[number]
export type HistoryCounts = { [K in HistoryTable]: number }

export type ImportResult =
  | { status: 'imported'; counts: TableCounts }
  | {
      status: 'needs_confirm'
      current: HistoryCounts
      incoming: HistoryCounts
      /** The kinds of data the device has more of than the backup (would be lost). */
      shrinking: HistoryTable[]
    }

export interface ImportOptions {
  /** Go ahead even when the backup holds less history than the device. */
  confirmFewerRows?: boolean
}

/** Dump every table, rows sorted by primary key, so the same data always gives the same file. */
export async function exportBackup(
  ctx: Pick<ServiceCtx, 'db' | 'now'>,
  opts: { appVersion: string },
): Promise<Backup> {
  const { db } = ctx
  const tables = await db.transaction('r', [...TABLE_NAMES], async () => {
    const entries = await Promise.all(
      TABLE_NAMES.map(async (name) => [name, sortByKey(name, await db.table(name).toArray())]),
    )
    return Object.fromEntries(entries) as BackupTables
  })
  const backup: Backup = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: opts.appVersion,
    exportedAt: ctx.now(),
    tables,
  }
  // Check the file exactly as import will read it: a backup that can't be restored is worse than
  // no backup (restore is all-or-nothing, possibly after the device is gone).
  const errors = restoreProblems(JSON.parse(serializeBackup(backup)))
  if (errors.length > 0) {
    const n = errors.length
    const rows = n === 1 ? 'row' : 'rows'
    throw new ServiceError(
      'export_invalid',
      `${n} saved ${rows} can't be restored from a backup, so no backup file was made. Nothing was changed.`,
      { errors },
    )
  }
  return backup
}

export function serializeBackup(backup: Backup): string {
  return JSON.stringify(backup)
}

/** Download name, e.g. `routine-backup-2026-11-25.json`. */
export function backupFileName(date: LocalDate): string {
  return `routine-backup-${date}.json`
}

/**
 * Replace everything on the device with a backup file's contents.
 *
 * Throws ServiceError 'invalid_backup' (detail.errors lists every problem) for text that isn't a
 * valid backup, 'newer_version' for a file from a newer app, and 'restore_failed' if the database
 * write fails (nothing is changed in that case). Returns `needs_confirm` instead of importing when
 * the device has more of ANY kind of history or user-created data than the file (see
 * HISTORY_TABLES), unless `confirmFewerRows` is set. After a restore, the backup reminder counts
 * from when the file was made.
 */
export async function importBackup(
  ctx: Pick<ServiceCtx, 'db'> & Partial<Pick<ServiceCtx, 'now'>>,
  jsonText: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const backup = validateBackupText(jsonText, {
    today: ctx.now ? localDateOf(ctx.now()) : undefined,
  })
  const incoming = historyCounts(backup.tables)
  const { db } = ctx
  try {
    return await db.transaction('rw', [...TABLE_NAMES], async (): Promise<ImportResult> => {
      const current = await currentHistoryCounts(ctx)
      const shrinking = HISTORY_TABLES.filter((t) => incoming[t] < current[t])
      if (shrinking.length > 0 && !opts.confirmFewerRows) {
        return { status: 'needs_confirm', current, incoming, shrinking }
      }
      for (const name of TABLE_NAMES) await db.table(name).clear()
      for (const name of TABLE_NAMES) {
        const rows = backup.tables[name]
        if (rows.length > 0) await db.table(name).bulkAdd(rows)
      }
      // The file is a backup as of its export: the reminder counts from then.
      const stamped = backup.tables.appState.find((r) => r.key === LAST_BACKUP_AT_KEY)?.value
      const lastBackupAt = Math.max(
        typeof stamped === 'number' && Number.isFinite(stamped) ? stamped : 0,
        backup.exportedAt,
      )
      await db.appState.put({ key: LAST_BACKUP_AT_KEY, value: lastBackupAt })
      return { status: 'imported', counts: tableCounts(backup.tables) }
    })
  } catch (e) {
    if (e instanceof ServiceError) throw e
    throw new ServiceError(
      'restore_failed',
      'The backup could not be written, so nothing was changed. Your current data is untouched.',
      { cause: e instanceof Error ? `${e.name}: ${e.message}` : String(e) },
    )
  }
}

/**
 * Parse, migrate and validate backup text without touching the database. `today` is the restore
 * day (passed to migrations that need a date).
 */
export function validateBackupText(jsonText: string, opts: { today?: LocalDate } = {}): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw invalid('This file is not a backup: it is not valid JSON.', [reason])
  }
  let migrated: unknown
  try {
    migrated = migrateBackup(raw, { today: opts.today })
  } catch (e) {
    if (e instanceof MigrationError && e.kind === 'newer_version') {
      throw new ServiceError('newer_version', e.message, {
        version: e.version,
        currentVersion: e.currentVersion,
      })
    }
    if (e instanceof MigrationError) throw invalid(e.message, [e.message])
    throw e
  }
  const parsed = parseBackup(migrated)
  if (!parsed.ok) throw invalid(problemsMessage(parsed.errors.length), parsed.errors)
  const errors = integrityErrors(parsed.backup)
  if (errors.length > 0) throw invalid(problemsMessage(errors.length), errors)
  return parsed.backup
}

/** Every reason a (current-version) backup object couldn't be restored; [] when it can. */
function restoreProblems(raw: unknown): string[] {
  const parsed = parseBackup(raw)
  return parsed.ok ? integrityErrors(parsed.backup) : parsed.errors
}

/** Checks beyond the row schema: what the app needs to start, and references. */
function integrityErrors(backup: Backup): string[] {
  return [...requiredRowErrors(backup), ...referenceErrors(backup.tables)]
}

/** Record that a backup file was saved (drives the backup reminder). */
export async function markBackupSaved(ctx: ServiceCtx): Promise<void> {
  await setAppState(ctx, LAST_BACKUP_AT_KEY, ctx.now())
}

export interface BackupReminder {
  lastBackupAt: EpochMs | null
  /** Whole days since the last backup, or null if there has never been one. */
  daysSince: number | null
  /** True once `backupReminderDays` have passed, or when logged data has never been backed up. */
  due: boolean
}

/** Query: when the last backup was saved and whether a reminder is due. */
export async function getBackupReminder(
  ctx: Pick<ServiceCtx, 'db' | 'now'>,
): Promise<BackupReminder> {
  const { db } = ctx
  const [settings, stored, activities, sessions] = await Promise.all([
    loadSettings(ctx),
    getAppState<unknown>(ctx, LAST_BACKUP_AT_KEY),
    db.activities.count(),
    db.sessions.count(),
  ])
  const lastBackupAt = typeof stored === 'number' && Number.isFinite(stored) ? stored : null
  if (lastBackupAt === null) {
    // Nothing created yet: nothing to lose.
    return { lastBackupAt, daysSince: null, due: activities + sessions > 0 }
  }
  const daysSince = daysBetween(localDateOf(lastBackupAt), today(ctx))
  return { lastBackupAt, daysSince, due: daysSince >= settings.backupReminderDays }
}

export async function currentHistoryCounts(ctx: Pick<ServiceCtx, 'db'>): Promise<HistoryCounts> {
  const { db } = ctx
  const counts = await Promise.all(HISTORY_TABLES.map((t) => db.table(t).count()))
  return Object.fromEntries(HISTORY_TABLES.map((t, i) => [t, counts[i]])) as HistoryCounts
}

function historyCounts(t: BackupTables): HistoryCounts {
  return Object.fromEntries(HISTORY_TABLES.map((n) => [n, t[n].length])) as HistoryCounts
}

function tableCounts(tables: BackupTables): TableCounts {
  return Object.fromEntries(TABLE_NAMES.map((n) => [n, tables[n].length])) as TableCounts
}

function sortByKey<T>(name: TableName, rows: T[]): T[] {
  const pk = PRIMARY_KEYS[name]
  const key = (row: T) => String((row as Record<string, unknown>)[pk])
  return rows.sort((a, b) => {
    const x = key(a)
    const y = key(b)
    return x < y ? -1 : x > y ? 1 : 0
  })
}

/** Rows the app can't run without: the one settings row. */
function requiredRowErrors(backup: Backup): string[] {
  const n = backup.tables.settings.length
  return n === 1 ? [] : [`tables.settings: expected exactly 1 settings row, got ${n}`]
}

/** Every id a row points at must exist in its table (else the app fails after the restore). */
function referenceErrors(t: BackupTables): string[] {
  const ids = {
    activities: new Set(t.activities.map((r) => r.id)),
    routines: new Set(t.routines.map((r) => r.id)),
    routineItems: new Set(t.routineItems.map((r) => r.id)),
    sessions: new Set(t.sessions.map((r) => r.id)),
    sessionItems: new Set(t.sessionItems.map((r) => r.id)),
  }
  type Target = keyof typeof ids
  const errors: string[] = []
  const check = (table: TableName, i: number, field: string, value: string, target: Target) => {
    if (!ids[target].has(value)) {
      errors.push(
        `tables.${table}[${i}].${field}: no ${target} row has id ${JSON.stringify(value)}`,
      )
    }
  }
  t.routineItems.forEach((r, i) => {
    check('routineItems', i, 'routineId', r.routineId, 'routines')
    check('routineItems', i, 'activityId', r.activityId, 'activities')
  })
  t.sessions.forEach((r, i) => {
    if (r.routineId !== null) check('sessions', i, 'routineId', r.routineId, 'routines')
  })
  t.sessionItems.forEach((r, i) => {
    check('sessionItems', i, 'sessionId', r.sessionId, 'sessions')
    check('sessionItems', i, 'activityId', r.activityId, 'activities')
  })
  t.blockLogs.forEach((r, i) => {
    check('blockLogs', i, 'sessionId', r.sessionId, 'sessions')
    check('blockLogs', i, 'sessionItemId', r.sessionItemId, 'sessionItems')
    check('blockLogs', i, 'activityId', r.activityId, 'activities')
  })
  return errors
}

function problemsMessage(n: number): string {
  return n === 1
    ? 'This backup file has a problem and was not restored.'
    : `This backup file has ${n} problems and was not restored.`
}

function invalid(message: string, errors: readonly string[]): ServiceError {
  return new ServiceError('invalid_backup', message, { errors })
}
