import { db } from '../db'
import { extractStructuredDataFromPdf, ExtractionParseError } from '../claudeClient'
import {
  isRecurringAccountItem,
  STATEMENT_SCHEMA_DESCRIPTION,
  type StatementExtraction,
  type StatementLineItem,
} from './statementSchema'

const STATEMENT_SYSTEM_PROMPT = `You are extracting structured financial data from a Japanese property management monthly statement PDF (issued by Axios Management Inc.). The document has a summary/rent-roll page and an itemized income/expense ledger. Extract every rent roll row and every line item from the ledger.`

// Line items don't have a stable ID from the source PDF, and multiple items can share the
// same accountItem (one "Rent" row per rental unit). This key lets a manual correction on
// one specific line item survive re-ingestion without being duplicated by a freshly
// extracted row for that same line item.
function computeLineItemKey(item: Pick<StatementLineItem, 'accountItem' | 'settlementDate' | 'note'>): string {
  return `${item.accountItem}|${item.settlementDate}|${item.note}`
}

export async function ingestStatement(params: {
  dropboxFileId: string
  propertyId: string
  pdfBase64: string
}): Promise<
  | { status: 'success'; extractionId: string; recordsCreated: number; activityMonth: string }
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
    const extraction = await db.extraction.upsert({
      where: { dropboxFileId: params.dropboxFileId },
      update: { rawModelOutput: message, status: 'failed', extractedAt: new Date() },
      create: { dropboxFileId: params.dropboxFileId, rawModelOutput: message, status: 'failed' },
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

  // Real statements have MULTIPLE line items sharing the same accountItem (e.g. one
  // "Rent" row per rental unit), so we do not dedupe/merge by accountItem. Instead, for
  // a re-ingestion of the same extraction, we drop all previously-extracted rows and
  // recreate them fresh from the current extraction output. Manual-source rows are never
  // touched (they're filtered out of the delete), so manual corrections survive re-ingestion —
  // and we skip recreating an extracted row for any line item a manual correction already
  // covers (matched by lineItemKey), so the correction isn't duplicated alongside a fresh
  // extracted value for the same line item.
  const manualRecords = await db.financialRecord.findMany({
    where: { propertyId: params.propertyId, extractionId: extraction.id, source: 'manual' },
    select: { lineItemKey: true },
  })
  const manuallyCoveredKeys = new Set(manualRecords.map((r) => r.lineItemKey))

  await db.financialRecord.deleteMany({
    where: {
      propertyId: params.propertyId,
      extractionId: extraction.id,
      source: 'extracted',
    },
  })

  const recordsData = extracted.lineItems
    .map((item) => ({ item, lineItemKey: computeLineItemKey(item) }))
    .filter(({ lineItemKey }) => !manuallyCoveredKeys.has(lineItemKey))
    .map(({ item, lineItemKey }) => ({
      propertyId: params.propertyId,
      month: extracted.activityMonth,
      category: item.category,
      accountItem: item.accountItem,
      lineItemKey,
      note: item.note,
      amount: item.total,
      recurring: isRecurringAccountItem(item.accountItem),
      source: 'extracted' as const,
      extractionId: extraction.id,
    }))

  if (recordsData.length > 0) {
    await db.financialRecord.createMany({ data: recordsData })
  }

  // Rent roll rows are keyed uniquely per (property, month, room), so re-ingesting the same
  // statement just replaces the prior snapshot rather than accumulating duplicates.
  await db.rentRollEntry.deleteMany({ where: { propertyId: params.propertyId, month: extracted.activityMonth } })
  if (extracted.rentRoll.length > 0) {
    await db.rentRollEntry.createMany({
      data: extracted.rentRoll.map((entry) => ({
        propertyId: params.propertyId,
        month: extracted.activityMonth,
        roomNumber: entry.roomNumber,
        unitType: entry.unitType,
        lessee: entry.lessee,
        monthlyCharge: entry.monthlyCharge,
        leaseStart: entry.leaseStart,
        leaseEnd: entry.leaseEnd,
        extractionId: extraction.id,
      })),
    })
  }

  return {
    status: 'success',
    extractionId: extraction.id,
    recordsCreated: recordsData.length,
    activityMonth: extracted.activityMonth,
  }
}
