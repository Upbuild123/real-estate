import { describe, it, expect, vi, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { createProperty } from '../../lib/properties'
import { getLoanForProperty } from '../../lib/loans'
import fixture from '../fixtures/loan-do5.json'

vi.mock('../../lib/claudeClient', () => ({
  extractStructuredDataFromPdf: vi.fn().mockResolvedValue(fixture),
  ExtractionParseError: class ExtractionParseError extends Error {},
}))

import { ingestLoanDocument } from '../../lib/extraction/extractLoan'

describe('ingestLoanDocument', () => {
  it('creates a Loan record from extracted data, using the first schedule row as current balance', async () => {
    const property = await createProperty({ name: 'DO5 Loan Extract Test', address: 'x' })

    const result = await ingestLoanDocument({ dropboxFileId: null, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })

    expect(result.status).toBe('success')
    const loan = await getLoanForProperty(property.id)
    expect(loan?.lender).toBe('Kiraboshi Bank')
    expect(loan?.originalAmount).toBe(221800000)
    expect(loan?.currentBalance).toBe(210700000) // first schedule row's remainingBalance + principal (balance before that payment)
    expect(loan?.currentRate).toBe(1.825)
    expect(loan?.monthlyPrincipal).toBe(925000)
    expect(loan?.newRate).toBe(2.075)
  })

  afterAll(async () => {
    await db.loan.deleteMany({})
    await db.property.deleteMany({ where: { name: 'DO5 Loan Extract Test' } })
    await db.$disconnect()
  })
})
