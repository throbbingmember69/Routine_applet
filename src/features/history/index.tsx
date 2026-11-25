import { useLive } from '@/app/hooks'
import { listHistory } from '@/services/sessions/queries'
import { formatAmount, formatDate } from '@/ui/format'
import { Badge, EmptyState, LinkList, LinkRow, PageHeader, Stack } from '@/ui/kit'
import Spinner from '@/ui/Spinner'

export default function History() {
  const { data: rows } = useLive((ctx) => listHistory(ctx), [])
  if (!rows) return <Spinner />
  return (
    <>
      <PageHeader title="History" />
      <Stack>
        {rows.length === 0 ? (
          <EmptyState title="Nothing logged yet">
            Finished sessions and quick logs show up here.
          </EmptyState>
        ) : (
          <LinkList>
            {rows.map((r) => (
              <LinkRow
                key={r.id}
                to={`/history/${r.id}`}
                label={
                  <>
                    {formatDate(r.date)} · {r.routineName ?? (r.quickLog ? 'Quick log' : 'Session')}
                  </>
                }
                hint={
                  r.totals.length > 0
                    ? r.totals
                        .map((t) => `${t.activityName} ${formatAmount(t.amount, t.unitLabel)}`)
                        .join(' · ')
                    : 'Nothing logged'
                }
                trailing={
                  r.voided ? (
                    <Badge tone="bad">Deleted</Badge>
                  ) : r.status === 'abandoned' ? (
                    <Badge tone="warn">Abandoned</Badge>
                  ) : r.edited ? (
                    <Badge>Edited</Badge>
                  ) : null
                }
              />
            ))}
          </LinkList>
        )}
      </Stack>
    </>
  )
}
