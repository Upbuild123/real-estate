import { ingestLoanDocument } from '../../../../lib/extraction/extractLoan'

export async function POST(request: Request) {
  const formData = await request.formData()
  const propertyId = formData.get('propertyId') as string
  const file = formData.get('file') as File

  const arrayBuffer = await file.arrayBuffer()
  const pdfBase64 = Buffer.from(arrayBuffer).toString('base64')

  const result = await ingestLoanDocument({ dropboxFileId: null, propertyId, pdfBase64 })
  return Response.json(result)
}
