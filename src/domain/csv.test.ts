import { describe, expect, it } from 'vitest'
import { BLOCKS_CSV_HEADER, blocksCsv, csvFileName, toCsv, type BlocksCsvInput } from './csv'
import type { BlockLog, LocalDate, Routine, Session, SessionItem } from './types'

// ── A strict RFC 4180 reader, so tests check what a spreadsheet would actually see ──

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (c === '"') {
      if (field !== '') throw new Error(`quote inside unquoted field at ${i}`)
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else if (c === '\r' || c === '\n') {
      throw new Error(`bare line break outside quotes at ${i}`)
    } else field += c
  }
  if (quoted) throw new Error('unterminated quoted field')
  if (field !== '' || row.length > 0) throw new Error('last record is not terminated by CRLF')
  return rows
}

function records(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text)
  return rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i]!])))
}

/** Recursively freeze a fixture so any mutation by the code under test throws (strict mode). */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const v of Object.values(value)) deepFreeze(v, seen)
  return Object.freeze(value)
}

// ── Fixture: a routine run, an ad hoc session and a voided one ───────────────

const d = (s: string) => s as LocalDate
const at = (date: string, hh: number, mm = 0) => {
  const [y, m, day] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, day, hh, mm)
}

function session(p: Pick<Session, 'id' | 'date' | 'startedAt'> & Partial<Session>): Session {
  return {
    finishedAt: p.startedAt + 3_600_000,
    tzOffsetMin: 0,
    status: 'finished',
    source: 'logger',
    routineId: null,
    note: '',
    voidedAt: null,
    editedAt: null,
    createdAt: p.startedAt,
    ...p,
  }
}

function item(
  p: Pick<SessionItem, 'id' | 'sessionId' | 'order' | 'activityId' | 'activityName'> &
    Partial<SessionItem>,
): SessionItem {
  return {
    routineItemId: null,
    adHoc: false,
    unitLabel: 'min',
    blocks: 4,
    blockAmount: 25,
    optional: false,
    restMinSec: 300,
    restMaxSec: 300,
    createdAt: 0,
    ...p,
  }
}

function block(
  p: Pick<BlockLog, 'id' | 'sessionId' | 'sessionItemId' | 'activityId' | 'blockIndex' | 'amount'> &
    Partial<BlockLog>,
): BlockLog {
  return { note: '', loggedAt: 0, editedAt: null, voidedAt: null, ...p }
}

const routines: Routine[] = [
  { id: 'r-study', name: 'Study, morning', weekday: 1, order: 0, note: '', archivedAt: null },
]

const input: BlocksCsvInput = deepFreeze({
  routines,
  sessions: [
    session({ id: 's-tue', date: d('2026-11-24'), startedAt: at('2026-11-24', 8) }),
    session({
      id: 's-mon',
      date: d('2026-11-23'),
      startedAt: at('2026-11-23', 9),
      routineId: 'r-study',
    }),
    session({ id: 's-void', date: d('2026-11-23'), startedAt: at('2026-11-23', 20), voidedAt: 1 }),
  ],
  sessionItems: [
    item({
      id: 'i-study',
      sessionId: 's-mon',
      order: 0,
      activityId: 'a-study',
      activityName: 'Study',
    }),
    item({
      id: 'i-read',
      sessionId: 's-mon',
      order: 1,
      activityId: 'a-read',
      activityName: 'Reading',
      unitLabel: 'pages',
      blockAmount: 20,
      optional: true,
    }),
    item({
      id: 'i-walk',
      sessionId: 's-tue',
      order: 0,
      activityId: 'a-walk',
      activityName: '=Walk, outside',
      unitLabel: 'km',
      adHoc: true,
    }),
  ],
  blockLogs: [
    block({
      id: 'b3',
      sessionId: 's-mon',
      sessionItemId: 'i-read',
      activityId: 'a-read',
      blockIndex: 0,
      amount: 18,
      note: 'slow "chapter"',
    }),
    block({
      id: 'b2',
      sessionId: 's-mon',
      sessionItemId: 'i-study',
      activityId: 'a-study',
      blockIndex: 1,
      amount: 20,
    }),
    block({
      id: 'b1',
      sessionId: 's-mon',
      sessionItemId: 'i-study',
      activityId: 'a-study',
      blockIndex: 0,
      amount: 25,
    }),
    block({
      id: 'bv',
      sessionId: 's-mon',
      sessionItemId: 'i-study',
      activityId: 'a-study',
      blockIndex: 2,
      amount: 25,
      voidedAt: 5,
    }),
    block({
      id: 'b4',
      sessionId: 's-tue',
      sessionItemId: 'i-walk',
      activityId: 'a-walk',
      blockIndex: 0,
      amount: 2.5,
    }),
    block({
      id: 'b5',
      sessionId: 's-void',
      sessionItemId: 'x',
      activityId: 'a-study',
      blockIndex: 0,
      amount: 25,
    }),
  ],
})

