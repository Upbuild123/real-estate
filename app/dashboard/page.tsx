import { listProperties } from '../../lib/properties'
import { getPropertyRangeDashboard, getEarliestMonthWithData } from '../../lib/dashboardData'
import { getRoomBreakdown, getExpenseBreakdown } from '../../lib/lineItemBreakdown'
import { parsePeriod, listPeriodOptions } from '../../lib/periods'
import { DashboardView } from './DashboardView'
import styles from './dashboard.module.css'

// This page reads live DB state (financials, anomaly flags) and per-request query params
// (propertyId/period) — it must never be statically prerendered at build time.
export const dynamic = 'force-dynamic'

const PERIOD_PATTERN = /^\d{4}-(\d{2}|full|ytd)$/

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; period?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const properties = await listProperties()
  const propertyId = resolvedSearchParams.propertyId ?? properties[0]?.id

  if (!propertyId) {
    return <p className={styles.empty}>No properties found. Add a property to get started.</p>
  }

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

  const [dashboard, roomBreakdown, expenseBreakdown] = await Promise.all([
    getPropertyRangeDashboard(propertyId, months),
    getRoomBreakdown(propertyId, months),
    getExpenseBreakdown(propertyId, months),
  ])

  return (
    <DashboardView
      properties={properties.map((p) => ({ id: p.id, name: p.name }))}
      selectedPropertyId={propertyId}
      period={period}
      periodOptions={periodOptions}
      dashboard={dashboard}
      roomBreakdown={roomBreakdown}
      expenseBreakdown={expenseBreakdown}
    />
  )
}
