import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import {
  getPropertyMonthlyDashboard,
  getPropertyYtdDashboard,
  getPortfolioDashboard,
  getPropertyRangeDashboard,
  getEarliestMonthWithData,
} from '../lib/dashboardData'

describe('dashboardData', () => {
  it('returns monthly financials plus open anomaly flags for a property', async () => {
    const property = await createProperty({ name: 'Dash Monthly Test', address: 'x' })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, lineItemKey: 'test-key-1', source: 'extracted' },
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
        { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, lineItemKey: 'test-key-2', source: 'extracted' },
        { propertyId: property.id, month: '2026-02', category: 'income', accountItem: 'Rent', amount: 110000, recurring: true, lineItemKey: 'test-key-3', source: 'extracted' },
        { propertyId: property.id, month: '2026-03', category: 'income', accountItem: 'Rent', amount: 999999, recurring: true, lineItemKey: 'test-key-4', source: 'extracted' }, // excluded, after throughMonth
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
      data: { propertyId: propertyA.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, lineItemKey: 'test-key-5', source: 'extracted' },
    })
    await db.financialRecord.create({
      data: { propertyId: propertyB.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 200000, recurring: true, lineItemKey: 'test-key-6', source: 'extracted' },
    })

    const result = await getPortfolioDashboard('2026-01')
    // getPortfolioDashboard sums across ALL active properties in the DB, not just ones this
    // test created — asserting against this test's own two properties (rather than the DB-wide
    // total/length) keeps the test correct regardless of what other active properties exist
    // (e.g. real properties seeded for local dev/testing).
    const propertyAEntry = result.perProperty.find((p) => p.propertyId === propertyA.id)
    const propertyBEntry = result.perProperty.find((p) => p.propertyId === propertyB.id)
    expect(propertyAEntry?.financials.income).toBe(100000)
    expect(propertyBEntry?.financials.income).toBe(200000)
    expect(result.income).toBeGreaterThanOrEqual(300000)
  })

  it('sums financials across an arbitrary list of months (getPropertyRangeDashboard)', async () => {
    const property = await createProperty({ name: 'Dash Range Test', address: 'x' })
    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2025-11', category: 'income', accountItem: 'Rent', amount: 50000, recurring: true, lineItemKey: 'test-key-7', source: 'extracted' },
        { propertyId: property.id, month: '2025-12', category: 'income', accountItem: 'Rent', amount: 60000, recurring: true, lineItemKey: 'test-key-8', source: 'extracted' },
        { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 999999, recurring: true, lineItemKey: 'test-key-9', source: 'extracted' }, // excluded, not in the requested range
      ],
    })
    await db.anomalyFlag.create({
      data: { propertyId: property.id, month: '2025-12', ruleType: 'negative_cash_flow', description: 'test flag', status: 'open' },
    })

    const result = await getPropertyRangeDashboard(property.id, ['2025-11', '2025-12'])
    expect(result.income).toBe(110000)
    expect(result.flags).toHaveLength(1)

    await db.anomalyFlag.deleteMany({ where: { propertyId: property.id } })
    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('returns the earliest month with any FinancialRecord for a property', async () => {
    const property = await createProperty({ name: 'Dash Earliest Month Test', address: 'x' })
    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-03', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'k10', source: 'extracted' },
        { propertyId: property.id, month: '2025-06', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'k11', source: 'extracted' },
      ],
    })

    expect(await getEarliestMonthWithData(property.id)).toBe('2025-06')

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('returns null for a property with no financial records', async () => {
    const property = await createProperty({ name: 'Dash No Data Test', address: 'x' })
    expect(await getEarliestMonthWithData(property.id)).toBeNull()
    await db.property.delete({ where: { id: property.id } })
  })

  afterAll(async () => {
    await db.anomalyFlag.deleteMany({})
    await db.financialRecord.deleteMany({})
    await db.property.deleteMany({
      where: {
        name: {
          in: [
            'Dash Monthly Test',
            'Dash YTD Test',
            'Portfolio A',
            'Portfolio B',
            'Dash Range Test',
            'Dash Earliest Month Test',
            'Dash No Data Test',
          ],
        },
      },
    })
    await db.$disconnect()
  })
})
