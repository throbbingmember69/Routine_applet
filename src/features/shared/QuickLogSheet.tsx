import { useState } from 'react'
import { useCommand, useToday } from '@/app/hooks'
import { addDays } from '@/domain/dates'
import type { LocalDate } from '@/domain/types'
import { quickLog } from '@/services/sessions/session'
import { formatAmount } from '@/ui/format'
import { Button, Field } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import Sheet from '@/ui/Sheet'
import { stepFor } from './amounts'

export interface QuickLogTarget {
  id: string
  name: string
  unitLabel: string
  defaultBlockAmount: number
}

/** Log an amount of one activity without a routine: blocks × size, today or an earlier day. */
export default function QuickLogSheet({
  activity,
  onClose,
}: {
  activity: QuickLogTarget | null
  onClose: () => void
}) {
  return (
    <Sheet
      open={activity !== null}
      title={activity ? `Log ${activity.name}` : 'Log'}
      onClose={onClose}
    >
      {activity ? <QuickLogForm key={activity.id} activity={activity} onDone={onClose} /> : null}
    </Sheet>
  )
}

function QuickLogForm({ activity, onDone }: { activity: QuickLogTarget; onDone: () => void }) {
  const today = useToday()
  const [amount, setAmount] = useState<number | null>(activity.defaultBlockAmount)
  const [blocks, setBlocks] = useState<number | null>(1)
  const [date, setDate] = useState<LocalDate>(today)
  const [note, setNote] = useState('')
  const log = useCommand(quickLog, { success: 'Logged' })
  const total = amount !== null && blocks !== null ? amount * blocks : null
  const unit = activity.unitLabel
  const days: { date: LocalDate; label: string }[] = [
    { date: today, label: 'Today' },
    { date: addDays(today, -1), label: 'Yesterday' },
    { date: addDays(today, -2), label: '2 days ago' },
  ]

  return (
    <div className={kit.stack}>
      <Field label={`Amount per block (${unit})`}>
        <NumberStepper
          label={`Amount (${unit})`}
          value={amount}
          onChange={setAmount}
          step={stepFor(activity.defaultBlockAmount)}
          min={0}
          decimals={2}
        />
      </Field>
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
      <Field label="Day">
        <div className={kit.chips} role="group" aria-label="Day">
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              className={kit.chip}
              aria-pressed={date === d.date}
              onClick={() => setDate(d.date)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Note" htmlFor="quick-note">
        <input
          id="quick-note"
          className={kit.input}
          value={note}
          maxLength={500}
          placeholder="Optional"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className={kit.actions}>
        <Button onClick={onDone}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!amount || !blocks || log.pending}
          onClick={() =>
            void log
              .tryRun({
                activityId: activity.id,
                blockAmount: amount!,
                blocks: blocks!,
                date,
                note: note.trim(),
              })
              .then((ok) => ok && onDone())
          }
        >
          {total !== null && total > 0 ? `Log ${formatAmount(total, unit)}` : 'Log'}
        </Button>
      </div>
    </div>
  )
}
