// tests/dropboxSync.test.ts
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'

vi.mock('../lib/dropboxClient', () => ({
  listStatementFiles: vi.fn().mockResolvedValue([
    { id: 'dbx1', name: '429878_2026-02_report.pdf', pathLower: '/ide/429878_2026-02_report.pdf', serverModified: new Date('2026-02-15') },
  ]),
  downloadFile: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
}))

vi.mock('../lib/blobStorage', () => ({
  uploadToStorage: vi.fn().mockResolvedValue('https://blob.example.com/429878_2026-02_report.pdf'),
}))

vi.mock('../lib/extraction/extractStatement', () => ({
  ingestStatement: vi.fn().mockResolvedValue({
    status: 'success',
    extractionId: 'ext1',
    recordsCreated: 1,
    activityMonth: '2026-02',
  }),
}))

vi.mock('../lib/extraction/extractLoan', () => ({
  ingestLoanDocument: vi.fn().mockResolvedValue({ status: 'success', loanId: 'loan1' }),
}))

vi.mock('../lib/anomalyRules', () => ({
  runAnomalyRules: vi.fn().mockResolvedValue([]),
}))

import { syncDropboxFolder } from '../lib/dropboxSync'
import { listStatementFiles } from '../lib/dropboxClient'
import { ingestStatement } from '../lib/extraction/extractStatement'
import { ingestLoanDocument } from '../lib/extraction/extractLoan'
import { runAnomalyRules } from '../lib/anomalyRules'

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

  it('passes an xlsx statement to ingestStatement as xlsxBase64 rather than pdfBase64', async () => {
    vi.mocked(listStatementFiles).mockResolvedValueOnce([
      { id: 'dbx-xlsx-1', name: '457917_2026-08_report.xlsx', pathLower: '/ide/457917_2026-08_report.xlsx', serverModified: new Date('2026-08-14') },
    ])
    vi.mocked(ingestStatement).mockClear()

    const property = await createProperty({ name: 'Ide Sync Xlsx Test', address: 'x' })
    await syncDropboxFolder({ id: property.id, dropboxFolderPath: '/ide' })

    expect(ingestStatement).toHaveBeenCalledWith(
      expect.objectContaining({ xlsxBase64: expect.any(String) })
    )
    const call = vi.mocked(ingestStatement).mock.calls[0][0]
    expect('pdfBase64' in call).toBe(false)
  })

  it('skips a file already ingested with a successful extraction (dedupe by dropboxFileId)', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 2', address: 'x' })
    const existingFile = await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date('2026-02-15'),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/existing.pdf',
      },
    })
    await db.extraction.create({
      data: { dropboxFileId: existingFile.id, rawModelOutput: '{}', status: 'success' },
    })
    vi.mocked(ingestStatement).mockClear()

    const result = await syncDropboxFolder({ id: property.id, dropboxFolderPath: '/ide' })

    expect(result.newFiles).toBe(0)
    expect(result.skipped).toBe(1)
    expect(ingestStatement).not.toHaveBeenCalled()
  })

  it('retries a file that has a DropboxFile row but no successful extraction (self-heals a stuck/interrupted sync)', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 6', address: 'x' })
    const stuckFile = await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date('2026-02-15'),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/stuck.pdf',
      },
    })
    // No Extraction row at all — simulates a prior sync that was killed (e.g. by a function
    // timeout) after creating the DropboxFile row but before extraction ran.
    vi.mocked(ingestStatement).mockClear()

    const result = await syncDropboxFolder({ id: property.id, dropboxFolderPath: '/ide' })

    expect(result.newFiles).toBe(0)
    expect(result.skipped).toBe(0)
    expect(ingestStatement).toHaveBeenCalledTimes(1)
    expect(ingestStatement).toHaveBeenCalledWith(expect.objectContaining({ dropboxFileId: stuckFile.id }))
  })

  it('retries a file whose only extraction attempt failed', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 7', address: 'x' })
    const failedFile = await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date('2026-02-15'),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/failed.pdf',
      },
    })
    await db.extraction.create({
      data: { dropboxFileId: failedFile.id, rawModelOutput: 'bad json', status: 'failed' },
    })
    vi.mocked(ingestStatement).mockClear()

    const result = await syncDropboxFolder({ id: property.id, dropboxFolderPath: '/ide' })

    expect(result.newFiles).toBe(0)
    expect(result.skipped).toBe(0)
    expect(ingestStatement).toHaveBeenCalledTimes(1)
  })

  it('triggers ingestStatement and, on success, runAnomalyRules for a new statement file', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 3', address: 'x' })
    vi.mocked(ingestStatement).mockClear()
    vi.mocked(runAnomalyRules).mockClear()
    vi.mocked(ingestLoanDocument).mockClear()

    const result = await syncDropboxFolder({ id: property.id, dropboxFolderPath: '/ide' })

    expect(result.newFiles).toBe(1)
    expect(ingestStatement).toHaveBeenCalledTimes(1)
    const dropboxFile = await db.dropboxFile.findUnique({ where: { dropboxFileId: 'dbx1' } })
    expect(ingestStatement).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: property.id, dropboxFileId: dropboxFile!.id })
    )
    expect(runAnomalyRules).toHaveBeenCalledTimes(1)
    expect(runAnomalyRules).toHaveBeenCalledWith(property.id, '2026-02')
    expect(ingestLoanDocument).not.toHaveBeenCalled()
  })

  it('triggers ingestLoanDocument (and not ingestStatement) for a new loan file', async () => {
    vi.mocked(listStatementFiles).mockResolvedValueOnce([
      { id: 'dbx-loan-1', name: 'loan-schedule.pdf', pathLower: '/ide/loan-schedule.pdf', serverModified: new Date('2026-02-15') },
    ])
    const property = await createProperty({ name: 'Ide Sync Test 4', address: 'x' })
    vi.mocked(ingestStatement).mockClear()
    vi.mocked(ingestLoanDocument).mockClear()
    vi.mocked(runAnomalyRules).mockClear()

    const result = await syncDropboxFolder({ id: property.id, dropboxFolderPath: '/ide' })

    expect(result.newFiles).toBe(1)
    expect(ingestLoanDocument).toHaveBeenCalledTimes(1)
    const dropboxFile = await db.dropboxFile.findUnique({ where: { dropboxFileId: 'dbx-loan-1' } })
    expect(ingestLoanDocument).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: property.id, dropboxFileId: dropboxFile!.id })
    )
    expect(ingestStatement).not.toHaveBeenCalled()
    expect(runAnomalyRules).not.toHaveBeenCalled()

    await db.dropboxFile.deleteMany({ where: { dropboxFileId: 'dbx-loan-1' } })
  })

  it('continues processing subsequent files when one ingestion fails', async () => {
    vi.mocked(listStatementFiles).mockResolvedValueOnce([
      { id: 'dbx-fail-1', name: 'fail_report.pdf', pathLower: '/ide/fail_report.pdf', serverModified: new Date('2026-02-15') },
      { id: 'dbx-fail-2', name: 'ok_report.pdf', pathLower: '/ide/ok_report.pdf', serverModified: new Date('2026-02-16') },
    ])
    const property = await createProperty({ name: 'Ide Sync Test 5', address: 'x' })
    vi.mocked(ingestStatement).mockClear()
    vi.mocked(ingestStatement)
      .mockRejectedValueOnce(new Error('extraction blew up'))
      .mockResolvedValueOnce({ status: 'success', extractionId: 'ext2', recordsCreated: 1, activityMonth: '2026-02' })

    const result = await syncDropboxFolder({ id: property.id, dropboxFolderPath: '/ide' })

    expect(result.newFiles).toBe(2)
    expect(result.failed).toBe(1)
    expect(ingestStatement).toHaveBeenCalledTimes(2)
    const firstFile = await db.dropboxFile.findUnique({ where: { dropboxFileId: 'dbx-fail-1' } })
    const secondFile = await db.dropboxFile.findUnique({ where: { dropboxFileId: 'dbx-fail-2' } })
    expect(firstFile).not.toBeNull()
    expect(secondFile).not.toBeNull()

    await db.dropboxFile.deleteMany({ where: { dropboxFileId: { in: ['dbx-fail-1', 'dbx-fail-2'] } } })
  })

  afterEach(async () => {
    // dropboxFileId is globally unique; clean up between tests so a later
    // test's sync of 'dbx1' doesn't collide with an earlier test's record.
    // Extraction has a required FK to DropboxFile, so it must go first.
    const existing = await db.dropboxFile.findUnique({ where: { dropboxFileId: 'dbx1' } })
    if (existing) {
      await db.extraction.deleteMany({ where: { dropboxFileId: existing.id } })
      await db.dropboxFile.delete({ where: { id: existing.id } })
    }
  })

  afterAll(async () => {
    await db.dropboxFile.deleteMany({})
    await db.property.deleteMany({
      where: {
        name: {
          in: [
            'Ide Sync Test',
            'Ide Sync Test 2',
            'Ide Sync Test 3',
            'Ide Sync Test 4',
            'Ide Sync Test 5',
            'Ide Sync Test 6',
            'Ide Sync Test 7',
          ],
        },
      },
    })
    await db.$disconnect()
  })
})