// ── toCsv ────────────────────────────────────────────────────────────────────

describe('toCsv', () => {
  it('writes a header and rows with CRLF after every record', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          [1, 'x'],
          [2, 'y'],
        ],
      ),
    ).toBe('a,b\r\n1,x\r\n2,y\r\n')
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n')
  })

  it('quotes fields containing a comma, quote, CR or LF and doubles inner quotes', () => {
    expect(
      toCsv(['c'], [['a,b'], ['say "hi"'], ['line1\nline2'], ['cr\rhere'], ['crlf\r\nx']]),
    ).toBe('c\r\n"a,b"\r\n"say ""hi"""\r\n"line1\nline2"\r\n"cr\rhere"\r\n"crlf\r\nx"\r\n')
    expect(toCsv(['c'], [[' padded '], ["it's"]])).toBe("c\r\n padded \r\nit's\r\n")
  })

  it('writes null and empty strings as empty cells and booleans as true/false', () => {
    expect(toCsv(['a', 'b', 'c', 'd'], [[null, '', true, false]])).toBe(
      'a,b,c,d\r\n,,true,false\r\n',
    )
  })

  it('prints numbers as plain decimals without float noise or locale grouping', () => {
    const cells = [
      37.5,
      0.1 + 0.2,
      220,
      -20,
      1234567.5,
      1 / 3,
      2 / 3,
      220.46226218,
      -0,
      1e-7,
      -1e-9,
      0.000001,
    ]
    expect(
      toCsv(
        cells.map((_, i) => `n${i}`),
        [cells],
      ).split('\r\n')[1],
    ).toBe('37.5,0.3,220,-20,1234567.5,0.333333,0.666667,220.462262,0,0,0,0.000001')
  })

  it('writes non-finite numbers as empty cells', () => {
    expect(toCsv(['a', 'b', 'c'], [[Number.NaN, Infinity, -Infinity]])).toBe('a,b,c\r\n,,\r\n')
  })

  it('guards text cells that start like a formula, but never numbers', () => {
    const texts = ['=1+1', '+1', '-1', '@x', '\tx', 'a=b', 'safe']
    expect(
      parseCsv(
        toCsv(
          ['t'],
          texts.map((t) => [t]),
        ),
      )
        .slice(1)
        .flat(),
    ).toEqual(["'=1+1", "'+1", "'-1", "'@x", "'\tx", 'a=b', 'safe'])
    expect(toCsv(['n', 't'], [[-1, '-1']])).toBe("n,t\r\n-1,'-1\r\n")
  })

  it('guards before quoting, so a guarded cell with a comma or CR is still quoted', () => {
    expect(toCsv(['t'], [['=A1,B1'], ['\rx'], ['=say "x"']])).toBe(
      't\r\n"\'=A1,B1"\r\n"\'\rx"\r\n"\'=say ""x"""\r\n',
    )
  })

  it('adds a UTF-8 BOM only when asked', () => {
    expect(toCsv(['a'], [['é']], { bom: true })).toBe('\uFEFFa\r\né\r\n')
    expect(toCsv(['a'], [['é']], { bom: false }).startsWith('a')).toBe(true)
  })

  it('rejects rows whose width differs from the header', () => {
    expect(() => toCsv(['a', 'b'], [[1, 2], [1]])).toThrow(RangeError)
    expect(() => toCsv(['a'], [[1, 2]])).toThrow(/row 0 has 2 cells but the header has 1/)
  })
})

// ── blocksCsv ────────────────────────────────────────────────────────────────

describe('blocksCsv', () => {
  const text = blocksCsv(input)
  const rows = records(text)

  it('has the documented columns', () => {
    expect(parseCsv(text)[0]).toEqual([...BLOCKS_CSV_HEADER])
  })

  it('writes every live block in session order, leaving voided blocks and sessions out', () => {
    expect(rows.map((r) => [r.date, r.activity, r.block_index, r.amount])).toEqual([
      ['2026-11-23', 'Study', '0', '25'],
      ['2026-11-23', 'Study', '1', '20'],
      ['2026-11-23', 'Reading', '0', '18'],
      ['2026-11-24', "'=Walk, outside", '0', '2.5'],
    ])
  })

  it('writes the routine, unit, planned amount, optional flag and note', () => {
    expect(rows[2]).toMatchObject({
      routine: 'Study, morning',
      unit: 'pages',
      planned_amount: '20',
      optional: 'true',
      note: 'slow "chapter"',
      session_status: 'finished',
    })
    expect(rows[3]).toMatchObject({ routine: '', unit: 'km', planned_amount: '25' })
    expect(text).toContain('"slow ""chapter"""')
  })

  it('names the file by kind and date', () => {
    expect(csvFileName('blocks', d('2026-11-25'))).toBe('routine-blocks-2026-11-25.csv')
  })
})
