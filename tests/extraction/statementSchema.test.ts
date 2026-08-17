import { describe, it, expect } from 'vitest'
import { isRecurringAccountItem } from '../../lib/extraction/statementSchema'

describe('isRecurringAccountItem', () => {
  it('classifies rent, PM fee, electricity, cleaning, elevator maintenance as recurring', () => {
    expect(isRecurringAccountItem('Rent')).toBe(true)
    expect(isRecurringAccountItem('Property management fee')).toBe(true)
    expect(isRecurringAccountItem('Electricity charge')).toBe(true)
    expect(isRecurringAccountItem('Regular cleaning')).toBe(true)
    expect(isRecurringAccountItem('Building Management fee')).toBe(true)
    expect(isRecurringAccountItem('Elevator maintenance fee')).toBe(true)
  })

  it('classifies renewal fees, deposits, restoration, agent fees as one-time', () => {
    expect(isRecurringAccountItem('Renewal fee')).toBe(false)
    expect(isRecurringAccountItem('Renewal fee income')).toBe(false)
    expect(isRecurringAccountItem('Deposit')).toBe(false)
    expect(isRecurringAccountItem('Deposit refund')).toBe(false)
    expect(isRecurringAccountItem('Restration cost')).toBe(false)
    expect(isRecurringAccountItem('Restration cost received')).toBe(false)
    expect(isRecurringAccountItem('Building maintenance fee')).toBe(false)
    expect(isRecurringAccountItem('Brokerage fee')).toBe(false)
    expect(isRecurringAccountItem('Agent fee')).toBe(false)
    expect(isRecurringAccountItem('Co-agent fee')).toBe(false)
    expect(isRecurringAccountItem('Repair expense')).toBe(false)
    expect(isRecurringAccountItem('Cancellation penalty income')).toBe(false)
    expect(isRecurringAccountItem('Miscellaneous income')).toBe(false)
  })

  it('defaults unknown account items to one-time (conservative default)', () => {
    expect(isRecurringAccountItem('Some new category never seen before')).toBe(false)
  })

  it('is case-insensitive and tolerant of surrounding whitespace', () => {
    expect(isRecurringAccountItem('  rent  ')).toBe(true)
    expect(isRecurringAccountItem('ELECTRICITY CHARGE')).toBe(true)
  })
})
