import { createProperty, listProperties } from '../../../lib/properties'

export async function GET() {
  const properties = await listProperties()
  return Response.json(properties)
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON body' }, { status: 400 })
  }

  const { name, address, dropboxFolderPath } = body as {
    name?: unknown
    address?: unknown
    dropboxFolderPath?: unknown
  }

  if (typeof name !== 'string' || name.trim() === '') {
    return Response.json({ error: 'name is required and must be a non-empty string' }, { status: 400 })
  }
  if (typeof address !== 'string' || address.trim() === '') {
    return Response.json({ error: 'address is required and must be a non-empty string' }, { status: 400 })
  }
  if (dropboxFolderPath !== undefined && typeof dropboxFolderPath !== 'string') {
    return Response.json({ error: 'dropboxFolderPath must be a string if provided' }, { status: 400 })
  }

  try {
    const property = await createProperty({
      name,
      address,
      dropboxFolderPath: dropboxFolderPath || undefined,
    })
    return Response.json(property)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create property'
    return Response.json({ error: message }, { status: 500 })
  }
}
