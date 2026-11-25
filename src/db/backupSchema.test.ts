import { describe, expect, it } from 'vitest'
import type { LocalDate } from '@/domain/types'
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  backupSchema,
  parseBackup,
  rowSchemas,
  TABLE_NAMES,
  type Backup,
  type BackupTables,
} from './backupSchema'

const d = (s: string) => s as LocalDate
const T0 = Date.UTC(2026, 10, 23, 17)
const min = 60_000

function emptyTables(): BackupTables {
  return Object.fromEntries(TABLE_NAMES.map((n) => [n, []])) as unknown as BackupTables
}

function minimalBackup(): Backup {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: '0.1.0',
    exportedAt: T0,
    tables: emptyTables(),
  }
}

/** Two activities (one with progression), a routine, a finished session and a quick log. */
function realisticBackup(): Backup {
  return {
    ...minimalBackup(),
    tables: {
      settings: [
        { id: 'singleton', values: { weekStartDay: 0, restExtendSec: 15 }, updatedAt: T0 },
      ],
      appState: [
        { key: 'lastBackupAt', value: T0 - 86_400_000 },
        { key: 'restTimer', value: { endsAt: T0 + 5 * min } },
        { key: 'dismissed', value: null },
      ],
      activities: [
        {
          id: 'act-study',
          name: 'Study',
          unitLabel: 'min',
          defaultBlockAmount: 25,
          restMinSec: 300,
          restMaxSec: 300,
          weeklyTarget: 300,
          progression: {
            stepAmount: 30,
            everyWeeks: 2,
            capAmount: 600,
            startDate: d('2026-11-23'),
          },
          notes: 'Pomodoro',
          archivedAt: null,
          createdAt: T0,
          updatedAt: T0,
        },
        {
          id: 'act-read',
          name: 'Reading',
          unitLabel: 'pages',
          defaultBlockAmount: 20,
          restMinSec: 0,
          restMaxSec: 0,
          weeklyTarget: null,
          progression: null,
          notes: '',
          archivedAt: null,
          createdAt: T0,
          updatedAt: T0,
        },
      ],
      routines: [
        { id: 'rt-morning', name: 'Morning', weekday: 1, order: 0, note: '', archivedAt: null },
      ],
      routineItems: [
        {
          id: 'ri-1',
          routineId: 'rt-morning',
          order: 0,
          activityId: 'act-study',
          blocks: 4,
          blockAmount: 25,
          restMinSec: 300,
          restMaxSec: 300,
          optional: false,
          note: '',
          archivedAt: null,
        },
        {
          id: 'ri-2',
          routineId: 'rt-morning',
          order: 1,
          activityId: 'act-read',
          blocks: 1,
          blockAmount: 20,
          restMinSec: 0,
          restMaxSec: 0,
          optional: true,
          note: 'if time',
          archivedAt: null,
        },
      ],
      sessions: [
        {
          id: 'ses-1',
          date: d('2026-11-23'),
          startedAt: T0,
          finishedAt: T0 + 120 * min,
          tzOffsetMin: -300,
          status: 'finished',
          routineId: 'rt-morning',
          note: '',
          voidedAt: null,
          editedAt: null,
          createdAt: T0,
        },
        {
          id: 'ses-2',
          date: d('2026-11-24'),
          startedAt: T0 + 86_400_000,
          finishedAt: T0 + 86_400_000,
          tzOffsetMin: -300,
          status: 'finished',
          routineId: null,
          note: 'quick log',
          voidedAt: null,
          editedAt: null,
          createdAt: T0 + 86_400_000,
        },
      ],
      sessionItems: [
        {
          id: 'si-1',
          sessionId: 'ses-1',
          order: 0,
          routineItemId: 'ri-1',
          adHoc: false,
          activityId: 'act-study',
          activityName: 'Study',
          unitLabel: 'min',
          blocks: 4,
          blockAmount: 25,
          restMinSec: 300,
          restMaxSec: 300,
          optional: false,
          createdAt: T0,
        },
        {
          id: 'si-2',
          sessionId: 'ses-2',
          order: 0,
          routineItemId: null,
          adHoc: true,
          activityId: 'act-read',
          activityName: 'Reading',
          unitLabel: 'pages',
          blocks: 1,
          blockAmount: 20,
          restMinSec: 0,
          restMaxSec: 0,
          optional: false,
          createdAt: T0 + 86_400_000,
        },
      ],
      blockLogs: [
        block('blk-1', 'ses-1', 'si-1', 'act-study', 0, 25),
        block('blk-2', 'ses-1', 'si-1', 'act-study', 1, 25),
        block('blk-3', 'ses-1', 'si-1', 'act-study', 2, 0),
        block('blk-4', 'ses-1', 'si-1', 'act-study', 3, 12.5),
        block('blk-5', 'ses-2', 'si-2', 'act-read', 0, 34),
      ],
    },
  }
}

