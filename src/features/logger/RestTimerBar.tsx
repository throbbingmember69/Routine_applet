import { useEffect, useState } from 'react'
import { useCommand, useCtx } from '@/app/hooks'
import { restView, type RestTimer } from '@/domain/restTimer'
import { clearRestTimer, extendRestTimer } from '@/services/sessions/restTimerState'
import { formatClock } from '@/ui/format'
import { Button } from '@/ui/kit'
import styles from './logger.module.css'

/** Sticky countdown to the end of the rest (then overtime), with +N s and Skip. */
export default function RestTimerBar({
  timer,
  extendSec,
}: {
  timer: RestTimer
  extendSec: number
}) {
  const ctx = useCtx()
  const [now, setNow] = useState(() => ctx.now())
  useEffect(() => {
    const id = setInterval(() => setNow(ctx.now()), 250)
    return () => clearInterval(id)
  }, [ctx])
  const extend = useCommand(extendRestTimer)
  const skip = useCommand(clearRestTimer)
  const view = restView(timer, now)
  const range = timer.restMaxSec > timer.restMinSec
  const label =
    view.stage === 'rest'
      ? 'Rest'
      : view.stage === 'min' && range
        ? 'Rest done · up to max'
        : 'Rest over · next block'
  // Counts down to the minimum rest, then to the maximum (a range), then shows overtime (+m:ss).
  const maxMs = (Math.max(timer.restMinSec, timer.restMaxSec) + timer.extendedSec) * 1000
  const clock = formatClock(
    view.stage === 'rest'
      ? view.msToMin
      : view.stage === 'min'
        ? view.msToMax
        : maxMs - view.elapsedMs,
  )
  return (
    <div className={styles.timerBar} data-stage={view.stage} role="timer" aria-live="off">
      <div className={styles.timerClock}>
        {clock}
        <span className={styles.timerLabel}>{label}</span>
      </div>
      <Button onClick={() => void extend.run()} aria-label={`Add ${extendSec} seconds`}>
        +{extendSec}s
      </Button>
      <Button variant="ghost" onClick={() => void skip.run()}>
        {view.stage === 'rest' ? 'Skip' : 'Close'}
      </Button>
    </div>
  )
}
