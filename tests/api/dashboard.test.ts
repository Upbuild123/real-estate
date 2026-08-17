import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { createProperty } from '../../lib/properties'
import { GET } from '../../app/api/dashboard/route'

describe('GET /api/dashboard', () => {
  it('returns range-aggregated financials for a period param (e.g. a full year)', async () => {
    const property = await createProperty({ name: 'Dashboard Route Period Test', address: 'x' })
    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2025-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, lineItemKey: 'k1', source: 'extracted' },
        { propertyId: property.id, month: '2025-06', category: 'income', accountItem: 'Rent', amount: 50000, recurring: true, lineItemKey: 'k2', source: 'extracted' },
      ],
    })

    const request = new Request(`http://localhost/api/dashboard?propertyId=${property.id}&period=2025-full`)
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.income).toBe(150000)

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('returns a single month for a YYYY-MM period', async () => {
    const property = await createProperty({ name: 'Dashboard Route Month Test', address: 'x' })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-03', category: 'income', accountItem: 'Rent', amount: 70000, recurring: true, lineItemKey: 'k3', source: 'extracted' },
    })

    const request = new Request(`http://localhost/api/dashboard?propertyId=${property.id}&period=2026-03`)
    const response = await GET(request)
    const body = await response.json()

    expect(body.income).toBe(70000)

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('returns 400 for a malformed period', async () => {
    const request = new Request('http://localhost/api/dashboard?propertyId=prop-1&period=garbage')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  it('returns 400 when propertyId is missing', async () => {
    const request = new Request('http://localhost/api/dashboard?period=2026-06')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
