import { syncDropboxFolder } from '../../../lib/dropboxSync'

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const { propertyId, dropboxFolderPath } = body ?? {}

  if (typeof propertyId !== 'string' || propertyId.trim() === '') {
    return Response.json({ error: 'propertyId is required and must be a non-empty string' }, { status: 400 })
  }

  if (typeof dropboxFolderPath !== 'string' || dropboxFolderPath.trim() === '') {
    return Response.json({ error: 'dropboxFolderPath is required and must be a non-empty string' }, { status: 400 })
  }

  try {
    const result = await syncDropboxFolder({ id: propertyId, dropboxFolderPath })
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to sync Dropbox folder'
    return Response.json({ error: message }, { status: 500 })
  }
}
