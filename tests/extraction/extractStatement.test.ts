import { describe, it, expect, vi, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { createProperty } from '../../lib/properties'
import fixture from '../fixtures/statement-ide-jan2026.json'

vi.mock('../../lib/claudeClient', () => ({
  extractStructuredDataFromPdf: vi.fn().mockResolvedValue(fixture),
  ExtractionParseError: class ExtractionParseError extends Error {},
}))

import { ingestStatement } from '../../lib/extraction/extractStatement'
import { extractStructuredDataFromPdf, ExtractionParseError } from '../../lib/claudeClient'

describe('ingestStatement', () => {
  it('creates FinancialRecord rows from extracted line items, tagging recurring correctly', async () => {
    const property = await createProperty({ name: 'Ide Extract Test', address: 'x' })
    const dropboxFile = await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx-statement-1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date(),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/x.pdf',
      },
    })

    const result = await ingestStatement({
      dropboxFileId: dropboxFile.id,
      propertyId: property.id,
      pdfBase64: 'ZmFrZQ==',
    })

    expect(result.status).toBe('success')
    const records = await db.financialRecord.findMany({ where: { propertyId: property.id } })
    expect(records).toHaveLength(3)
    expect(records.find((r) => r.accountItem === 'Rent')?.recurring).toBe(true)
    expect(records.find((r) => r.accountItem === 'Property management fee')?.recurring).toBe(true)
    expect(records.every((r) => r.month === '2026-01')).toBe(true)
    expect(records.every((r) => r.source === 'extracted')).toBe(true)
  })

  it('preserves a manual correction when the same file is re-ingested', async () => {
    const property = await createProperty({ name: 'Ide Extract Test 2', address: 'x' })
    const dropboxFile = await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx-statement-2',
        filename: 'x.pdf',
        uploadedAt: new Date(),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/x.pdf',
      },
    })
    const first = await ingestStatement({ dropboxFileId: dropboxFile.id, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })
    if (first.status !== 'success') throw new Error('setup failed')

    const rentRecord = await db.financialRecord.findFirstOrThrow({
      where: { propertyId: property.id, accountItem: 'Rent' },
    })
    await db.financialRecord.update({ where: { id: rentRecord.id }, data: { amount: 999999, source: 'manual' } })

    await ingestStatement({ dropboxFileId: dropboxFile.id, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })

    const afterReingest = await db.financialRecord.findUniqueOrThrow({ where: { id: rentRecord.id } })
    expect(afterReingest.amount).toBe(999999)
    expect(afterReingest.source).toBe('manual')
  })

  it('marks the extraction as failed and creates no records when the model output cannot be parsed', async () => {
    ;(extractStructuredDataFromPdf as any).mockRejectedValueOnce(new ExtractionParseError('bad json'))
    const property = await createProperty({ name: 'Ide Extract Fail Test', address: 'x' })
    const dropboxFile = await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx-statement-3',
        filename: 'x.pdf',
        uploadedAt: new Date(),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/x.pdf',
      },
    })

    const result = await ingestStatement({ dropboxFileId: dropboxFile.id, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })

    expect(result.status).toBe('failed')
    const extraction = await db.extraction.findUnique({ where: { dropboxFileId: dropboxFile.id } })
    expect(extraction?.status).toBe('failed')
    const records = await db.financialRecord.findMany({ where: { propertyId: property.id } })
    expect(records).toHaveLength(0)
  })

  afterAll(async () => {
    await db.financialRecord.deleteMany({})
    await db.extraction.deleteMany({})
    await db.dropboxFile.deleteMany({})
    await db.property.deleteMany({
      where: { name: { in: ['Ide Extract Test', 'Ide Extract Test 2', 'Ide Extract Fail Test'] } },
    })
    await db.$disconnect()
  })
})
