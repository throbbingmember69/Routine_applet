import { describe, expect, it } from 'vitest'
import {
  countsTowardVolume,
  plannedByActivity,
  progressionSteps,
  targetForWeek,
  weekOf,
  weeklyProgress,
} from './progress'
import type { LocalDate } from './types'

const d = (s: string) => s as LocalDate
const MON = 1 as const
const SUN = 0 as const

describe('weekOf', () => {
  it('runs seven days from the configured start day', () => {
    // 2026-11-25 is a Wednesday.
    expect(weekOf(d('2026-11-25'), MON)).toEqual({ start: '2026-11-23', end: '2026-11-29' })
    expect(weekOf(d('2026-11-25'), SUN)).toEqual({ start: '2026-11-22', end: '2026-11-28' })
    expect(weekOf(d('2026-11-23'), MON).start).toBe('2026-11-23')
  })
})

describe('targetForWeek', () => {
  const study = { weeklyTarget: 300, progression: null }

  it('is the weekly target without progression, and null without a target', () => {
    expect(targetForWeek(study, d('2026-11-23'), MON)).toBe(300)
    expect(
      targetForWeek({ weeklyTarget: null, progression: null }, d('2026-11-23'), MON),
    ).toBeNull()
  })

  it('grows by a step every N weeks from the start week, up to the cap', () => {
    const growing = {
      weeklyTarget: 300,
      // Starts mid-week: counts from that week's Monday.
      progression: { stepAmount: 30, everyWeeks: 2, capAmount: 390, startDate: d('2026-11-25') },
    }
    const t = (week: string) => targetForWeek(growing, d(week), MON)
    expect(t('2026-11-16')).toBe(300) // before the start
    expect(t('2026-11-23')).toBe(300)
    expect(t('2026-11-30')).toBe(300)
    expect(t('2026-12-07')).toBe(330) // 2 weeks on
    expect(t('2026-12-21')).toBe(360)
    expect(t('2027-01-04')).toBe(390)
    expect(t('2027-03-01')).toBe(390) // capped
  })

  it('never goes below the base, even with a cap under it', () => {
    const odd = {
      weeklyTarget: 300,
      progression: { stepAmount: 30, everyWeeks: 1, capAmount: 200, startDate: d('2026-11-23') },
    }
    expect(targetForWeek(odd, d('2026-12-28'), MON)).toBe(300)
  })

  it('counts whole steps', () => {
    const p = { everyWeeks: 3, startDate: d('2026-11-23') }
    expect(progressionSteps(p, d('2026-11-23'), MON)).toBe(0)
    expect(progressionSteps(p, d('2026-12-14'), MON)).toBe(1)
    expect(progressionSteps(p, d('2026-12-07'), MON)).toBe(0)
    expect(
      progressionSteps({ everyWeeks: 0, startDate: d('2026-11-23') }, d('2027-01-04'), MON),
    ).toBe(0)
  })
})

describe('weeklyProgress', () => {
  const activities = [
    { id: 'study', weeklyTarget: 300, progression: null, archivedAt: null },
    { id: 'read', weeklyTarget: null, progression: null, archivedAt: null },
    { id: 'walk', weeklyTarget: 10, progression: null, archivedAt: null },
    { id: 'old', weeklyTarget: 50, progression: null, archivedAt: 5 },
  ]
  const s = (
    id: string,
    date: string,
    extra: Partial<{
      status: 'in_progress' | 'finished' | 'abandoned'
      voidedAt: number | null
    }> = {},
  ) => ({
    id,
    date: d(date),
    status: 'finished' as const,
    voidedAt: null,
    ...extra,
  })
  const sessions = [
    s('mon', '2026-11-23'),
    s('wed', '2026-11-25', { status: 'in_progress' }),
    s('abandoned', '2026-11-24', { status: 'abandoned' }),
    s('voided', '2026-11-24', { voidedAt: 9 }),
    s('last-week', '2026-11-22'),
    s('next-week', '2026-11-30'),
  ]
  const b = (
    sessionId: string,
    activityId: string,
    amount: number,
    voidedAt: number | null = null,
  ) => ({
    sessionId,
    activityId,
    amount,
    voidedAt,
  })
  const blockLogs = [
    b('mon', 'study', 25),
    b('mon', 'study', 20), // a partial block still counts its amount
    b('wed', 'study', 25),
    b('mon', 'study', 25, 3), // voided
    b('abandoned', 'study', 100),
    b('voided', 'study', 100),
    b('last-week', 'study', 100),
    b('next-week', 'study', 100),
    b('mon', 'walk', 6),
    b('wed', 'walk', 5.5),
    b('mon', 'read', 40),
  ]

  it('sums live blocks of counted sessions in the week, against each target', () => {
    const p = weeklyProgress({ activities, sessions, blockLogs }, d('2026-11-26'), MON)
    expect(p).toEqual([
      {
        activityId: 'study',
        target: 300,
        done: 70,
        remaining: 230,
        fraction: 70 / 300,
        status: 'under',
        blocks: 3,
      },
      {
        activityId: 'read',
        target: null,
        done: 40,
        remaining: null,
        fraction: null,
        status: 'none',
        blocks: 1,
      },
      {
        activityId: 'walk',
        target: 10,
        done: 11.5,
        remaining: 0,
        fraction: 1,
        status: 'met',
        blocks: 2,
      },
    ])
  })

  it('follows the week start setting', () => {
    // A Sunday start puts 11-22 in the same week as 11-23 … 11-28.
    const p = weeklyProgress({ activities, sessions, blockLogs }, d('2026-11-26'), SUN)
    expect(p[0]).toMatchObject({ done: 170 })
  })

  it('meets a target despite float noise in the sum', () => {
    const tenths = [0.7, 0.1, 0.1, 0.1].map((amount) => b('mon', 'walk', amount))
    const p = weeklyProgress(
      {
        activities: [{ id: 'walk', weeklyTarget: 1, progression: null, archivedAt: null }],
        sessions,
        blockLogs: tenths,
      },
      d('2026-11-23'),
      MON,
    )
    expect(p[0]).toMatchObject({ done: 1, remaining: 0, status: 'met' })
  })

  it('counts in-progress and finished sessions only', () => {
    expect([
      countsTowardVolume({ status: 'finished', voidedAt: null }),
      countsTowardVolume({ status: 'in_progress', voidedAt: null }),
      countsTowardVolume({ status: 'abandoned', voidedAt: null }),
      countsTowardVolume({ status: 'finished', voidedAt: 1 }),
    ]).toEqual([true, true, false, false])
  })
})

describe('plannedByActivity', () => {
  it('sums blocks × amount, optional items apart, archived ones skipped', () => {
    const p = plannedByActivity([
      { activityId: 'study', blocks: 4, blockAmount: 25, optional: false, archivedAt: null },
      { activityId: 'study', blocks: 2, blockAmount: 25, optional: true, archivedAt: null },
      { activityId: 'read', blocks: 2, blockAmount: 20, optional: false, archivedAt: null },
      { activityId: 'read', blocks: 9, blockAmount: 20, optional: false, archivedAt: 1 },
    ])
    expect(Object.fromEntries(p)).toEqual({
      study: { required: 100, optional: 50 },
      read: { required: 40, optional: 0 },
    })
  })
})
