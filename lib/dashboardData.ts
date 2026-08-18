import { db } from './db'
import { getMonthlyFinancials, type MonthlyFinancials } from './financialCalculations'
import { listProperties } from './properties'
import type { AnomalyFlag } from '@prisma/client'

const ZERO_FINANCIALS: MonthlyFinancials = {
  income: 0,
  operatingExpenses: 0,
  noi: 0,
  debtService: 0,
  interestExpense: 0,
  principalPaydown: 0,
  amortizedTax: 0,
  amortizedInsurance: 0,
  amortizedDepreciation: 0,
  preTaxCashFlow: 0,
  taxableIncome: 0,
  incomeTaxOwed: 0,
  afterTaxCashFlow: 0,
}

function sumFinancials(a: MonthlyFinancials, b: MonthlyFinancials): MonthlyFinancials {
  const result = { ...ZERO_FINANCIALS }
  for (const key of Object.keys(ZERO_FINANCIALS) as (keyof MonthlyFinancials)[]) {
    result[key] = a[key] + b[key]
  }
  return result
}

export async function getPropertyMonthlyDashboard(
  propertyId: string,
  month: string
): Promise<MonthlyFinancials & { flags: AnomalyFlag[] }> {
  const financials = await getMonthlyFinancials(propertyId, month)
  const flags = await db.anomalyFlag.findMany({ where: { propertyId, month, status: 'open' } })
  return { ...financials, flags }
}

export async function getPropertyYtdDashboard(
  propertyId: string,
  year: number,
  throughMonth: number
): Promise<MonthlyFinancials> {
  let total = { ...ZERO_FINANCIALS }
  for (let m = 1; m <= throughMonth; m++) {
    const month = `${year}-${String(m).padStart(2, '0')}`
    const financials = await getMonthlyFinancials(propertyId, month)
    total = sumFinancials(total, financials)
  }
  return total
}

export async function getPropertyRangeDashboard(
  propertyId: string,
  months: string[]
): Promise<MonthlyFinancials & { flags: AnomalyFlag[] }> {
  let total = { ...ZERO_FINANCIALS }
  for (const month of months) {
    const financials = await getMonthlyFinancials(propertyId, month)
    total = sumFinancials(total, financials)
  }
  const flags = await db.anomalyFlag.findMany({ where: { propertyId, month: { in: months }, status: 'open' } })
  return { ...total, flags }
}

// The earliest month with any FinancialRecord for this property, used to bound how far back
// the period selector offers individual months/full years. Null if the property has no data yet.
export async function getEarliestMonthWithData(propertyId: string): Promise<string | null> {
  const record = await db.financialRecord.findFirst({
    where: { propertyId },
    orderBy: { month: 'asc' },
    select: { month: true },
  })
  return record?.month ?? null
}

export interface YearlyComparisonColumn {
  year: number
  label: string
  financials: MonthlyFinancials
}

// One column per year of available data, most recent first. The current calendar year is
// YTD-only (through the latest month with data) since its full-year total isn't known yet;
// every prior year is its complete Jan-Dec total. Comparing a YTD column against prior years'
// full-year totals is a known apples-to-oranges gap the label makes explicit — the caller
// should never present a YTD column as if it were a complete year.
export async function getYearlyComparisonDashboard(
  propertyId: string,
  now: Date = new Date()
): Promise<YearlyComparisonColumn[]> {
  const earliestMonth = await getEarliestMonthWithData(propertyId)
  if (!earliestMonth) return []

  const earliestYear = Number(earliestMonth.split('-')[0])
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const columns: YearlyComparisonColumn[] = []
  for (let year = currentYear; year >= earliestYear; year--) {
    const isCurrentYear = year === currentYear
    const throughMonth = isCurrentYear ? currentMonth : 12
    const financials = await getPropertyYtdDashboard(propertyId, year, throughMonth)
    columns.push({
      year,
      label: isCurrentYear ? `${year} (YTD)` : `${year}`,
      financials,
    })
  }

  return columns
}

export async function getPortfolioDashboard(
  month: string
): Promise<MonthlyFinancials & { perProperty: { propertyId: string; propertyName: string; financials: MonthlyFinancials }[] }> {
  const properties = await listProperties()
  const perProperty = await Promise.all(
    properties.map(async (property) => ({
      propertyId: property.id,
      propertyName: property.name,
      financials: await getMonthlyFinancials(property.id, month),
    }))
  )

  const total = perProperty.reduce((acc, p) => sumFinancials(acc, p.financials), { ...ZERO_FINANCIALS })

  return { ...total, perProperty }
}
