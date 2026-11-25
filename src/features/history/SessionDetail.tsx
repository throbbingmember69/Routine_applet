import { useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { useCommand, useLive, useToday } from '@/app/hooks'
import type { LocalDate } from '@/domain/types'
import {
  addBlockInEdit,
  editBlock,
  editSession,
  restoreBlock,
  restoreSession,
  voidBlockInEdit,
  voidSession,
} from '@/services/sessions/edit'
import { getSessionView, type SessionItemView } from '@/services/sessions/queries'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { formatAmount, formatDate, formatPlan } from '@/ui/format'
import { Badge, Button, Card, EmptyState, Field, PageHeader, Stack, Toggle } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import Spinner from '@/ui/Spinner'
import logger from '../logger/logger.module.css'
import BlockEditor from '../shared/BlockEditor'
import styles from '../shared/shared.module.css'

type Editing = { itemId: string; blockId: string | null } | null

export default function SessionDetail() {
  const { id = '' } = useParams()
  const today = useToday()
  const { data: view } = useLive((ctx) => getSessionView(ctx, id), [id])
  const [editMode, setEditMode] = useState(false)
  const [confirmEdit, setConfirmEdit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)

  const save = useCommand(editBlock)
  const add = useCommand(addBlockInEdit)
  const voidOne = useCommand(voidBlockInEdit)
  const restoreOne = useCommand(restoreBlock)
  const patchSession = useCommand(editSession)
  const remove = useCommand(voidSession, { success: 'Session deleted' })
  const restore = useCommand(restoreSession, { success: 'Session restored' })

  if (view === undefined) return <Spinner />
  if (view === null) {
    return (
      <>
        <PageHeader title="Session" back="/history" />
        <EmptyState title="Session not found">It may have been deleted.</EmptyState>
      </>
    )
  }
  const { session } = view
  if (session.status === 'in_progress' && session.voidedAt === null) {
    return <Navigate to={`/session/${id}`} replace />
  }
  const voided = session.voidedAt !== null
  const canEdit = editMode && !voided
  const title = view.routineName ?? (session.source === 'quick' ? 'Quick log' : 'Session')

  const editingItem = editing ? view.items.find((i) => i.id === editing.itemId) : undefined
  const editingBlock =
    editing && editingItem
      ? (editingItem.entries.find((b) => b.id === editing.blockId) ?? null)
      : null

  return (
    <>
      <PageHeader title={title} back="/history" />
      <p className={`${styles.muted} ${styles.small}`} style={{ marginTop: '-0.5rem' }}>
        {formatDate(session.date)}
        {session.source === 'logger'
          ? ` · ${new Date(session.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
          : ''}{' '}
        {voided ? <Badge tone="bad">Deleted</Badge> : null}{' '}
        {session.status === 'abandoned' ? <Badge tone="warn">Abandoned</Badge> : null}{' '}
        {session.editedAt !== null ? <Badge>Edited</Badge> : null}
      </p>
      <Stack>
        {voided ? (
          <Card>
            <p className={styles.muted} style={{ marginTop: 0 }}>
              This session is deleted: it doesn’t count anywhere. Restore it to count it again.
            </p>
            <Button block onClick={() => void restore.run(id)}>
              Restore session
            </Button>
          </Card>
        ) : session.status === 'abandoned' && !editMode ? (
          <p className={`${styles.muted} ${styles.small}`}>
            Abandoned sessions don’t count toward the week. Edit it to mark it finished.
          </p>
        ) : null}

        {view.totals.length > 0 ? (
          <Card title="Total">
            <ul className={styles.list}>
              {view.totals.map((t) => (
                <li
                  key={t.activityId}
                  className={styles.row}
                  style={{ padding: 'var(--space-1) 0' }}
                >
                  <span>{t.activityName}</span>
                  <span className={styles.amount}>{formatAmount(t.amount, t.unitLabel)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {view.items.map((item) => (
          <ItemBlocks
            key={item.id}
            item={item}
            editable={canEdit}
            onEdit={(blockId) => setEditing({ itemId: item.id, blockId })}
            onRestore={(blockId) => void restoreOne.run(blockId)}
          />
        ))}

        {canEdit ? (
          <SessionFields
            key={`${session.note}|${session.date}|${session.status}`}
            note={session.note}
            date={session.date}
            abandoned={session.status === 'abandoned'}
            today={today}
            onSave={(patch) => void patchSession.run(id, patch)}
          />
        ) : session.note ? (
          <Card title="Note">
            <p style={{ margin: 0 }}>{session.note}</p>
          </Card>
        ) : null}

        {!voided ? (
          editMode ? (
            <div className={kit.actions}>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete session
              </Button>
              <Button variant="primary" onClick={() => setEditMode(false)}>
                Done editing
              </Button>
            </div>
          ) : (
            <Button block icon="edit" onClick={() => setConfirmEdit(true)}>
              Edit session
            </Button>
          )
        ) : null}
      </Stack>

      <BlockEditor
        block={
          editing && editingItem
            ? {
                key: `${editing.itemId}|${editing.blockId ?? 'new'}`,
                title: editingBlock
                  ? `Block ${editingItem.entries.indexOf(editingBlock) + 1}`
                  : `Add a block of ${editingItem.activityName}`,
                amount: editingBlock?.amount ?? editingItem.blockAmount,
                note: editingBlock?.note ?? '',
              }
            : null
        }
        unitLabel={editingItem?.unitLabel ?? ''}
        plannedAmount={editingItem?.blockAmount ?? 1}
        onClose={() => setEditing(null)}
        onSave={(v) => {
          if (editingBlock) void save.run(editingBlock.id, v)
          else if (editingItem) void add.run({ sessionItemId: editingItem.id, ...v })
          setEditing(null)
        }}
        onDelete={
          editingBlock
            ? () => {
                void voidOne.run(editingBlock.id)
                setEditing(null)
              }
            : undefined
        }
      />

      <ConfirmDialog
        open={confirmEdit}
        title="Edit this session?"
        confirmLabel="Edit"
        onCancel={() => setConfirmEdit(false)}
        onConfirm={() => {
          setConfirmEdit(false)
          setEditMode(true)
        }}
      >
        Changes are marked as edited. Deleted blocks can be restored.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this session?"
        danger
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          setEditMode(false)
          void remove.run(id)
        }}
      >
        It stops counting everywhere. You can restore it from this page.
      </ConfirmDialog>
    </>
  )
}

function ItemBlocks({
  item,
  editable,
  onEdit,
  onRestore,
}: {
  item: SessionItemView
  editable: boolean
  onEdit: (blockId: string | null) => void
  onRestore: (blockId: string) => void
}) {
  const unit = item.unitLabel
  return (
    <Card>
      <div className={logger.itemHeader}>
        <div style={{ minWidth: 0 }}>
          <h2 className={logger.itemTitle}>{item.activityName}</h2>
          <div className={`${styles.muted} ${styles.small}`}>{formatPlan(item, unit)}</div>
        </div>
        <div className={logger.badges}>
          {item.optional ? <Badge>Optional</Badge> : null}
          <Badge tone={item.progress.complete ? 'good' : 'neutral'}>
            {item.progress.logged}/{item.progress.planned}
          </Badge>
        </div>
      </div>
      {item.entries.length + (editable ? item.voided.length : 0) === 0 ? (
        <p className={`${styles.muted} ${styles.small}`}>No blocks logged.</p>
      ) : (
        <ol className={logger.blocks}>
          {item.entries.map((b, i) => (
            <li key={b.id}>
              <button
                type="button"
                className={logger.blockRow}
                disabled={!editable}
                onClick={() => onEdit(b.id)}
                aria-label={editable ? `Edit block ${i + 1}` : undefined}
              >
                <span className={logger.blockIndex}>{i + 1}</span>
                <span>
                  {formatAmount(b.amount, unit)}
                  {b.note ? ` · ${b.note}` : ''}
                </span>
                <span className={logger.blockIndex}>{b.editedAt !== null ? 'edited' : ''}</span>
              </button>
            </li>
          ))}
          {editable
            ? item.voided.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className={logger.blockRow}
                    data-voided="true"
                    onClick={() => onRestore(b.id)}
                    aria-label={`Restore deleted block of ${formatAmount(b.amount, unit)}`}
                  >
                    <span className={logger.blockIndex}>–</span>
                    <span>{formatAmount(b.amount, unit)}</span>
                    <span className={logger.blockIndex}>Restore</span>
                  </button>
                </li>
              ))
            : null}
        </ol>
      )}
      {editable ? (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <Button variant="ghost" icon="plus" onClick={() => onEdit(null)}>
            Add block
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

function SessionFields({
  note,
  date,
  abandoned,
  today,
  onSave,
}: {
  note: string
  date: LocalDate
  abandoned: boolean
  today: LocalDate
  onSave: (patch: { note?: string; date?: LocalDate; status?: 'finished' | 'abandoned' }) => void
}) {
  const [draftNote, setDraftNote] = useState(note)
  const [draftDate, setDraftDate] = useState<string>(date)
  return (
    <Card title="Session">
      <div className={kit.stack}>
        <Field label="Date" htmlFor="session-date">
          <input
            id="session-date"
            type="date"
            className={kit.input}
            value={draftDate}
            max={today}
            onChange={(e) => setDraftDate(e.target.value)}
            onBlur={() => {
              if (draftDate && draftDate !== date) onSave({ date: draftDate as LocalDate })
            }}
          />
        </Field>
        <Field label="Note" htmlFor="session-note">
          <input
            id="session-note"
            className={kit.input}
            value={draftNote}
            maxLength={500}
            placeholder="Optional"
            onChange={(e) => setDraftNote(e.target.value)}
            onBlur={() => {
              if (draftNote.trim() !== note) onSave({ note: draftNote.trim() })
            }}
          />
        </Field>
        <Toggle
          label="Abandoned"
          hint="Abandoned sessions don’t count toward the week"
          checked={abandoned}
          onChange={(v) => onSave({ status: v ? 'abandoned' : 'finished' })}
        />
      </div>
    </Card>
  )
}
