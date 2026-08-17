import { db } from '../../../../lib/db'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const { amount } = body ?? {}

  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    return Response.json({ error: 'amount is required and must be a number' }, { status: 400 })
  }

  const { id } = await params

  try {
    const updated = await db.financialRecord.update({
      where: { id },
      data: { amount, source: 'manual' },
    })
    return Response.json(updated)
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return Response.json({ error: 'Financial record not found' }, { status: 404 })
    }
    const message = err instanceof Error ? err.message : 'Failed to update financial record'
    return Response.json({ error: message }, { status: 500 })
  }
}
