import { describe, expect, it } from 'vitest'
import {
  archiveActivity,
  createActivity,
  deleteActivity,
  getActivity,
  listActivities,
  restoreActivity,
  updateActivity,
} from './activities'
import { addRoutineItem, createRoutine } from './routines'
import { updateSettings } from './settings'
import { MON, READING, rejectsWith, STUDY, testCtxFactory } from './testFixtures'

const ctx = testCtxFactory()

describe('createActivity', () => {
  it('stores a trimmed activity with its unit, block size, rest and target', async () => {
    const c = ctx()
    const id = await createActivity(c, { ...STUDY, name: '  Study ', notes: 'Pomodoro' })
    expect(await c.db.activities.get(id)).toEqual({
      id,
      name: 'Study',
      unitLabel: 'min',
      defaultBlockAmount: 25,
      restMinSec: 300,
      restMaxSec: 300,
      weeklyTarget: 300,
      progression: null,
      notes: 'Pomodoro',
      archivedAt: null,
      createdAt: MON,
      updatedAt: MON,
    })
  })

  it('defaults the rest to the defaultRestSec setting', async () => {
    const c = ctx()
    await updateSettings(c, { defaultRestSec: 120 })
    const id = await createActivity(c, {
      name: 'Walk',
      unitLabel: 'km',
      defaultBlockAmount: 2.5,
      weeklyTarget: 20,
    })
    expect(await c.db.activities.get(id)).toMatchObject({ restMinSec: 120, restMaxSec: 120 })
  })

  it('starts a progression from today unless a start date is given', async () => {
    const c = ctx()
    const id = await createActivity(c, {
      ...STUDY,
      progression: { stepAmount: 30, everyWeeks: 2, capAmount: 600 },
    })
    expect((await c.db.activities.get(id))?.progression).toEqual({
      stepAmount: 30,
      everyWeeks: 2,
      capAmount: 600,
      startDate: '2026-11-23',
    })
  })

  it('rejects bad values', async () => {
    const c = ctx()
    await rejectsWith(createActivity(c, { ...STUDY, name: ' ' }), 'invalid_name')
    await rejectsWith(createActivity(c, { ...STUDY, unitLabel: '' }), 'invalid_unit')
    await rejectsWith(createActivity(c, { ...STUDY, defaultBlockAmount: 0 }), 'invalid_amount')
    await rejectsWith(
      createActivity(c, { ...STUDY, restMinSec: 90, restMaxSec: 60 }),
      'invalid_rest',
    )
    await rejectsWith(createActivity(c, { ...STUDY, weeklyTarget: -1 }), 'invalid_target')
    const p = { stepAmount: 30, everyWeeks: 2, capAmount: 600 }
    await rejectsWith(
      createActivity(c, { ...STUDY, weeklyTarget: null, progression: p }),
      'invalid_progression',
    )
    await rejectsWith(
      createActivity(c, { ...STUDY, progression: { ...p, capAmount: 300 } }),
      'invalid_progression',
    )
    await rejectsWith(
      createActivity(c, { ...STUDY, progression: { ...p, everyWeeks: 1.5 } }),
      'invalid_progression',
    )
    expect(await c.db.activities.count()).toBe(0)
  })

  it('refuses a second active activity with the same name', async () => {
    const c = ctx()
    const id = await createActivity(c, STUDY)
    await rejectsWith(createActivity(c, { ...STUDY, name: 'STUDY' }), 'duplicate_name')
    await archiveActivity(c, id)
    const again = await createActivity(c, STUDY)
    // Restoring the archived one would clash with the new one.
    await rejectsWith(restoreActivity(c, id), 'duplicate_name')
    expect(again).not.toBe(id)
  })
})

describe('updateActivity', () => {
  it('changes fields, keeping the progression start date unless given', async () => {
    const c = ctx()
    const id = await createActivity(c, {
      ...STUDY,
      progression: { stepAmount: 30, everyWeeks: 2, capAmount: 600 },
    })
    c.advance(10 * 86_400_000)
    await updateActivity(c, id, {
      name: 'Deep work',
      progression: { stepAmount: 15, everyWeeks: 1, capAmount: 450 },
    })
    expect(await c.db.activities.get(id)).toMatchObject({
      name: 'Deep work',
      progression: { stepAmount: 15, everyWeeks: 1, capAmount: 450, startDate: '2026-11-23' },
      updatedAt: MON + 10 * 86_400_000,
    })
    await updateActivity(c, id, { progression: null, weeklyTarget: null })
    expect(await c.db.activities.get(id)).toMatchObject({ progression: null, weeklyTarget: null })
  })

  it('rejects read-only fields and invalid combinations', async () => {
    const c = ctx()
    const id = await createActivity(c, STUDY)
    await rejectsWith(updateActivity(c, id, { id: 'x' } as never), 'field_not_editable')
    await rejectsWith(
      updateActivity(c, id, { progression: { stepAmount: 10, everyWeeks: 1, capAmount: 100 } }),
      'invalid_progression',
    )
    await rejectsWith(updateActivity(c, 'missing', { name: 'x' }), 'activity_not_found')
  })
})

describe('archive and delete', () => {
  it('deletes an unused activity, but only archives one a routine uses', async () => {
    const c = ctx()
    const unused = await createActivity(c, READING)
    expect((await getActivity(c, unused))?.deletable).toBe(true)
    await deleteActivity(c, unused)
    expect(await c.db.activities.get(unused)).toBeUndefined()

    const used = await createActivity(c, STUDY)
    const routine = await createRoutine(c, { name: 'Morning' })
    await addRoutineItem(c, routine, { activityId: used })
    expect((await getActivity(c, used))?.deletable).toBe(false)
    await rejectsWith(deleteActivity(c, used), 'activity_in_use')
    await archiveActivity(c, used)
    expect(await listActivities(c)).toEqual([])
    expect((await listActivities(c, { includeArchived: true })).map((a) => a.name)).toEqual([
      'Study',
    ])
    await restoreActivity(c, used)
    expect((await listActivities(c)).map((a) => a.archivedAt)).toEqual([null])
  })

  it('lists activities by name, ignoring case', async () => {
    const c = ctx()
    for (const name of ['walk', 'Study', 'Anki']) await createActivity(c, { ...STUDY, name })
    expect((await listActivities(c)).map((a) => a.name)).toEqual(['Anki', 'Study', 'walk'])
  })
})
