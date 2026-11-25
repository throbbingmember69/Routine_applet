// The CSV export of logged blocks, read from the database and formatted by domain/csv.ts: ISO
// dates, voided rows left out. Files start with a UTF-8 byte-order mark so spreadsheet apps pick
// the right encoding.
import { blocksCsv, csvFileName, type CsvKind } from '@/domain/csv'
import type { LocalDate } from '@/domain/types'
import { today, type ServiceCtx } from '../context'

export type { CsvKind }

export const CSV_KINDS: readonly CsvKind[] = ['blocks']

export interface CsvExport {
  fileName: string
  mimeType: 'text/csv'
  text: string
}

export async function exportCsv(
  ctx: Pick<ServiceCtx, 'db' | 'now'>,
  kind: CsvKind,
  opts: { today?: LocalDate } = {},
): Promise<CsvExport> {
  return {
    fileName: csvFileName(kind, opts.today ?? today(ctx)),
    mimeType: 'text/csv',
    text: await csvText(ctx, kind),
  }
}

async function csvText(ctx: Pick<ServiceCtx, 'db'>, kind: CsvKind): Promise<string> {
  const { db } = ctx
  switch (kind) {
    case 'blocks': {
      const input = await db.transaction(
        'r',
        [db.sessions, db.sessionItems, db.blockLogs, db.routines],
        async () => ({
          sessions: await db.sessions.toArray(),
          sessionItems: await db.sessionItems.toArray(),
          blockLogs: await db.blockLogs.toArray(),
          routines: await db.routines.toArray(),
        }),
      )
      return blocksCsv(input, { bom: true })
    }
  }
}
