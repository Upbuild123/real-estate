import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { GET, POST } from '../../app/api/properties/route'
import { PATCH } from '../../app/api/properties/[id]/route'

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

describe('PATCH /api/properties/[id]', () => {
  it('updates an existing property\'s Google Drive folder ID', async () => {
    const property = await db.property.create({ data: { name: 'Patch Test Building', address: '456 Test Ave' } })

    const request = new Request(`http://localhost/api/properties/${property.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ googleDriveFolderId: '1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ' }),
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: property.id }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.googleDriveFolderId).toBe('1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ')

    await db.property.delete({ where: { id: property.id } })
  })

  it('returns 400 when googleDriveFolderId is not a string or null', async () => {
    const property = await db.property.create({ data: { name: 'Patch Test Building 2', address: '456 Test Ave' } })

    const request = new Request(`http://localhost/api/properties/${property.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ googleDriveFolderId: 123 }),
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: property.id }) })
    expect(response.status).toBe(400)

    await db.property.delete({ where: { id: property.id } })
  })

  it('returns 400 for malformed JSON body', async () => {
    const property = await db.property.create({ data: { name: 'Patch Test Building 3', address: '456 Test Ave' } })

    const request = new Request(`http://localhost/api/properties/${property.id}`, {
      method: 'PATCH',
      body: '{not valid json',
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: property.id }) })
    expect(response.status).toBe(400)

    await db.property.delete({ where: { id: property.id } })
  })
})

afterAll(async () => {
  await db.property.deleteMany({ where: { name: 'Test Building' } })
  await db.$disconnect()
})
