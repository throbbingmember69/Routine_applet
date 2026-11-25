// The JSON backup file: every table dumped as an array of rows, plus a format marker and a schema
// version. Restore validates the whole file before anything is written: the format marker first,
// then the version (a newer one is refused), then every row against its types.ts entity. Row
// schemas are checked against types.ts at compile time (RowSchemasMatchEntities), so a contract
// change that isn't mirrored here fails `npm run typecheck`.
//
// Unknown object keys are dropped rather than rejected, and so are unknown settings keys (the
// registry ignores them anyway), so a backup stays restorable after a setting is retired.
import * as z from 'zod/mini'
import { isLocalDate } from '@/domain/dates'
import { isSettingKey } from '@/domain/settings/registry'
import type {
  Activity,
  AppStateRow,
  BlockLog,
  EpochMs,
  LocalDate,
  Routine,
  RoutineItem,
  Session,
  SessionItem,
  SettingKey,
  SettingsRow,
} from '@/domain/types'

export const BACKUP_FORMAT = 'routine-applet-backup'
/** Schema 1: the first version. Older files would be migrated on import. */
export const BACKUP_SCHEMA_VERSION = 1

/** Every persisted table. This list is the Dexie table-name contract. */
export const TABLE_NAMES = [
  'settings',
  'appState',
  'activities',
  'routines',
  'routineItems',
  'sessions',
  'sessionItems',
  'blockLogs',
] as const

export type TableName = (typeof TABLE_NAMES)[number]

/** The row type each table stores. */
export interface TableRows {
  settings: SettingsRow
  appState: AppStateRow
  activities: Activity
  routines: Routine
  routineItems: RoutineItem
  sessions: Session
  sessionItems: SessionItem
  blockLogs: BlockLog
}

export type BackupTables = { [K in TableName]: TableRows[K][] }

export interface Backup {
  format: typeof BACKUP_FORMAT
  schemaVersion: typeof BACKUP_SCHEMA_VERSION
  appVersion: string
  exportedAt: EpochMs
  tables: BackupTables
}

export type ParseBackupResult = { ok: true; backup: Backup } | { ok: false; errors: string[] }

// ── Field schemas ────────────────────────────────────────────────────────────
// z.number() already rejects NaN and ±Infinity.

const id = z.string().check(z.minLength(1))
const text = z.string()
const bool = z.boolean()
const num = z.number()
const nonNegative = z.number().check(z.nonnegative())
const positive = z.number().check(z.positive())
const count = z.int().check(z.nonnegative())
const epochMs = z.int().check(z.nonnegative())
const localDate = z.custom<LocalDate>((v) => typeof v === 'string' && isLocalDate(v), {
  error: (issue) => expectation('a real YYYY-MM-DD date', issue.input),
})
const weekday = z.literal([0, 1, 2, 3, 4, 5, 6])
const restShape = { restMinSec: count, restMaxSec: count }

// ── Row schemas (one per types.ts entity) ────────────────────────────────────

const settingsRow = z.object({
  id: z.literal('singleton'),
  values: z.pipe(z.record(z.string(), num), z.transform(knownSettings)),
  updatedAt: epochMs,
})

function knownSettings(values: Record<string, number>): Partial<Record<SettingKey, number>> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => isSettingKey(key)))
}

// JSON drops `value: undefined`, so a missing value is accepted and restored as undefined.
const appStateRow = z.pipe(
  z.object({ key: id, value: z.optional(z.unknown()) }),
  z.transform(({ key, value }): AppStateRow => ({ key, value })),
)

const activityRow = z.object({
  ...restShape,
  id,
  name: text,
  unitLabel: text,
  defaultBlockAmount: positive,
  weeklyTarget: z.nullable(nonNegative),
  progression: z.nullable(
    z.object({
      stepAmount: positive,
      everyWeeks: z.int().check(z.positive()),
      capAmount: nonNegative,
      startDate: localDate,
    }),
  ),
  notes: text,
  archivedAt: z.nullable(epochMs),
  createdAt: epochMs,
  updatedAt: epochMs,
})

const routineRow = z.object({
  id,
  name: text,
  weekday: z.nullable(weekday),
  order: num,
  note: text,
  archivedAt: z.nullable(epochMs),
})

