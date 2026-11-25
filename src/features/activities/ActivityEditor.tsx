import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useCommand, useLive } from '@/app/hooks'
import type { Activity } from '@/domain/types'
import {
  archiveActivity,
  createActivity,
  deleteActivity,
  getActivity,
  restoreActivity,
  updateActivity,
  type ActivityInput,
} from '@/services/activities'
import { loadSettings } from '@/services/settings'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { formatAmount } from '@/ui/format'
import { Badge, Button, Card, EmptyState, Field, PageHeader, Stack, Toggle } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import Spinner from '@/ui/Spinner'
import { stepFor } from '../shared/amounts'
import styles from '../shared/shared.module.css'

const UNITS = ['min', 'pages', 'km', 'reps', 'sessions', 'chapters', 'words']

export default function ActivityEditor() {
  const { id } = useParams()
  const isNew = id === undefined
  const { data: detail } = useLive(
    (ctx) => (id ? getActivity(ctx, id) : Promise.resolve(null)),
    [id],
  )
  const { data: settings } = useLive((ctx) => loadSettings(ctx), [])
  if (!settings || (!isNew && detail === undefined)) return <Spinner />
  if (!isNew && detail === null) {
    return (
      <>
        <PageHeader title="Activity" back="/activities" />
        <EmptyState title="Activity not found">It may have been deleted.</EmptyState>
      </>
    )
  }
  return (
    <ActivityForm
      key={detail?.activity.id ?? 'new'}
      activity={detail?.activity ?? null}
      deletable={detail?.deletable ?? false}
      defaultRestSec={settings.defaultRestSec}
    />
  )
}

