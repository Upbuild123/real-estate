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
        { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 859500, recurring: true, lineItemKey: 'test-key-1', source: 'extracted' },
        { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Property management fee', amount: 41073, recurring: true, lineItemKey: 'test-key-2', source: 'extracted' },
        { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Utilities', amount: 10226, recurring: true, lineItemKey: 'test-key-3', source: 'extracted' },
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

  it('allows taxable income and income tax owed to go negative when expenses and debt service exceed income', async () => {
    // Not floored at 0: a monthly loss must be able to offset gain months when summed into a
    // YTD/full-year total (via sumFinancials in lib/dashboardData.ts) — flooring here would
    // understate the aggregated loss and overstate the aggregated tax owed.
    const property = await createProperty({ name: 'Loss Test', address: 'x' })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-02', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'test-key-4', source: 'extracted' },
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
    await setSetting('marginalTaxRate', '0.43')
    const result = await getMonthlyFinancials(property.id, '2026-02')
    const expectedInterest = (100000000 * (2 / 100)) / 12
    const expectedTaxableIncome = 1000 - expectedInterest
    expect(result.taxableIncome).toBeCloseTo(expectedTaxableIncome, 1)
    expect(result.taxableIncome).toBeLessThan(0)
    expect(result.incomeTaxOwed).toBeCloseTo(expectedTaxableIncome * 0.43, 1)
    expect(result.incomeTaxOwed).toBeLessThan(0)
  })

  it('handles a property with no loan (interest, principal, and debt service all zero)', async () => {
    const property = await createProperty({ name: 'No Loan Test', address: 'x' })

    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-03', category: 'income', accountItem: 'Rent', amount: 500000, recurring: true, lineItemKey: 'test-key-5', source: 'extracted' },
        { propertyId: property.id, month: '2026-03', category: 'expense', accountItem: 'Utilities', amount: 20000, recurring: true, lineItemKey: 'test-key-6', source: 'extracted' },
      ],
    })

    await upsertAnnualCost({ propertyId: property.id, costType: 'tax', year: 2026, annualAmount: 120000 })
    await upsertAnnualCost({ propertyId: property.id, costType: 'insurance', year: 2026, annualAmount: 24000 })

    const result = await getMonthlyFinancials(property.id, '2026-03')

    expect(result.income).toBe(500000)
    expect(result.operatingExpenses).toBe(20000)
    expect(result.noi).toBe(480000)
    expect(result.interestExpense).toBe(0)
    expect(result.principalPaydown).toBe(0)
    expect(result.debtService).toBe(0)

    const expectedPreTaxCashFlow = result.noi - result.amortizedTax - result.amortizedInsurance
    expect(result.preTaxCashFlow).toBeCloseTo(expectedPreTaxCashFlow, 1)
  })

  it('depreciation reduces taxable income (and thus tax owed) but never touches cash flow, since it is not a cash expense', async () => {
    const property = await createProperty({ name: 'Depreciation Calc Test', address: 'x' })

    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-05', category: 'income', accountItem: 'Rent', amount: 1000000, recurring: true, lineItemKey: 'test-key-dep', source: 'extracted' },
    })
    await upsertAnnualCost({ propertyId: property.id, costType: 'depreciation', year: 2026, annualAmount: 1670000 })
    await setSetting('marginalTaxRate', '0.43')

    const withDepreciation = await getMonthlyFinancials(property.id, '2026-05')

    const expectedAmortizedDepreciation = 1670000 / 12
    expect(withDepreciation.amortizedDepreciation).toBeCloseTo(expectedAmortizedDepreciation, 2)

    const expectedTaxableIncome = 1000000 - expectedAmortizedDepreciation
    expect(withDepreciation.taxableIncome).toBeCloseTo(expectedTaxableIncome, 1)
    expect(withDepreciation.incomeTaxOwed).toBeCloseTo(expectedTaxableIncome * 0.43, 1)

    // Cash flow must equal NOI exactly here (no loan, no tax/insurance) — depreciation must
    // not appear in either cash flow figure despite reducing the tax bill.
    expect(withDepreciation.preTaxCashFlow).toBe(1000000)
    expect(withDepreciation.afterTaxCashFlow).toBeCloseTo(1000000 - expectedTaxableIncome * 0.43, 1)
  })

  it('handles a month with no financial records without throwing', async () => {
    const property = await createProperty({ name: 'Empty Month Test', address: 'x' })

    const result = await getMonthlyFinancials(property.id, '2026-04')

    expect(result.income).toBe(0)
    expect(result.operatingExpenses).toBe(0)
    expect(result.noi).toBe(0)
  })

  afterAll(async () => {
    await db.financialRecord.deleteMany({})
    await db.loan.deleteMany({})
    await db.annualCost.deleteMany({})
    await db.setting.deleteMany({ where: { key: 'marginalTaxRate' } })
    await db.property.deleteMany({
      where: { name: { in: ['Ide Calc Test', 'Loss Test', 'No Loan Test', 'Empty Month Test', 'Depreciation Calc Test'] } },
    })
    await db.$disconnect()
  })
})