function block(
  id: string,
  sessionId: string,
  sessionItemId: string,
  activityId: string,
  blockIndex: number,
  amount: number,
) {
  return {
    id,
    sessionId,
    sessionItemId,
    activityId,
    blockIndex,
    amount,
    note: '',
    loggedAt: T0 + blockIndex * 30 * min,
    editedAt: null,
    voidedAt: null,
  }
}

const REMOVE = Symbol('remove')

/**
 * A JSON copy of the realistic backup (as a restored file would arrive) with changes applied by
 * dotted path, e.g. { 'tables.blockLogs.3.amount': -1 }. REMOVE deletes the key.
 */
function withChanges(changes: Record<string, unknown>): unknown {
  const copy = JSON.parse(JSON.stringify(realisticBackup())) as Record<string, unknown>
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split('.')
    const last = keys.pop()!
    let target = copy
    for (const key of keys) target = target[key] as Record<string, unknown>
    if (value === REMOVE) delete target[last]
    else target[last] = value
  }
  return copy
}

function errorsOf(json: unknown): string[] {
  const result = parseBackup(json)
  if (result.ok) throw new Error('expected the backup to be rejected')
  return result.errors
}

describe('TABLE_NAMES', () => {
  it('lists every table in the contract order', () => {
    expect(TABLE_NAMES).toEqual([
      'settings',
      'appState',
      'activities',
      'routines',
      'routineItems',
      'sessions',
      'sessionItems',
      'blockLogs',
    ])
  })

  it('matches the tables the schema validates and the exported row schemas', () => {
    expect(Object.keys(backupSchema.shape.tables.shape).sort()).toEqual([...TABLE_NAMES].sort())
    expect(Object.keys(rowSchemas).sort()).toEqual([...TABLE_NAMES].sort())
  })
})

describe('parseBackup: valid files', () => {
  it('accepts a minimal backup with every table empty', () => {
    const backup = minimalBackup()
    expect(parseBackup(backup)).toEqual({ ok: true, backup })
  })

  it('accepts a realistic backup unchanged after a JSON round trip', () => {
    const backup = realisticBackup()
    expect(parseBackup(JSON.parse(JSON.stringify(backup)))).toEqual({ ok: true, backup })
  })

  it('accepts zero and fractional block amounts', () => {
    const result = parseBackup(realisticBackup())
    expect(result.ok && result.backup.tables.blockLogs.map((b) => b.amount)).toEqual([
      25, 25, 0, 12.5, 34,
    ])
  })

  it('accepts an appState row whose value was dropped by JSON (undefined)', () => {
    const result = parseBackup(withChanges({ 'tables.appState': [{ key: 'restTimer' }] }))
    expect(result.ok && result.backup.tables.appState).toEqual([
      { key: 'restTimer', value: undefined },
    ])
  })

  it('drops unknown fields, unknown tables and retired settings keys instead of rejecting them', () => {
    const result = parseBackup(
      withChanges({
        'tables.sessions.0.legacyField': 'x',
        'tables.categories': [{ id: 'c-1' }],
        'tables.settings.0.values.retiredSetting': 3,
        comment: 'hand-edited',
      }),
    )
    expect(result).toEqual({ ok: true, backup: realisticBackup() })
    if (!result.ok) return
    expect(result.backup.tables.settings[0]!.values).toEqual({ weekStartDay: 0, restExtendSec: 15 })
    expect('categories' in result.backup.tables).toBe(false)
    expect('legacyField' in result.backup.tables.sessions[0]!).toBe(false)
  })

  it('validates a single table row with rowSchemas', () => {
    const row = realisticBackup().tables.blockLogs[0]
    expect(rowSchemas.blockLogs.safeParse(row).success).toBe(true)
    expect(rowSchemas.blockLogs.safeParse({ ...row, amount: -1 }).success).toBe(false)
  })
})

