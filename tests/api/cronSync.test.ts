import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../lib/dropboxSync', () => ({
  syncDropboxFolder: vi.fn().mockResolvedValue({ newFiles: 1, skipped: 0, failed: 0 }),
}))

vi.mock('../../lib/properties', () => ({
  listProperties: vi.fn(),
}))

import { GET } from '../../app/api/cron/sync/route'
import { syncDropboxFolder } from '../../lib/dropboxSync'
import { listProperties } from '../../lib/properties'

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET

function authedRequest() {
  return new Request('http://localhost/api/cron/sync', {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
}

describe('GET /api/cron/sync', () => {
  it('returns 401 when the Authorization header does not match CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const request = new Request('http://localhost/api/cron/sync', {
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('syncs every active property that has a dropboxFolderPath configured, skipping those without one', async () => {
    process.env.CRON_SECRET = 'test-secret'
    ;(listProperties as any).mockResolvedValueOnce([
      { id: 'prop-1', name: 'Ide', dropboxFolderPath: '/Michael Sloyer/Ide building/2026' },
      { id: 'prop-2', name: 'No Folder Property', dropboxFolderPath: null },
    ])

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(syncDropboxFolder).toHaveBeenCalledTimes(1)
    expect(syncDropboxFolder).toHaveBeenCalledWith({
      id: 'prop-1',
      dropboxFolderPath: '/Michael Sloyer/Ide building/2026',
    })
    expect(body.results).toHaveLength(1)
    expect(body.results[0].propertyId).toBe('prop-1')
    expect(body.skippedProperties).toEqual(['prop-2'])
  })

  it('continues syncing remaining properties if one property sync throws', async () => {
    process.env.CRON_SECRET = 'test-secret'
    ;(listProperties as any).mockResolvedValueOnce([
      { id: 'prop-1', name: 'Ide', dropboxFolderPath: '/a' },
      { id: 'prop-2', name: 'D05', dropboxFolderPath: '/b' },
    ])
    ;(syncDropboxFolder as any).mockRejectedValueOnce(new Error('Dropbox API error'))
    ;(syncDropboxFolder as any).mockResolvedValueOnce({ newFiles: 1, skipped: 0, failed: 0 })

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.results).toHaveLength(2)
    expect(body.results[0].status).toBe('failed')
    expect(body.results[1].status).toBe('success')
  })
})

afterAll(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET
})
