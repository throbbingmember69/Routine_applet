import { describe, expect, it } from 'vitest'
import { progressLine, stepFor } from './amounts'

describe('amount helpers', () => {
  it('picks a step that suits the block size', () => {
    expect([stepFor(25), stepFor(20), stepFor(8), stepFor(2.5), stepFor(0.5)]).toEqual([
      5, 5, 1, 0.5, 0.1,
    ])
  })

  it('writes the weekly progress line', () => {
    expect(progressLine({ target: 300, done: 120, remaining: 180, status: 'under' }, 'min')).toBe(
      '120 / 300 min · 180 to go',
    )
    expect(progressLine({ target: 300, done: 310, remaining: 0, status: 'met' }, 'min')).toBe(
      'Met · 310 / 300 min',
    )
    expect(progressLine({ target: null, done: 45, remaining: null, status: 'none' }, 'pages')).toBe(
      '45 pages this week',
    )
  })
})
