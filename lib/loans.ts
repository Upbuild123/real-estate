import { db } from './db'
import { listProperties } from './properties'
import type { Loan } from '@prisma/client'

export async function createLoan(input: {
  propertyId: string
  lender: string
  originalAmount: number
  currentBalance: number
  currentRate: number
  rateChangeDate?: Date
  newRate?: number
  monthlyPrincipal: number
  originationDate: Date
  maturityDate: Date
  sourceFileId?: string
}): Promise<Loan> {
  return db.loan.create({ data: input })
}

export async function getLoanForProperty(propertyId: string): Promise<Loan | null> {
  return db.loan.findFirst({ where: { propertyId }, orderBy: { createdAt: 'desc' } })
}

export function monthlyInterestExpense(balance: number, annualRatePercent: number): number {
  return (balance * (annualRatePercent / 100)) / 12
}

export function monthlyDebtService(loan: Loan): number {
  return loan.monthlyPrincipal + monthlyInterestExpense(loan.currentBalance, loan.currentRate)
}

function monthIndex(month: string): number {
  const [year, mo] = month.split('-').map(Number)
  return year * 12 + mo
}

// loan.currentBalance is a single snapshot, not a per-month history — the whole app already
// treats it as accurate as of "now" (e.g. monthlyDebtService uses it regardless of which
// historical month is being viewed). For a starting/ending balance over a period, "now" is
// taken to be the end of referenceMonth (the latest month with actual statement data), and the
// balance for any other month is projected by walking the constant monthlyPrincipal paydown
// forward or backward from there. Assumes principal paydown has been constant since
// origination — a real amortization schedule's principal portion grows slightly over time, so
// this is an approximation, most accurate near referenceMonth and least accurate far from it.
export function loanBalanceRange(
  loan: Pick<Loan, 'currentBalance' | 'monthlyPrincipal'>,
  months: string[],
  referenceMonth: string
): { startingBalance: number; endingBalance: number } {
  const sorted = [...months].sort()
  const firstMonth = sorted[0]
  const lastMonth = sorted[sorted.length - 1]
  const refIdx = monthIndex(referenceMonth)

  const endingBalance = loan.currentBalance + loan.monthlyPrincipal * (refIdx - monthIndex(lastMonth))
  const startingBalance = loan.currentBalance + loan.monthlyPrincipal * (refIdx - monthIndex(firstMonth) + 1)

  return { startingBalance, endingBalance }
}

// Sums loanBalanceRange across every active property's loan — for the "Combined" portfolio
// option. A property with no loan on file simply contributes nothing.
export async function getPortfolioLoanBalanceRange(
  months: string[],
  referenceMonth: string
): Promise<{ startingBalance: number; endingBalance: number }> {
  const properties = await listProperties()
  let startingBalance = 0
  let endingBalance = 0

  for (const property of properties) {
    const loan = await getLoanForProperty(property.id)
    if (!loan) continue
    const range = loanBalanceRange(loan, months, referenceMonth)
    startingBalance += range.startingBalance
    endingBalance += range.endingBalance
  }

  return { startingBalance, endingBalance }
}
