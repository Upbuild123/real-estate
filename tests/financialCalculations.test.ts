import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { createLoan } from '../lib/loans'
import { upsertAnnualCost } from '../lib/annualCosts'
import { setSetting } from '../lib/settings'
import { getMonthlyFinancials } from '../lib/financialCalculations'

describe('getMonthlyFinancials', () => {
  it('computes NOI, debt service, and pre/after-tax cash flow for a month with income, expenses, a loan, tax, and insurance', async () => {
    const property = await createProperty({ name: 'Ide Calc Test', address: 'x' })

    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 859500, recurring: true, source: 'extracted' },
        { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Property management fee', amount: 41073, recurring: true, source: 'extracted' },
        { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Utilities', amount: 10226, recurring: true, source: 'extracted' },
      ],
    })

    await createLoan({
      propertyId: property.id,
      lender: 'Kiraboshi Bank',
      originalAmount: 110500000,
      currentBalance: 104968000,
      currentRate: 1.825,
      monthlyPrincipal: 461000,
      originationDate: new Date('2025-07-31'),
      maturityDate: new Date('2045-07-31'),
    })

    await upsertAnnualCost({ propertyId: property.id, costType: 'tax', year: 2026, annualAmount: 227900 })
    await upsertAnnualCost({ propertyId: property.id, costType: 'insurance', year: 2026, annualAmount: 46040 })
    await setSetting('marginalTaxRate', '0.43')

    const result = await getMonthlyFinancials(property.id, '2026-01')

    expect(result.income).toBe(859500)
    expect(result.operatingExpenses).toBe(51299) // 41073 + 10226
    expect(result.noi).toBe(808201) // 859500 - 51299
    const expectedInterest = (104968000 * (1.825 / 100)) / 12
    expect(result.interestExpense).toBeCloseTo(expectedInterest, 1)
    expect(result.debtService).toBeCloseTo(461000 + expectedInterest, 1)
    expect(result.principalPaydown).toBe(461000)
    expect(result.amortizedTax).toBeCloseTo(227900 / 12, 2)
    expect(result.amortizedInsurance).toBeCloseTo(46040 / 12, 2)

    const expectedTaxableIncome = result.noi - result.interestExpense - result.amortizedTax - result.amortizedInsurance
    expect(result.taxableIncome).toBeCloseTo(expectedTaxableIncome, 1)
    expect(result.incomeTaxOwed).toBeCloseTo(expectedTaxableIncome * 0.43, 1)

    const expectedPreTaxCashFlow = result.noi - result.debtService - result.amortizedTax - result.amortizedInsurance
    expect(result.preTaxCashFlow).toBeCloseTo(expectedPreTaxCashFlow, 1)
    expect(result.afterTaxCashFlow).toBeCloseTo(expectedPreTaxCashFlow - result.incomeTaxOwed, 1)
  })

  it('floors taxable income at 0 when expenses and debt service exceed income', async () => {
    const property = await createProperty({ name: 'Loss Test', address: 'x' })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-02', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, source: 'extracted' },
    })
    await createLoan({
      propertyId: property.id,
      lender: 'Kiraboshi Bank',
      originalAmount: 100000000,
      currentBalance: 100000000,
      currentRate: 2,
      monthlyPrincipal: 500000,
      originationDate: new Date('2025-01-01'),
      maturityDate: new Date('2045-01-01'),
    })
    const result = await getMonthlyFinancials(property.id, '2026-02')
    expect(result.taxableIncome).toBe(0)
    expect(result.incomeTaxOwed).toBe(0)
  })

  afterAll(async () => {
    await db.financialRecord.deleteMany({})
    await db.loan.deleteMany({})
    await db.annualCost.deleteMany({})
    await db.setting.deleteMany({ where: { key: 'marginalTaxRate' } })
    await db.property.deleteMany({ where: { name: { in: ['Ide Calc Test', 'Loss Test'] } } })
    await db.$disconnect()
  })
})
