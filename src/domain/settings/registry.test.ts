import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  isSettingKey,
  resolveSettings,
  SETTINGS_REGISTRY,
  settingMeta,
} from './registry'

describe('settings registry', () => {
  it('has a default inside its bounds and on its step for every setting', () => {
    for (const m of SETTINGS_REGISTRY) {
      expect(m.default, m.key).toBeGreaterThanOrEqual(m.min)
      expect(m.default, m.key).toBeLessThanOrEqual(m.max)
      expect(Number.isInteger(Math.round((m.default - m.min) / m.step)), m.key).toBe(true)
      expect(m.help.length, m.key).toBeGreaterThan(0)
    }
    expect(DEFAULT_SETTINGS).toMatchObject({
      weekStartDay: 1,
      restExtendSec: 30,
      defaultRestSec: 300,
      backupReminderDays: 7,
    })
  })

  it('merges stored overrides over the defaults, clamped, ignoring unknown and bad values', () => {
    const s = resolveSettings({
      weekStartDay: 0,
      restExtendSec: 999,
      nope: 3,
      backupReminderDays: NaN,
    })
    expect(s).toMatchObject({ weekStartDay: 0, restExtendSec: 120, backupReminderDays: 7 })
    expect(Object.isFrozen(s)).toBe(true)
    expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('knows its keys', () => {
    expect(isSettingKey('weekStartDay')).toBe(true)
    expect(isSettingKey('kcalPerLb')).toBe(false)
    expect(settingMeta('restExtendSec').unit).toBe('s')
    expect(() => settingMeta('nope' as never)).toThrow(RangeError)
  })
})
