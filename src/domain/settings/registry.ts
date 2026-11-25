// Every tunable number the app uses. All are user-editable. Stored values are merged over these
// defaults on read, so adding a key never needs a migration.

export type SettingGroup = 'week' | 'session' | 'app'

export interface SettingMeta {
  readonly key: string
  readonly label: string
  readonly group: SettingGroup
  readonly unit: string
  readonly default: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly help: string
}

export const SETTINGS_REGISTRY = [
  // ── Week ────────────────────────────────────────────────────────────────
  {
    key: 'weekStartDay',
    label: 'Week starts on',
    group: 'week',
    unit: 'weekday',
    default: 1,
    min: 0,
    max: 6,
    step: 1,
    help: 'Weekly targets and the week view run from this day (0 = Sunday … 6 = Saturday).',
  },

  // ── Session ─────────────────────────────────────────────────────────────
  {
    key: 'restExtendSec',
    label: 'Rest extend button',
    group: 'session',
    unit: 's',
    default: 30,
    min: 5,
    max: 120,
    step: 5,
    help: 'How much the + button adds to a running rest.',
  },
  {
    key: 'defaultRestSec',
    label: 'Default rest for new activities',
    group: 'session',
    unit: 's',
    default: 300,
    min: 0,
    max: 1800,
    step: 15,
    help: 'Prefilled rest between blocks when you create an activity.',
  },

  // ── App ─────────────────────────────────────────────────────────────────
  {
    key: 'backupReminderDays',
    label: 'Backup reminder',
    group: 'app',
    unit: 'days',
    default: 7,
    min: 1,
    max: 60,
    step: 1,
    help: 'Remind to export a backup after this many days.',
  },
] as const satisfies readonly SettingMeta[]

export type SettingKey = (typeof SETTINGS_REGISTRY)[number]['key']
export type Settings = Readonly<Record<SettingKey, number>>

const META_BY_KEY = new Map<string, SettingMeta>(SETTINGS_REGISTRY.map((m) => [m.key, m]))

export const DEFAULT_SETTINGS: Settings = Object.freeze(
  Object.fromEntries(SETTINGS_REGISTRY.map((m) => [m.key, m.default])) as Record<
    SettingKey,
    number
  >,
)

export function settingMeta(key: SettingKey): SettingMeta {
  const m = META_BY_KEY.get(key)
  if (!m) throw new RangeError(`Unknown setting: ${key}`)
  return m
}

export function isSettingKey(key: string): key is SettingKey {
  return META_BY_KEY.has(key)
}

/**
 * Merge stored overrides over the defaults. Unknown keys and non-finite values are ignored;
 * values are clamped to [min, max].
 */
export function resolveSettings(
  stored: Readonly<Record<string, unknown>> | null | undefined,
): Settings {
  const out: Record<string, number> = { ...DEFAULT_SETTINGS }
  if (stored) {
    for (const [k, v] of Object.entries(stored)) {
      const meta = META_BY_KEY.get(k)
      if (!meta || typeof v !== 'number' || !Number.isFinite(v)) continue
      out[k] = Math.min(meta.max, Math.max(meta.min, v))
    }
  }
  return Object.freeze(out) as Settings
}
