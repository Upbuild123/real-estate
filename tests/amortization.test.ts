import { describe, it, expect } from 'vitest'
import { amortizeAnnual } from '../lib/amortization'

describe('amortizeAnnual', () => {
  it('divides an annual amount evenly by 12', () => {
    expect(amortizeAnnual(1203400)).toBeCloseTo(100283.33, 2)
  })

  it('handles amounts that divide evenly', () => {
    expect(amortizeAnnual(120000)).toBe(10000)
  })
})
