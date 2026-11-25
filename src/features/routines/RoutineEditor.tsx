import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useCommand, useLive } from '@/app/hooks'
import type { Weekday } from '@/domain/types'
import { listActivities } from '@/services/activities'
import {
  addRoutineItem,
  archiveRoutine,
  deleteRoutine,
  getRoutine,
  moveRoutineItem,
  removeRoutineItem,
  restoreRoutine,
  updateRoutine,
  updateRoutineItem,
  type RoutineItemView,
} from '@/services/routines'
import { getInProgressId } from '@/services/sessions/queries'
import { startSession } from '@/services/sessions/session'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { formatAmount, formatPlan } from '@/ui/format'
import { Badge, Button, Card, EmptyState, Field, PageHeader, Stack, Toggle } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import PromptSheet from '@/ui/PromptSheet'
import Sheet from '@/ui/Sheet'
import Spinner from '@/ui/Spinner'
import { stepFor } from '../shared/amounts'
import styles from '../shared/shared.module.css'

const WEEKDAYS: { value: Weekday; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

export default function RoutineEditor() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: routine } = useLive((ctx) => getRoutine(ctx, id), [id])
  const { data: activities } = useLive((ctx) => listActivities(ctx), [])
  const { data: inProgressId } = useLive((ctx) => getInProgressId(ctx), [])
  const [renaming, setRenaming] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const update = useCommand(updateRoutine)
  const addItem = useCommand(addRoutineItem)
  const move = useCommand(moveRoutineItem)
  const archive = useCommand(archiveRoutine, { success: 'Archived' })
  const restore = useCommand(restoreRoutine, { success: 'Restored' })
  const remove = useCommand(deleteRoutine, { success: 'Deleted' })
  const start = useCommand(startSession)

  if (routine === undefined || !activities || inProgressId === undefined) return <Spinner />
  if (routine === null) {
    return (
      <>
        <PageHeader title="Routine" back="/routines" />
        <EmptyState title="Routine not found">It may have been deleted.</EmptyState>
      </>
    )
  }
  const archived = routine.archivedAt !== null
  const editingItem = routine.items.find((i) => i.id === editing) ?? null
  const startable = routine.items.some((i) => !i.activityArchived)

  return (
    <>
      <PageHeader
        title={routine.name}
        back="/routines"
        actions={
          <Button
            variant="ghost"
            icon="edit"
            aria-label="Rename"
            onClick={() => setRenaming(true)}
          />
        }
      />
      <Stack>
        <Card>
          <Field label="Day" htmlFor="routine-day" hint="Today shows it first on this day">
            <select
              id="routine-day"
              className={kit.input}
              value={routine.weekday ?? ''}
              onChange={(e) =>
                void update.run(routine.id, {
                  weekday: e.target.value === '' ? null : (Number(e.target.value) as Weekday),
                })
              }
            >
              <option value="">Any day</option>
              {WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
        </Card>

        <Card title="Activities">
          {routine.items.length === 0 ? (
            <p className={`${styles.muted} ${styles.small}`}>
              Add the activities this routine runs through, in order.
            </p>
          ) : (
            <ul className={styles.list}>
              {routine.items.map((item, i) => (
                <li key={item.id} className={styles.row}>
                  <button
                    type="button"
                    className={styles.choice}
                    style={{ flex: 1, minWidth: 0, border: 0, background: 'none', padding: 0 }}
                    onClick={() => setEditing(item.id)}
                    aria-label={`Edit ${item.activityName}`}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span className={styles.name}>{item.activityName}</span>{' '}
                      {item.optional ? <Badge>Optional</Badge> : null}{' '}
                      {item.activityArchived ? <Badge tone="warn">Archived</Badge> : null}
                      <br />
                      <span className={styles.choiceHint}>{formatPlan(item, item.unitLabel)}</span>
                    </span>
                  </button>
                  <div style={{ display: 'flex' }}>
                    <Button
                      variant="ghost"
                      icon="chevron-down"
                      style={{ transform: 'rotate(180deg)' }}
                      aria-label={`Move ${item.activityName} up`}
                      disabled={i === 0}
                      onClick={() => void move.run(item.id, -1)}
                    />
                    <Button
                      variant="ghost"
                      icon="chevron-down"
                      aria-label={`Move ${item.activityName} down`}
                      disabled={i === routine.items.length - 1}
                      onClick={() => void move.run(item.id, 1)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 'var(--space-2)' }}>
            <Button
              icon="plus"
              block
              disabled={archived || activities.length === 0}
              onClick={() => setAdding(true)}
            >
              Add activity
            </Button>
            {activities.length === 0 ? (
              <p className={`${styles.muted} ${styles.small}`}>
                Create an activity first (More → Activities).
              </p>
            ) : null}
          </div>
        </Card>

        {routine.planned.length > 0 ? (
          <Card title="Planned">
            <ul className={styles.list}>
              {routine.planned.map((p) => (
                <li
                  key={p.activityId}
                  className={styles.row}
                  style={{ padding: 'var(--space-1) 0' }}
                >
                  <span>{p.activityName}</span>
                  <span className={styles.amount}>
                    {p.amount.required > 0 ? formatAmount(p.amount.required, p.unitLabel) : ''}
                    {p.amount.optional > 0
                      ? `${p.amount.required > 0 ? ' + ' : ''}${formatAmount(p.amount.optional, p.unitLabel)} optional`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {!archived ? (
          <Button
            variant="primary"
            block
            icon="play"
            disabled={!startable || inProgressId !== null || start.pending}
            onClick={() =>
              void start
                .run({ routineId: routine.id })
                .then((sid) => sid && navigate(`/session/${sid}`))
            }
          >
            {inProgressId !== null ? 'A session is in progress' : 'Start routine'}
          </Button>
        ) : null}

        <div className={kit.actions}>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
          {archived ? (
            <Button onClick={() => void restore.run(routine.id)}>Restore</Button>
          ) : (
            <Button
              onClick={() =>
                void archive.tryRun(routine.id).then((ok) => ok && navigate('/routines'))
              }
            >
              Archive
            </Button>
          )}
        </div>
      </Stack>

      <PromptSheet
        open={renaming}
        title="Rename routine"
        label="Name"
        initial={routine.name}
        confirmLabel="Save"
        onClose={() => setRenaming(false)}
        onSubmit={(name) => {
          setRenaming(false)
          void update.run(routine.id, { name })
        }}
      />

      <Sheet open={adding} title="Add activity" onClose={() => setAdding(false)}>
        <div className={styles.choiceList}>
          {activities.map((a) => (
            <button
              key={a.id}
              type="button"
              className={styles.choice}
              onClick={() => {
                setAdding(false)
                void addItem
                  .run(routine.id, { activityId: a.id })
                  .then((itemId) => itemId && setEditing(itemId))
              }}
            >
              <span>{a.name}</span>
              <span className={styles.choiceHint}>
                {formatAmount(a.defaultBlockAmount, a.unitLabel)} blocks
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={editingItem !== null}
        title={editingItem?.activityName ?? 'Item'}
        onClose={() => setEditing(null)}
      >
        {editingItem ? (
          <ItemForm key={editingItem.id} item={editingItem} onDone={() => setEditing(null)} />
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this routine?"
        danger
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          void remove.tryRun(routine.id).then((ok) => ok && navigate('/routines'))
        }}
      >
        Only a routine that was never started can be deleted; otherwise archive it. Your logged
        sessions are never deleted.
      </ConfirmDialog>
    </>
  )
}

function ItemForm({ item, onDone }: { item: RoutineItemView; onDone: () => void }) {
  const [blocks, setBlocks] = useState<number | null>(item.blocks)
  const [amount, setAmount] = useState<number | null>(item.blockAmount)
  const [restMin, setRestMin] = useState<number | null>(item.restMinSec / 60)
  const [optional, setOptional] = useState(item.optional)
  const [note, setNote] = useState(item.note)
  const save = useCommand(updateRoutineItem)
  const remove = useCommand(removeRoutineItem)
  const unit = item.unitLabel
  const restSec = Math.round((restMin ?? 0) * 60)
  return (
    <div className={kit.stack}>
      <div className={styles.grid2}>
        <Field label="Blocks">
          <NumberStepper
            label="Blocks"
            value={blocks}
            onChange={setBlocks}
            step={1}
            min={1}
            max={50}
            decimals={0}
          />
        </Field>
        <Field label={`Block size (${unit})`}>
          <NumberStepper
            label="Block size"
            value={amount}
            onChange={setAmount}
            step={stepFor(item.blockAmount)}
            min={0}
            decimals={2}
          />
        </Field>
      </div>
      <Field label="Rest between blocks (min)">
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
      <Toggle
        label="Optional"
        hint="Counts toward the week when done, never needed to finish"
        checked={optional}
        onChange={setOptional}
      />
      <Field label="Note" htmlFor="item-note">
        <input
          id="item-note"
          className={kit.input}
          value={note}
          maxLength={500}
          placeholder="Optional"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {blocks && amount ? (
        <p className={`${styles.muted} ${styles.small}`} style={{ margin: 0 }}>
          {formatAmount(blocks * amount, unit)} in total
        </p>
      ) : null}
      <div className={kit.actions}>
        <Button
          variant="danger"
          onClick={() => void remove.tryRun(item.id).then((ok) => ok && onDone())}
        >
          Remove
        </Button>
        <Button
          variant="primary"
          disabled={!blocks || !amount || save.pending}
          onClick={() =>
            void save
              .tryRun(item.id, {
                blocks: blocks!,
                blockAmount: amount!,
                restMinSec: restSec,
                restMaxSec: restSec,
                optional,
                note: note.trim(),
              })
              .then((ok) => ok && onDone())
          }
        >
          Save
        </Button>
      </div>
    </div>
  )
}
