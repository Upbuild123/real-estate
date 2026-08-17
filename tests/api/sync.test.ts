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

  it('returns 400 for malformed JSON body', async () => {
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: '{not valid json',
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 400 when propertyId is missing', async () => {
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({ dropboxFolderPath: '/ide' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 400 when dropboxFolderPath is not a string', async () => {
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'prop-1', dropboxFolderPath: 123 }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })
})
