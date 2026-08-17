import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { createProperty } from '../../lib/properties'
import { PATCH } from '../../app/api/financial-records/[id]/route'

describe('PATCH /api/financial-records/:id', () => {
  it('updates the amount and sets source to manual', async () => {
    const property = await createProperty({ name: 'Correction Test', address: 'x' })
    const record = await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Utilities', amount: 5000, recurring: true, lineItemKey: 'test-key-1', source: 'extracted' },
    })

    const request = new Request(`http://localhost/api/financial-records/${record.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ amount: 7500 }),
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: record.id }) })
    const body = await response.json()

    expect(body.amount).toBe(7500)
    expect(body.source).toBe('manual')
  })

  it('returns 400 when amount is missing or not a number', async () => {
    const property = await createProperty({ name: 'Correction Test', address: 'x' })
    const record = await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Utilities', amount: 5000, recurring: true, lineItemKey: 'test-key-2', source: 'extracted' },
    })

    const request = new Request(`http://localhost/api/financial-records/${record.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ amount: 'not-a-number' }),
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: record.id }) })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 404 when the financial record does not exist', async () => {
    const request = new Request('http://localhost/api/financial-records/nonexistent-id', {
      method: 'PATCH',
      body: JSON.stringify({ amount: 100 }),
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: 'nonexistent-id' }) })
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toBe('Financial record not found')
  })

  it('returns 400 for malformed JSON body', async () => {
    const property = await createProperty({ name: 'Correction Test', address: 'x' })
    const record = await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Utilities', amount: 5000, recurring: true, lineItemKey: 'test-key-3', source: 'extracted' },
    })

    const request = new Request(`http://localhost/api/financial-records/${record.id}`, {
      method: 'PATCH',
      body: '{not valid json',
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: record.id }) })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  afterAll(async () => {
    await db.financialRecord.deleteMany({})
    await db.property.deleteMany({ where: { name: 'Correction Test' } })
    await db.$disconnect()
  })
})
