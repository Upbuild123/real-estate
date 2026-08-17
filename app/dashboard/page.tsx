import { listProperties } from '../../lib/properties'
import { getPropertyMonthlyDashboard, getPropertyYtdDashboard } from '../../lib/dashboardData'
import { DashboardView } from './DashboardView'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { propertyId?: string; month?: string }
}) {
  const properties = await listProperties()
  const month = searchParams.month ?? new Date().toISOString().slice(0, 7)
  const propertyId = searchParams.propertyId ?? properties[0]?.id

  if (!propertyId) {
    return <p>No properties found. Add a property to get started.</p>
  }

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
