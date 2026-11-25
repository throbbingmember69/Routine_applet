import { afterEach, describe, expect, it } from 'vitest'
import { BLOCKS_CSV_HEADER } from '@/domain/csv'
import type { LocalDate } from '@/domain/types'
import { createTestCtx, today } from '../context'
import { exportCsv } from './csvExport'

const ctxs: ReturnType<typeof createTestCtx>[] = []
function ctx() {
  const c = createTestCtx()
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

const d = (s: string) => s as LocalDate
const BOM = '\uFEFF'
const T0 = Date.UTC(2026, 10, 23, 17)

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF records. */
function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\r' && text[i + 1] === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
      i++
    } else field += ch
  }
  expect(field, 'every record ends in CRLF').toBe('')
  const [header, ...rows] = records
  return rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i]!])))
}

async function logSomeBlocks(c: ReturnType<typeof ctx>) {
  await c.db.transaction(
    'rw',
    [c.db.routines, c.db.sessions, c.db.sessionItems, c.db.blockLogs],
    async () => {
      await c.db.routines.add({
        id: 'rt-1',
        name: 'Morning',
        weekday: null,
        order: 0,
        note: '',
        archivedAt: null,
      })
      for (const [id, date, voidedAt] of [
        ['ses-1', '2026-11-23', null],
        ['ses-void', '2026-11-24', T0],
      ] as const) {
        await c.db.sessions.add({
          id,
          date: d(date),
          startedAt: T0,
          finishedAt: T0,
          tzOffsetMin: 0,
          status: 'finished',
          source: 'logger',
          routineId: 'rt-1',
          note: '',
          voidedAt,
          editedAt: null,
          createdAt: T0,
        })
        await c.db.sessionItems.add({
          id: `${id}-item`,
          sessionId: id,
          order: 0,
          routineItemId: null,
          adHoc: false,
          activityId: 'act-study',
          activityName: 'Study',
          unitLabel: 'min',
          blocks: 2,
          blockAmount: 25,
          restMinSec: 300,
          restMaxSec: 300,
          optional: false,
          createdAt: T0,
        })
      }
      for (const [i, amount, voidedAt] of [
        [0, 25, null],
        [1, 12.5, null],
        [2, 25, T0],
      ] as const) {
        await c.db.blockLogs.add({
          id: `blk-${i}`,
          sessionId: 'ses-1',
          sessionItemId: 'ses-1-item',
          activityId: 'act-study',
          blockIndex: i,
          amount,
          note: i === 1 ? 'phone, "again"' : '',
          loggedAt: T0 + i,
          editedAt: null,
          voidedAt,
        })
      }
      await c.db.blockLogs.add({
        id: 'blk-void-session',
        sessionId: 'ses-void',
        sessionItemId: 'ses-void-item',
        activityId: 'act-study',
        blockIndex: 0,
        amount: 25,
        note: '',
        loggedAt: T0,
        editedAt: null,
        voidedAt: null,
      })
    },
  )
}

describe('exportCsv: blocks', () => {
  it('exports every live block with date, routine, activity, unit and amount', async () => {
    const c = ctx()
    await logSomeBlocks(c)
    const file = await exportCsv(c, 'blocks', { today: d('2026-11-25') })
    expect(file.fileName).toBe('routine-blocks-2026-11-25.csv')
    expect(file.mimeType).toBe('text/csv')
    expect(file.text.startsWith(BOM)).toBe(true)
    expect(file.text.slice(1).split('\r\n')[0]).toBe(BLOCKS_CSV_HEADER.join(','))
    const rows = parseCsv(file.text.slice(1))
    expect(
      rows.map((r) => [r.date, r.routine, r.activity, r.unit, r.block_index, r.amount, r.note]),
    ).toEqual([
      ['2026-11-23', 'Morning', 'Study', 'min', '0', '25', ''],
      ['2026-11-23', 'Morning', 'Study', 'min', '1', '12.5', 'phone, "again"'],
    ])
  })

  it('uses the current date for the file name by default', async () => {
    const c = ctx()
    const file = await exportCsv(c, 'blocks')
    expect(file.fileName).toBe(`routine-blocks-${today(c)}.csv`)
    expect(parseCsv(file.text.slice(1))).toEqual([])
  })
})
