import { ingestLoanDocument } from '../../../../lib/extraction/extractLoan'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const propertyId = formData.get('propertyId')
    const file = formData.get('file')

    if (typeof propertyId !== 'string' || propertyId.trim() === '') {
      return Response.json({ error: 'propertyId is required and must be a non-empty string' }, { status: 400 })
    }

    if (!file || !(file instanceof File)) {
      return Response.json({ error: 'file is required and must be a valid file upload' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const pdfBase64 = Buffer.from(arrayBuffer).toString('base64')

    try {
      const result = await ingestLoanDocument({ dropboxFileId: null, propertyId, pdfBase64 })
      return Response.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to ingest loan document'
      return Response.json({ error: message }, { status: 500 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process upload request'
    return Response.json({ error: message }, { status: 400 })
  }
}
