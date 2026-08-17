import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'

describe('db connection', () => {
  it('can create and read a Property', async () => {
    const property = await db.property.create({
      data: { name: 'Test Building', address: '123 Test St' },
    })
    const found = await db.property.findUnique({ where: { id: property.id } })
    expect(found?.name).toBe('Test Building')
  })

  afterAll(async () => {
    await db.property.deleteMany({ where: { name: 'Test Building' } })
    await db.$disconnect()
  })
})
