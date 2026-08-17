// tests/dropboxSync.test.ts
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'

vi.mock('../lib/dropboxClient', () => ({
  listPdfFiles: vi.fn().mockResolvedValue([
    { id: 'dbx1', name: '429878_2026-02_report.pdf', pathLower: '/ide/429878_2026-02_report.pdf', serverModified: new Date('2026-02-15') },
  ]),
  downloadFile: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
}))

vi.mock('../lib/blobStorage', () => ({
  uploadToStorage: vi.fn().mockResolvedValue('https://blob.example.com/429878_2026-02_report.pdf'),
}))

import { syncDropboxFolder } from '../lib/dropboxSync'

describe('syncDropboxFolder', () => {
  it('creates a DropboxFile record for a new file', async () => {
    const property = await createProperty({ name: 'Ide Sync Test', address: 'x' })
    const result = await syncDropboxFolder({ id: property.id, dropboxFolderPath: '/ide' })
    expect(result.newFiles).toBe(1)
    expect(result.skipped).toBe(0)
    const stored = await db.dropboxFile.findUnique({ where: { dropboxFileId: 'dbx1' } })
    expect(stored?.filename).toBe('429878_2026-02_report.pdf')
    expect(stored?.fileType).toBe('statement')
  })

  it('skips a file already ingested (dedupe by dropboxFileId)', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 2', address: 'x' })
    await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date('2026-02-15'),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/existing.pdf',
      },
    })
    const result = await syncDropboxFolder({ id: property.id, dropboxFolderPath: '/ide' })
    expect(result.newFiles).toBe(0)
    expect(result.skipped).toBe(1)
  })

  afterEach(async () => {
    // dropboxFileId is globally unique; clean up between tests so the second
    // test's manual insert of 'dbx1' doesn't collide with the first test's
    // sync-created record from the same run.
    await db.dropboxFile.deleteMany({ where: { dropboxFileId: 'dbx1' } })
  })

  afterAll(async () => {
    await db.dropboxFile.deleteMany({})
    await db.property.deleteMany({ where: { name: { in: ['Ide Sync Test', 'Ide Sync Test 2'] } } })
    await db.$disconnect()
  })
})
