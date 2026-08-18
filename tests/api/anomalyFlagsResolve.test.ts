import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { createProperty } from '../../lib/properties'
import { PATCH } from '../../app/api/anomaly-flags/[id]/route'

describe('PATCH /api/anomaly-flags/:id', () => {
  it('sets status to resolved', async () => {
    const property = await createProperty({ name: 'Flag Resolve Test', address: 'x' })
    const flag = await db.anomalyFlag.create({
      data: { propertyId: property.id, month: '2026-01', ruleType: 'unrecognized_expense', description: 'test flag', status: 'open' },
    })

    const request = new Request(`http://localhost/api/anomaly-flags/${flag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved' }),
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: flag.id }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('resolved')
  })

  it('rejects a status value other than open or resolved', async () => {
    const property = await createProperty({ name: 'Flag Resolve Test', address: 'x' })
    const flag = await db.anomalyFlag.create({
      data: { propertyId: property.id, month: '2026-01', ruleType: 'unrecognized_expense', description: 'test flag', status: 'open' },
    })

    const request = new Request(`http://localhost/api/anomaly-flags/${flag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: flag.id }) })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 404 when the flag does not exist', async () => {
    const request = new Request('http://localhost/api/anomaly-flags/nonexistent-id', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved' }),
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: 'nonexistent-id' }) })
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toBe('Anomaly flag not found')
  })

  it('returns 400 for malformed JSON body', async () => {
    const property = await createProperty({ name: 'Flag Resolve Test', address: 'x' })
    const flag = await db.anomalyFlag.create({
      data: { propertyId: property.id, month: '2026-01', ruleType: 'unrecognized_expense', description: 'test flag', status: 'open' },
    })

    const request = new Request(`http://localhost/api/anomaly-flags/${flag.id}`, {
      method: 'PATCH',
      body: '{not valid json',
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: flag.id }) })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  afterAll(async () => {
    await db.anomalyFlag.deleteMany({})
    await db.property.deleteMany({ where: { name: 'Flag Resolve Test' } })
    await db.$disconnect()
  })
})
