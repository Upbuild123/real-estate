import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { runAnomalyRules } from '../lib/anomalyRules'

async function seedRecurringExpense(propertyId: string, month: string, amount: number) {
  await db.financialRecord.create({
    data: { propertyId, month, category: 'expense', accountItem: 'Electricity charge', amount, recurring: true, source: 'extracted' },
  })
}

describe('runAnomalyRules', () => {
  it('flags a recurring expense that deviates more than 50% from its trailing 3-month average', async () => {
    const property = await createProperty({ name: 'Anomaly Test', address: 'x' })
    await seedRecurringExpense(property.id, '2025-11', 10000)
    await seedRecurringExpense(property.id, '2025-12', 10000)
    await seedRecurringExpense(property.id, '2026-01', 10000)
    await seedRecurringExpense(property.id, '2026-02', 50000) // huge spike

    const flags = await runAnomalyRules(property.id, '2026-02')

    expect(flags.some((f) => f.ruleType === 'expense_deviation' && f.description.includes('Electricity charge'))).toBe(true)
  })

  it('does not flag a recurring expense within normal range', async () => {
    const property = await createProperty({ name: 'Normal Range Test', address: 'x' })
    await seedRecurringExpense(property.id, '2025-11', 10000)
    await seedRecurringExpense(property.id, '2025-12', 10500)
    await seedRecurringExpense(property.id, '2026-01', 9800)
    await seedRecurringExpense(property.id, '2026-02', 10200)

    const flags = await runAnomalyRules(property.id, '2026-02')
    expect(flags.some((f) => f.ruleType === 'expense_deviation')).toBe(false)
  })

  it('flags a missing statement past the 20th of the month', async () => {
    const property = await createProperty({ name: 'Missing Statement Test', address: 'x' })
    const targetMonth = '2026-03'
    // simulate "today" via a rule param instead of relying on real clock in tests
    const flags = await runAnomalyRules(property.id, targetMonth, { today: new Date('2026-04-25') })
    expect(flags.some((f) => f.ruleType === 'missing_statement')).toBe(true)
  })

  it('does not flag a missing statement before the 20th of the following month', async () => {
    const property = await createProperty({ name: 'Not Yet Late Test', address: 'x' })
    const flags = await runAnomalyRules(property.id, '2026-03', { today: new Date('2026-04-10') })
    expect(flags.some((f) => f.ruleType === 'missing_statement')).toBe(false)
  })

  it('flags negative cash flow after debt service', async () => {
    const property = await createProperty({ name: 'Negative Cashflow Test', address: 'x' })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, source: 'extracted' },
    })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Repair expense', amount: 500000, recurring: false, source: 'extracted' },
    })
    const flags = await runAnomalyRules(property.id, '2026-01')
    expect(flags.some((f) => f.ruleType === 'negative_cash_flow')).toBe(true)
  })

  it('does not create a duplicate open flag if the rule already fired for this property/month', async () => {
    const property = await createProperty({ name: 'Dedupe Test', address: 'x' })
    await seedRecurringExpense(property.id, '2025-11', 10000)
    await seedRecurringExpense(property.id, '2025-12', 10000)
    await seedRecurringExpense(property.id, '2026-01', 10000)
    await seedRecurringExpense(property.id, '2026-02', 50000)

    await runAnomalyRules(property.id, '2026-02')
    await runAnomalyRules(property.id, '2026-02')

    const allFlags = await db.anomalyFlag.findMany({
      where: { propertyId: property.id, month: '2026-02', ruleType: 'expense_deviation' },
    })
    expect(allFlags).toHaveLength(1)
  })

  it('creates exactly one expense_deviation flag covering multiple deviating account items in the same month', async () => {
    const property = await createProperty({ name: 'Multi Deviation Test', address: 'x' })

    await seedRecurringExpense(property.id, '2025-11', 10000)
    await seedRecurringExpense(property.id, '2025-12', 10000)
    await seedRecurringExpense(property.id, '2026-01', 10000)
    await seedRecurringExpense(property.id, '2026-02', 50000) // Electricity charge spike

    async function seedWaterCharge(month: string, amount: number) {
      await db.financialRecord.create({
        data: { propertyId: property.id, month, category: 'expense', accountItem: 'Water charge', amount, recurring: true, source: 'extracted' },
      })
    }
    await seedWaterCharge('2025-11', 5000)
    await seedWaterCharge('2025-12', 5000)
    await seedWaterCharge('2026-01', 5000)
    await seedWaterCharge('2026-02', 30000) // Water charge spike

    await runAnomalyRules(property.id, '2026-02')

    const allFlags = await db.anomalyFlag.findMany({
      where: { propertyId: property.id, month: '2026-02', ruleType: 'expense_deviation' },
    })

    expect(allFlags).toHaveLength(1)
    expect(allFlags[0].description).toContain('Electricity charge')
    expect(allFlags[0].description).toContain('Water charge')
  })

  afterAll(async () => {
    await db.anomalyFlag.deleteMany({})
    await db.financialRecord.deleteMany({})
    await db.property.deleteMany({
      where: {
        name: {
          in: [
            'Anomaly Test',
            'Normal Range Test',
            'Missing Statement Test',
            'Not Yet Late Test',
            'Negative Cashflow Test',
            'Dedupe Test',
            'Multi Deviation Test',
          ],
        },
      },
    })
    await db.$disconnect()
  })
})
