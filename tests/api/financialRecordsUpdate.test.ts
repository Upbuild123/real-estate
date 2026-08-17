import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { createProperty } from '../../lib/properties'
import { PATCH } from '../../app/api/financial-records/[id]/route'

describe('PATCH /api/financial-records/:id', () => {
  it('updates the amount and sets source to manual', async () => {
    const property = await createProperty({ name: 'Correction Test', address: 'x' })
    const record = await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Utilities', amount: 5000, recurring: true, source: 'extracted' },
    })

    const request = new Request(`http://localhost/api/financial-records/${record.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ amount: 7500 }),
    })
    const response = await PATCH(request, { params: { id: record.id } })
    const body = await response.json()

    expect(body.amount).toBe(7500)
    expect(body.source).toBe('manual')
  })

  afterAll(async () => {
    await db.financialRecord.deleteMany({})
    await db.property.deleteMany({ where: { name: 'Correction Test' } })
    await db.$disconnect()
  })
})
