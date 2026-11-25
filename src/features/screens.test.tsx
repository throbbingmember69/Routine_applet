import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { disposeCtx, renderScreen, type TestCtx } from '@/app/testing'
import { createActivity } from '@/services/activities'
import { createTestCtx } from '@/services/context'
import { addRoutineItem, createRoutine } from '@/services/routines'
import { getRestTimer } from '@/services/sessions/restTimerState'
import { finishSession, logBlock, startSession } from '@/services/sessions/session'
import ActivityEditor from './activities/ActivityEditor'
import SessionDetail from './history/SessionDetail'
import Logger from './logger/Logger'
import Today from './today'
import Week from './week'

const MON = Date.UTC(2026, 10, 23, 17)
const ctxs: TestCtx[] = []
function ctx(): TestCtx {
  const c = createTestCtx({ startMs: MON })
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) await disposeCtx(c)
})

const STUDY = {
  name: 'Study',
  unitLabel: 'min',
  defaultBlockAmount: 25,
  restMinSec: 300,
  restMaxSec: 300,
  weeklyTarget: 300,
}

describe('Today', () => {
  it('asks for a first activity on a fresh install', async () => {
    renderScreen(<Today />, { ctx: ctx() })
    expect(
      await screen.findByRole('heading', { name: 'Create your first activity' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New activity' })).toHaveAttribute(
      'href',
      '/activities/new',
    )
  })

  it('shows weekly progress and quick-logs an amount', async () => {
    const c = ctx()
    await createActivity(c, STUDY)
    renderScreen(<Today />, { ctx: c })
    expect(await screen.findByText('0 / 300 min · 300 to go')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log Study' }))
    const sheet = await screen.findByRole('dialog', { name: 'Log Study' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Increase Blocks' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Log 50 min' }))
    expect(await screen.findByText('50 / 300 min · 250 to go')).toBeInTheDocument()
    expect(screen.getByText('Today 50 min')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Study this week' })).toHaveAttribute(
      'aria-valuenow',
      '17',
    )
  })

  it('offers today’s routine first and starts it', async () => {
    const c = ctx()
    const study = await createActivity(c, STUDY)
    const r = await createRoutine(c, { name: 'Morning', weekday: 1 })
    await addRoutineItem(c, r, { activityId: study, blocks: 4 })
    renderScreen(<Today />, {
      ctx: c,
      extraRoutes: [{ path: '/session/:id', element: <p>Logger open</p> }],
    })
    expect(await screen.findByText('Study 4 × 25 min')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start Morning' }))
    expect(await screen.findByText('Logger open')).toBeInTheDocument()
  })
})

describe('Logger', () => {
  async function started(c: TestCtx) {
    const study = await createActivity(c, STUDY)
    const r = await createRoutine(c, { name: 'Morning' })
    await addRoutineItem(c, r, { activityId: study, blocks: 2 })
    return startSession(c, { routineId: r })
  }

  it('logs the planned block in one tap and starts the rest timer', async () => {
    const c = ctx()
    const id = await started(c)
    renderScreen(<Logger />, { ctx: c, route: '/session/:id', path: `/session/${id}` })
    expect(await screen.findByText('Block 1 of 2 · 25 min')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Done (25 min)' }))
    expect(await screen.findByText('Block 2 of 2 · 25 min')).toBeInTheDocument()
    expect(await screen.findByRole('timer')).toHaveTextContent('5:00')
    expect((await getRestTimer(c))?.timer).toMatchObject({ restMinSec: 300, restMaxSec: 300 })
  })

  it('logs a partial block with a typed amount, and no rest after the last block', async () => {
    const c = ctx()
    const id = await started(c)
    renderScreen(<Logger />, { ctx: c, route: '/session/:id', path: `/session/${id}` })
    await screen.findByText('Block 1 of 2 · 25 min')
    await userEvent.click(screen.getByRole('button', { name: 'Done (25 min)' }))
    await screen.findByText('Block 2 of 2 · 25 min')
    const input = screen.getByRole('textbox', { name: 'Study amount (min)' })
    await userEvent.type(input, '15')
    await userEvent.tab()
    // The rest from block 1 is cleared by skipping, so we can see none starts after the last block.
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(async () => expect(await getRestTimer(c)).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Log 15 min' }))
    expect(await screen.findByText('All 2 blocks done · 40 min')).toBeInTheDocument()
    expect(screen.getByText('partial')).toBeInTheDocument()
    expect(await getRestTimer(c)).toBeNull()
  })

  it('finishes with a summary of what is left', async () => {
    const c = ctx()
    const id = await started(c)
    renderScreen(<Logger />, {
      ctx: c,
      route: '/session/:id',
      path: `/session/${id}`,
      extraRoutes: [{ path: '/history/:id', element: <p>Detail open</p> }],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Finish session' }))
    const sheet = await screen.findByRole('dialog', { name: 'Finish session' })
    expect(within(sheet).getByText(/Nothing is logged yet/)).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Finish' }))
    expect(await screen.findByText('Detail open')).toBeInTheDocument()
    expect((await c.db.sessions.get(id))?.status).toBe('finished')
  })
})

describe('Session detail', () => {
  it('edits a finished session’s block in Edit mode', async () => {
    const c = ctx()
    const study = await createActivity(c, STUDY)
    const id = await startSession(c, { routineId: null })
    const { addSessionItem } = await import('@/services/sessions/session')
    const item = await addSessionItem(c, id, { activityId: study })
    await logBlock(c, { sessionItemId: item })
    await finishSession(c, id)
    renderScreen(<SessionDetail />, { ctx: c, route: '/history/:id', path: `/history/${id}` })
    expect(await screen.findByRole('button', { name: 'Edit session' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit block 1' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit session' }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Edit this session?' })).getByRole(
        'button',
        { name: 'Edit' },
      ),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Edit block 1' }))
    const sheet = await screen.findByRole('dialog', { name: 'Block 1' })
    const amount = within(sheet).getByRole('textbox', { name: 'Amount (min)' })
    await userEvent.clear(amount)
    await userEvent.type(amount, '20')
    await userEvent.tab()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(async () => {
      const blocks = await c.db.blockLogs.where('sessionId').equals(id).toArray()
      expect(blocks.map((b) => [b.amount, b.editedAt])).toEqual([[20, MON]])
    })
    expect(await screen.findByText('edited')).toBeInTheDocument()
  })
})

describe('Activity editor', () => {
  it('creates an activity with a weekly target and progression', async () => {
    const c = ctx()
    renderScreen(<ActivityEditor />, {
      ctx: c,
      route: '/activities/new',
      extraRoutes: [{ path: '/activities', element: <p>Activity list</p> }],
    })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Name' }), 'Reading')
    const unit = screen.getByRole('combobox', { name: 'Unit' })
    await userEvent.clear(unit)
    await userEvent.type(unit, 'pages')
    await userEvent.click(screen.getByRole('checkbox', { name: /Grow the target/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Create activity' }))
    expect(await screen.findByText('Activity list')).toBeInTheDocument()
    const [a] = await c.db.activities.toArray()
    expect(a).toMatchObject({
      name: 'Reading',
      unitLabel: 'pages',
      defaultBlockAmount: 25,
      restMinSec: 300,
      weeklyTarget: 300,
      progression: { stepAmount: 30, everyWeeks: 2, capAmount: 600, startDate: '2026-11-23' },
    })
  })
})

describe('Week', () => {
  it('shows each activity by day and moves between weeks', async () => {
    const c = ctx()
    const study = await createActivity(c, STUDY)
    const { quickLog } = await import('@/services/sessions/session')
    await quickLog(c, { activityId: study, blockAmount: 45 })
    renderScreen(<Week />, { ctx: c, route: '/week' })
    expect(await screen.findByText('45 / 300 min · 255 to go')).toBeInTheDocument()
    expect(screen.getByText('This week · 0 of 1 targets met')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Next week' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Previous week' }))
    expect(await screen.findByText('0 / 300 min · 300 to go')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Next week' })).toBeInTheDocument()
  })
})
