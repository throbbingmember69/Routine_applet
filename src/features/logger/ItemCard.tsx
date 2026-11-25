import { useState } from 'react'
import { useCommand } from '@/app/hooks'
import type { SessionItemView } from '@/services/sessions/queries'
import { startRestTimer } from '@/services/sessions/restTimerState'
import { logBlock, removeSessionItem, updateBlock, voidBlock } from '@/services/sessions/session'
import { formatAmount, formatPlan } from '@/ui/format'
import { Badge, Button, Card } from '@/ui/kit'
import NumberStepper from '@/ui/NumberStepper'
import { stepFor } from '../shared/amounts'
import BlockEditor from '../shared/BlockEditor'
import shared from '../shared/shared.module.css'
import styles from './logger.module.css'

/** One activity of the session: the plan, the blocks logged, and the next-block entry. */
export default function ItemCard({
  sessionId,
  item,
  othersToDo,
}: {
  sessionId: string
  item: SessionItemView
  /** Another item still has planned blocks left (the rest timer runs between items too). */
  othersToDo: boolean
}) {
  const { progress } = item
  const unit = item.unitLabel
  // The planned size is a hint, not a value: "Done" logs it, typing logs something else.
  const [amount, setAmount] = useState<number | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const log = useCommand(logBlock)
  const restart = useCommand(startRestTimer)
  const update = useCommand(updateBlock)
  const remove = useCommand(voidBlock)
  const drop = useCommand(removeSessionItem)

  const onLog = async (value: number) => {
    const id = await log.run({ sessionItemId: item.id, amount: value })
    if (!id) return
    setAmount(null)
    const moreHere = progress.logged + 1 < progress.planned
    if (item.restMaxSec > 0 && (moreHere || othersToDo)) {
      void restart.run({
        sessionId,
        sessionItemId: item.id,
        restMinSec: item.restMinSec,
        restMaxSec: item.restMaxSec,
      })
    }
  }

  const editingBlock = item.entries.find((b) => b.id === editing) ?? null
  const nextLine = progress.complete
    ? `All ${progress.planned} ${progress.planned === 1 ? 'block' : 'blocks'} done · ${formatAmount(progress.amount, unit)}`
    : `Block ${progress.nextBlockNumber} of ${progress.planned} · ${formatAmount(item.blockAmount, unit)}`

  return (
    <Card className={`${styles.item} ${progress.complete ? styles.done : ''}`}>
      <div className={styles.itemHeader}>
        <div style={{ minWidth: 0 }}>
          <h2 className={styles.itemTitle}>{item.activityName}</h2>
          <div className={`${shared.muted} ${shared.small}`}>{formatPlan(item, unit)}</div>
        </div>
        <div className={styles.badges}>
          {item.optional ? <Badge>Optional</Badge> : null}
          {progress.complete ? <Badge tone="good">Done</Badge> : null}
        </div>
      </div>

      <p className={styles.next}>{nextLine}</p>

      {item.entries.length > 0 ? (
        <ol className={styles.blocks}>
          {item.entries.map((b, i) => (
            <li key={b.id}>
              <button
                type="button"
                className={styles.blockRow}
                onClick={() => setEditing(b.id)}
                aria-label={`Edit block ${i + 1}`}
              >
                <span className={styles.blockIndex}>{i + 1}</span>
                <span>
                  {formatAmount(b.amount, unit)}
                  {b.note ? ` · ${b.note}` : ''}
                </span>
                <span className={styles.blockIndex}>
                  {b.amount < item.blockAmount ? 'partial' : ''}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      <div className={styles.entry}>
        <NumberStepper
          label={`${item.activityName} amount (${unit})`}
          value={amount}
          onChange={setAmount}
          step={stepFor(item.blockAmount)}
          min={0}
          decimals={2}
          placeholder={String(item.blockAmount)}
          bumpFrom={item.blockAmount}
        />
        <div className={styles.entryButtons}>
          {progress.logged === 0 ? (
            <Button variant="ghost" icon="x" onClick={() => void drop.run(item.id)}>
              Remove
            </Button>
          ) : null}
          {amount === null ? (
            <Button
              variant="primary"
              icon="check"
              disabled={log.pending}
              onClick={() => void onLog(item.blockAmount)}
            >
              Done ({formatAmount(item.blockAmount, unit)})
            </Button>
          ) : (
            <Button variant="primary" disabled={log.pending} onClick={() => void onLog(amount)}>
              Log {formatAmount(amount, unit)}
            </Button>
          )}
        </div>
      </div>

      <BlockEditor
        block={
          editingBlock
            ? {
                key: editingBlock.id,
                title: `Block ${item.entries.indexOf(editingBlock) + 1}`,
                amount: editingBlock.amount,
                note: editingBlock.note,
              }
            : null
        }
        unitLabel={unit}
        plannedAmount={item.blockAmount}
        onClose={() => setEditing(null)}
        onSave={(v) => {
          if (editingBlock) void update.run(editingBlock.id, v)
          setEditing(null)
        }}
        onDelete={() => {
          if (editingBlock) void remove.run(editingBlock.id)
          setEditing(null)
        }}
      />
    </Card>
  )
}
