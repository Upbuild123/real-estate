import { db } from './db'
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
