import { upsertAnnualCost } from '../../../lib/annualCosts'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON body' }, { status: 400 })
  }

  const { propertyId, costType, year, annualAmount } = body as Record<string, unknown>

  if (typeof propertyId !== 'string' || propertyId.trim() === '') {
    return Response.json({ error: 'propertyId is required and must be a non-empty string' }, { status: 400 })
  }
  if (costType !== 'tax' && costType !== 'insurance') {
    return Response.json({ error: 'costType must be "tax" or "insurance"' }, { status: 400 })
  }
  if (typeof year !== 'number' || !Number.isFinite(year)) {
    return Response.json({ error: 'year is required and must be a number' }, { status: 400 })
  }
  if (typeof annualAmount !== 'number' || !Number.isFinite(annualAmount)) {
    return Response.json({ error: 'annualAmount is required and must be a number' }, { status: 400 })
  }

  try {
    const record = await upsertAnnualCost({ propertyId, costType, year, annualAmount })
    return Response.json(record)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save annual cost'
    return Response.json({ error: message }, { status: 500 })
  }
}
