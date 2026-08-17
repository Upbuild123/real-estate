import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/dropboxSync', () => ({
  syncDropboxFolder: vi.fn().mockResolvedValue({ newFiles: 2, skipped: 1 }),
}))

import { POST } from '../../app/api/sync/route'

describe('POST /api/sync', () => {
  it('triggers a Dropbox sync for the given property and returns the result', async () => {
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'prop-1', dropboxFolderPath: '/ide' }),
    })
    const response = await POST(request)
    const body = await response.json()
    expect(body).toEqual({ newFiles: 2, skipped: 1 })
  })
})
