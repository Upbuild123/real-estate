import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty, listProperties, getProperty } from '../lib/properties'

describe('properties', () => {
  it('creates and retrieves a property', async () => {
    const created = await createProperty({ name: 'Ide building', address: '東京都杉並区松ノ木3-22-14' })
    const found = await getProperty(created.id)
    expect(found?.name).toBe('Ide building')
  })

  it('stores an optional dropboxFolderPath', async () => {
    const created = await createProperty({
      name: 'Ide building',
      address: 'x',
      dropboxFolderPath: '/Michael Sloyer/Ide building/2026',
    })
    expect(created.dropboxFolderPath).toBe('/Michael Sloyer/Ide building/2026')
  })

  it('lists only active properties by default', async () => {
    const p = await createProperty({ name: 'Inactive Test', address: 'x' })
    await db.property.update({ where: { id: p.id }, data: { active: false } })
    const active = await listProperties()
    expect(active.find((x) => x.id === p.id)).toBeUndefined()
  })

  afterAll(async () => {
    await db.property.deleteMany({ where: { name: { in: ['Ide building', 'Inactive Test'] } } })
    await db.$disconnect()
  })
})
