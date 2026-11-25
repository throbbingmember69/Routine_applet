import { describe, expect, it } from 'vitest'
import { createActivity } from '../activities'
import { DAY, MON, rejectsWith, STUDY, testCtxFactory, type TestCtx } from '../testFixtures'
import {
  addBlockInEdit,
  editBlock,
  editSession,
  restoreBlock,
  restoreSession,
  voidBlockInEdit,
  voidSession,
} from './edit'
import { addSessionItem, finishSession, logBlock, startSession } from './session'

const ctx = testCtxFactory()

async function finishedSession(c: TestCtx) {
  const study = await createActivity(c, STUDY)
  const id = await startSession(c, { routineId: null })
  const item = await addSessionItem(c, id, { activityId: study, blocks: 2 })
  const block = await logBlock(c, { sessionItemId: item })
  return { id, item, block }
}

describe('Edit mode', () => {
  it('is refused while the session is in progress', async () => {
    const c = ctx()
    const { id, item, block } = await finishedSession(c)
    await rejectsWith(editBlock(c, block, { amount: 10 }), 'session_not_editable')
    await rejectsWith(
      addBlockInEdit(c, { sessionItemId: item, amount: 10 }),
      'session_not_editable',
    )
    await rejectsWith(editSession(c, id, { note: 'x' }), 'session_not_editable')
  })

  it('edits, adds, voids and restores blocks, stamping editedAt on the block and session', async () => {
    const c = ctx()
    const { id, item, block } = await finishedSession(c)
    await finishSession(c, id)
    c.setNow(MON + DAY)
    await editBlock(c, block, { amount: 20, note: 'shorter' })
    expect(await c.db.blockLogs.get(block)).toMatchObject({
      amount: 20,
      note: 'shorter',
      editedAt: MON + DAY,
    })
    const added = await addBlockInEdit(c, { sessionItemId: item, amount: 25 })
    expect(await c.db.blockLogs.get(added)).toMatchObject({ blockIndex: 1, editedAt: MON + DAY })
    await voidBlockInEdit(c, added)
    expect((await c.db.blockLogs.get(added))?.voidedAt).toBe(MON + DAY)
    await restoreBlock(c, added)
    expect((await c.db.blockLogs.get(added))?.voidedAt).toBeNull()
    await rejectsWith(restoreBlock(c, added), 'block_not_voided')
    expect((await c.db.sessions.get(id))?.editedAt).toBe(MON + DAY)
  })

  it('changes the note, date and status; never back to in progress or into the future', async () => {
    const c = ctx()
    const { id } = await finishedSession(c)
    await finishSession(c, id)
    await editSession(c, id, { note: 'moved', date: '2026-11-21' as never, status: 'abandoned' })
    expect(await c.db.sessions.get(id)).toMatchObject({
      note: 'moved',
      date: '2026-11-21',
      status: 'abandoned',
      editedAt: MON,
    })
    await rejectsWith(editSession(c, id, { status: 'in_progress' }), 'invalid_status')
    await rejectsWith(editSession(c, id, { date: '2026-11-24' as never }), 'future_date')
  })

  it('voids and restores a whole session; a voided one must be restored before editing', async () => {
    const c = ctx()
    const { id, block } = await finishedSession(c)
    await finishSession(c, id)
    await voidSession(c, id)
    await rejectsWith(voidSession(c, id), 'session_voided')
    await rejectsWith(editBlock(c, block, { amount: 5 }), 'session_voided')
    await restoreSession(c, id)
    expect((await c.db.sessions.get(id))?.voidedAt).toBeNull()
    await rejectsWith(restoreSession(c, id), 'session_not_voided')
  })

  it('never writes a snapshot', async () => {
    const c = ctx()
    const { id, item, block } = await finishedSession(c)
    await finishSession(c, id)
    const before = await c.db.sessionItems.get(item)
    await editBlock(c, block, { amount: 3 })
    await addBlockInEdit(c, { sessionItemId: item, amount: 4 })
    await editSession(c, id, { note: 'n' })
    expect(await c.db.sessionItems.get(item)).toEqual(before)
  })
})
