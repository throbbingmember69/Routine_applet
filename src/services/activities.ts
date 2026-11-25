// Activities: what the user does in blocks (Study in 25-minute blocks, Reading in 20-page blocks),
// with a weekly target in the activity's unit and an optional stepped progression of that target.
// Activities are never deleted once anything refers to them (routines, logged sessions): they're
// archived instead, so history keeps its names and the backup's references stay whole.
import { isLocalDate } from '@/domain/dates'
import { roundHalfAway } from '@/domain/rounding'
import type { Activity, LocalDate, TargetProgression } from '@/domain/types'
import { today, type ServiceCtx } from './context'
import { ServiceError } from './errors'
import { loadSettings } from './settings'
import {
  assertBlockAmount,
  assertRest,
  cleanName,
  cleanNote,
  cleanUnit,
  MAX_EVERY_WEEKS,
  MAX_WEEKLY,
} from './validate'

export interface ProgressionInput {
  stepAmount: number
  everyWeeks: number
  capAmount: number
  /** The week counting starts from (defaults to today). */
  startDate?: LocalDate
}

export interface ActivityInput {
  name: string
  unitLabel: string
  defaultBlockAmount: number
  /** Rest between blocks; defaults to the defaultRestSec setting. */
  restMinSec?: number
  restMaxSec?: number
  weeklyTarget: number | null
  progression?: ProgressionInput | null
  notes?: string
}

export type ActivityPatch = Partial<ActivityInput>

const PATCH_FIELDS = [
  'name',
  'unitLabel',
  'defaultBlockAmount',
  'restMinSec',
  'restMaxSec',
  'weeklyTarget',
  'progression',
  'notes',
] as const

// ── Commands ─────────────────────────────────────────────────────────────────

/** Create an activity. Returns its id. */
export async function createActivity(ctx: ServiceCtx, input: ActivityInput): Promise<string> {
  const { db } = ctx
  const settings = await loadSettings(ctx)
  const restMinSec = input.restMinSec ?? settings.defaultRestSec
  const values = checkActivity(
    {
      name: input.name,
      unitLabel: input.unitLabel,
      defaultBlockAmount: input.defaultBlockAmount,
      restMinSec,
      restMaxSec: input.restMaxSec ?? restMinSec,
      weeklyTarget: input.weeklyTarget,
      progression: input.progression ?? null,
      notes: input.notes,
    },
    today(ctx),
  )
  const id = ctx.newId()
  const now = ctx.now()
  await db.transaction('rw', db.activities, async () => {
    await assertUniqueName(ctx, values.name, null)
    await db.activities.add({ id, ...values, archivedAt: null, createdAt: now, updatedAt: now })
  })
  return id
}

/** Change an activity. Snapshots of past sessions keep the old name, unit and plan. */
export async function updateActivity(
  ctx: ServiceCtx,
  id: string,
  patch: ActivityPatch,
): Promise<void> {
  for (const key of Object.keys(patch)) {
    if (!(PATCH_FIELDS as readonly string[]).includes(key)) {
      throw new ServiceError('field_not_editable', `An activity's ${key} can't be changed.`, {
        field: key,
      })
    }
  }
  const { db } = ctx
  const now = ctx.now()
  const date = today(ctx)
  await db.transaction('rw', db.activities, async () => {
    const current = requireActivity(await db.activities.get(id), id)
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as ActivityPatch
    const values = checkActivity(
      {
        ...current,
        ...defined,
        // A progression keeps its start date unless a new one is given.
        progression:
          defined.progression === undefined
            ? current.progression
            : defined.progression === null
              ? null
              : {
                  ...defined.progression,
                  startDate:
                    defined.progression.startDate ?? current.progression?.startDate ?? date,
                },
      },
      date,
    )
    if (values.name.toLowerCase() !== current.name.toLowerCase()) {
      await assertUniqueName(ctx, values.name, id)
    }
    await db.activities.put({ ...current, ...values, updatedAt: now })
  })
}

/** Archive an activity: hidden from Today, the week and pickers; its history stays. */
export async function archiveActivity(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.activities, async () => {
    const a = requireActivity(await db.activities.get(id), id)
    if (a.archivedAt !== null) return
    await db.activities.update(id, { archivedAt: now, updatedAt: now })
  })
}

/** Bring an archived activity back. */
export async function restoreActivity(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.activities, async () => {
    const a = requireActivity(await db.activities.get(id), id)
    if (a.archivedAt === null) return
    await assertUniqueName(ctx, a.name, id)
    await db.activities.update(id, { archivedAt: null, updatedAt: now })
  })
}

/**
 * Delete an activity outright. Only allowed while nothing refers to it (no routine item, ever, and
 * no logged session); otherwise archive it ('activity_in_use').
 */