describe('parseBackup: rejected files', () => {
  it('refuses a file that is not an app backup, with one clear error', () => {
    expect(errorsOf(withChanges({ format: 'exersise-applet-backup' }))).toEqual([
      'format: not a Routine Applet backup; expected "routine-applet-backup", got "exersise-applet-backup"',
    ])
    expect(errorsOf({ hello: 'world' })).toEqual([
      'format: not a Routine Applet backup; expected "routine-applet-backup" (missing)',
    ])
  })

  it('refuses input that is not an object', () => {
    expect(errorsOf([])).toEqual(['backup: expected object, got an array'])
    expect(errorsOf(null)).toEqual(['backup: expected object, got null'])
  })

  it('refuses a backup from a newer schema version before validating anything else', () => {
    const json = withChanges({ schemaVersion: BACKUP_SCHEMA_VERSION + 1, tables: 'a newer layout' })
    expect(errorsOf(json)).toEqual([
      'schemaVersion: this backup was made by a newer version of the app (schema 2; this app reads schema 1). Update the app, then restore.',
    ])
  })

  it('accepts only the current schema version', () => {
    expect(errorsOf(withChanges({ schemaVersion: 0 }))).toEqual([
      'schemaVersion: expected 1, got 0',
    ])
    expect(errorsOf(withChanges({ schemaVersion: REMOVE }))).toEqual([
      'schemaVersion: expected 1 (missing)',
    ])
  })

  it('rejects dates that are malformed or not on the calendar', () => {
    const json = withChanges({
      'tables.sessions.0.date': '2026-02-30',
      'tables.sessions.1.date': '2026-9-30',
      'tables.activities.0.progression.startDate': 20261123,
    })
    expect(errorsOf(json)).toEqual([
      'tables.activities[0].progression.startDate: expected a real YYYY-MM-DD date, got 20261123',
      'tables.sessions[0].date: expected a real YYYY-MM-DD date, got "2026-02-30"',
      'tables.sessions[1].date: expected a real YYYY-MM-DD date, got "2026-9-30"',
    ])
  })

  it('rejects impossible amounts, block counts and progression', () => {
    const json = withChanges({
      'tables.activities.0.defaultBlockAmount': 0,
      'tables.activities.0.progression.everyWeeks': 1.5,
      'tables.activities.1.weeklyTarget': -5,
      'tables.routineItems.0.blocks': 0,
      'tables.blockLogs.1.amount': -1,
      'tables.blockLogs.2.blockIndex': 0.5,
    })
    expect(errorsOf(json)).toEqual([
      'tables.activities[0].defaultBlockAmount: expected a value > 0, got 0',
      'tables.activities[0].progression.everyWeeks: expected integer, got 1.5',
      'tables.activities[1].weeklyTarget: expected a value >= 0, got -5',
      'tables.routineItems[0].blocks: expected a value > 0, got 0',
      'tables.blockLogs[1].amount: expected a value >= 0, got -1',
      'tables.blockLogs[2].blockIndex: expected integer, got 0.5',
    ])
  })

  it('rejects values outside an enum or literal, missing fields and wrong types', () => {
    const json = withChanges({
      'tables.settings.0.id': 'me',
      'tables.routines.0.weekday': 7,
      'tables.sessions.0.status': 'done',
      'tables.sessionItems.0.optional': 'no',
      'tables.blockLogs.0.note': REMOVE,
      'tables.routineItems': REMOVE,
    })
    expect(errorsOf(json)).toEqual([
      'tables.settings[0].id: expected "singleton", got "me"',
      'tables.routines[0].weekday: expected one of 0, 1, 2, 3, 4, 5, 6, got 7',
      'tables.routineItems: expected array (missing)',
      'tables.sessions[0].status: expected one of "in_progress", "finished", "abandoned", got "done"',
      'tables.sessionItems[0].optional: expected boolean, got "no"',
      'tables.blockLogs[0].note: expected string (missing)',
    ])
  })

  it('rejects empty ids and non-finite numbers', () => {
    const json = withChanges({
      'tables.activities.1.id': '',
      'tables.blockLogs.3.amount': Infinity,
    })
    expect(errorsOf(json)).toEqual([
      'tables.activities[1].id: must not be empty',
      'tables.blockLogs[3].amount: expected number, got Infinity',
    ])
  })

  it('rejects duplicate primary keys, which would abort the restore transaction', () => {
    const json = withChanges({
      'tables.appState.2.key': 'lastBackupAt',
      'tables.blockLogs.2.id': 'blk-1',
    })
    expect(errorsOf(json)).toEqual([
      'tables.appState[2].key: duplicate key "lastBackupAt" (also at [0])',
      'tables.blockLogs[2].id: duplicate id "blk-1" (also at [0])',
    ])
  })

  it('collects every problem in one pass', () => {
    const changes = Object.fromEntries(
      [0, 1, 2, 3, 4].map((i) => [`tables.blockLogs.${i}.amount`, -1]),
    )
    expect(errorsOf(withChanges(changes))).toHaveLength(5)
  })
})
