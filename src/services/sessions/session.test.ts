import { describe, expect, it } from 'vitest'
import { archiveActivity, createActivity } from '../activities'
import { removeRoutineItem, updateRoutineItem } from '../routines'
import {
  DAY,
  MON,
  READING,
  rejectsWith,
  setupMorning,
  STUDY,
  testCtxFactory,
} from '../testFixtures'
import {
  abandonSession,
  addSessionItem,
  finishSession,
  inProgress,
  LAST_ROUTINE_ID_KEY,
  logBlock,
  quickLog,
  removeSessionItem,
  startSession,
  updateBlock,
  voidBlock,
} from './session'

const ctx = testCtxFactory()

describe('startSession', () => {
  it('snapshots the routine’s items, and editing the routine later changes nothing', async () => {
    const c = ctx()
    const { routine, studyItem } = await setupMorning(c)
    const id = await startSession(c, { routineId: routine })
    expect(await c.db.sessions.get(id)).toMatchObject({
      date: '2026-11-23',
      status: 'in_progress',
      routineId: routine,
      startedAt: MON,
      finishedAt: null,
    })
    const items = await c.db.sessionItems.where('sessionId').equals(id).sortBy('order')
    expect(
      items.map((i) => [i.activityName, i.unitLabel, i.blocks, i.blockAmount, i.optional]),
    ).toEqual([
      ['Study', 'min', 4, 25, false],
      ['Reading', 'pages', 1, 20, true],
    ])
    expect(items[0]).toMatchObject({ routineItemId: studyItem, adHoc: false, restMinSec: 300 })
    await updateRoutineItem(c, studyItem, { blocks: 6 })
    expect((await c.db.sessionItems.get(items[0]!.id))?.blocks).toBe(4)
    expect((await c.db.appState.get(LAST_ROUTINE_ID_KEY))?.value).toBe(routine)
  })

  it('skips removed items and archived activities', async () => {
    const c = ctx()
    const { routine, reading, studyItem } = await setupMorning(c)
    await removeRoutineItem(c, studyItem)
    await archiveActivity(c, reading)
    const id = await startSession(c, { routineId: routine })
    expect(await c.db.sessionItems.where('sessionId').equals(id).count()).toBe(0)
  })

  it('allows one session in progress at a time, and an empty start', async () => {
    const c = ctx()
    const id = await startSession(c, { routineId: null })
    expect((await inProgress(c))?.id).toBe(id)
    await rejectsWith(startSession(c, { routineId: null }), 'session_in_progress')
    await abandonSession(c, id)
    expect(await inProgress(c)).toBeNull()
    await rejectsWith(startSession(c, { routineId: 'nope' }), 'routine_not_found')
  })
})

