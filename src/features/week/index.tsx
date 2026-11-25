import { Link, useSearchParams } from 'react-router'
import { useLive, useToday } from '@/app/hooks'
import { isLocalDate } from '@/domain/dates'
import { getWeek } from '@/services/sessions/queries'
import { formatNumber, formatShortDate, WEEKDAY_NAMES } from '@/ui/format'
import { weekday } from '@/domain/dates'
import Icon from '@/ui/Icon'
import { ButtonLink, Card, EmptyState, PageHeader, Stack } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import Spinner from '@/ui/Spinner'
import { progressLine } from '../shared/amounts'
import ProgressBar from '../shared/ProgressBar'
import styles from '../shared/shared.module.css'

export default function Week() {
  const today = useToday()
  const [params] = useSearchParams()
  const d = params.get('d')
  const date = d && isLocalDate(d) ? d : today
  const { data: week } = useLive((ctx) => getWeek(ctx, date, today), [date, today])
  if (!week) return <Spinner />

  const navButton = (to: string | null, label: string, icon: 'chevron-left' | 'chevron-right') =>
    to ? (
      <Link to={to} className={`${kit.button} ${kit.ghost} ${kit.iconButton}`} aria-label={label}>
        <Icon name={icon} />
      </Link>
    ) : (
      <span
        className={`${kit.button} ${kit.ghost} ${kit.iconButton}`}
        aria-hidden="true"
        style={{ visibility: 'hidden' }}
      >
        <Icon name={icon} />
      </span>
    )

  return (
    <>
      <PageHeader title="Week" />
      <div className={styles.row} style={{ marginTop: '-0.5rem' }}>
        {navButton(`/week?d=${week.prevDate}`, 'Previous week', 'chevron-left')}
        <div style={{ textAlign: 'center' }}>
          <div className={styles.name}>
            {formatShortDate(week.start)} – {formatShortDate(week.end)}
          </div>
          <div className={`${styles.muted} ${styles.small}`}>
            {week.isCurrent ? 'This week' : 'Past week'}
            {week.withTarget > 0 ? ` · ${week.met} of ${week.withTarget} targets met` : ''}
          </div>
        </div>
        {navButton(
          week.isCurrent ? null : `/week?d=${week.nextDate}`,
          'Next week',
          'chevron-right',
        )}
      </div>
      <Stack>
        {week.rows.length === 0 ? (
          <EmptyState
            title="No activities yet"
            action={
              <ButtonLink to="/activities/new" variant="primary" icon="plus">
                New activity
              </ButtonLink>
            }
          />
        ) : (
          <Card>
            <ul className={styles.list}>
              {week.rows.map((r) => (
                <li key={r.activityId}>
                  <div className={styles.row}>
                    <span className={styles.name}>{r.name}</span>
                    <span className={`${styles.small} ${styles.amount}`}>
                      {r.blocks} {r.blocks === 1 ? 'block' : 'blocks'}
                    </span>
                  </div>
                  <div className={`${styles.small} ${styles.amount}`}>
                    {progressLine(r, r.unitLabel)}
                  </div>
                  {r.fraction !== null ? (
                    <ProgressBar
                      fraction={r.fraction}
                      met={r.status === 'met'}
                      label={`${r.name} this week`}
                    />
                  ) : null}
                  <div className={styles.days} aria-label={`${r.name} by day`}>
                    {week.days.map((day, i) => (
                      <div
                        key={day}
                        className={styles.day}
                        data-done={r.byDay[i]! > 0}
                        data-today={day === today}
                        title={`${formatShortDate(day)}: ${formatNumber(r.byDay[i]!)} ${r.unitLabel}`}
                      >
                        <span>{WEEKDAY_NAMES[weekday(day)]!.slice(0, 2)}</span>
                        <span className={styles.dayValue}>
                          {r.byDay[i]! > 0 ? formatNumber(r.byDay[i]!) : '·'}
                        </span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Stack>
    </>
  )
}
