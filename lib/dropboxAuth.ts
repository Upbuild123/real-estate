// Dropbox's "generate access token" quick-start button issues short-lived tokens (~4 hours)
// with no way to configure a longer lifetime. For unattended overnight syncing, mint a fresh
// access token from the long-lived refresh token before every Dropbox API call instead —
// simpler and more robust than trying to cache/track a single token's expiry across
// serverless invocations.
export async function getAccessToken(): Promise<string> {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN
  const appKey = process.env.DROPBOX_APP_KEY
  const appSecret = process.env.DROPBOX_APP_SECRET

  if (!refreshToken || !appKey || !appSecret) {
    throw new Error(
      'Dropbox refresh credentials are not configured (DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET)'
    )
  }

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Dropbox token refresh failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.access_token as string
}