describe('logging blocks', () => {
  it('logs at the planned size by default, numbers blocks, and voids without reusing indexes', async () => {
    const c = ctx()
    const { routine } = await setupMorning(c)
    const id = await startSession(c, { routineId: routine })
    const [study] = await c.db.sessionItems.where('sessionId').equals(id).sortBy('order')
    const b1 = await logBlock(c, { sessionItemId: study!.id })
    const b2 = await logBlock(c, { sessionItemId: study!.id, amount: 15, note: 'phone call' })
    expect(await c.db.blockLogs.get(b1)).toMatchObject({
      sessionId: id,
      activityId: study!.activityId,
      blockIndex: 0,
      amount: 25,
      editedAt: null,
      voidedAt: null,
    })
    expect(await c.db.blockLogs.get(b2)).toMatchObject({
      blockIndex: 1,
      amount: 15,
      note: 'phone call',
    })
    await updateBlock(c, b2, { amount: 20 })
    await voidBlock(c, b2)
    const b3 = await logBlock(c, { sessionItemId: study!.id })
    expect(await c.db.blockLogs.get(b2)).toMatchObject({
      amount: 20,
      voidedAt: MON,
      editedAt: null,
    })
    expect((await c.db.blockLogs.get(b3))?.blockIndex).toBe(2)
    await rejectsWith(updateBlock(c, b2, { amount: 5 }), 'block_voided')
    await rejectsWith(logBlock(c, { sessionItemId: study!.id, amount: -1 }), 'invalid_amount')
    await rejectsWith(updateBlock(c, b1, { blockIndex: 4 } as never), 'field_not_editable')
  })

  it('only writes to a session in progress', async () => {
    const c = ctx()
    const { routine } = await setupMorning(c)
    const id = await startSession(c, { routineId: routine })
    const [study] = await c.db.sessionItems.where('sessionId').equals(id).sortBy('order')
    const b = await logBlock(c, { sessionItemId: study!.id })
    await finishSession(c, id, { note: 'good focus' })
    expect(await c.db.sessions.get(id)).toMatchObject({
      status: 'finished',
      finishedAt: MON,
      note: 'good focus',
    })
    await rejectsWith(logBlock(c, { sessionItemId: study!.id }), 'session_not_in_progress')
    await rejectsWith(voidBlock(c, b), 'session_not_in_progress')
    await rejectsWith(finishSession(c, id), 'session_not_in_progress')
  })

  it('adds activities ad hoc (once each) and removes ones without blocks', async () => {
    const c = ctx()
    const study = await createActivity(c, STUDY)
    const reading = await createActivity(c, READING)
    const id = await startSession(c, { routineId: null })
    const item = await addSessionItem(c, id, { activityId: study, blocks: 2 })
    expect(await c.db.sessionItems.get(item)).toMatchObject({
      order: 0,
      adHoc: true,
      routineItemId: null,
      activityName: 'Study',
      blocks: 2,
      blockAmount: 25,
      restMinSec: 300,
      optional: false,
    })
    await rejectsWith(addSessionItem(c, id, { activityId: study }), 'activity_in_session')
    const other = await addSessionItem(c, id, { activityId: reading })
    expect((await c.db.sessionItems.get(other))?.order).toBe(1)
    const b = await logBlock(c, { sessionItemId: item })
    await rejectsWith(removeSessionItem(c, item), 'has_blocks')
    await voidBlock(c, b)
    await removeSessionItem(c, item)
    expect(await c.db.sessionItems.get(item)).toBeUndefined()
    expect(await c.db.blockLogs.get(b)).toBeUndefined()
  })
})

describe('quickLog', () => {
  it('records a finished one-activity session with the blocks', async () => {
    const c = ctx()
    const study = await createActivity(c, STUDY)
    const id = await quickLog(c, { activityId: study, blockAmount: 45, blocks: 2, note: 'library' })
    expect(await c.db.sessions.get(id)).toMatchObject({
      date: '2026-11-23',
      status: 'finished',
      routineId: null,
      startedAt: MON,
      finishedAt: MON,
      note: 'library',
    })
    const blocks = await c.db.blockLogs.where('sessionId').equals(id).sortBy('blockIndex')
    expect(blocks.map((b) => [b.blockIndex, b.amount])).toEqual([
      [0, 45],
      [1, 45],
    ])
    const [item] = await c.db.sessionItems.where('sessionId').equals(id).toArray()
    expect(item).toMatchObject({ adHoc: true, blocks: 2, blockAmount: 45, activityName: 'Study' })
  })

  it('works during a session, backdates, and refuses the future and bad amounts', async () => {
    const c = ctx()
    const study = await createActivity(c, STUDY)
    await startSession(c, { routineId: null })
    const id = await quickLog(c, {
      activityId: study,
      blockAmount: 30,
      date: '2026-11-20' as never,
    })
    expect((await c.db.sessions.get(id))?.date).toBe('2026-11-20')
    await rejectsWith(
      quickLog(c, { activityId: study, blockAmount: 30, date: '2026-11-24' as never }),
      'future_date',
    )
    await rejectsWith(quickLog(c, { activityId: study, blockAmount: 0 }), 'invalid_amount')
    await rejectsWith(
      quickLog(c, { activityId: study, blockAmount: 5, blocks: 0 }),
      'invalid_blocks',
    )
    await rejectsWith(quickLog(c, { activityId: 'nope', blockAmount: 5 }), 'activity_not_found')
    c.advance(DAY)
    await quickLog(c, { activityId: study, blockAmount: 30, date: '2026-11-24' as never })
  })
})
