// tests/loans.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { createLoan, getLoanForProperty, monthlyInterestExpense, monthlyDebtService } from '../lib/loans'

describe('loans', () => {
  it('computes monthly interest expense from balance and annual rate', () => {
    // Ide loan: 104,968,000 balance, 1.825% annual rate
    // matches actual schedule: interest was 178,234 on a higher balance;
    // verify formula against known schedule row instead: DO5 loan
    // balance 210,700,000 at 1.825% -> monthly interest ≈ 320,439.58
    expect(monthlyInterestExpense(210700000, 1.825)).toBeCloseTo(320439.58, 1)
  })

  it('creates a loan and computes its debt service', async () => {
    const property = await createProperty({ name: 'Ide Loan Test', address: 'x' })
    const loan = await createLoan({
      propertyId: property.id,
      lender: 'Kiraboshi Bank',
      originalAmount: 110500000,
      currentBalance: 104968000,
      currentRate: 1.825,
      rateChangeDate: new Date('2026-09-01'),
      newRate: 2.075,
      monthlyPrincipal: 461000,
      originationDate: new Date('2025-07-31'),
      maturityDate: new Date('2045-07-31'),
    })
    const found = await getLoanForProperty(property.id)
    expect(found?.id).toBe(loan.id)
    const debtService = monthlyDebtService(loan)
    expect(debtService).toBeCloseTo(461000 + monthlyInterestExpense(104968000, 1.825), 1)
  })

  afterAll(async () => {
    await db.loan.deleteMany({})
    await db.property.deleteMany({ where: { name: 'Ide Loan Test' } })
    await db.$disconnect()
  })
})
