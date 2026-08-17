import { listProperties } from '../../lib/properties'
import { getPropertyMonthlyDashboard, getPropertyYtdDashboard } from '../../lib/dashboardData'
import { DashboardView } from './DashboardView'

// This page reads live DB state (financials, anomaly flags) and per-request query params
// (propertyId/month) — it must never be statically prerendered at build time.
export const dynamic = 'force-dynamic'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; month?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const properties = await listProperties()
  const month = resolvedSearchParams.month ?? new Date().toISOString().slice(0, 7)
  const propertyId = resolvedSearchParams.propertyId ?? properties[0]?.id

  if (!propertyId) {
    return <p>No properties found. Add a property to get started.</p>
  }

  // Note: `month` is not format-validated here (unlike app/api/dashboard/route.ts, which
  // rejects malformed values with a 400). A malformed month would silently produce NaN
  // year/monthNum below. Not fixed here since this is a server component, not a JSON API,
  // and a 400-style error response doesn't fit this context as cleanly.
  const year = parseInt(month.split('-')[0], 10)
  const monthNum = parseInt(month.split('-')[1], 10)

  const [monthly, ytd] = await Promise.all([
    getPropertyMonthlyDashboard(propertyId, month),
    getPropertyYtdDashboard(propertyId, year, monthNum),
  ])

  return (
    <DashboardView
      properties={properties.map((p) => ({ id: p.id, name: p.name }))}
      selectedPropertyId={propertyId}
      month={month}
      monthly={monthly}
      ytd={ytd}
    />
  )
}
