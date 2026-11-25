import styles from './shared.module.css'

/** A thin bar for a share of a weekly target (fraction 0–1); green once met. */
export default function ProgressBar({
  fraction,
  met,
  label,
}: {
  fraction: number
  met: boolean
  label: string
}) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  return (
    <div
      className={styles.bar}
      data-status={met ? 'met' : 'under'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className={styles.barFill} style={{ width: `${pct}%` }} />
    </div>
  )
}
