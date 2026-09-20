import { createSign } from 'crypto'

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function buildSignedJwt(email: string, privateKey: string): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const claimSet = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const signature = base64url(signer.sign(privateKey))

  return `${unsigned}.${signature}`
}

// Google's service-account tokens are short-lived (1 hour) with no unattended way to extend
// them, so — same approach as the prior Dropbox integration — mint a fresh access token from
// the service account credentials before every Drive API call rather than caching one across
// serverless invocations.
export async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

  if (!email || !privateKey) {
    throw new Error(
      'Google service account credentials are not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)'
    )
  }

  const jwt = buildSignedJwt(email, privateKey.replace(/\\n/g, '\n'))

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google token exchange failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.access_token as string
}
