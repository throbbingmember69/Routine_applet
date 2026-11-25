import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import NumberStepper from './NumberStepper'

function StepperHarness({ initial, decimals = 1 }: { initial: number | null; decimals?: number }) {
  const [v, setV] = useState<number | null>(initial)
  return (
    <>
      <NumberStepper label="Reps" value={v} onChange={setV} step={1} min={0} decimals={decimals} />
      <output data-testid="value">{v === null ? 'null' : String(v)}</output>
    </>
  )
}

describe('NumberStepper', () => {
  it('bumps by the step and respects min', async () => {
    render(<StepperHarness initial={1} decimals={0} />)
    await userEvent.click(screen.getByRole('button', { name: 'Increase Reps' }))
    expect(screen.getByTestId('value')).toHaveTextContent('2')
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Reps' }))
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Reps' }))
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Reps' }))
    expect(screen.getByTestId('value')).toHaveTextContent('0')
  })

  it('commits typed values on blur, accepting a comma decimal', async () => {
    render(<StepperHarness initial={null} />)
    const input = screen.getByLabelText('Reps')
    await userEvent.click(input)
    await userEvent.type(input, '37,5')
    await userEvent.tab()
    expect(screen.getByTestId('value')).toHaveTextContent('37.5')
  })

  it('clears to null when emptied and ignores garbage', async () => {
    render(<StepperHarness initial={8} />)
    const input = screen.getByLabelText('Reps')
    await userEvent.clear(input)
    await userEvent.tab()
    expect(screen.getByTestId('value')).toHaveTextContent('null')
    await userEvent.click(input)
    await userEvent.type(input, 'abc')
    await userEvent.tab()
    expect(screen.getByTestId('value')).toHaveTextContent('null')
  })
})
