import { useState } from 'react'
import { Button, Field } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import Sheet from '@/ui/Sheet'
import { stepFor } from './amounts'

export interface BlockDraft {
  /** Shown in the title, e.g. "Block 2". */
  title: string
  amount: number
  note: string
}

/** Correct, add or delete one block: amount and note. */
export default function BlockEditor({
  block,
  unitLabel,
  plannedAmount,
  onSave,
  onDelete,
  onClose,
}: {
  block: (BlockDraft & { key: string }) | null
  unitLabel: string
  plannedAmount: number
  onSave: (v: { amount: number; note: string }) => void
  /** Omit to hide the delete button (adding a block). */
  onDelete?: () => void
  onClose: () => void
}) {
  return (
    <Sheet open={block !== null} title={block?.title ?? 'Block'} onClose={onClose}>
      {block ? (
        <BlockForm
          key={block.key}
          block={block}
          unitLabel={unitLabel}
          plannedAmount={plannedAmount}
          onSave={onSave}
          onDelete={onDelete}
        />
      ) : null}
    </Sheet>
  )
}

function BlockForm({
  block,
  unitLabel,
  plannedAmount,
  onSave,
  onDelete,
}: {
  block: BlockDraft
  unitLabel: string
  plannedAmount: number
  onSave: (v: { amount: number; note: string }) => void
  onDelete?: () => void
}) {
  const [amount, setAmount] = useState<number | null>(block.amount)
  const [note, setNote] = useState(block.note)
  return (
    <div className={kit.stack}>
      <Field label={`Amount (${unitLabel})`}>
        <NumberStepper
          label={`Amount (${unitLabel})`}
          value={amount}
          onChange={setAmount}
          step={stepFor(plannedAmount)}
          min={0}
          decimals={2}
        />
      </Field>
      <Field label="Note" htmlFor="block-note">
        <input
          id="block-note"
          className={kit.input}
          value={note}
          maxLength={500}
          placeholder="Optional"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className={kit.actions}>
        {onDelete ? (
          <Button variant="danger" onClick={onDelete}>
            Delete block
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={amount === null}
          onClick={() => onSave({ amount: amount!, note: note.trim() })}
        >
          Save
        </Button>
      </div>
    </div>
  )
}
