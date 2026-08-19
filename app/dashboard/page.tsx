import { listProperties } from '../../lib/properties'
import {
  getPropertyRangeDashboard,
  getEarliestMonthWithData,
  getLatestMonthWithData,
  getYearlyComparisonDashboard,
} from '../../lib/dashboardData'
import { getRoomBreakdown, getExpenseBreakdown, getIncomeBreakdown } from '../../lib/lineItemBreakdown'
import { getUpcomingLeaseExpirations, getPortfolioUpcomingLeaseExpirations } from '../../lib/leaseTracking'
import { parsePeriod, listPeriodOptions } from '../../lib/periods'
import { DashboardView, type DashboardViewMode } from './DashboardView'
import styles from './dashboard.module.css'

// This page reads live DB state (financials, anomaly flags) and per-request query params
// (propertyId/period/view) — it must never be statically prerendered at build time.
export const dynamic = 'force-dynamic'

const PERIOD_PATTERN = /^\d{4}-(\d{2}|full|ytd)$/

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

  const view: DashboardViewMode =
    resolvedSearchParams.view === 'financials'
      ? 'financials'
      : resolvedSearchParams.view === 'compare'
        ? 'compare'
        : 'operations'

  const [earliestMonth, latestMonth] = await Promise.all([
    getEarliestMonthWithData(propertyId),
    getLatestMonthWithData(propertyId),
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

  // Room/expense breakdown and lease expirations are only shown on the Operations view — skip
  // fetching them on Financials/Compare to avoid unnecessary work. Comparison columns are only
  // fetched on Compare — they span every year of data, not just the selected period. Lease
  // expirations are forward-looking (next 90 days from today), independent of the selected period.
  const [dashboard, roomBreakdown, incomeBreakdown, expenseBreakdown, comparison, upcomingLeaseExpirations, portfolioLeaseExpirations] =
    await Promise.all([
      getPropertyRangeDashboard(propertyId, months),
      view === 'operations' ? getRoomBreakdown(propertyId, months) : Promise.resolve([]),
      view === 'operations' ? getIncomeBreakdown(propertyId, months) : Promise.resolve([]),
      view === 'operations' ? getExpenseBreakdown(propertyId, months) : Promise.resolve([]),
      view === 'compare' ? getYearlyComparisonDashboard(propertyId, effectiveNow) : Promise.resolve([]),
      view === 'operations' ? getUpcomingLeaseExpirations(propertyId) : Promise.resolve([]),
      getPortfolioUpcomingLeaseExpirations(),
    ])

  return (
    <DashboardView
      properties={properties.map((p) => ({ id: p.id, name: p.name }))}
      selectedPropertyId={propertyId}
      period={period}
      periodOptions={periodOptions}
      view={view}
      dashboard={dashboard}
      roomBreakdown={roomBreakdown}
      incomeBreakdown={incomeBreakdown}
      expenseBreakdown={expenseBreakdown}
      comparison={comparison}
      upcomingLeaseExpirations={upcomingLeaseExpirations}
      portfolioLeaseExpirations={portfolioLeaseExpirations}
    />
  )
}