function ActivityForm({
  activity,
  deletable,
  defaultRestSec,
}: {
  activity: Activity | null
  deletable: boolean
  defaultRestSec: number
}) {
  const navigate = useNavigate()
  const [name, setName] = useState(activity?.name ?? '')
  const [unit, setUnit] = useState(activity?.unitLabel ?? 'min')
  const [blockAmount, setBlockAmount] = useState<number | null>(activity?.defaultBlockAmount ?? 25)
  const [restMin, setRestMin] = useState<number | null>(
    (activity?.restMinSec ?? defaultRestSec) / 60,
  )
  const [hasTarget, setHasTarget] = useState(activity ? activity.weeklyTarget !== null : true)
  const [target, setTarget] = useState<number | null>(activity?.weeklyTarget ?? 300)
  const [grows, setGrows] = useState(activity?.progression != null)
  const [step, setStep] = useState<number | null>(activity?.progression?.stepAmount ?? 30)
  const [every, setEvery] = useState<number | null>(activity?.progression?.everyWeeks ?? 2)
  const [cap, setCap] = useState<number | null>(activity?.progression?.capAmount ?? 600)
  const [notes, setNotes] = useState(activity?.notes ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const create = useCommand(createActivity, { success: 'Activity created' })
  const update = useCommand(updateActivity, { success: 'Saved' })
  const archive = useCommand(archiveActivity, { success: 'Archived' })
  const restore = useCommand(restoreActivity, { success: 'Restored' })
  const remove = useCommand(deleteActivity, { success: 'Deleted' })

  const restSec = Math.round((restMin ?? 0) * 60)
  const input: ActivityInput = {
    name,
    unitLabel: unit,
    defaultBlockAmount: blockAmount ?? 0,
    restMinSec: restSec,
    restMaxSec: restSec,
    weeklyTarget: hasTarget ? (target ?? 0) : null,
    progression:
      hasTarget && grows
        ? { stepAmount: step ?? 0, everyWeeks: every ?? 0, capAmount: cap ?? 0 }
        : null,
    notes,
  }
  const blocksPerWeek = hasTarget && target && blockAmount ? Math.ceil(target / blockAmount) : null

  const onSave = async () => {
    if (activity) {
      const ok = await update.tryRun(activity.id, input)
      if (ok) navigate('/activities')
    } else {
      const id = await create.run(input)
      if (id) navigate('/activities')
    }
  }

  const archived = activity?.archivedAt != null
  return (
    <>
      <PageHeader title={activity ? activity.name : 'New activity'} back="/activities" />
      {archived ? (
        <p>
          <Badge>Archived</Badge>
        </p>
      ) : null}
      <Stack>
        <Card>
          <div className={kit.stack}>
            <Field label="Name" htmlFor="activity-name">
              <input
                id="activity-name"
                className={kit.input}
                value={name}
                maxLength={60}
                placeholder="Study"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Unit" htmlFor="activity-unit" hint="What a block is measured in">
              <input
                id="activity-unit"
                className={kit.input}
                value={unit}
                maxLength={20}
                list="activity-units"
                onChange={(e) => setUnit(e.target.value)}
              />
              <datalist id="activity-units">
                {UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </Field>
            <div className={styles.grid2}>
              <Field label={`Block size (${unit || 'unit'})`}>
                <NumberStepper
                  label="Block size"
                  value={blockAmount}
                  onChange={setBlockAmount}
                  step={stepFor(blockAmount ?? 25)}
                  min={0}
                  decimals={2}
                />
              </Field>
              <Field label="Rest between (min)">
                <NumberStepper
                  label="Rest between blocks (min)"
                  value={restMin}
                  onChange={setRestMin}
                  step={0.5}
                  min={0}
                  max={60}
                  decimals={2}
                />
              </Field>
            </div>
          </div>
        </Card>

        <Card title="Weekly target">
          <div className={kit.stack}>
            <Toggle
              label="Aim for a weekly total"
              hint="Every logged block adds its amount, partial blocks included"
              checked={hasTarget}
              onChange={setHasTarget}
            />
            {hasTarget ? (
              <>
                <Field
                  label={`Per week (${unit || 'unit'})`}
                  hint={
                    blocksPerWeek
                      ? `About ${blocksPerWeek} ${blocksPerWeek === 1 ? 'block' : 'blocks'} of ${formatAmount(blockAmount ?? 0, unit)}`
                      : undefined
                  }
                >
                  <NumberStepper
                    label="Weekly target"
                    value={target}
                    onChange={setTarget}
                    step={stepFor(blockAmount ?? 25) * 2}
                    min={0}
                    decimals={2}
                  />
                </Field>
                <Toggle
                  label="Grow the target over time"
                  hint="Adds a step every few weeks, up to a cap"
                  checked={grows}
                  onChange={setGrows}
                />
                {grows ? (
                  <div className={styles.grid2}>
                    <Field label={`Step (${unit || 'unit'})`}>
                      <NumberStepper
                        label="Step"
                        value={step}
                        onChange={setStep}
                        step={stepFor(blockAmount ?? 25)}
                        min={0}
                        decimals={2}
                      />
                    </Field>
                    <Field label="Every (weeks)">
                      <NumberStepper
                        label="Every (weeks)"
                        value={every}
                        onChange={setEvery}
                        step={1}
                        min={1}
                        max={52}
                        decimals={0}
                      />
                    </Field>
                    <Field label={`Up to (${unit || 'unit'})`}>
                      <NumberStepper
                        label="Cap"
                        value={cap}
                        onChange={setCap}
                        step={stepFor(blockAmount ?? 25) * 2}
                        min={0}
                        decimals={2}
                      />
                    </Field>
                  </div>
                ) : null}
                {grows && activity?.progression ? (
                  <p className={`${styles.muted} ${styles.small}`} style={{ margin: 0 }}>
                    Counting from the week of {activity.progression.startDate}.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </Card>

        <Card>
          <Field label="Notes" htmlFor="activity-notes">
            <textarea
              id="activity-notes"
              className={kit.input}
              value={notes}
              maxLength={500}
              rows={2}
              placeholder="Optional"
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </Card>

        <Button
          variant="primary"
          block
          disabled={create.pending || update.pending}
          onClick={() => void onSave()}
        >
          {activity ? 'Save' : 'Create activity'}
        </Button>

        {activity ? (
          <div className={kit.actions}>
            {deletable ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
            {archived ? (
              <Button onClick={() => void restore.run(activity.id)}>Restore</Button>
            ) : (
              <Button
                onClick={() =>
                  void archive.tryRun(activity.id).then((ok) => ok && navigate('/activities'))
                }
              >
                Archive
              </Button>
            )}
          </div>
        ) : null}
      </Stack>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this activity?"
        danger
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          if (activity) void remove.tryRun(activity.id).then((ok) => ok && navigate('/activities'))
        }}
      >
        Nothing has been logged for it yet, so it’s removed completely.
      </ConfirmDialog>
    </>
  )
}
