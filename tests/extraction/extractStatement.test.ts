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

  it('keeps multiple line items with the same accountItem as separate records (one per rental unit)', async () => {
    const property = await createProperty({ name: 'Ide Extract Test Multi Unit', address: 'x' })
    const dropboxFile = await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx-statement-multiunit',
        filename: 'multi-unit.pdf',
        uploadedAt: new Date(),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/x.pdf',
      },
    })

    const multiUnitFixture = {
      ...fixture,
      lineItems: [
        { ...fixture.lineItems[0], note: 'Unit 101 rent' },
        { ...fixture.lineItems[0], amount: 98000, total: 98000, note: 'Unit 102 rent' },
      ],
    }
    ;(extractStructuredDataFromPdf as any).mockResolvedValueOnce(multiUnitFixture)

    const result = await ingestStatement({
      dropboxFileId: dropboxFile.id,
      propertyId: property.id,
      pdfBase64: 'ZmFrZQ==',
    })

    expect(result.status).toBe('success')
    const records = await db.financialRecord.findMany({ where: { propertyId: property.id, accountItem: 'Rent' } })
    expect(records).toHaveLength(2)
    const amounts = records.map((r) => r.amount).sort((a, b) => a - b)
    expect(amounts).toEqual([98000, 125000])
  })

  it('does not duplicate a manually-corrected line item when re-ingesting a statement with multiple same-accountItem lines', async () => {
    const property = await createProperty({ name: 'Ide Extract Manual Multi Unit Test', address: 'x' })
    const dropboxFile = await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx-statement-manual-multiunit',
        filename: 'multi-unit-manual.pdf',
        uploadedAt: new Date(),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/x.pdf',
      },
    })

    const multiUnitFixture = {
      ...fixture,
      lineItems: [
        { ...fixture.lineItems[0], settlementDate: '2026-01-30', note: 'Unit 101 rent' },
        { ...fixture.lineItems[0], amount: 98000, total: 98000, settlementDate: '2026-01-30', note: 'Unit 102 rent' },
      ],
    }
    ;(extractStructuredDataFromPdf as any).mockResolvedValueOnce(multiUnitFixture)

    const first = await ingestStatement({
      dropboxFileId: dropboxFile.id,
      propertyId: property.id,
      pdfBase64: 'ZmFrZQ==',
    })
    if (first.status !== 'success') throw new Error('setup failed')

    const unit102Record = await db.financialRecord.findFirstOrThrow({
      where: { propertyId: property.id, accountItem: 'Rent', amount: 98000 },
    })
    await db.financialRecord.update({
      where: { id: unit102Record.id },
      data: { amount: 105000, source: 'manual' },
    })

    ;(extractStructuredDataFromPdf as any).mockResolvedValueOnce(multiUnitFixture)
    await ingestStatement({ dropboxFileId: dropboxFile.id, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })

    const rentRecords = await db.financialRecord.findMany({
      where: { propertyId: property.id, accountItem: 'Rent' },
    })
    expect(rentRecords).toHaveLength(2)
    const amounts = rentRecords.map((r) => r.amount).sort((a, b) => a - b)
    expect(amounts).toEqual([105000, 125000])
    expect(rentRecords.find((r) => r.amount === 105000)?.source).toBe('manual')
  })

  it('re-ingesting a file that fails extraction twice returns a graceful failure both times, with one Extraction row', async () => {
    ;(extractStructuredDataFromPdf as any).mockRejectedValueOnce(new ExtractionParseError('bad json 1'))
    const property = await createProperty({ name: 'Ide Extract Double Fail Test', address: 'x' })
    const dropboxFile = await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx-statement-double-fail',
        filename: 'x.pdf',
        uploadedAt: new Date(),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/x.pdf',
      },
    })

    const first = await ingestStatement({ dropboxFileId: dropboxFile.id, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })
    expect(first.status).toBe('failed')

    ;(extractStructuredDataFromPdf as any).mockRejectedValueOnce(new ExtractionParseError('bad json 2'))
    let second: Awaited<ReturnType<typeof ingestStatement>> | undefined
    let threw = false
    try {
      second = await ingestStatement({ dropboxFileId: dropboxFile.id, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(second?.status).toBe('failed')

    const extractions = await db.extraction.findMany({ where: { dropboxFileId: dropboxFile.id } })
    expect(extractions).toHaveLength(1)
    expect(extractions[0].status).toBe('failed')
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
      where: {
        name: {
          in: [
            'Ide Extract Test',
            'Ide Extract Test 2',
            'Ide Extract Fail Test',
            'Ide Extract Test Multi Unit',
            'Ide Extract Manual Multi Unit Test',
            'Ide Extract Double Fail Test',
          ],
        },
      },
    })
    await db.$disconnect()
  })
})
