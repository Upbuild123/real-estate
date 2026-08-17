import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { getPropertyMonthlyDashboard, getPropertyYtdDashboard, getPortfolioDashboard } from '../lib/dashboardData'

describe('dashboardData', () => {
  it('returns monthly financials plus open anomaly flags for a property', async () => {
    const property = await createProperty({ name: 'Dash Monthly Test', address: 'x' })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, source: 'extracted' },
    })
    await db.anomalyFlag.create({
      data: { propertyId: property.id, month: '2026-01', ruleType: 'negative_cash_flow', description: 'test flag', status: 'open' },
    })

    const result = await getPropertyMonthlyDashboard(property.id, '2026-01')
    expect(result.income).toBe(100000)
    expect(result.flags).toHaveLength(1)

    await db.anomalyFlag.deleteMany({ where: { propertyId: property.id } })
    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('sums financials across Jan through the given month for YTD', async () => {
    const property = await createProperty({ name: 'Dash YTD Test', address: 'x' })
    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, source: 'extracted' },
        { propertyId: property.id, month: '2026-02', category: 'income', accountItem: 'Rent', amount: 110000, recurring: true, source: 'extracted' },
        { propertyId: property.id, month: '2026-03', category: 'income', accountItem: 'Rent', amount: 999999, recurring: true, source: 'extracted' }, // excluded, after throughMonth
      ],
    })

    const result = await getPropertyYtdDashboard(property.id, 2026, 2)
    expect(result.income).toBe(210000)

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('aggregates portfolio-wide totals across all active properties for a month', async () => {
    const propertyA = await createProperty({ name: 'Portfolio A', address: 'x' })
    const propertyB = await createProperty({ name: 'Portfolio B', address: 'x' })
    await db.financialRecord.create({
      data: { propertyId: propertyA.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, source: 'extracted' },
    })
    await db.financialRecord.create({
      data: { propertyId: propertyB.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 200000, recurring: true, source: 'extracted' },
    })

    const result = await getPortfolioDashboard('2026-01')
    expect(result.income).toBe(300000)
    expect(result.perProperty).toHaveLength(2)
    expect(result.perProperty.find((p) => p.propertyName === 'Portfolio A')?.financials.income).toBe(100000)
  })

  afterAll(async () => {
    await db.anomalyFlag.deleteMany({})
    await db.financialRecord.deleteMany({})
    await db.property.deleteMany({
      where: { name: { in: ['Dash Monthly Test', 'Dash YTD Test', 'Portfolio A', 'Portfolio B'] } },
    })
    await db.$disconnect()
  })
})
