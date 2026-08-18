import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { upsertAnnualCost, getMonthlyAmortizedCost } from '../lib/annualCosts'

describe('annualCosts', () => {
  it('stores Ide tax and returns correct monthly amortization', async () => {
    const property = await createProperty({ name: 'Ide Test', address: 'x' })
    await upsertAnnualCost({ propertyId: property.id, costType: 'tax', year: 2026, annualAmount: 227900 })
    const monthly = await getMonthlyAmortizedCost(property.id, 'tax', 2026)
    expect(monthly).toBeCloseTo(18991.67, 2)
  })

  it('stores DO5 insurance and returns correct monthly amortization', async () => {
    const property = await createProperty({ name: 'DO5 Test', address: 'x' })
    await upsertAnnualCost({ propertyId: property.id, costType: 'insurance', year: 2026, annualAmount: 117402 })
    const monthly = await getMonthlyAmortizedCost(property.id, 'insurance', 2026)
    expect(monthly).toBeCloseTo(9783.5, 2)
  })

  it('stores depreciation and returns correct monthly amortization', async () => {
    const property = await createProperty({ name: 'Depreciation Test', address: 'x' })
    await upsertAnnualCost({ propertyId: property.id, costType: 'depreciation', year: 2026, annualAmount: 3330000 })
    const monthly = await getMonthlyAmortizedCost(property.id, 'depreciation', 2026)
    expect(monthly).toBeCloseTo(277500, 2)
  })

  it('returns 0 when no annual cost is recorded for that year', async () => {
    const property = await createProperty({ name: 'No Cost Test', address: 'x' })
    const monthly = await getMonthlyAmortizedCost(property.id, 'tax', 2026)
    expect(monthly).toBe(0)
  })

  afterAll(async () => {
    await db.annualCost.deleteMany({})
    await db.property.deleteMany({ where: { name: { in: ['Ide Test', 'DO5 Test', 'No Cost Test', 'Depreciation Test'] } } })
    await db.$disconnect()
  })
})
