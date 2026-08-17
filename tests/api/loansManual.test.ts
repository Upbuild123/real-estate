import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { createProperty } from '../../lib/properties'
import { POST } from '../../app/api/loans/route'

describe('POST /api/loans', () => {
  it('creates a loan from a valid body', async () => {
    const property = await createProperty({ name: 'Loan Route Test', address: 'x' })
    const request = new Request('http://localhost/api/loans', {
      method: 'POST',
      body: JSON.stringify({
        propertyId: property.id,
        lender: 'Kiraboshi Bank',
        originalAmount: 110500000,
        currentBalance: 104968000,
        currentRate: 1.825,
        monthlyPrincipal: 461000,
        originationDate: '2025-07-31',
        maturityDate: '2045-07-31',
      }),
    })
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.lender).toBe('Kiraboshi Bank')
    expect(body.propertyId).toBe(property.id)
  })

  it('returns 400 when required fields are missing', async () => {
    const request = new Request('http://localhost/api/loans', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'x' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 400 for malformed JSON body', async () => {
    const request = new Request('http://localhost/api/loans', {
      method: 'POST',
      body: '{not valid json',
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })
})

afterAll(async () => {
  await db.loan.deleteMany({})
  await db.property.deleteMany({ where: { name: 'Loan Route Test' } })
  await db.$disconnect()
})
