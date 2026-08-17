import { db } from '../db'
import { extractStructuredDataFromPdf, ExtractionParseError } from '../claudeClient'
import { createLoan } from '../loans'
import { LOAN_SCHEMA_DESCRIPTION, type LoanExtraction } from './loanSchema'

const LOAN_SYSTEM_PROMPT = `You are extracting structured data from a Japanese bank loan repayment schedule (証書貸付ご返済予定表). Extract the loan terms and every row of the payment schedule table.`

export async function ingestLoanDocument(params: {
  dropboxFileId: string | null
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

  const loan = await createLoan({
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
    sourceFileId: params.dropboxFileId ?? undefined,
  })

  return { status: 'success', loanId: loan.id }
}
