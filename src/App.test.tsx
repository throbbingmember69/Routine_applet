import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import ServicesProvider from './app/ServicesProvider'
import ToastProvider from './app/ToastProvider'
import { disposeCtx, type TestCtx } from './app/testing'
import { createTestCtx } from './services/context'

let ctx: TestCtx

function renderApp() {
  return render(
    <ServicesProvider ctx={ctx}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ServicesProvider>,
  )
}

describe('App shell', () => {
  beforeEach(() => {
    window.location.hash = '#/'
    ctx = createTestCtx()
  })
  afterEach(async () => {
    await disposeCtx(ctx)
  })

  it('renders Today with the bottom navigation', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const tab of ['Today', 'Week', 'History', 'More']) {
      expect(nav).toHaveTextContent(tab)
    }
  })

  it('navigates between tabs with hash routing', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Today' })
    await userEvent.click(screen.getByRole('link', { name: 'More' }))
    expect(await screen.findByRole('heading', { name: 'More' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/more')
    expect(screen.getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page')
  })
})
