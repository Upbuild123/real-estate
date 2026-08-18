import { db } from './db'
import { getLoanForProperty, monthlyInterestExpense, monthlyDebtService } from './loans'
import { getMonthlyAmortizedCost } from './annualCosts'
import { getMarginalTaxRate } from './settings'

export interface MonthlyFinancials {
  income: number
  operatingExpenses: number
  noi: number
  debtService: number
  interestExpense: number
  principalPaydown: number
  amortizedTax: number
  amortizedInsurance: number
  amortizedDepreciation: number
  preTaxCashFlow: number
  taxableIncome: number
  incomeTaxOwed: number
  afterTaxCashFlow: number
}

export async function getMonthlyFinancials(propertyId: string, month: string): Promise<MonthlyFinancials> {
  const records = await db.financialRecord.findMany({ where: { propertyId, month } })

  const income = records.filter((r) => r.category === 'income').reduce((sum, r) => sum + r.amount, 0)
  const operatingExpenses = records.filter((r) => r.category === 'expense').reduce((sum, r) => sum + r.amount, 0)
  const noi = income - operatingExpenses

  const loan = await getLoanForProperty(propertyId)
  const interestExpense = loan ? monthlyInterestExpense(loan.currentBalance, loan.currentRate) : 0
  const principalPaydown = loan ? loan.monthlyPrincipal : 0
  const debtService = loan ? monthlyDebtService(loan) : 0

  const year = parseInt(month.split('-')[0], 10)
  const amortizedTax = await getMonthlyAmortizedCost(propertyId, 'tax', year)
  const amortizedInsurance = await getMonthlyAmortizedCost(propertyId, 'insurance', year)
  const amortizedDepreciation = await getMonthlyAmortizedCost(propertyId, 'depreciation', year)

  // Depreciation reduces taxable income (it's a real deductible expense for tax purposes)
  // but is never a cash outflow, so it must never appear in preTaxCashFlow/afterTaxCashFlow below.
  const rawTaxableIncome = noi - interestExpense - amortizedTax - amortizedInsurance - amortizedDepreciation
  const taxableIncome = Math.max(rawTaxableIncome, 0)

  const marginalRate = await getMarginalTaxRate()
  const incomeTaxOwed = taxableIncome * marginalRate

  const preTaxCashFlow = noi - debtService - amortizedTax - amortizedInsurance
  const afterTaxCashFlow = preTaxCashFlow - incomeTaxOwed

  return {
    income,
    operatingExpenses,
    noi,
    debtService,
    interestExpense,
    principalPaydown,
    amortizedTax,
    amortizedInsurance,
    amortizedDepreciation,
    preTaxCashFlow,
    taxableIncome,
    incomeTaxOwed,
    afterTaxCashFlow,
  }
}
