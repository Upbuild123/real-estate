import { db } from '../db'
import { extractStructuredDataFromPdf, ExtractionParseError } from '../claudeClient'
import { isRecurringAccountItem, STATEMENT_SCHEMA_DESCRIPTION, type StatementExtraction } from './statementSchema'

const STATEMENT_SYSTEM_PROMPT = `You are extracting structured financial data from a Japanese property management monthly statement PDF (issued by Axios Management Inc.). The document has a summary/rent-roll page and an itemized income/expense ledger. Extract every rent roll row and every line item from the ledger.`

export async function ingestStatement(params: {
  dropboxFileId: string
  propertyId: string
  pdfBase64: string
}): Promise<
  | { status: 'success'; extractionId: string; recordsCreated: number }
  | { status: 'failed'; extractionId: string; error: string }
> {
  let extracted: StatementExtraction
  let rawOutput = ''

  try {
    extracted = await extractStructuredDataFromPdf<StatementExtraction>({
      pdfBase64: params.pdfBase64,
      systemPrompt: STATEMENT_SYSTEM_PROMPT,
      schemaDescription: STATEMENT_SCHEMA_DESCRIPTION,
    })
    rawOutput = JSON.stringify(extracted)
  } catch (err) {
    const message = err instanceof ExtractionParseError ? err.message : String(err)
    const extraction = await db.extraction.create({
      data: { dropboxFileId: params.dropboxFileId, rawModelOutput: message, status: 'failed' },
    })
    return { status: 'failed', extractionId: extraction.id, error: message }
  }

  const existingExtraction = await db.extraction.findUnique({ where: { dropboxFileId: params.dropboxFileId } })

  const extraction = existingExtraction
    ? await db.extraction.update({
        where: { id: existingExtraction.id },
        data: { rawModelOutput: rawOutput, status: 'success', extractedAt: new Date() },
      })
    : await db.extraction.create({
        data: { dropboxFileId: params.dropboxFileId, rawModelOutput: rawOutput, status: 'success' },
      })

  let recordsCreated = 0

  for (const item of extracted.lineItems) {
    const existingManual = await db.financialRecord.findFirst({
      where: {
        propertyId: params.propertyId,
        extractionId: extraction.id,
        accountItem: item.accountItem,
        source: 'manual',
      },
    })
    if (existingManual) continue // manual correction takes precedence, never overwritten

    const existingExtracted = await db.financialRecord.findFirst({
      where: {
        propertyId: params.propertyId,
        extractionId: extraction.id,
        accountItem: item.accountItem,
        source: 'extracted',
      },
    })

    const data = {
      propertyId: params.propertyId,
      month: extracted.activityMonth,
      category: item.category,
      accountItem: item.accountItem,
      amount: item.total,
      recurring: isRecurringAccountItem(item.accountItem),
      source: 'extracted' as const,
      extractionId: extraction.id,
    }

    if (existingExtracted) {
      await db.financialRecord.update({ where: { id: existingExtracted.id }, data })
    } else {
      await db.financialRecord.create({ data })
      recordsCreated++
    }
  }

  return { status: 'success', extractionId: extraction.id, recordsCreated }
}
