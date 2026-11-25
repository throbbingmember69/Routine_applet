import { describe, expect, it } from 'vitest'
import type { LocalDate } from '@/domain/types'
import {
  formatAmount,
  formatClock,
  formatDate,
  formatInt,
  formatNumber,
  formatPlan,
  formatRest,
} from './format'

describe('format', () => {
  it('formats amounts in their unit, trimming trailing zeros', () => {
    expect(formatAmount(25, 'min')).toBe('25 min')
    expect(formatAmount(2.5, 'km')).toBe('2.5 km')
    expect(formatAmount(2.125, 'km')).toMatch(/^2.13 km$/)
    expect(formatAmount(20, ' pages ')).toBe('20 pages')
    expect(formatAmount(3, '')).toBe('3')
    expect(formatNumber(1.5)).toMatch(/^1.5$/)
    expect(formatInt(2.6)).toBe('3')
  })

  it('formats rest and a routine item’s plan', () => {
    expect(formatRest(90, 90)).toBe('90 s')
    expect(formatRest(120, 120)).toBe('2 min')
    expect(formatRest(90, 120)).toBe('1:30–2 min')
    expect(formatRest(45, 50)).toBe('45–50 s')
    const plan = { blocks: 4, blockAmount: 25, restMinSec: 300, restMaxSec: 300 }
    expect(formatPlan(plan, 'min')).toBe('4 × 25 min · rest 5 min')
    expect(formatPlan({ ...plan, restMinSec: 0, restMaxSec: 0 }, 'min')).toBe('4 × 25 min')
  })

  it('formats clocks', () => {
    expect(formatClock(125_000)).toBe('2:05')
    expect(formatClock(-40_000)).toBe('+0:40')
  })

  it('formats a LocalDate on the right day', () => {
    expect(formatDate('2026-09-28' as LocalDate)).toMatch(/28/)
  })
})
