import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty, listProperties, getProperty, updatePropertyDriveFolder } from '../lib/properties'

describe('properties', () => {
  it('creates and retrieves a property', async () => {
    const created = await createProperty({ name: 'Ide building', address: '東京都杉並区松ノ木3-22-14' })
    const found = await getProperty(created.id)
    expect(found?.name).toBe('Ide building')
  })

  it('stores an optional googleDriveFolderId', async () => {
    const created = await createProperty({
      name: 'Ide building',
      address: 'x',
      googleDriveFolderId: '1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ',
    })
    expect(created.googleDriveFolderId).toBe('1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ')
  })

  it('updates a property\'s Google Drive folder ID', async () => {
    const created = await createProperty({ name: 'Ide building', address: 'x' })
    const updated = await updatePropertyDriveFolder(created.id, '1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ')
    expect(updated.googleDriveFolderId).toBe('1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ')

    const cleared = await updatePropertyDriveFolder(created.id, null)
    expect(cleared.googleDriveFolderId).toBeNull()
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
