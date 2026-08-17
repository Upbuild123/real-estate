import { db } from '../../../../lib/db'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json()
  const updated = await db.financialRecord.update({
    where: { id: params.id },
    data: { amount: body.amount, source: 'manual' },
  })
  return Response.json(updated)
}
