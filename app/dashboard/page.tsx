import { listProperties } from '../../lib/properties'
import {
  getPropertyRangeDashboard,
  getEarliestMonthWithData,
  getYearlyComparisonDashboard,
} from '../../lib/dashboardData'
import { getRoomBreakdown, getExpenseBreakdown } from '../../lib/lineItemBreakdown'
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

  const earliestMonth = (await getEarliestMonthWithData(propertyId)) ?? new Date().toISOString().slice(0, 7)
  const periodOptions = listPeriodOptions({ earliestMonth })

  const requestedPeriod = resolvedSearchParams.period
  const period =
    requestedPeriod && PERIOD_PATTERN.test(requestedPeriod) ? requestedPeriod : periodOptions[0]?.value ?? earliestMonth

  let months: string[]
  try {
    months = parsePeriod(period)
  } catch {
    months = parsePeriod(periodOptions[0]?.value ?? earliestMonth)
  }

  // Room/expense breakdown and lease expirations are only shown on the Operations view — skip
  // fetching them on Financials/Compare to avoid unnecessary work. Comparison columns are only
  // fetched on Compare — they span every year of data, not just the selected period. Lease
  // expirations are forward-looking (next 90 days from today), independent of the selected period.
  const [dashboard, roomBreakdown, expenseBreakdown, comparison, upcomingLeaseExpirations, portfolioLeaseExpirations] =
    await Promise.all([
      getPropertyRangeDashboard(propertyId, months),
      view === 'operations' ? getRoomBreakdown(propertyId, months) : Promise.resolve([]),
      view === 'operations' ? getExpenseBreakdown(propertyId, months) : Promise.resolve([]),
      view === 'compare' ? getYearlyComparisonDashboard(propertyId) : Promise.resolve([]),
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
      expenseBreakdown={expenseBreakdown}
      comparison={comparison}
      upcomingLeaseExpirations={upcomingLeaseExpirations}
      portfolioLeaseExpirations={portfolioLeaseExpirations}
    />
  )
}
