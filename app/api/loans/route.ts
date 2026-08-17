import { createLoan } from '../../../lib/loans'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON body' }, { status: 400 })
  }

  const input = body as Record<string, unknown>

  const requiredStringFields = ['propertyId', 'lender', 'originationDate', 'maturityDate'] as const
  for (const field of requiredStringFields) {
    if (typeof input[field] !== 'string' || (input[field] as string).trim() === '') {
      return Response.json({ error: `${field} is required and must be a non-empty string` }, { status: 400 })
    }
  }

  const requiredNumberFields = ['originalAmount', 'currentBalance', 'currentRate', 'monthlyPrincipal'] as const
  for (const field of requiredNumberFields) {
    if (typeof input[field] !== 'number' || !Number.isFinite(input[field])) {
      return Response.json({ error: `${field} is required and must be a number` }, { status: 400 })
    }
  }

  try {
    const loan = await createLoan({
      propertyId: input.propertyId as string,
      lender: input.lender as string,
      originalAmount: input.originalAmount as number,
      currentBalance: input.currentBalance as number,
      currentRate: input.currentRate as number,
      rateChangeDate: typeof input.rateChangeDate === 'string' ? new Date(input.rateChangeDate) : undefined,
      newRate: typeof input.newRate === 'number' ? input.newRate : undefined,
      monthlyPrincipal: input.monthlyPrincipal as number,
      originationDate: new Date(input.originationDate as string),
      maturityDate: new Date(input.maturityDate as string),
    })
    return Response.json(loan)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create loan'
    return Response.json({ error: message }, { status: 500 })
  }
}
