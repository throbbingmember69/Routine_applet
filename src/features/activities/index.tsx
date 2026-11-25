import { useState } from 'react'
import { useLive } from '@/app/hooks'
import type { Activity } from '@/domain/types'
import { listActivities } from '@/services/activities'
import { formatAmount, formatRest } from '@/ui/format'
import {
  Badge,
  ButtonLink,
  EmptyState,
  LinkList,
  LinkRow,
  PageHeader,
  Stack,
  Toggle,
} from '@/ui/kit'
import Spinner from '@/ui/Spinner'

/** "25 min blocks · rest 5 min · 300 min a week, +30 every 2 weeks to 600". */
function activitySummary(a: Activity): string {
  const parts = [`${formatAmount(a.defaultBlockAmount, a.unitLabel)} blocks`]
  if (a.restMaxSec > 0) parts.push(`rest ${formatRest(a.restMinSec, a.restMaxSec)}`)
  if (a.weeklyTarget !== null) {
    const p = a.progression
    parts.push(
      `${formatAmount(a.weeklyTarget, a.unitLabel)} a week${
        p
          ? `, +${formatAmount(p.stepAmount, '')} every ${p.everyWeeks === 1 ? 'week' : `${p.everyWeeks} weeks`} to ${formatAmount(p.capAmount, '')}`
          : ''
      }`,
    )
  }
  return parts.join(' · ')
}

export default function Activities() {
  const [showArchived, setShowArchived] = useState(false)
  const { data: activities } = useLive((ctx) => listActivities(ctx, { includeArchived: true }), [])
  if (!activities) return <Spinner />
  const active = activities.filter((a) => a.archivedAt === null)
  const archived = activities.filter((a) => a.archivedAt !== null)
  return (
    <>
      <PageHeader
        title="Activities"
        back="/more"
        actions={
          <ButtonLink to="/activities/new" variant="primary" icon="plus">
            New
          </ButtonLink>
        }
      />
      <Stack>
        {active.length === 0 ? (
          <EmptyState title="No activities yet">
            Create one for each thing you want to track, like Study, Reading or Walking.
          </EmptyState>
        ) : (
          <LinkList>
            {active.map((a) => (
              <LinkRow
                key={a.id}
                to={`/activities/${a.id}`}
                label={a.name}
                hint={activitySummary(a)}
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
        {showArchived && archived.length > 0 ? (
          <LinkList>
            {archived.map((a) => (
              <LinkRow
                key={a.id}
                to={`/activities/${a.id}`}
                label={a.name}
                hint={activitySummary(a)}
                trailing={<Badge>Archived</Badge>}
              />
            ))}
          </LinkList>
        ) : null}
      </Stack>
    </>
  )
}