const routineItemRow = z.object({
  ...restShape,
  id,
  routineId: id,
  order: num,
  activityId: id,
  blocks: z.int().check(z.positive()),
  blockAmount: positive,
  optional: bool,
  note: text,
  archivedAt: z.nullable(epochMs),
})

const sessionRow = z.object({
  id,
  date: localDate,
  startedAt: epochMs,
  finishedAt: z.nullable(epochMs),
  tzOffsetMin: z.int(),
  status: z.enum(['in_progress', 'finished', 'abandoned']),
  routineId: z.nullable(id),
  note: text,
  voidedAt: z.nullable(epochMs),
  editedAt: z.nullable(epochMs),
  createdAt: epochMs,
})

const sessionItemRow = z.object({
  ...restShape,
  id,
  sessionId: id,
  order: num,
  routineItemId: z.nullable(id),
  adHoc: bool,
  activityId: id,
  activityName: text,
  unitLabel: text,
  blocks: z.int().check(z.positive()),
  blockAmount: positive,
  optional: bool,
  createdAt: epochMs,
})

const blockLogRow = z.object({
  id,
  sessionId: id,
  sessionItemId: id,
  activityId: id,
  blockIndex: count,
  amount: nonNegative,
  note: text,
  loggedAt: epochMs,
  editedAt: z.nullable(epochMs),
  voidedAt: z.nullable(epochMs),
})

/** Row schema per table (e.g. for migrations that need to validate one table). */
export const rowSchemas = {
  settings: settingsRow,
  appState: appStateRow,
  activities: activityRow,
  routines: routineRow,
  routineItems: routineItemRow,
  sessions: sessionRow,
  sessionItems: sessionItemRow,
  blockLogs: blockLogRow,
} as const

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type AssertAllTrue<T extends Record<string, true>> = T

/**
 * Makes every nested property required, so mutual assignability also notices an optional field
 * that exists on one side only (plain assignability ignores a missing optional property).
 */
type DeepRequired<T> = T extends readonly (infer U)[]
  ? DeepRequired<U>[]
  : T extends string | number | boolean | bigint | symbol | null | undefined
    ? T
    : T extends object
      ? { [K in keyof T]-?: DeepRequired<T[K]> }
      : T

type SameShape<A, B> =
  MutuallyAssignable<A, B> extends true
    ? MutuallyAssignable<DeepRequired<A>, DeepRequired<B>>
    : false

/**
 * Compile-time guard, never used at runtime: fails typecheck when a row schema and its types.ts
 * entity drift apart in either direction (a field, optional field, enum member or nullability
 * added or removed, at any depth), or when TABLE_NAMES, TableRows and rowSchemas list different
 * tables.
 */
export type RowSchemasMatchEntities = AssertAllTrue<
  { [K in TableName]: SameShape<z.output<(typeof rowSchemas)[K]>, TableRows[K]> } & {
    tableNames: MutuallyAssignable<TableName, keyof TableRows>
    rowSchemaNames: MutuallyAssignable<TableName, keyof typeof rowSchemas>
  }
>

/** Primary key of each table (a duplicate would abort the restore). */
export const PRIMARY_KEYS = {
  settings: 'id',
  appState: 'key',
  activities: 'id',
  routines: 'id',
  routineItems: 'id',
  sessions: 'id',
  sessionItems: 'id',
  blockLogs: 'id',
} as const satisfies { [K in TableName]: keyof TableRows[K] & string }

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  appVersion: z.string(),
  exportedAt: epochMs,
  tables: z.object({
    settings: z.array(settingsRow),
    appState: z.array(appStateRow),
    activities: z.array(activityRow),
    routines: z.array(routineRow),
    routineItems: z.array(routineItemRow),
    sessions: z.array(sessionRow),
    sessionItems: z.array(sessionItemRow),
    blockLogs: z.array(blockLogRow),
  }),
})

/**
 * Validate an already-parsed backup file. Errors name the path and the problem, one per issue,
 * e.g. "tables.blockLogs[3].amount: expected a value >= 0, got -1". A file that isn't a backup, or that
 * comes from a newer schema version, gets a single explanatory error.
 */
