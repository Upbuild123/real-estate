import { getPropertyRangeDashboard, getPortfolioDashboard } from '../../../lib/dashboardData'
import { parsePeriod } from '../../../lib/periods'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const propertyId = url.searchParams.get('propertyId')
  const period = url.searchParams.get('period') ?? new Date().toISOString().slice(0, 7)

  let months: string[]
  try {
    months = parsePeriod(period)
  } catch {
    return Response.json({ error: 'Invalid period. Expected YYYY-MM, YYYY-full, or YYYY-ytd.' }, { status: 400 })
  }

  if (propertyId === 'portfolio') {
    // Portfolio view is month-by-month only for now; use the first month in the requested period.
    const monthly = await getPortfolioDashboard(months[0])
    return Response.json(monthly)
  }

  if (!propertyId) {
    return Response.json({ error: 'propertyId is required (or "portfolio")' }, { status: 400 })
  }

  const result = await getPropertyRangeDashboard(propertyId, months)
  return Response.json(result)
}
