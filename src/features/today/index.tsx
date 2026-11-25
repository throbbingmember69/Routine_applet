import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCommand, useLive, useToday } from '@/app/hooks'
import type { RoutineView } from '@/services/routines'
import { getToday } from '@/services/sessions/queries'
import { startSession } from '@/services/sessions/session'
import { formatAmount, formatDate, formatPlan, WEEKDAY_NAMES } from '@/ui/format'
import { Badge, Button, ButtonLink, Card, EmptyState, PageHeader, Stack } from '@/ui/kit'
import Spinner from '@/ui/Spinner'
import { progressLine } from '../shared/amounts'
import ProgressBar from '../shared/ProgressBar'
import QuickLogSheet, { type QuickLogTarget } from '../shared/QuickLogSheet'
import styles from '../shared/shared.module.css'

export default function Today() {
  const today = useToday()
  const navigate = useNavigate()
  const { data: view } = useLive((ctx) => getToday(ctx, today), [today])
  const [logging, setLogging] = useState<QuickLogTarget | null>(null)
  const start = useCommand(startSession)

  if (!view) return <Spinner />

  const onStart = async (routineId: string | null) => {
    const id = await start.run({ routineId })
    if (id) navigate(`/session/${id}`)
  }

  const daysLeft =
    view.daysLeft === 1 ? 'last day of the week' : `${view.daysLeft} days left this week`

  return (
    <>
      <PageHeader title="Today" />
      <p className={`${styles.muted} ${styles.small}`} style={{ marginTop: '-0.5rem' }}>
        {formatDate(view.date)} · {daysLeft}
      </p>
      <Stack>
        {view.inProgress ? (
          <Card>
            <div className={styles.row}>
              <div>
                <div className={styles.name}>
                  {view.inProgress.routineName ?? 'Session'} in progress
                </div>
                <div className={`${styles.muted} ${styles.small}`}>Pick up where you left off.</div>
              </div>
              <ButtonLink to={`/session/${view.inProgress.id}`} variant="primary" icon="play">
                Resume
              </ButtonLink>
            </div>
          </Card>
        ) : null}

        {!view.hasActivities ? (
          <EmptyState
            title="Create your first activity"
            action={
              <ButtonLink to="/activities/new" variant="primary" icon="plus">
                New activity
              </ButtonLink>
            }
          >
            An activity is anything you do in blocks, like Study in 25-minute blocks or Reading in
            20-page blocks, with a weekly target if you want one.
          </EmptyState>
        ) : (
          <Card title="This week">
            <ul className={styles.list}>
              {view.activities.map((a) => (
                <li key={a.activityId}>
                  <div className={styles.row}>
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.name}>{a.name}</div>
                      <div className={`${styles.small} ${styles.amount}`}>
                        {progressLine(a, a.unitLabel)}
                      </div>
                      {a.today > 0 ? (
                        <div className={`${styles.muted} ${styles.small}`}>
                          Today {formatAmount(a.today, a.unitLabel)}
                        </div>
                      ) : null}
                    </div>
                    <Button
                      icon="plus"
                      aria-label={`Log ${a.name}`}
                      onClick={() =>
                        setLogging({
                          id: a.activityId,
                          name: a.name,
                          unitLabel: a.unitLabel,
                          defaultBlockAmount: a.defaultBlockAmount,
                        })
                      }
                    >
                      Log
                    </Button>
                  </div>
                  {a.fraction !== null ? (
                    <ProgressBar
                      fraction={a.fraction}
                      met={a.status === 'met'}
                      label={`${a.name} this week`}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {view.hasActivities ? (
          <Card title="Routines">
            {view.routinesToday.length + view.otherRoutines.length === 0 ? (
              <p className={`${styles.muted} ${styles.small}`}>
                A routine is a set list of activities with blocks and rests, like a workout day.
              </p>
            ) : (
              <ul className={styles.list}>
                {[...view.routinesToday, ...view.otherRoutines].map((r) => (
                  <RoutineRow
                    key={r.id}
                    routine={r}
                    isToday={view.routinesToday.includes(r)}
                    disabled={view.inProgress !== null || start.pending}
                    onStart={() => void onStart(r.id)}
                  />
                ))}
              </ul>
            )}
            <div className={styles.row} style={{ marginTop: 'var(--space-2)' }}>
              <ButtonLink to="/routines" variant="ghost" icon="list">
                Routines
              </ButtonLink>
              <Button
                variant="ghost"
                disabled={view.inProgress !== null || start.pending}
                onClick={() => void onStart(null)}
              >
                Empty session
              </Button>
            </div>
          </Card>
        ) : null}
      </Stack>
      <QuickLogSheet activity={logging} onClose={() => setLogging(null)} />
    </>
  )
}

function RoutineRow({
  routine,
  isToday,
  disabled,
  onStart,
}: {
  routine: RoutineView
  isToday: boolean
  disabled: boolean
  onStart: () => void
}) {
  const items = routine.items.filter((i) => !i.activityArchived)
  return (
    <li>
      <div className={styles.row}>
        <div style={{ minWidth: 0 }}>
          <div className={styles.name}>
            {routine.name}{' '}
            {isToday ? (
              <Badge tone="accent">Today</Badge>
            ) : routine.weekday !== null ? (
              <Badge>{WEEKDAY_NAMES[routine.weekday]}</Badge>
            ) : null}
          </div>
          <div className={`${styles.muted} ${styles.small}`}>
            {items.length === 0
              ? 'No activities yet'
              : items
                  .map(
                    (i) =>
                      `${i.activityName} ${formatPlan({ ...i, restMinSec: 0, restMaxSec: 0 }, i.unitLabel)}${i.optional ? ' (optional)' : ''}`,
                  )
                  .join(' · ')}
          </div>
        </div>
        <Button
          variant={isToday ? 'primary' : 'default'}
          icon="play"
          disabled={disabled || items.length === 0}
          onClick={onStart}
          aria-label={`Start ${routine.name}`}
        >
          Start
        </Button>
      </div>
    </li>
  )
}
