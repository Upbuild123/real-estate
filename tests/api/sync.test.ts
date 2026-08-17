import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/dropboxSync', () => ({
  syncDropboxFolder: vi.fn().mockResolvedValue({ newFiles: 2, skipped: 1, failed: 0 }),
}))

vi.mock('../../lib/properties', () => ({
  getProperty: vi.fn(),
}))

import { POST } from '../../app/api/sync/route'
import { syncDropboxFolder } from '../../lib/dropboxSync'
import { getProperty } from '../../lib/properties'

describe('POST /api/sync', () => {
  it('looks up the property\'s stored dropboxFolderPath and triggers a sync', async () => {
    ;(getProperty as any).mockResolvedValueOnce({
      id: 'prop-1',
      name: 'Ide building',
      dropboxFolderPath: '/Michael Sloyer/Ide building/2026',
    })

    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'prop-1' }),
    })
    const response = await POST(request)
    const body = await response.json()

    expect(syncDropboxFolder).toHaveBeenCalledWith({
      id: 'prop-1',
      dropboxFolderPath: '/Michael Sloyer/Ide building/2026',
    })
    expect(body).toEqual({ newFiles: 2, skipped: 1, failed: 0 })
  })

  it('returns 400 when propertyId is missing', async () => {
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 404 when the property does not exist', async () => {
    ;(getProperty as any).mockResolvedValueOnce(null)
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'nonexistent' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(404)
  })

  it('returns 400 when the property has no dropboxFolderPath configured', async () => {
    ;(getProperty as any).mockResolvedValueOnce({ id: 'prop-2', name: 'No Folder', dropboxFolderPath: null })
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'prop-2' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/dropboxFolderPath/i)
  })

  it('returns 400 for malformed JSON body', async () => {
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: '{not valid json',
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })
})
