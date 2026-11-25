import type { Table } from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, TABLE_NAMES, type Backup } from '@/db/backupSchema'
import type { Activity, BlockLog, LocalDate, Session, SessionItem } from '@/domain/types'
import { createTestCtx, type ServiceCtx } from '../context'
import { isServiceError, type ServiceError } from '../errors'
import {
  LAST_BACKUP_AT_KEY,
  backupFileName,
  exportBackup,
  getBackupReminder,
  importBackup,
  markBackupSaved,
  serializeBackup,
} from './backup'

type TestCtx = ReturnType<typeof createTestCtx>
const ctxs: TestCtx[] = []
function ctx(opts?: Parameters<typeof createTestCtx>[0]) {
  const c = createTestCtx(opts)
  ctxs.push(c)
  return c
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

const DAY = 86_400_000
const d = (s: string) => s as LocalDate
const T0 = Date.UTC(2026, 10, 23, 17)

async function dumpAll(c: Pick<ServiceCtx, 'db'>): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of TABLE_NAMES) out[name] = await c.db.table(name).toArray()
  return out
}

/** dumpAll without the lastBackupAt stamp a restore adds. */
async function dumpRestorable(c: Pick<ServiceCtx, 'db'>): Promise<Record<string, unknown[]>> {
  const out = await dumpAll(c)
  out.appState = out.appState!.filter((r) => (r as { key: string }).key !== LAST_BACKUP_AT_KEY)
  return out
}

/** An exported backup as import sees it (plain JSON), to break on purpose. */
async function exportedJson(c: Pick<ServiceCtx, 'db' | 'now'>): Promise<Backup> {
  return JSON.parse(serializeBackup(await exportBackup(c, { appVersion: '0.1.0' }))) as Backup
}

async function expectServiceError(p: Promise<unknown>, code: string): Promise<ServiceError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  )
  expect(isServiceError(e, code), `expected ServiceError ${code}, got ${String(e)}`).toBe(true)
  return e as ServiceError
}

/** A month of realistic use on top of the first-launch seed: every table gets rows. */
async function historyTotal(c: Pick<ServiceCtx, 'db'>): Promise<number> {
  return (await c.db.sessions.count()) + (await c.db.blockLogs.count())
}

function activity(id: string, name: string, over: Partial<Activity> = {}): Activity {
  return {
    id,
    name,
    unitLabel: 'min',
    defaultBlockAmount: 25,
    restMinSec: 300,
    restMaxSec: 300,
    weeklyTarget: 300,
    progression: null,
    notes: '',
    archivedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  }
}

function session(id: string, date: string, over: Partial<Session> = {}): Session {
  return {
    id,
    date: d(date),
    startedAt: T0,
    finishedAt: T0 + DAY / 24,
    tzOffsetMin: 0,
    status: 'finished',
    routineId: null,
    note: '',
    voidedAt: null,
    editedAt: null,
    createdAt: T0,
    ...over,
  }
}

function item(id: string, sessionId: string, a: Activity, over: Partial<SessionItem> = {}) {
  const row: SessionItem = {
    id,
    sessionId,
    order: 0,
    routineItemId: null,
    adHoc: true,
    activityId: a.id,
    activityName: a.name,
    unitLabel: a.unitLabel,
    blocks: 2,
    blockAmount: a.defaultBlockAmount,
    restMinSec: a.restMinSec,
    restMaxSec: a.restMaxSec,
    optional: false,
    createdAt: T0,
    ...over,
  }
  return row
}

function block(id: string, si: SessionItem, blockIndex: number, amount: number): BlockLog {
  return {
    id,
    sessionId: si.sessionId,
    sessionItemId: si.id,
    activityId: si.activityId,
    blockIndex,
    amount,
    note: '',
    loggedAt: T0 + blockIndex,
    editedAt: null,
    voidedAt: null,
  }
}

