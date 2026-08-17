import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { GET, POST } from '../../app/api/properties/route'

describe('POST /api/properties', () => {
  it('creates a property from a valid body', async () => {
    const request = new Request('http://localhost/api/properties', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Building', address: '123 Test St' }),
    })
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.name).toBe('Test Building')
    expect(body.address).toBe('123 Test St')
  })

  it('returns 400 when name is missing', async () => {
    const request = new Request('http://localhost/api/properties', {
      method: 'POST',
      body: JSON.stringify({ address: '123 Test St' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 400 for malformed JSON body', async () => {
    const request = new Request('http://localhost/api/properties', {
      method: 'POST',
      body: '{not valid json',
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })
})

describe('GET /api/properties', () => {
  it('lists active properties', async () => {
    const response = await GET()
    const body = await response.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.some((p: { name: string }) => p.name === 'Test Building')).toBe(true)
  })
})

afterAll(async () => {
  await db.property.deleteMany({ where: { name: 'Test Building' } })
  await db.$disconnect()
})
