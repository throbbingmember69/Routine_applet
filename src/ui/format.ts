// Display formatting shared by every screen (docs/UI.md "Numbers and copy").
import type { LocalDate } from '@/domain/types'

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const shortDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const intFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const amountFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/** A LocalDate at local noon (never `new Date('YYYY-MM-DD')`, which is UTC midnight). */
function atNoon(date: LocalDate): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, 12)
}

/** "Mon 28 Sep" (locale order). */
export function formatDate(date: LocalDate): string {
  return dateFmt.format(atNoon(date))
}

/** "28 Sep". */
export function formatShortDate(date: LocalDate): string {
  return shortDateFmt.format(atNoon(date))
}

export function formatInt(n: number): string {
  return intFmt.format(Math.round(n))
}

/** Up to 2 decimals, trailing zeros trimmed: "25", "2.5", "1,250". */
export function formatNumber(n: number): string {
  return amountFmt.format(n)
}

/** An amount in its unit: "25 min", "2.5 km", "20 pages". */
export function formatAmount(n: number, unitLabel: string): string {
  const unit = unitLabel.trim()
  return unit ? `${formatNumber(n)} ${unit}` : formatNumber(n)
}

/** "2 min", "90 s", "2–3 min", "1:30–2 min". */
export function formatRest(minSec: number, maxSec: number): string {
  const one = (s: number) =>
    s % 60 === 0
      ? `${s / 60}`
      : s < 60
        ? `${s} s`
        : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  if (minSec === maxSec)
    return minSec % 60 === 0 && minSec > 0 ? `${minSec / 60} min` : `${minSec} s`
  if (minSec < 60 && maxSec < 60) return `${minSec}–${maxSec} s`
  const lo = minSec < 60 ? `${minSec} s` : one(minSec)
  return `${lo}–${one(maxSec)} min`
}

/** "4 × 25 min · rest 5 min" (no rest part when there's no rest). */
export function formatPlan(
  p: { blocks: number; blockAmount: number; restMinSec: number; restMaxSec: number },
  unitLabel: string,
): string {
  const base = `${p.blocks} × ${formatAmount(p.blockAmount, unitLabel)}`
  return p.restMaxSec > 0 ? `${base} · rest ${formatRest(p.restMinSec, p.restMaxSec)}` : base
}

/** "mm:ss" for a countdown (negative → "+mm:ss" overtime). */
export function formatClock(ms: number): string {
  const over = ms < 0
  const total = Math.round(Math.abs(ms) / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${over ? '+' : ''}${m}:${String(s).padStart(2, '0')}`
}

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
