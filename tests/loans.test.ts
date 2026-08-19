// tests/loans.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { createLoan, getLoanForProperty, monthlyInterestExpense, monthlyDebtService, loanBalanceRange, getPortfolioLoanBalanceRange } from '../lib/loans'

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

  it('computes starting/ending balance for a single month equal to referenceMonth, using currentBalance as the ending balance', () => {
    const loan = { currentBalance: 100000000, monthlyPrincipal: 500000 }
    const result = loanBalanceRange(loan, ['2026-07'], '2026-07')
    expect(result.endingBalance).toBe(100000000)
    expect(result.startingBalance).toBe(100500000)
  })

  it('projects a higher balance for a past month, before more paydowns had happened', () => {
    const loan = { currentBalance: 100000000, monthlyPrincipal: 500000 }
    // referenceMonth (2026-07) is 3 months after the requested month (2026-04): the balance
    // back then was higher by 3 months of paydown that have since occurred.
    const result = loanBalanceRange(loan, ['2026-04'], '2026-07')
    expect(result.endingBalance).toBe(101500000) // 100M + 3 * 500K
    expect(result.startingBalance).toBe(102000000) // ending + this month's own paydown
  })

  it('spans starting balance from the first month and ending balance from the last month of a multi-month period', () => {
    const loan = { currentBalance: 100000000, monthlyPrincipal: 500000 }
    const result = loanBalanceRange(loan, ['2026-05', '2026-06', '2026-07'], '2026-07')
    expect(result.endingBalance).toBe(100000000) // end of 2026-07 (== referenceMonth) is currentBalance
    expect(result.startingBalance).toBe(101500000) // before 2026-05's paydown: 3 payments (May, Jun, Jul) hadn't happened yet
  })

  it('sums loanBalanceRange across every active property\'s loan (getPortfolioLoanBalanceRange)', async () => {
    const propertyA = await createProperty({ name: 'Portfolio Loan Test A', address: 'x' })
    const propertyB = await createProperty({ name: 'Portfolio Loan Test B', address: 'x' })
    await createLoan({
      propertyId: propertyA.id,
      lender: 'Bank A',
      originalAmount: 100000000,
      currentBalance: 90000000,
      currentRate: 1.5,
      monthlyPrincipal: 400000,
      originationDate: new Date('2020-01-01'),
      maturityDate: new Date('2040-01-01'),
    })
    await createLoan({
      propertyId: propertyB.id,
      lender: 'Bank B',
      originalAmount: 50000000,
      currentBalance: 40000000,
      currentRate: 1.8,
      monthlyPrincipal: 200000,
      originationDate: new Date('2021-01-01'),
      maturityDate: new Date('2041-01-01'),
    })

    const result = await getPortfolioLoanBalanceRange(['2026-07'], '2026-07')

    // Sums across ALL active properties in the DB — assert this test's two loans are both
    // reflected in the total (lower bound), consistent with the existing portfolio test pattern.
    expect(result.endingBalance).toBeGreaterThanOrEqual(90000000 + 40000000)
    expect(result.startingBalance).toBeGreaterThanOrEqual(90400000 + 40200000)

    await db.loan.deleteMany({ where: { propertyId: { in: [propertyA.id, propertyB.id] } } })
    await db.property.deleteMany({ where: { id: { in: [propertyA.id, propertyB.id] } } })
  })

  afterAll(async () => {
    await db.loan.deleteMany({})
    await db.property.deleteMany({ where: { name: 'Ide Loan Test' } })
    await db.$disconnect()
  })
})
