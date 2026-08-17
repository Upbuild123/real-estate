import { describe, it, expect } from 'vitest'
import { formatYenCompact } from '../lib/formatYen'

describe('formatYenCompact', () => {
  it('rounds to the nearest thousand and shows a K suffix', () => {
    expect(formatYenCompact(643124)).toBe('643K')
  })

  it('rounds fractional-yen amounts (e.g. amortized tax/insurance) to the nearest thousand', () => {
    expect(formatYenCompact(18991.666666666668)).toBe('19K')
  })

  it('shows an M suffix for amounts of 1,000,000 yen or more', () => {
    expect(formatYenCompact(5369011)).toBe('5.4M')
  })

  it('formats negative amounts with a leading minus sign', () => {
    expect(formatYenCompact(-121431.71499999997)).toBe('-121K')
  })

  it('formats zero as 0', () => {
    expect(formatYenCompact(0)).toBe('0')
  })

  it('rounds small amounts under 1000 to the nearest thousand too (shows 0 or 1K)', () => {
    expect(formatYenCompact(499)).toBe('0')
    expect(formatYenCompact(500)).toBe('1K')
  })
})