export function parseBackup(json: unknown): ParseBackupResult {
  const headerError = checkHeader(json)
  if (headerError) return { ok: false, errors: [headerError] }
  const result = backupSchema.safeParse(json, { reportInput: true })
  // Scanned on the raw input, so duplicates are reported in the same pass as invalid rows.
  const duplicates = duplicateKeyErrors(json)
  if (!result.success || duplicates.length > 0) {
    const issues = result.success ? [] : result.error.issues.map(formatIssue)
    return { ok: false, errors: [...issues, ...duplicates] }
  }
  return { ok: true, backup: result.data }
}

function duplicateKeyErrors(json: unknown): string[] {
  if (typeof json !== 'object' || json === null) return []
  const tables = (json as Record<string, unknown>).tables
  if (typeof tables !== 'object' || tables === null) return []
  const errors: string[] = []
  for (const name of TABLE_NAMES) {
    const rows = (tables as Record<string, unknown>)[name]
    if (!Array.isArray(rows)) continue
    const primaryKey = PRIMARY_KEYS[name]
    const firstIndex = new Map<unknown, number>()
    rows.forEach((row: unknown, i) => {
      if (typeof row !== 'object' || row === null) return
      const key = (row as Record<string, unknown>)[primaryKey]
      if (key === undefined) return
      const first = firstIndex.get(key)
      if (first === undefined) firstIndex.set(key, i)
      else {
        errors.push(
          `${formatPath(['tables', name, i, primaryKey])}: duplicate ${primaryKey} ${describeValue(key)} (also at [${first}])`,
        )
      }
    })
  }
  return errors
}

function checkHeader(json: unknown): string | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const { format, schemaVersion } = json as Record<string, unknown>
  if (format !== BACKUP_FORMAT) {
    return `format: not a Routine Applet backup; ${expectation(describeValue(BACKUP_FORMAT), format)}`
  }
  if (typeof schemaVersion === 'number' && schemaVersion > BACKUP_SCHEMA_VERSION) {
    return (
      `schemaVersion: this backup was made by a newer version of the app (schema ${schemaVersion}; ` +
      `this app reads schema ${BACKUP_SCHEMA_VERSION}). Update the app, then restore.`
    )
  }
  return null
}

// ── Error messages ───────────────────────────────────────────────────────────

const TYPE_LABELS: Readonly<Record<string, string>> = { int: 'integer', record: 'object' }

function formatIssue(issue: z.core.$ZodIssue): string {
  return `${formatPath(issue.path)}: ${describeIssue(issue)}`
}

function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return expectation(TYPE_LABELS[issue.expected] ?? issue.expected, issue.input)
    case 'invalid_value': {
      const values = issue.values.map(describeValue)
      return expectation(
        values.length === 1 ? values[0]! : `one of ${values.join(', ')}`,
        issue.input,
      )
    }
    case 'too_small':
      if (issue.origin === 'string') return 'must not be empty'
      return expectation(`a value ${issue.inclusive ? '>=' : '>'} ${issue.minimum}`, issue.input)
    case 'too_big':
      return expectation(`a value ${issue.inclusive ? '<=' : '<'} ${issue.maximum}`, issue.input)
    default:
      return issue.message
  }
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const MAX_SHOWN_CHARS = 40

/** ['tables', 'blockLogs', 3, 'amount'] → "tables.blockLogs[3].amount"; the root is "backup". */
function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return 'backup'
  return path
    .map((seg, i) => {
      if (typeof seg === 'number') return `[${seg}]`
      if (typeof seg === 'symbol') return `[${String(seg)}]`
      if (!IDENTIFIER.test(seg)) return `[${JSON.stringify(seg)}]`
      return i === 0 ? seg : `.${seg}`
    })
    .join('')
}

function expectation(expected: string, input: unknown): string {
  return input === undefined
    ? `expected ${expected} (missing)`
    : `expected ${expected}, got ${describeValue(input)}`
}

function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  switch (typeof value) {
    case 'string': {
      const shown = value.length > MAX_SHOWN_CHARS ? `${value.slice(0, MAX_SHOWN_CHARS)}…` : value
      return JSON.stringify(shown)
    }
    case 'object':
      return 'an object'
    case 'number':
    case 'boolean':
      return String(value)
    default:
      return typeof value
  }
}
