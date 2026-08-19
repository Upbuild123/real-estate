import { listProperties } from '../../lib/properties'
import {
  getPropertyRangeDashboard,
  getPortfolioRangeDashboard,
  getEarliestMonthWithData,
  getLatestMonthWithData,
  getPortfolioEarliestMonthWithData,
  getPortfolioLatestMonthWithData,
  getYearlyComparisonDashboard,
} from '../../lib/dashboardData'
import { getRoomBreakdown, getExpenseBreakdown } from '../../lib/lineItemBreakdown'
import { getUpcomingLeaseExpirations, getPortfolioUpcomingLeaseExpirations } from '../../lib/leaseTracking'
import { getLoanForProperty, loanBalanceRange, getPortfolioLoanBalanceRange } from '../../lib/loans'
import { parsePeriod, listPeriodOptions } from '../../lib/periods'
import { DashboardView, type DashboardViewMode } from './DashboardView'
import styles from './dashboard.module.css'
import type { AnomalyFlag } from '@prisma/client'

// This page reads live DB state (financials, anomaly flags) and per-request query params
// (propertyId/period/view) — it must never be statically prerendered at build time.
export const dynamic = 'force-dynamic'

const PERIOD_PATTERN = /^\d{4}-(\d{2}|full|ytd)$/

// A pseudo-property, not a real row in the Property table — selecting it sums every active
// property's financials together. Only the Financials view makes sense for it: per-room
// breakdown, flags, and anomaly detection are all inherently single-property concepts.
export const COMBINED_PROPERTY_ID = 'combined'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; period?: string; view?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const properties = await listProperties()
  const propertyId = resolvedSearchParams.propertyId ?? properties[0]?.id

  if (!propertyId) {
    return <p className={styles.empty}>No properties found. Add a property to get started.</p>
  }

  const isCombined = propertyId === COMBINED_PROPERTY_ID

  const view: DashboardViewMode = isCombined
    ? 'financials'
    : resolvedSearchParams.view === 'financials'
      ? 'financials'
      : resolvedSearchParams.view === 'compare'
        ? 'compare'
        : 'operations'

  const [earliestMonth, latestMonth] = await Promise.all([
    isCombined ? getPortfolioEarliestMonthWithData() : getEarliestMonthWithData(propertyId),
    isCombined ? getPortfolioLatestMonthWithData() : getLatestMonthWithData(propertyId),
  ])
  const resolvedEarliestMonth = earliestMonth ?? new Date().toISOString().slice(0, 7)

  // "Now" for YTD purposes is the latest month with an actual statement, not today's real
  // calendar date — a statement normally arrives 15-20 days into the following month, so
  // blindly summing through today's calendar month would include a month with no income/
  // expense records yet. Debt service/amortized tax/insurance are computed from the loan
  // independent of whether a statement exists, so that empty month would still silently add a
  // full extra month of debt service to the YTD total with nothing to offset it.
  const effectiveNow = latestMonth
    ? new Date(Number(latestMonth.split('-')[0]), Number(latestMonth.split('-')[1]) - 1, 1)
    : new Date()

  const periodOptions = listPeriodOptions({ earliestMonth: resolvedEarliestMonth, asOf: effectiveNow })

  const requestedPeriod = resolvedSearchParams.period
  const period =
    requestedPeriod && PERIOD_PATTERN.test(requestedPeriod)
      ? requestedPeriod
      : periodOptions[0]?.value ?? resolvedEarliestMonth

  let months: string[]
  try {
    months = parsePeriod(period, effectiveNow)
  } catch {
    months = parsePeriod(periodOptions[0]?.value ?? resolvedEarliestMonth, effectiveNow)
  }

  const loanReferenceMonth = latestMonth ?? months[months.length - 1]

  // Room/expense breakdown and lease expirations are only shown on the Operations view — skip
  // fetching them on Financials/Compare to avoid unnecessary work. Comparison columns are only
  // fetched on Compare — they span every year of data, not just the selected period. Lease
  // expirations are forward-looking (next 90 days from today), independent of the selected
  // period. Loan balance is only shown on the Financials view (single-property or combined).
  const [dashboard, roomBreakdown, expenseBreakdown, comparison, upcomingLeaseExpirations, portfolioLeaseExpirations, loanBalance] =
    await Promise.all([
      isCombined
        ? getPortfolioRangeDashboard(months).then((f) => ({ ...f, flags: [] as AnomalyFlag[] }))
        : getPropertyRangeDashboard(propertyId, months),
      !isCombined && view === 'operations' ? getRoomBreakdown(propertyId, months) : Promise.resolve([]),
      !isCombined && view === 'operations' ? getExpenseBreakdown(propertyId, months) : Promise.resolve([]),
      !isCombined && view === 'compare' ? getYearlyComparisonDashboard(propertyId, effectiveNow) : Promise.resolve([]),
      !isCombined && view === 'operations' ? getUpcomingLeaseExpirations(propertyId) : Promise.resolve([]),
      getPortfolioUpcomingLeaseExpirations(),
      view === 'financials'
        ? isCombined
          ? getPortfolioLoanBalanceRange(months, loanReferenceMonth)
          : getLoanForProperty(propertyId).then((loan) => (loan ? loanBalanceRange(loan, months, loanReferenceMonth) : null))
        : Promise.resolve(null),
    ])

  return (
    <DashboardView
      properties={[...properties.map((p) => ({ id: p.id, name: p.name })), { id: COMBINED_PROPERTY_ID, name: 'Combined' }]}
      selectedPropertyId={propertyId}
      period={period}
      periodOptions={periodOptions}
      view={view}
      dashboard={dashboard}
      roomBreakdown={roomBreakdown}
      expenseBreakdown={expenseBreakdown}
      comparison={comparison}
      upcomingLeaseExpirations={upcomingLeaseExpirations}
      portfolioLeaseExpirations={portfolioLeaseExpirations}
      loanBalance={loanBalance}
    />
  )
}
