import { describe, expect, it } from 'vitest'
import { archiveActivity, createActivity } from './activities'
import {
  addRoutineItem,
  archiveRoutine,
  createRoutine,
  deleteRoutine,
  getRoutine,
  listRoutines,
  moveRoutine,
  moveRoutineItem,
  removeRoutineItem,
  updateRoutine,
  updateRoutineItem,
} from './routines'
import { startSession } from './sessions/session'
import { rejectsWith, setupMorning, STUDY, testCtxFactory } from './testFixtures'

const ctx = testCtxFactory()

describe('routines', () => {
  it('adds items with the activity’s block size and rest by default', async () => {
    const c = ctx()
    const { routine, study } = await setupMorning(c)
    const view = (await getRoutine(c, routine))!
    expect(view).toMatchObject({ name: 'Morning', weekday: 1, order: 0 })
    expect(
      view.items.map((i) => [i.activityName, i.blocks, i.blockAmount, i.restMinSec, i.optional]),
    ).toEqual([
      ['Study', 4, 25, 300, false],
      ['Reading', 1, 20, 0, true],
    ])
    expect(view.planned).toEqual([
      {
        activityId: study,
        activityName: 'Study',
        unitLabel: 'min',
        amount: { required: 100, optional: 0 },
      },
      {
        activityId: expect.any(String),
        activityName: 'Reading',
        unitLabel: 'pages',
        amount: { required: 0, optional: 20 },
      },
    ])
  })

  it('updates, reorders and removes items', async () => {
    const c = ctx()
    const { routine, studyItem, readingItem } = await setupMorning(c)
    await updateRoutineItem(c, studyItem, { blocks: 3, blockAmount: 50, optional: true })
    await moveRoutineItem(c, readingItem, -1)
    let view = (await getRoutine(c, routine))!
    expect(view.items.map((i) => [i.activityName, i.blocks, i.blockAmount, i.optional])).toEqual([
      ['Reading', 1, 20, true],
      ['Study', 3, 50, true],
    ])
    await moveRoutineItem(c, readingItem, -1) // already first: no change
    await removeRoutineItem(c, readingItem)
    view = (await getRoutine(c, routine))!
    expect(view.items.map((i) => i.activityName)).toEqual(['Study'])
    expect((await c.db.routineItems.get(readingItem))?.archivedAt).not.toBeNull()
    await rejectsWith(updateRoutineItem(c, studyItem, { blocks: 0 }), 'invalid_blocks')
    await rejectsWith(
      updateRoutineItem(c, studyItem, { activityId: 'x' } as never),
      'field_not_editable',
    )
  })

  it('refuses archived activities and validates names and weekdays', async () => {
    const c = ctx()
    const a = await createActivity(c, STUDY)
    await archiveActivity(c, a)
    const r = await createRoutine(c, { name: 'Evening' })
    await rejectsWith(addRoutineItem(c, r, { activityId: a }), 'activity_archived')
    await rejectsWith(createRoutine(c, { name: '' }), 'invalid_name')
    await rejectsWith(createRoutine(c, { name: 'X', weekday: 7 as never }), 'invalid_weekday')
    await updateRoutine(c, r, { name: 'Late', weekday: 5 })
    expect(await c.db.routines.get(r)).toMatchObject({ name: 'Late', weekday: 5 })
  })

  it('orders, archives and deletes routines', async () => {
    const c = ctx()
    const a = await createRoutine(c, { name: 'A' })
    const b = await createRoutine(c, { name: 'B' })
    await moveRoutine(c, b, -1)
    expect((await listRoutines(c)).map((r) => r.name)).toEqual(['B', 'A'])
    await archiveRoutine(c, b)
    expect((await listRoutines(c)).map((r) => r.name)).toEqual(['A'])
    await deleteRoutine(c, a)
    expect(await c.db.routines.get(a)).toBeUndefined()
  })

  it('only archives a routine a session was started from', async () => {
    const c = ctx()
    const { routine } = await setupMorning(c)
    await startSession(c, { routineId: routine })
    await rejectsWith(deleteRoutine(c, routine), 'routine_in_use')
  })
})
