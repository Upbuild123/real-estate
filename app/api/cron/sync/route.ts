import { syncDropboxFolder } from '../../../../lib/dropboxSync'
import { listProperties } from '../../../../lib/properties'

// Syncs every property sequentially, each involving several Claude extraction calls — this
// can comfortably exceed the default serverless timeout. Capped to whatever the actual
// Vercel plan allows; safe to request more than the plan grants.
export const maxDuration = 300

// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` on scheduled invocations
// (see vercel.json). This also lets us trigger a manual sync-all by hitting the route
// with the same header.
export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const properties = await listProperties()
  const withFolder = properties.filter((p) => p.dropboxFolderPath)
  const skippedProperties = properties.filter((p) => !p.dropboxFolderPath).map((p) => p.id)

  const results: { propertyId: string; status: 'success' | 'failed'; detail: unknown }[] = []

  for (const property of withFolder) {
    try {
      const result = await syncDropboxFolder({
        id: property.id,
        dropboxFolderPath: property.dropboxFolderPath as string,
      })
      results.push({ propertyId: property.id, status: 'success', detail: result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed'
      results.push({ propertyId: property.id, status: 'failed', detail: message })
    }
  }

  return Response.json({ results, skippedProperties })
}
