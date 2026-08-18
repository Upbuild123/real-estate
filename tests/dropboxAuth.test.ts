import { describe, it, expect, vi, afterEach } from 'vitest'
import { getAccessToken } from '../lib/dropboxAuth'

const ORIGINAL_ENV = {
  DROPBOX_REFRESH_TOKEN: process.env.DROPBOX_REFRESH_TOKEN,
  DROPBOX_APP_KEY: process.env.DROPBOX_APP_KEY,
  DROPBOX_APP_SECRET: process.env.DROPBOX_APP_SECRET,
}

describe('getAccessToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.DROPBOX_REFRESH_TOKEN = ORIGINAL_ENV.DROPBOX_REFRESH_TOKEN
    process.env.DROPBOX_APP_KEY = ORIGINAL_ENV.DROPBOX_APP_KEY
    process.env.DROPBOX_APP_SECRET = ORIGINAL_ENV.DROPBOX_APP_SECRET
  })

  it('exchanges the refresh token for a fresh access token via the Dropbox OAuth endpoint', async () => {
    process.env.DROPBOX_REFRESH_TOKEN = 'test-refresh-token'
    process.env.DROPBOX_APP_KEY = 'test-app-key'
    process.env.DROPBOX_APP_SECRET = 'test-app-secret'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'fresh-access-token', expires_in: 14400 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const token = await getAccessToken()

    expect(token).toBe('fresh-access-token')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dropboxapi.com/oauth2/token',
      expect.objectContaining({ method: 'POST' })
    )
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as URLSearchParams
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('test-refresh-token')
    expect(body.get('client_id')).toBe('test-app-key')
    expect(body.get('client_secret')).toBe('test-app-secret')
  })

  it('throws a descriptive error when the refresh request fails', async () => {
    process.env.DROPBOX_REFRESH_TOKEN = 'test-refresh-token'
    process.env.DROPBOX_APP_KEY = 'test-app-key'
    process.env.DROPBOX_APP_SECRET = 'test-app-secret'

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid_grant' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAccessToken()).rejects.toThrow(/401/)
  })

  it('throws if any of the required env vars are missing', async () => {
    delete process.env.DROPBOX_REFRESH_TOKEN
    process.env.DROPBOX_APP_KEY = 'test-app-key'
    process.env.DROPBOX_APP_SECRET = 'test-app-secret'

    await expect(getAccessToken()).rejects.toThrow(/DROPBOX_REFRESH_TOKEN/)
  })
})
