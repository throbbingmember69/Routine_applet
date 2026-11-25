import { describe, expect, it } from 'vitest'
import type { LocalDate } from '@/domain/types'
import { createActivity, updateActivity } from '../activities'
import { createRoutine } from '../routines'
import { updateSettings } from '../settings'
import { DAY, MON, READING, setupMorning, STUDY, testCtxFactory } from '../testFixtures'
import { voidSession } from './edit'
import { getInProgressId, getSessionView, getToday, getWeek, listHistory } from './queries'
import { abandonSession, finishSession, logBlock, quickLog, startSession } from './session'

const ctx = testCtxFactory()
const d = (s: string) => s as LocalDate

describe('getToday', () => {
  it('starts empty on a fresh install', async () => {
    const view = await getToday(ctx(), d('2026-11-23'))
    expect(view).toMatchObject({
      weekStart: '2026-11-23',
      weekEnd: '2026-11-29',
      daysLeft: 7,
      activities: [],
      routinesToday: [],
      otherRoutines: [],
      inProgress: null,
      hasActivities: false,
    })
  })

  it('shows weekly progress and today’s amount, least done first, and today’s routines', async () => {
    const c = ctx()
    const { routine, study, reading } = await setupMorning(c)
    const walk = await createActivity(c, {
      name: 'Walk',
      unitLabel: 'km',
      defaultBlockAmount: 2,
      weeklyTarget: 4,
    })
    await createRoutine(c, { name: 'Weekend', weekday: 6 })
    await quickLog(c, { activityId: walk, blockAmount: 4 })
    const id = await startSession(c, { routineId: routine })
    const view0 = await getSessionView(c, id)
    await logBlock(c, { sessionItemId: view0!.items[0]!.id })
    await logBlock(c, { sessionItemId: view0!.items[0]!.id, amount: 20 })
    c.advance(DAY)
    await quickLog(c, { activityId: reading, blockAmount: 30 })

    const view = await getToday(c, d('2026-11-24'))
    expect(view.daysLeft).toBe(6)
    expect(
      view.activities.map((a) => [a.name, a.done, a.target, a.remaining, a.status, a.today]),
    ).toEqual([
      ['Study', 45, 300, 255, 'under', 0],
      ['Walk', 4, 4, 0, 'met', 0],
      ['Reading', 30, null, null, 'none', 30],
    ])
    expect(view.activities[0]!.byDay).toEqual([45, 0, 0, 0, 0, 0, 0])
    expect(view.inProgress).toEqual({ id, routineName: 'Morning', startedAt: MON })
    // Tuesday: Morning (Mondays) moves to the other routines, the last one started first.
    expect(view.routinesToday).toEqual([])
    expect(view.otherRoutines.map((r) => r.name)).toEqual(['Morning', 'Weekend'])
    expect((await getToday(c, d('2026-11-23'))).routinesToday.map((r) => r.name)).toEqual([
      'Morning',
    ])
    expect(study).toBeTruthy()
  })

  it('applies progression to this week’s target', async () => {
    const c = ctx()
    const id = await createActivity(c, {
      ...STUDY,
      progression: { stepAmount: 30, everyWeeks: 1, capAmount: 360, startDate: d('2026-11-09') },
    })
    expect((await getToday(c, d('2026-11-23'))).activities[0]!.target).toBe(360)
    await updateActivity(c, id, {
      progression: { stepAmount: 30, everyWeeks: 2, capAmount: 600, startDate: d('2026-11-09') },
    })
    expect((await getToday(c, d('2026-11-23'))).activities[0]!.target).toBe(330)
  })
})

describe('getWeek', () => {
  it('navigates weeks and follows the week start setting', async () => {
    const c = ctx()
    const study = await createActivity(c, STUDY)
    await quickLog(c, { activityId: study, blockAmount: 300 })
    const week = await getWeek(c, d('2026-11-25'), d('2026-11-25'))
    expect(week).toMatchObject({
      start: '2026-11-23',
      end: '2026-11-29',
      prevDate: '2026-11-16',
      nextDate: '2026-11-30',
      isCurrent: true,
      met: 1,
      withTarget: 1,
    })
    expect(week.days).toHaveLength(7)
    const last = await getWeek(c, week.prevDate, d('2026-11-25'))
    expect([last.isCurrent, last.rows[0]!.done]).toEqual([false, 0])
    await updateSettings(c, { weekStartDay: 0 })
    expect((await getWeek(c, d('2026-11-25'), d('2026-11-25'))).start).toBe('2026-11-22')
  })
})

describe('getSessionView', () => {
  it('shows each item’s progress, live and voided blocks, totals and what can be added', async () => {
    const c = ctx()
    const { routine } = await setupMorning(c)
    await createActivity(c, { ...READING, name: 'Guitar' })
    const id = await startSession(c, { routineId: routine })
    expect(await getInProgressId(c)).toBe(id)
    let view = (await getSessionView(c, id))!
    const studyItem = view.items[0]!.id
    await logBlock(c, { sessionItemId: studyItem })
    const b = await logBlock(c, { sessionItemId: studyItem, amount: 10 })
    await (await import('./session')).voidBlock(c, b)
    view = (await getSessionView(c, id))!
    expect(view).toMatchObject({ routineName: 'Morning', mode: 'log' })
    expect(view.items[0]!.progress).toMatchObject({
      logged: 1,
      planned: 4,
      amount: 25,
      nextBlockNumber: 2,
    })
    expect(view.items[0]!.entries.map((e) => e.amount)).toEqual([25])
    expect(view.items[0]!.voided.map((e) => e.amount)).toEqual([10])
    expect(view.finish).toMatchObject({
      missing: [{ activityName: 'Study', blocks: 3 }],
      skippedOptional: [{ activityName: 'Reading' }],
      empty: false,
    })
    expect(view.totals).toMatchObject([{ activityName: 'Study', unitLabel: 'min', amount: 25 }])
    expect(view.addable.map((a) => a.name)).toEqual(['Guitar'])
    await finishSession(c, id)
    expect((await getSessionView(c, id))?.mode).toBe('edit')
    expect(await getSessionView(c, 'missing')).toBeNull()
  })
})

describe('listHistory', () => {
  it('lists past sessions newest first, with totals, flags and no session in progress', async () => {
    const c = ctx()
    const { routine, study } = await setupMorning(c)
    const quick = await quickLog(c, { activityId: study, blockAmount: 45, date: d('2026-11-21') })
    const morning = await startSession(c, { routineId: routine })
    const view = (await getSessionView(c, morning))!
    await logBlock(c, { sessionItemId: view.items[0]!.id })
    await logBlock(c, { sessionItemId: view.items[1]!.id, amount: 12 })
    await finishSession(c, morning)
    c.advance(60_000)
    const dropped = await startSession(c, { routineId: null })
    await abandonSession(c, dropped)
    await voidSession(c, quick)
    await startSession(c, { routineId: null }) // in progress: not history

    const rows = await listHistory(c)
    expect(
      rows.map((r) => [r.id, r.status, r.routineName, r.quickLog, r.voided, r.blocks]),
    ).toEqual([
      [dropped, 'abandoned', null, false, false, 0],
      [morning, 'finished', 'Morning', false, false, 2],
      [quick, 'finished', null, true, true, 1],
    ])
    expect(rows[1]!.totals).toEqual([
      { activityName: 'Study', unitLabel: 'min', amount: 25 },
      { activityName: 'Reading', unitLabel: 'pages', amount: 12 },
    ])
    expect(await listHistory(c, { limit: 1 })).toHaveLength(1)
    expect(MON).toBeGreaterThan(0)
  })
})