/** Two activities, a routine with two items, three sessions (one voided) and five blocks. */
async function addRealisticHistory(c: Pick<ServiceCtx, 'db'>): Promise<void> {
  const study = activity('act-study', 'Study', {
    progression: { stepAmount: 30, everyWeeks: 2, capAmount: 600, startDate: d('2026-11-23') },
  })
  const read = activity('act-read', 'Reading', {
    unitLabel: 'pages',
    defaultBlockAmount: 20,
    restMinSec: 0,
    restMaxSec: 0,
    weeklyTarget: null,
  })
  const s1 = session('ses-1', '2026-11-23', { routineId: 'rt-morning' })
  const s2 = session('ses-2', '2026-11-24')
  const s3 = session('ses-void', '2026-11-24', { voidedAt: T0 + DAY })
  const i1 = item('si-1', s1.id, study, { routineItemId: 'ri-1', adHoc: false, blocks: 4 })
  const i2 = item('si-2', s2.id, read)
  const i3 = item('si-3', s3.id, study)
  await c.db.transaction('rw', [...TABLE_NAMES], async () => {
    await c.db.activities.bulkAdd([study, read])
    await c.db.routines.add({
      id: 'rt-morning',
      name: 'Morning',
      weekday: 1,
      order: 0,
      note: '',
      archivedAt: null,
    })
    await c.db.routineItems.bulkAdd([
      {
        id: 'ri-1',
        routineId: 'rt-morning',
        order: 0,
        activityId: study.id,
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
        activityId: read.id,
        blocks: 1,
        blockAmount: 20,
        restMinSec: 0,
        restMaxSec: 0,
        optional: true,
        note: '',
        archivedAt: null,
      },
    ])
    await c.db.sessions.bulkAdd([s1, s2, s3])
    await c.db.sessionItems.bulkAdd([i1, i2, i3])
    await c.db.blockLogs.bulkAdd([
      block('blk-1', i1, 0, 25),
      block('blk-2', i1, 1, 25),
      block('blk-3', i1, 2, 12.5),
      block('blk-4', i2, 0, 34),
      block('blk-5', i3, 0, 25),
    ])
    await c.db.appState.put({ key: 'lastRoutineId', value: 'rt-morning' })
  })
}

describe('exportBackup', () => {
  it('dumps every table in TABLE_NAMES order with rows sorted by primary key', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    c.setNow(T0 + 4 * DAY)
    const backup = await exportBackup(c, { appVersion: '0.1.0' })
    expect(backup).toMatchObject({
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '0.1.0',
      exportedAt: T0 + 4 * DAY,
    })
    expect(Object.keys(backup.tables)).toEqual([...TABLE_NAMES])
    expect(backup.tables.activities.map((a) => a.id)).toEqual(['act-read', 'act-study'])
    expect(backup.tables.sessions.map((s) => s.id)).toEqual(['ses-1', 'ses-2', 'ses-void'])
  })

  it('gives the same file for the same data', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    const a = serializeBackup(await exportBackup(c, { appVersion: '0.1.0' }))
    const b = serializeBackup(await exportBackup(c, { appVersion: '0.1.0' }))
    expect(a).toBe(b)
    expect(JSON.parse(a)).toEqual(await exportBackup(c, { appVersion: '0.1.0' }))
  })

  it('names the file after the date', () => {
    expect(backupFileName(d('2026-11-25'))).toBe('routine-backup-2026-11-25.json')
  })

  it('refuses to produce a file that import would reject, listing every problem', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    await c.db.blockLogs.update('blk-2', { amount: -5 })
    const e = await expectServiceError(exportBackup(c, { appVersion: '0.1.0' }), 'export_invalid')
    expect(e.message).toBe(
      "1 saved row can't be restored from a backup, so no backup file was made. Nothing was changed.",
    )
    expect(e.detail?.errors).toEqual(['tables.blockLogs[1].amount: expected a value >= 0, got -5'])

    // Once the rows parse, the reference checks run too.
    await c.db.blockLogs.update('blk-2', { amount: 5 })
    await c.db.sessionItems.update('si-2', { sessionId: 'ses-gone' })
    await c.db.routineItems.update('ri-2', { activityId: 'act-gone' })
    const e2 = await expectServiceError(exportBackup(c, { appVersion: '0.1.0' }), 'export_invalid')
    expect(e2.message).toMatch(/^2 saved rows can't be restored/)
    expect(e2.detail?.errors).toEqual([
      'tables.routineItems[1].activityId: no activities row has id "act-gone"',
      'tables.sessionItems[1].sessionId: no sessions row has id "ses-gone"',
    ])
  })
})

