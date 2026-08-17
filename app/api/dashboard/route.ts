import { getPropertyMonthlyDashboard, getPropertyYtdDashboard, getPortfolioDashboard } from '../../../lib/dashboardData'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const propertyId = url.searchParams.get('propertyId') ?? 'portfolio'
  const month = url.searchParams.get('month') ?? new Date().toISOString().slice(0, 7)
  const year = parseInt(month.split('-')[0], 10)
  const monthNum = parseInt(month.split('-')[1], 10)

  if (propertyId === 'portfolio') {
    const monthly = await getPortfolioDashboard(month)
    return Response.json({ monthly, ytd: null })
  }

  const [monthly, ytd] = await Promise.all([
    getPropertyMonthlyDashboard(propertyId, month),
    getPropertyYtdDashboard(propertyId, year, monthNum),
  ])
  return Response.json({ monthly, ytd })
}
