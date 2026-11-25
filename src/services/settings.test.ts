import { afterEach, describe, expect, it } from 'vitest'
import { DB_TABLES } from '@/db/schema'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import { createTestCtx } from './context'
import {
  getAppState,
  loadSettingOverrides,
  loadSettings,
  resetSettings,
  setAppState,
  updateSettings,
} from './settings'

const ctxs: ReturnType<typeof createTestCtx>[] = []
function ctx(opts?: Parameters<typeof createTestCtx>[0]) {
  const c = createTestCtx(opts)
  ctxs.push(c)
  return c
}

afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

describe('first launch', () => {
  it('writes only the settings row: no activities, routines or history', async () => {
    const c = ctx()
    expect(await c.db.settings.count()).toBe(1)
    for (const t of DB_TABLES.filter((n) => n !== 'settings')) {
      expect(await c.db.table(t).count(), t).toBe(0)
    }
    expect(await loadSettingOverrides(c)).toEqual({})
  })

  it('can create an empty database', async () => {
    const c = ctx({ seed: false })
    for (const t of DB_TABLES) expect(await c.db.table(t).count(), t).toBe(0)
    // Settings still resolve (to the defaults) without the row.
    expect(await loadSettings(c)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('settings', () => {
  it('resolves to the registry defaults on a fresh database', async () => {
    expect(await loadSettings(ctx())).toEqual(DEFAULT_SETTINGS)
  })

  it('stores overrides and drops them when set back to the default', async () => {
    const c = ctx()
    await updateSettings(c, { weekStartDay: 0, restExtendSec: 15 })
    expect(await loadSettingOverrides(c)).toEqual({ weekStartDay: 0, restExtendSec: 15 })
    expect((await loadSettings(c)).weekStartDay).toBe(0)
    await updateSettings(c, { weekStartDay: 1 })
    expect(await loadSettingOverrides(c)).toEqual({ restExtendSec: 15 })
  })

  it('rejects unknown keys and out-of-bounds values without writing', async () => {
    const c = ctx()
    await expect(updateSettings(c, { weekStartDay: 7 })).rejects.toThrow(/between 0 and 6/)
    await expect(
      updateSettings(c, { nope: 1 } as unknown as Parameters<typeof updateSettings>[1]),
    ).rejects.toMatchObject({ code: 'unknown_setting' })
    await expect(updateSettings(c, { restExtendSec: Number.NaN })).rejects.toMatchObject({
      code: 'invalid_setting',
    })
    expect(await loadSettingOverrides(c)).toEqual({})
  })

  it('snaps values to the registry step so integer settings stay integers', async () => {
    const c = ctx()
    await updateSettings(c, { restExtendSec: 22, defaultRestSec: 100, backupReminderDays: 3.4 })
    expect(await loadSettingOverrides(c)).toEqual({
      restExtendSec: 20,
      defaultRestSec: 105,
      backupReminderDays: 3,
    })
  })

  it('resets some or all overrides', async () => {
    const c = ctx()
    await updateSettings(c, { weekStartDay: 0, restExtendSec: 15 })
    await resetSettings(c, ['restExtendSec'])
    expect(await loadSettingOverrides(c)).toEqual({ weekStartDay: 0 })
    await resetSettings(c)
    expect(await loadSettingOverrides(c)).toEqual({})
  })
})

describe('app state', () => {
  it('round-trips values', async () => {
    const c = ctx()
    await setAppState(c, 'lastRoutineId', 'rt-1')
    expect(await getAppState<string>(c, 'lastRoutineId')).toBe('rt-1')
    expect(await getAppState(c, 'missing')).toBeUndefined()
  })
})
