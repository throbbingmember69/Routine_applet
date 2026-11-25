import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCommand, useLive } from '@/app/hooks'
import { createRoutine, listRoutines } from '@/services/routines'
import { formatAmount, WEEKDAY_NAMES } from '@/ui/format'
import { Badge, Button, EmptyState, PageHeader, Stack, Toggle, LinkList, LinkRow } from '@/ui/kit'
import PromptSheet from '@/ui/PromptSheet'
import Spinner from '@/ui/Spinner'

export default function Routines() {
  const navigate = useNavigate()
  const [naming, setNaming] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const { data: routines } = useLive((ctx) => listRoutines(ctx, { includeArchived: true }), [])
  const create = useCommand(createRoutine)
  if (!routines) return <Spinner />
  const active = routines.filter((r) => r.archivedAt === null)
  const archived = routines.filter((r) => r.archivedAt !== null)

  return (
    <>
      <PageHeader
        title="Routines"
        back="/more"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setNaming(true)}>
            New
          </Button>
        }
      />
      <Stack>
        {active.length === 0 ? (
          <EmptyState title="No routines yet">
            A routine is a set list of activities with blocks and rests, like a workout day. Pin one
            to a weekday to see it first on Today.
          </EmptyState>
        ) : (
          <LinkList>
            {active.map((r) => (
              <LinkRow
                key={r.id}
                to={`/routines/${r.id}`}
                label={
                  <>
                    {r.name} {r.weekday !== null ? <Badge>{WEEKDAY_NAMES[r.weekday]}</Badge> : null}
                  </>
                }
                hint={
                  r.planned.length === 0
                    ? 'No activities yet'
                    : r.planned
                        .map(
                          (p) =>
                            `${p.activityName} ${formatAmount(p.amount.required || p.amount.optional, p.unitLabel)}${p.amount.required === 0 ? ' (optional)' : ''}`,
                        )
                        .join(' · ')
                }
              />
            ))}
          </LinkList>
        )}
        {archived.length > 0 ? (
          <Toggle
            label={`Show archived (${archived.length})`}
            checked={showArchived}
            onChange={setShowArchived}
          />
        ) : null}
        {showArchived ? (
          <LinkList>
            {archived.map((r) => (
              <LinkRow
                key={r.id}
                to={`/routines/${r.id}`}
                label={r.name}
                trailing={<Badge>Archived</Badge>}
              />
            ))}
          </LinkList>
        ) : null}
      </Stack>
      <PromptSheet
        open={naming}
        title="New routine"
        label="Name"
        confirmLabel="Create"
        onClose={() => setNaming(false)}
        onSubmit={(name) => {
          setNaming(false)
          void create.run({ name }).then((id) => id && navigate(`/routines/${id}`))
        }}
      />
    </>
  )
}
