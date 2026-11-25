// CSV export of every logged block.
//
// Format is RFC 4180 with CRLF line endings. Dates are ISO `YYYY-MM-DD`; voided rows are left out.
// Numbers print as plain decimals (no locale, float noise rounded away at 6 decimals). Text cells a
// spreadsheet would run as a formula get a leading apostrophe; numbers are never guarded.
import { roundHalfAway } from './rounding'
import type { BlockLog, EpochMs, LocalDate, Routine, Session, SessionItem } from './types'

export type CsvCell = string | number | boolean | null
export type CsvKind = 'blocks'

export interface CsvOptions {
  /** Prefix a UTF-8 byte-order mark (helps Excel detect the encoding). Default false. */
  bom?: boolean
}

export const BLOCKS_CSV_HEADER = [
  'date',
  'session_id',
  'session_status',
  'routine',
  'activity',
  'activity_id',
  'unit',
  'block_index',
  'amount',
  'planned_amount',
  'optional',
  'note',
] as const

const EOL = '\r\n'
const BOM = '﻿'
/** Hides binary noise such as 0.1 + 0.2. */
const NUMBER_DECIMALS = 6
const NEEDS_QUOTES = /[",\r\n]/
const FORMULA_START = /^[=+\-@\t\r]/

/** RFC 4180 text from a header and rows of cells; throws if a row's width differs. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvCell[])[],
  options: CsvOptions = {},
): string {
  const lines = [header.map(formatCell).join(',')]
  rows.forEach((row, i) => {
    if (row.length !== header.length) {
      throw new RangeError(
        `CSV row ${i} has ${row.length} cells but the header has ${header.length}`,
      )
    }
    lines.push(row.map(formatCell).join(','))
  })
  return (options.bom ? BOM : '') + lines.join(EOL) + EOL
}

export interface BlocksCsvInput {
  sessions: readonly Session[]
  sessionItems: readonly SessionItem[]
  blockLogs: readonly BlockLog[]
  routines: readonly Routine[]
}

/**
 * One row per logged block, in session order. Voided blocks and every block of a voided session
 * are excluded; in-progress and abandoned sessions are included (see session_status). A block
 * whose parent rows are missing is still exported, with those columns blank.
 */
export function blocksCsv(input: BlocksCsvInput, options?: CsvOptions): string {
  const sessions = indexById(input.sessions)
  const items = indexById(input.sessionItems)
  const routineNames = new Map(input.routines.map((r) => [r.id, r.name]))
  const rows = input.blockLogs
    .filter(isLive)
    .map((block) => ({
      block,
      session: sessions.get(block.sessionId),
      item: items.get(block.sessionItemId),
    }))
    .filter(({ session }) => session === undefined || isLive(session))
    .map((r) => ({ ...r, key: sortKey(r.block, r.session, r.item) }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map(({ block, session, item }): CsvCell[] => [
      session?.date ?? null,
      block.sessionId,
      session?.status ?? null,
      session?.routineId ? (routineNames.get(session.routineId) ?? session.routineId) : null,
      item?.activityName ?? null,
      block.activityId,
      item?.unitLabel ?? null,
      block.blockIndex,
      block.amount,
      item?.blockAmount ?? null,
      item?.optional ?? null,
      block.note,
    ])
  return toCsv(BLOCKS_CSV_HEADER, rows, options)
}

/** Download name for an export, e.g. `routine-blocks-2026-11-25.csv`. */
export function csvFileName(kind: CsvKind, date: LocalDate): string {
  return `routine-${kind}-${date}.csv`
}

function formatCell(cell: CsvCell): string {
  if (cell === null) return ''
  if (typeof cell === 'boolean') return cell ? 'true' : 'false'
  if (typeof cell === 'number') return formatNumber(cell)
  const text = FORMULA_START.test(cell) ? `'${cell}` : cell
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function formatNumber(x: number): string {
  // Non-finite values can't come from valid data; a blank cell beats failing the whole export.
  if (!Number.isFinite(x)) return ''
  // String() never uses locale grouping and prints -0 as "0".
  return String(roundHalfAway(x, NUMBER_DECIMALS))
}

function isLive(row: { voidedAt: EpochMs | null }): boolean {
  return row.voidedAt == null
}

function indexById<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]))
}

type SortKey = readonly (string | number)[]

/** Date, session start, item order, block index; ids break ties. Orphans sort last. */
function sortKey(
  block: BlockLog,
  session: Session | undefined,
  item: SessionItem | undefined,
): SortKey {
  return [
    session ? 0 : 1,
    session?.date ?? '',
    session?.startedAt ?? 0,
    block.sessionId,
    item?.order ?? Number.MAX_SAFE_INTEGER,
    block.sessionItemId,
    block.blockIndex,
    block.loggedAt,
    block.id,
  ]
}

function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}
