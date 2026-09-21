// tests/driveSync.test.ts
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'

vi.mock('../lib/googleDriveClient', () => ({
  listStatementFiles: vi.fn().mockResolvedValue([
    { id: 'drive1', name: '429878_2026-02_report.pdf', modifiedTime: new Date('2026-02-15') },
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

import { syncDriveFolder } from '../lib/driveSync'
import { listStatementFiles } from '../lib/googleDriveClient'
import { ingestStatement } from '../lib/extraction/extractStatement'
import { ingestLoanDocument } from '../lib/extraction/extractLoan'
import { runAnomalyRules } from '../lib/anomalyRules'

describe('syncDriveFolder', () => {
  it('creates a SourceFile record for a new file', async () => {
    const property = await createProperty({ name: 'Ide Sync Test', address: 'x' })
    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })
    expect(result.newFiles).toBe(1)
    expect(result.skipped).toBe(0)
    const stored = await db.sourceFile.findUnique({ where: { driveFileId: 'drive1' } })
    expect(stored?.filename).toBe('429878_2026-02_report.pdf')
    expect(stored?.fileType).toBe('statement')
  })

  it('passes an xlsx statement to ingestStatement as xlsxBase64 rather than pdfBase64', async () => {
    vi.mocked(listStatementFiles).mockResolvedValueOnce([
      { id: 'drive-xlsx-1', name: '457917_2026-08_report.xlsx', modifiedTime: new Date('2026-08-14') },
    ])
    vi.mocked(ingestStatement).mockClear()

    const property = await createProperty({ name: 'Ide Sync Xlsx Test', address: 'x' })
    await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(ingestStatement).toHaveBeenCalledWith(
      expect.objectContaining({ xlsxBase64: expect.any(String) })
    )
    const call = vi.mocked(ingestStatement).mock.calls[0][0]
    expect('pdfBase64' in call).toBe(false)
  })

  it('skips a file already ingested with a successful extraction (dedupe by driveFileId)', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 2', address: 'x' })
    const existingFile = await db.sourceFile.create({
      data: {
        propertyId: property.id,
        driveFileId: 'drive1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date('2026-02-15'),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/existing.pdf',
      },
    })
    await db.extraction.create({
      data: { sourceFileId: existingFile.id, rawModelOutput: '{}', status: 'success' },
    })
    vi.mocked(ingestStatement).mockClear()

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(0)
    expect(result.skipped).toBe(1)
    expect(ingestStatement).not.toHaveBeenCalled()
  })

  it('retries a file that has a SourceFile row but no successful extraction (self-heals a stuck/interrupted sync)', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 6', address: 'x' })
    const stuckFile = await db.sourceFile.create({
      data: {
        propertyId: property.id,
        driveFileId: 'drive1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date('2026-02-15'),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/stuck.pdf',
      },
    })
    vi.mocked(ingestStatement).mockClear()

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(0)
    expect(result.skipped).toBe(0)
    expect(ingestStatement).toHaveBeenCalledTimes(1)
    expect(ingestStatement).toHaveBeenCalledWith(expect.objectContaining({ sourceFileId: stuckFile.id }))
  })

  it('retries a file whose only extraction attempt failed', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 7', address: 'x' })
    const failedFile = await db.sourceFile.create({
      data: {
        propertyId: property.id,
        driveFileId: 'drive1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date('2026-02-15'),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/failed.pdf',
      },
    })
    await db.extraction.create({
      data: { sourceFileId: failedFile.id, rawModelOutput: 'bad json', status: 'failed' },
    })
    vi.mocked(ingestStatement).mockClear()

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(0)
    expect(result.skipped).toBe(0)
    expect(ingestStatement).toHaveBeenCalledTimes(1)
  })

  it('triggers ingestStatement and, on success, runAnomalyRules for a new statement file', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 3', address: 'x' })
    vi.mocked(ingestStatement).mockClear()
    vi.mocked(runAnomalyRules).mockClear()
    vi.mocked(ingestLoanDocument).mockClear()

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(1)
    expect(ingestStatement).toHaveBeenCalledTimes(1)
    const sourceFile = await db.sourceFile.findUnique({ where: { driveFileId: 'drive1' } })
    expect(ingestStatement).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: property.id, sourceFileId: sourceFile!.id })
    )
    expect(runAnomalyRules).toHaveBeenCalledTimes(1)
    expect(runAnomalyRules).toHaveBeenCalledWith(property.id, '2026-02')
    expect(ingestLoanDocument).not.toHaveBeenCalled()
  })

  it('triggers ingestLoanDocument (and not ingestStatement) for a new loan file', async () => {
    vi.mocked(listStatementFiles).mockResolvedValueOnce([
      { id: 'drive-loan-1', name: 'loan-schedule.pdf', modifiedTime: new Date('2026-02-15') },
    ])
    const property = await createProperty({ name: 'Ide Sync Test 4', address: 'x' })
    vi.mocked(ingestStatement).mockClear()
    vi.mocked(ingestLoanDocument).mockClear()
    vi.mocked(runAnomalyRules).mockClear()

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(1)
    expect(ingestLoanDocument).toHaveBeenCalledTimes(1)
    const sourceFile = await db.sourceFile.findUnique({ where: { driveFileId: 'drive-loan-1' } })
    expect(ingestLoanDocument).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: property.id, sourceFileId: sourceFile!.id })
    )
    expect(ingestStatement).not.toHaveBeenCalled()
    expect(runAnomalyRules).not.toHaveBeenCalled()

    await db.sourceFile.deleteMany({ where: { driveFileId: 'drive-loan-1' } })
  })

  it('continues processing subsequent files when one ingestion fails', async () => {
    vi.mocked(listStatementFiles).mockResolvedValueOnce([
      { id: 'drive-fail-1', name: 'fail_report.pdf', modifiedTime: new Date('2026-02-15') },
      { id: 'drive-fail-2', name: 'ok_report.pdf', modifiedTime: new Date('2026-02-16') },
    ])
    const property = await createProperty({ name: 'Ide Sync Test 5', address: 'x' })
    vi.mocked(ingestStatement).mockClear()
    vi.mocked(ingestStatement)
      .mockRejectedValueOnce(new Error('extraction blew up'))
      .mockResolvedValueOnce({ status: 'success', extractionId: 'ext2', recordsCreated: 1, activityMonth: '2026-02' })

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(2)
    expect(result.failed).toBe(1)
    expect(ingestStatement).toHaveBeenCalledTimes(2)
    const firstFile = await db.sourceFile.findUnique({ where: { driveFileId: 'drive-fail-1' } })
    const secondFile = await db.sourceFile.findUnique({ where: { driveFileId: 'drive-fail-2' } })
    expect(firstFile).not.toBeNull()
    expect(secondFile).not.toBeNull()

    await db.sourceFile.deleteMany({ where: { driveFileId: { in: ['drive-fail-1', 'drive-fail-2'] } } })
  })

  afterEach(async () => {
    // driveFileId is globally unique; clean up between tests so a later test's sync of
    // 'drive1' doesn't collide with an earlier test's record. Extraction has a required FK
    // to SourceFile, so it must go first.
    const existing = await db.sourceFile.findUnique({ where: { driveFileId: 'drive1' } })
    if (existing) {
      await db.extraction.deleteMany({ where: { sourceFileId: existing.id } })
      await db.sourceFile.delete({ where: { id: existing.id } })
    }
  })

  afterAll(async () => {
    await db.sourceFile.deleteMany({})
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