describe('importBackup', () => {
  it('backup round-trips: export, wipe, import, every table deep-equal', async () => {
    const source = ctx()
    await addRealisticHistory(source)
    const before = await dumpAll(source)
    const text = serializeBackup(await exportBackup(source, { appVersion: '0.1.0' }))

    // Wipe: a brand-new, empty database stands in for a new phone or cleared site data.
    const target = ctx({ seed: false })
    const result = await importBackup(target, text)

    expect(result.status).toBe('imported')
    // The restore stamps lastBackupAt (the reminder counts from the export); all else is equal.
    const after = await dumpRestorable(target)
    expect(await getBackupReminder(target)).toMatchObject({ due: false })
    for (const name of TABLE_NAMES) {
      expect(before[name]!.length, name).toBeGreaterThan(0)
      expect(after[name], name).toEqual(before[name])
    }
    if (result.status === 'imported') {
      expect(result.counts).toEqual(
        Object.fromEntries(TABLE_NAMES.map((n) => [n, before[n]!.length])),
      )
    }
    const again = JSON.parse(
      serializeBackup(await exportBackup(target, { appVersion: '0.1.0' })),
    ) as Backup
    again.tables.appState = again.tables.appState.filter((r) => r.key !== LAST_BACKUP_AT_KEY)
    expect(again).toEqual(JSON.parse(text))
  })

  it('replaces everything on the device, dropping rows the backup does not have', async () => {
    const source = ctx()
    await addRealisticHistory(source)
    const text = serializeBackup(await exportBackup(source, { appVersion: '0.1.0' }))

    const target = ctx()
    await target.db.activities.add(activity('act-local', 'Guitar'))
    expect(await importBackup(target, text)).toMatchObject({ status: 'imported' })
    expect(await target.db.activities.get('act-local')).toBeUndefined()
    expect(await dumpRestorable(target)).toEqual(await dumpAll(source))
  })

  it('asks before restoring a backup with less history than the device, then restores on confirm', async () => {
    const device = ctx()
    await addRealisticHistory(device)
    const deviceRows = await dumpAll(device)
    const old = ctx() // a backup taken on first launch: nothing yet
    const text = serializeBackup(await exportBackup(old, { appVersion: '0.1.0' }))

    const result = await importBackup(device, text)
    expect(result).toEqual({
      status: 'needs_confirm',
      current: { activities: 2, routines: 1, routineItems: 2, sessions: 3, blockLogs: 5 },
      incoming: { activities: 0, routines: 0, routineItems: 0, sessions: 0, blockLogs: 0 },
      shrinking: ['activities', 'routines', 'routineItems', 'sessions', 'blockLogs'],
    })
    expect(await dumpAll(device)).toEqual(deviceRows)

    expect(await importBackup(device, text, { confirmFewerRows: true })).toMatchObject({
      status: 'imported',
    })
    expect(await historyTotal(device)).toBe(0)
    expect(await dumpRestorable(device)).toEqual(await dumpAll(old))
  })

  it('asks before a backup that would lose one kind of data even if it has more of another', async () => {
    const device = ctx()
    await addRealisticHistory(device)
    const other = ctx()
    for (let i = 0; i < 5; i++) await other.db.activities.add(activity(`act-${i}`, `A${i}`))
    const text = serializeBackup(await exportBackup(other, { appVersion: '0.1.0' }))
    const result = await importBackup(device, text)
    expect(result.status).toBe('needs_confirm')
    if (result.status !== 'needs_confirm') return
    expect(result.shrinking).toEqual(['routines', 'routineItems', 'sessions', 'blockLogs'])
    expect(result.incoming.activities).toBe(5)
  })

  it('rejects text that is not JSON, leaving the data untouched', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    const before = await dumpAll(c)
    const e = await expectServiceError(
      importBackup(c, '{"format": "routine-applet-backup", '),
      'invalid_backup',
    )
    expect(e.message).toMatch(/not valid JSON/)
    expect((e.detail?.errors as string[]).length).toBe(1)
    expect(await dumpAll(c)).toEqual(before)
  })

  it('rejects a file that is not a backup (including a workout-app backup)', async () => {
    const c = ctx()
    const e = await expectServiceError(importBackup(c, '{"hello": "world"}'), 'invalid_backup')
    expect(e.detail?.errors).toEqual([
      expect.stringMatching(/^format: not a Routine Applet backup/),
    ])
    const workout = JSON.stringify({ format: 'exersise-applet-backup', schemaVersion: 5 })
    await expectServiceError(importBackup(c, workout), 'invalid_backup')
  })

  it('lists every invalid row and writes nothing', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    const backup = await exportedJson(c)
    ;(backup.tables.blockLogs[3] as { blockIndex: number }).blockIndex = 2.5
    ;(backup.tables.sessions[1] as { date: string }).date = '2026-02-30'
    backup.tables.sessions.push({ ...backup.tables.sessions[0]! })
    const target = ctx({ seed: false })
    const e = await expectServiceError(
      importBackup(target, JSON.stringify(backup)),
      'invalid_backup',
    )
    expect(e.message).toBe('This backup file has 3 problems and was not restored.')
    expect(e.detail?.errors).toEqual([
      'tables.sessions[1].date: expected a real YYYY-MM-DD date, got "2026-02-30"',
      'tables.blockLogs[3].blockIndex: expected integer, got 2.5',
      'tables.sessions[3].id: duplicate id "ses-1" (also at [0])',
    ])
    expect(await historyTotal(target)).toBe(0)
  })

  it('refuses a backup from a newer version of the app', async () => {
    const c = ctx()
    const backup = JSON.parse(serializeBackup(await exportBackup(c, { appVersion: '9.0.0' })))
    backup.schemaVersion = BACKUP_SCHEMA_VERSION + 1
    const e = await expectServiceError(importBackup(c, JSON.stringify(backup)), 'newer_version')
    expect(e.message).toMatch(/newer version of the app/)
    expect(e.detail).toEqual({
      version: BACKUP_SCHEMA_VERSION + 1,
      currentVersion: BACKUP_SCHEMA_VERSION,
    })
  })

  it('rejects a backup without the settings row', async () => {
    const c = ctx({ seed: false })
    const b = await exportedJson(ctx())
    b.tables.settings = []
    const e = await expectServiceError(importBackup(c, JSON.stringify(b)), 'invalid_backup')
    expect(e.detail?.errors).toEqual(['tables.settings: expected exactly 1 settings row, got 0'])
  })

  it('rejects broken references, listing each, and writes nothing', async () => {
    const source = ctx()
    await addRealisticHistory(source)
    const b = await exportedJson(source)
    b.tables.activities = b.tables.activities.filter((a) => a.id !== 'act-study')
    b.tables.routines = []
    const c = ctx({ seed: false })
    const e = await expectServiceError(importBackup(c, JSON.stringify(b)), 'invalid_backup')
    expect(e.detail?.errors).toEqual([
      'tables.routineItems[0].routineId: no routines row has id "rt-morning"',
      'tables.routineItems[0].activityId: no activities row has id "act-study"',
      'tables.routineItems[1].routineId: no routines row has id "rt-morning"',
      'tables.sessions[0].routineId: no routines row has id "rt-morning"',
      'tables.sessionItems[0].activityId: no activities row has id "act-study"',
      'tables.sessionItems[2].activityId: no activities row has id "act-study"',
      'tables.blockLogs[0].activityId: no activities row has id "act-study"',
      'tables.blockLogs[1].activityId: no activities row has id "act-study"',
      'tables.blockLogs[2].activityId: no activities row has id "act-study"',
      'tables.blockLogs[4].activityId: no activities row has id "act-study"',
    ])
    expect(await c.db.settings.count()).toBe(0) // nothing written
  })

  it('starts the backup reminder from when the restored file was made', async () => {
    const source = ctx()
    await addRealisticHistory(source)
    const exportedAt = source.now()
    const text = serializeBackup(await exportBackup(source, { appVersion: '0.1.0' }))
    const target = ctx({ seed: false })
    await importBackup(target, text)
    expect(await getBackupReminder(target)).toMatchObject({ lastBackupAt: exportedAt, due: false })
  })

  it('leaves the existing data untouched when the write fails part-way', async () => {
    const source = ctx()
    await addRealisticHistory(source)
    const text = serializeBackup(await exportBackup(source, { appVersion: '0.1.0' }))

    const target = ctx()
    await target.db.activities.add(activity('act-precious', 'Guitar'))
    const before = await dumpAll(target)
    // Every table has been cleared and most refilled by the time blockLogs fails. (Dexie keeps
    // separate Table objects for `db.blockLogs` and `db.table('blockLogs')`; patch the class.)
    const proto = target.db.Table.prototype as Table
    const realBulkAdd = proto.bulkAdd
    const failedTables: string[] = []
    vi.spyOn(proto, 'bulkAdd').mockImplementation(function (this: Table, ...args) {
      if (this.name === 'blockLogs') {
        failedTables.push(this.name)
        throw new Error('QuotaExceededError: disk full')
      }
      return realBulkAdd.apply(this, args)
    })

    const e = await expectServiceError(importBackup(target, text), 'restore_failed')
    expect(failedTables).toEqual(['blockLogs'])
    expect(e.message).toMatch(/nothing was changed/)
    expect(e.detail?.cause).toMatch(/disk full/)
    vi.restoreAllMocks()
    expect(await dumpAll(target)).toEqual(before)
  })
})

describe('backup reminder', () => {
  it('is quiet on a fresh install with nothing to lose', async () => {
    const c = ctx()
    expect(await getBackupReminder(c)).toEqual({ lastBackupAt: null, daysSince: null, due: false })
  })

  it('is due once there is data and no backup yet, and again after backupReminderDays', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    expect(await getBackupReminder(c)).toMatchObject({ lastBackupAt: null, due: true })

    await markBackupSaved(c)
    expect(await getBackupReminder(c)).toEqual({ lastBackupAt: T0, daysSince: 0, due: false })

    c.advance(6 * DAY)
    expect(await getBackupReminder(c)).toMatchObject({ daysSince: 6, due: false })
    c.advance(DAY)
    expect(await getBackupReminder(c)).toMatchObject({ daysSince: 7, due: true })
  })

  it('reads the database only', async () => {
    const c = ctx()
    await c.db.transaction('r', [...TABLE_NAMES], () => getBackupReminder(c))
  })
})
