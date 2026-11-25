import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ServiceError } from '@/services/errors'
import { loadSettings, updateSettings } from '@/services/settings'
import { useCommand, useLive, useToday } from './hooks'
import { disposeCtx, renderScreen, type TestCtx } from './testing'

const ctxs: TestCtx[] = []
afterEach(async () => {
  for (const c of ctxs.splice(0)) await disposeCtx(c)
})

function track<T extends { ctx: TestCtx }>(r: T): T {
  ctxs.push(r.ctx)
  return r
}

function ProfileName() {
  const { data, loading } = useLive((ctx) => loadSettings(ctx), [])
  const today = useToday()
  if (loading) return <p>loading</p>
  return (
    <p>
      reminder {data?.backupReminderDays} today {today}
    </p>
  )
}

function Commands() {
  const ok = useCommand((ctx) => updateSettings(ctx, { backupReminderDays: 14 }), {
    success: 'Saved',
  })
  const bad = useCommand(async () => {
    throw new ServiceError('nope', 'That is not allowed')
  })
  return (
    <>
      <button onClick={() => void ok.run()}>ok</button>
      <button onClick={() => void bad.run()}>bad</button>
      <ProfileName />
    </>
  )
}

describe('app hooks', () => {
  it('reads live data and today from the service context', async () => {
    track(renderScreen(<ProfileName />))
    expect(await screen.findByText('reminder 7 today 2026-11-23')).toBeInTheDocument()
  })

  it('re-renders when a command changes the data, and toasts success and ServiceErrors', async () => {
    track(renderScreen(<Commands />))
    await screen.findByText(/reminder 7/)
    await userEvent.click(screen.getByRole('button', { name: 'ok' }))
    await waitFor(() => expect(screen.getByText(/reminder 14/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'bad' }))
    expect(await screen.findByRole('button', { name: 'That is not allowed' })).toBeInTheDocument()
  })
})
