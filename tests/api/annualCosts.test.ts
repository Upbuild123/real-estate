import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { createProperty } from '../../lib/properties'
import { POST } from '../../app/api/annual-costs/route'

describe('POST /api/annual-costs', () => {
  it('upserts an annual cost from a valid body', async () => {
    const property = await createProperty({ name: 'Annual Cost Route Test', address: 'x' })
    const request = new Request('http://localhost/api/annual-costs', {
      method: 'POST',
      body: JSON.stringify({ propertyId: property.id, costType: 'tax', year: 2026, annualAmount: 227900 }),
    })
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.costType).toBe('tax')
    expect(body.annualAmount).toBe(227900)
  })

  it('returns 400 for an invalid costType', async () => {
    const property = await createProperty({ name: 'Annual Cost Route Test 2', address: 'x' })
    const request = new Request('http://localhost/api/annual-costs', {
      method: 'POST',
      body: JSON.stringify({ propertyId: property.id, costType: 'bogus', year: 2026, annualAmount: 1000 }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 400 for malformed JSON body', async () => {
    const request = new Request('http://localhost/api/annual-costs', {
      method: 'POST',
      body: '{not valid json',
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })
})

afterAll(async () => {
  await db.annualCost.deleteMany({})
  await db.property.deleteMany({ where: { name: { in: ['Annual Cost Route Test', 'Annual Cost Route Test 2'] } } })
  await db.$disconnect()
})
