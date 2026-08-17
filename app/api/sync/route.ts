import { syncDropboxFolder } from '../../../lib/dropboxSync'
import { getProperty } from '../../../lib/properties'

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const { propertyId } = body ?? {}

  if (typeof propertyId !== 'string' || propertyId.trim() === '') {
    return Response.json({ error: 'propertyId is required and must be a non-empty string' }, { status: 400 })
  }

  const property = await getProperty(propertyId)

  if (!property) {
    return Response.json({ error: 'Property not found' }, { status: 404 })
  }

  if (!property.dropboxFolderPath) {
    return Response.json(
      { error: 'This property has no dropboxFolderPath configured. Set one via /admin before syncing.' },
      { status: 400 }
    )
  }

  try {
    const result = await syncDropboxFolder({ id: propertyId, dropboxFolderPath: property.dropboxFolderPath })
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to sync Dropbox folder'
    return Response.json({ error: message }, { status: 500 })
  }
}
