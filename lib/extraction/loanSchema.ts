export interface LoanPaymentScheduleRow {
  date: string
  totalPayment: number
  principal: number
  interest: number
  remainingBalance: number
}

export interface LoanExtraction {
  lender: string
  originationDate: string
  maturityDate: string
  originalLoanAmount: number
  currentInterestRate: number
  rateChangeDate: string | null
  newInterestRate: number | null
  monthlyPrincipal: number
  paymentSchedule: LoanPaymentScheduleRow[]
}

export const LOAN_SCHEMA_DESCRIPTION = `
{
  "lender": string,
  "originationDate": string (YYYY-MM-DD),
  "maturityDate": string (YYYY-MM-DD),
  "originalLoanAmount": number,
  "currentInterestRate": number (as a percentage, e.g. 1.825),
  "rateChangeDate": string | null (YYYY-MM-DD, the date a new rate takes effect if shown),
  "newInterestRate": number | null (percentage),
  "monthlyPrincipal": number (the fixed principal amount per scheduled payment),
  "paymentSchedule": [{
    "date": string (YYYY-MM-DD),
    "totalPayment": number,
    "principal": number,
    "interest": number,
    "remainingBalance": number
  }]
}
`
