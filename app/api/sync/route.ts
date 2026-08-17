import { syncDropboxFolder } from '../../../lib/dropboxSync'

export async function POST(request: Request) {
  const body = await request.json()
  const result = await syncDropboxFolder({ id: body.propertyId, dropboxFolderPath: body.dropboxFolderPath })
  return Response.json(result)
}
