// Stepper settings for amounts in any unit, and the progress line every screen shows.
import type { ActivityProgress } from '@/domain/progress'
import { formatAmount } from '@/ui/format'

/** A − / + step that suits the size: 5 for 25 min or 20 pages, 1 for 8 reps, 0.5 for 2.5 km. */
export function stepFor(blockAmount: number): number {
  if (blockAmount >= 20) return 5
  if (blockAmount >= 4) return 1
  if (blockAmount >= 1) return 0.5
  return 0.1
}

/** "120 / 300 min · 180 to go", "Met · 310 / 300 min", or "45 min this week" without a target. */
export function progressLine(
  p: Pick<ActivityProgress, 'target' | 'done' | 'remaining' | 'status'>,
  unit: string,
): string {
  if (p.target === null || p.status === 'none') return `${formatAmount(p.done, unit)} this week`
  const total = `${formatAmount(p.done, '')} / ${formatAmount(p.target, unit)}`
  return p.status === 'met'
    ? `Met · ${total}`
    : `${total} · ${formatAmount(p.remaining ?? 0, '')} to go`
}
