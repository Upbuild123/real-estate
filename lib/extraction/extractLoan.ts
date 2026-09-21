import { db } from '../db'
import { extractStructuredDataFromPdf, ExtractionParseError } from '../claudeClient'
import { createLoan } from '../loans'
import { LOAN_SCHEMA_DESCRIPTION, type LoanExtraction } from './loanSchema'

const LOAN_SYSTEM_PROMPT = `You are extracting structured data from a Japanese bank loan repayment schedule (証書貸付ご返済予定表). Extract the loan terms and every row of the payment schedule table.`

export async function ingestLoanDocument(params: {
  sourceFileId: string | null
  propertyId: string
  pdfBase64: string
}): Promise<{ status: 'success'; loanId: string } | { status: 'failed'; error: string }> {
  let extracted: LoanExtraction

  try {
    extracted = await extractStructuredDataFromPdf<LoanExtraction>({
      pdfBase64: params.pdfBase64,
      systemPrompt: LOAN_SYSTEM_PROMPT,
      schemaDescription: LOAN_SCHEMA_DESCRIPTION,
    })
  } catch (err) {
    const message = err instanceof ExtractionParseError ? err.message : String(err)
    return { status: 'failed', error: message }
  }

  const firstRow = extracted.paymentSchedule[0]

  const loanData = {
    propertyId: params.propertyId,
    lender: extracted.lender,
    originalAmount: extracted.originalLoanAmount,
    currentBalance: firstRow ? firstRow.remainingBalance + firstRow.principal : extracted.originalLoanAmount,
    currentRate: extracted.currentInterestRate,
    rateChangeDate: extracted.rateChangeDate ? new Date(extracted.rateChangeDate) : undefined,
    newRate: extracted.newInterestRate ?? undefined,
    monthlyPrincipal: extracted.monthlyPrincipal,
    originationDate: new Date(extracted.originationDate),
    maturityDate: new Date(extracted.maturityDate),
    sourceFileId: params.sourceFileId ?? undefined,
  }

  // Prevent duplicate Loan rows when the same source file is re-processed (e.g. a
  // re-triggered sync). Manual uploads (sourceFileId === null) always create a new row,
  // since there's no reliable way to tell "same document re-uploaded" from "new document"
  // without a source file identity to key on.
  const existingLoan = params.sourceFileId
    ? await db.loan.findFirst({ where: { propertyId: params.propertyId, sourceFileId: params.sourceFileId } })
    : null

  const loan = existingLoan
    ? await db.loan.update({ where: { id: existingLoan.id }, data: loanData })
    : await createLoan(loanData)

  return { status: 'success', loanId: loan.id }
}
