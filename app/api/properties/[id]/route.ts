import { updatePropertyDriveFolder } from '../../../../lib/properties'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON body' }, { status: 400 })
  }

  const { googleDriveFolderId } = body as { googleDriveFolderId?: unknown }

  if (googleDriveFolderId !== null && typeof googleDriveFolderId !== 'string') {
    return Response.json({ error: 'googleDriveFolderId must be a string or null' }, { status: 400 })
  }

  try {
    const property = await updatePropertyDriveFolder(id, googleDriveFolderId || null)
    return Response.json(property)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update property'
    return Response.json({ error: message }, { status: 500 })
  }
}
