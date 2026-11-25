import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useCommand, useLive, useToast } from '@/app/hooks'
import {
  browserRestAlertDeps,
  clearRestNotification,
  scheduleRestAlerts,
} from '@/platform/restAlerts'
import { keepScreenOn } from '@/platform/wakeLock'
import { getSessionView } from '@/services/sessions/queries'
import { clearRestTimer, getRestTimer } from '@/services/sessions/restTimerState'
import { abandonSession, addSessionItem, finishSession } from '@/services/sessions/session'
import { loadSettings } from '@/services/settings'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { formatAmount } from '@/ui/format'
import { Button, EmptyState, Field, PageHeader, Stack } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import Sheet from '@/ui/Sheet'
import Spinner from '@/ui/Spinner'
import shared from '../shared/shared.module.css'
import ItemCard from './ItemCard'
import RestTimerBar from './RestTimerBar'
import styles from './logger.module.css'

export default function Logger() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: view } = useLive((ctx) => getSessionView(ctx, id), [id])
  const { data: rest } = useLive((ctx) => getRestTimer(ctx), [])
  const { data: settings } = useLive((ctx) => loadSettings(ctx), [])

  const [adding, setAdding] = useState(false)
  const [addBlocks, setAddBlocks] = useState<number | null>(1)
  const [finishing, setFinishing] = useState(false)
  const [abandoning, setAbandoning] = useState(false)
  const [note, setNote] = useState('')

  const add = useCommand(addSessionItem)
  const finish = useCommand(finishSession, { success: 'Session saved' })
  const abandon = useCommand(abandonSession)
  const clearTimer = useCommand(clearRestTimer)

  const inProgress = view?.session.status === 'in_progress' && view.session.voidedAt === null
  const timer = rest && rest.sessionId === id && inProgress ? rest.timer : null

  // Keep the screen on while logging (the rest timer stays visible and its timers keep running).
  useEffect(() => {
    if (!inProgress) return
    let handle: Awaited<ReturnType<typeof keepScreenOn>> = null
    let cancelled = false
    void keepScreenOn().then((h) => {
      if (cancelled) void h?.release()
      else handle = h
    })
    return () => {
      cancelled = true
      void handle?.release()
    }
  }, [inProgress])

  // Rest alerts: vibrate + beep in the app, a notification in the background.
  useEffect(() => {
    if (!timer) return
    const cancel = scheduleRestAlerts(timer, browserRestAlertDeps(`#/session/${id}`), (kind) =>
      toast.show(kind === 'min' ? 'Rest done — next block when ready' : 'Rest over', {
        tone: 'good',
      }),
    )
    const onVisible = () => {
      if (document.visibilityState === 'visible') void clearRestNotification()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancel()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [timer, id, toast])

  if (view === undefined) return <Spinner />
  if (view === null) {
    return (
      <>
        <PageHeader title="Session" back="/" />
        <EmptyState title="Session not found">It may have been deleted.</EmptyState>
      </>
    )
  }
  if (!inProgress) return <Navigate to={`/history/${id}`} replace />

  const planned = view.items.filter((i) => !i.optional).reduce((n, i) => n + i.progress.planned, 0)
  const logged = view.items.reduce((n, i) => n + i.progress.logged, 0)
  const toDo = (itemId: string) =>
    view.items.some((i) => i.id !== itemId && !i.optional && !i.progress.complete)

  const onFinish = async () => {
    if (!(await finish.tryRun(id, { note: note.trim() }))) return
    setFinishing(false)
    void clearTimer.run()
    navigate(`/history/${id}`)
  }

  return (
    <>
      <PageHeader
        title={view.routineName ?? 'Session'}
        back="/"
        actions={
          <Button variant="ghost" onClick={() => setAbandoning(true)}>
            Abandon
          </Button>
        }
      />
      <p className={`${shared.muted} ${shared.small}`} style={{ marginTop: '-0.5rem' }}>
        {logged} {logged === 1 ? 'block' : 'blocks'} logged
        {planned > 0 ? ` of ${planned} planned` : ''}
        {view.totals.length > 0
          ? ` · ${view.totals.map((t) => formatAmount(t.amount, t.unitLabel)).join(' · ')}`
          : ''}
      </p>
      <Stack>
        {view.items.map((item) => (
          <ItemCard key={item.id} sessionId={id} item={item} othersToDo={toDo(item.id)} />
        ))}

        {view.items.length === 0 ? (
          <EmptyState title="No activities yet">Add what you’re doing in this session.</EmptyState>
        ) : null}

        <Button
          block
          icon="plus"
          onClick={() => setAdding(true)}
          disabled={view.addable.length === 0}
        >
          Add activity
        </Button>
        <Button variant="primary" block icon="check" onClick={() => setFinishing(true)}>
          Finish session
        </Button>
        {timer ? <div className={styles.spacer} /> : null}
      </Stack>

      {timer ? <RestTimerBar timer={timer} extendSec={settings?.restExtendSec ?? 30} /> : null}

      <Sheet open={adding} title="Add activity" onClose={() => setAdding(false)}>
        <div className={kit.stack}>
          <Field label="Planned blocks">
            <NumberStepper
              label="Planned blocks"
              value={addBlocks}
              onChange={setAddBlocks}
              step={1}
              min={1}
              max={50}
              decimals={0}
            />
          </Field>
          <div className={shared.choiceList}>
            {view.addable.map((a) => (
              <button
                key={a.id}
                type="button"
                className={shared.choice}
                onClick={() => {
                  setAdding(false)
                  void add.run(id, { activityId: a.id, blocks: addBlocks ?? 1 })
                }}
              >
                <span>{a.name}</span>
                <span className={shared.choiceHint}>
                  {formatAmount(a.defaultBlockAmount, a.unitLabel)} blocks
                </span>
              </button>
            ))}
          </div>
        </div>
      </Sheet>

      <Sheet open={finishing} title="Finish session" onClose={() => setFinishing(false)}>
        <div className={kit.stack}>
          {view.finish.empty ? (
            <p className={shared.muted}>
              Nothing is logged yet. You can still finish, or abandon it.
            </p>
          ) : view.finish.missing.length > 0 ? (
            <div>
              <p className={shared.muted} style={{ margin: 0 }}>
                Not done yet (only logged blocks count toward the week):
              </p>
              <ul className={shared.small}>
                {view.finish.missing.map((m) => (
                  <li key={m.sessionItemId}>
                    {m.activityName}: {m.blocks} {m.blocks === 1 ? 'block' : 'blocks'} left
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className={shared.muted}>All planned blocks logged.</p>
          )}
          {view.finish.skippedOptional.length > 0 ? (
            <p className={`${shared.muted} ${shared.small}`}>
              Optional, skipped: {view.finish.skippedOptional.map((s) => s.activityName).join(', ')}
            </p>
          ) : null}
          <Field label="Note" htmlFor="session-note">
            <input
              id="session-note"
              className={kit.input}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <div className={kit.actions}>
            <Button onClick={() => setFinishing(false)}>Keep going</Button>
            <Button variant="primary" disabled={finish.pending} onClick={() => void onFinish()}>
              Finish
            </Button>
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={abandoning}
        title="Abandon session?"
        danger
        confirmLabel="Abandon"
        onCancel={() => setAbandoning(false)}
        onConfirm={() => {
          setAbandoning(false)
          void abandon.tryRun(id).then((ok) => {
            if (!ok) return
            void clearTimer.run()
            navigate('/')
          })
        }}
      >
        It stays in your history but its blocks don’t count toward the week. You can restore it
        later.
      </ConfirmDialog>
    </>
  )
}
