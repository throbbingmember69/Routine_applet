// Dexie (IndexedDB) schema. Rules:
// - Keep every db.version(n) declaration forever; add a new version for any index change.
// - Never change a primary key (that needs a new table plus a copy step).
// - Booleans and nulls can't be indexed (rows with a null index value are simply absent from
//   that index), so filter those in memory. Data volume is small, so services load whole tables.
// - Upgrade callbacks call pure transforms in db/migrations/, shared with backup import.
import Dexie, { type EntityTable } from 'dexie'
import type {
  Activity,
  AppStateRow,
  BlockLog,
  Routine,
  RoutineItem,
  Session,
  SessionItem,
  SettingsRow,
} from '@/domain/types'
import { ensureSeeded, populateSeed } from './populate'

/**
 * Unique per origin: throbbingmember69.github.io is shared by all of the user's Pages sites (the
 * workout app uses 'exersise-applet'), so this name must stay distinct.
 */
export const DB_NAME = 'routine-applet'

/** Current Dexie schema version. Backups record it; older backups are migrated on import. */
export const DB_SCHEMA_VERSION = 1

/** Table names in backup/export order. Must match TABLE_NAMES in db/backupSchema.ts. */
export const DB_TABLES = [
  'settings',
  'appState',
  'activities',
  'routines',
  'routineItems',
  'sessions',
  'sessionItems',
  'blockLogs',
] as const

export type DbTableName = (typeof DB_TABLES)[number]

/** Schema v1 stores (indexes). Later versions only add a version entry, so this stays. */
export const STORES_V1 = {
  settings: 'id',
  appState: 'key',
  activities: 'id, name',
  routines: 'id, order',
  routineItems: 'id, routineId, [routineId+order], activityId',
  sessions: 'id, date, status, startedAt, routineId',
  sessionItems: 'id, sessionId, activityId, routineItemId, [sessionId+order]',
  blockLogs: 'id, sessionId, sessionItemId, activityId',
} as const

export class AppDB extends Dexie {
  settings!: EntityTable<SettingsRow, 'id'>
  appState!: EntityTable<AppStateRow, 'key'>
  activities!: EntityTable<Activity, 'id'>
  routines!: EntityTable<Routine, 'id'>
  routineItems!: EntityTable<RoutineItem, 'id'>
  sessions!: EntityTable<Session, 'id'>
  sessionItems!: EntityTable<SessionItem, 'id'>
  blockLogs!: EntityTable<BlockLog, 'id'>

  /** `seed: false` creates an empty database (backup restore into a fresh DB, some tests). */
  constructor(name: string = DB_NAME, opts: { seed?: boolean } = {}) {
    super(name)
    this.version(1).stores(STORES_V1)
    if (opts.seed !== false) {
      this.on('populate', (tx) => populateSeed(tx))
      this.on('ready', (db) => ensureSeeded(db))
    }
  }
}