export async function deleteActivity(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', [db.activities, db.routineItems, db.sessionItems], async () => {
    requireActivity(await db.activities.get(id), id)
    const used =
      (await db.routineItems.where('activityId').equals(id).count()) +
      (await db.sessionItems.where('activityId').equals(id).count())
    if (used > 0) {
      throw new ServiceError(
        'activity_in_use',
        'This activity is in a routine or your history, so it can only be archived.',
        { id },
      )
    }
    await db.activities.delete(id)
  })
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Activities sorted by name; archived ones only when asked. */
export async function listActivities(
  ctx: Pick<ServiceCtx, 'db'>,
  opts: { includeArchived?: boolean } = {},
): Promise<Activity[]> {
  const all = await ctx.db.activities.toArray()
  return all
    .filter((a) => opts.includeArchived || a.archivedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export interface ActivityDetail {
  activity: Activity
  /** The activity can be deleted (nothing refers to it); otherwise only archived. */
  deletable: boolean
}

export async function getActivity(
  ctx: Pick<ServiceCtx, 'db'>,
  id: string,
): Promise<ActivityDetail | null> {
  const { db } = ctx
  const activity = await db.activities.get(id)
  if (!activity) return null
  const used =
    (await db.routineItems.where('activityId').equals(id).count()) +
    (await db.sessionItems.where('activityId').equals(id).count())
  return { activity, deletable: used === 0 }
}

// ── Checks ───────────────────────────────────────────────────────────────────

type ActivityValues = Pick<
  Activity,
  | 'name'
  | 'unitLabel'
  | 'defaultBlockAmount'
  | 'restMinSec'
  | 'restMaxSec'
  | 'weeklyTarget'
  | 'progression'
  | 'notes'
>

interface Unchecked {
  name: unknown
  unitLabel: unknown
  defaultBlockAmount: unknown
  restMinSec: unknown
  restMaxSec: unknown
  weeklyTarget: unknown
  progression: unknown
  notes: unknown
}

function checkActivity(v: Unchecked, date: LocalDate): ActivityValues {
  const name = cleanName(v.name, 'activity')
  const unitLabel = cleanUnit(v.unitLabel)
  assertBlockAmount(v.defaultBlockAmount)
  assertRest(v.restMinSec, v.restMaxSec)
  const weeklyTarget = v.weeklyTarget
  if (
    weeklyTarget !== null &&
    (typeof weeklyTarget !== 'number' ||
      !Number.isFinite(weeklyTarget) ||
      weeklyTarget <= 0 ||
      weeklyTarget > MAX_WEEKLY)
  ) {
    throw new ServiceError('invalid_target', 'The weekly target must be more than 0, or none.', {
      weeklyTarget,
    })
  }
  const progression = checkProgression(v.progression, weeklyTarget, date)
  return {
    name,
    unitLabel,
    defaultBlockAmount: roundHalfAway(v.defaultBlockAmount, 6),
    restMinSec: v.restMinSec as number,
    restMaxSec: v.restMaxSec as number,
    weeklyTarget,
    progression,
    notes: cleanNote(v.notes),
  }
}

function checkProgression(
  p: unknown,
  weeklyTarget: number | null,
  date: LocalDate,
): TargetProgression | null {
  if (p === null || p === undefined) return null
  if (typeof p !== 'object') {
    throw new ServiceError('invalid_progression', 'The progression is not valid.')
  }
  if (weeklyTarget === null) {
    throw new ServiceError(
      'invalid_progression',
      'Set a weekly target before adding a progression.',
    )
  }
  const { stepAmount, everyWeeks, capAmount, startDate } = p as Record<string, unknown>
  if (typeof stepAmount !== 'number' || !Number.isFinite(stepAmount) || stepAmount <= 0) {
    throw new ServiceError('invalid_progression', 'The step must be more than 0.')
  }
  if (
    typeof everyWeeks !== 'number' ||
    !Number.isInteger(everyWeeks) ||
    everyWeeks < 1 ||
    everyWeeks > MAX_EVERY_WEEKS
  ) {
    throw new ServiceError(
      'invalid_progression',
      `Grow every 1 to ${MAX_EVERY_WEEKS} weeks (a whole number).`,
    )
  }
  if (
    typeof capAmount !== 'number' ||
    !Number.isFinite(capAmount) ||
    capAmount <= weeklyTarget ||
    capAmount > MAX_WEEKLY
  ) {
    throw new ServiceError(
      'invalid_progression',
      'The cap must be more than the starting weekly target.',
    )
  }
  const start = startDate ?? date
  if (typeof start !== 'string' || !isLocalDate(start)) {
    throw new ServiceError('invalid_progression', 'The progression start date is not valid.')
  }
  return { stepAmount, everyWeeks, capAmount, startDate: start }
}

function requireActivity(a: Activity | undefined, id: string): Activity {
  if (!a) throw new ServiceError('activity_not_found', 'That activity no longer exists.', { id })
  return a
}

/** No other active activity has the same name (ignoring case). */
async function assertUniqueName(
  ctx: Pick<ServiceCtx, 'db'>,
  name: string,
  exceptId: string | null,
): Promise<void> {
  const key = name.toLowerCase()
  const clash = await ctx.db.activities
    .filter((a) => a.archivedAt === null && a.id !== exceptId && a.name.toLowerCase() === key)
    .first()
  if (clash) {
    throw new ServiceError('duplicate_name', `You already have an activity called ${clash.name}.`, {
      id: clash.id,
    })
  }
}
