import { describe, it, expect, vi, afterEach } from 'vitest'
import { getAccessToken } from '../lib/googleDriveAuth'

const ORIGINAL_ENV = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
}

// A real RSA private key so the JWT signing step in getAccessToken succeeds; the token
// exchange itself is mocked, so the key's validity (not its authenticity to Google) is
// what these tests exercise.
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCiUQn8xUNzswJi
u7IT2V3JU0NhUdYnx4bqHlPiijsSZO9+2uTDcfNyRn7FPVDbw2CwHxKdrmXaL3Uh
9qhzKB/MyOWji2G7PaTXbNcD77XAVC5pw0UO0Sia5+ZDt7HQlspiqglom20cTpMr
MYBtMkjE/YpHVIO5yuuRZbOs8xDHGZ473OWIjunw8dp1UAqfeMTu0NOQKek/Qm2e
wl/6ONDJ69Yx5BYRoCYcnxk/oIoWIm6AoBx2miOOnp3ejCfdmnnjsBLwbVw1le7x
EgcFhxdGR2NBe+BbS0HBOsRreLirxXE1DAA/q8Rg5GGYnVyWZTKJm42brEOOXG+n
3RcdyB0LAgMBAAECggEAHusH132tzQaeoDb3gz9m1XgGQC3p+JbRlJvlR6Qj/2t5
kTTZ2X7FrBFQiXqWAd5z9uhcT+vN2+MpUSheSt0sPYJQ97ePjK5/zUcep9HL0ZBX
bO70ow9lSCh/HIwLk1t9vpB8DVB51qgC8XnS6DnpUZin89Fd7BCCkaYJNRrxqbLi
Jch7n54EBW8ctz8SoffgNFdDRptEmtQlLT6fke5AyBB36rkTLeuOavvSxL78o9xu
unnDVsochNCyAmsl2FckpOAewMTzcI/qoKCktWD6XXyPTVxU7F0A9Y+DLbU8uxNB
0w/8AJeMcI8pqer4KGubBGsfSge/NikvYsOFV+AhfQKBgQDcE6bx54HTT033uB1G
g/IOKJHJqmrOe/vIUCjwPuLt8lITlDxgOXJsLmiJlG96XQRMMfQiHlpGJyIq9rS/
bIoFj3meNzJ1wkFZA4P3OUa8Xj7t91uhbTRxvvvGRLVUnGJRx+fxJZ4AxaAoptc3
1EBz9h4bA8EWfXWZQYK8guFT7QKBgQC8z8LWT+wcNdovctqwzz1gjEifkitGZl0R
8gt4RZkIOvZmuuC7dAcLA8A4UUNOBtaIIHWTko1VkSGwKwzVb91nAl0UENUETFwT
vOgXUtCgqXJuylqaZdd1pz8cZRNhQ8XTSYtkjZwsvnmbp09itmXYbL/TIzjxsy+/
2nSkTKMF1wKBgHKSzJwtwXoIVHf940fd03uphVSvIxHCnG9JxDZnFu9382D8EH6s
CbTmaEgP/gV/PYiJjSbiFG9nWjNx4uGxmR2R92f2JpAGBM1Zti9UI05X5n0vBQZC
e0Yofp1XEewtykX3Q/pYcizGtj3TtkH7f16fqEa6KqERydJyt6R6ouJ1AoGAU7f/
mU1Y0O1j8DQKGenaOiwZq3+BZrbOv71GLq8VetvCE6z7JsL8uHqSSaZmpHtNtpBF
8ghCWNWATX/ZMe5nCly27sXD3iMJlMrnUigrT4GytsNMxzcvAQEGb821eSQ23Ee4
4f4UaJaQj17xSUC9Cei2aaUtg6ZDHtt7arp8coMCgYBE3Iy+2zDmG5YhBDigX/26
tS682gvcynR6km1o5b8CJ+IYz/fJrE2IknncgJSkWaMJJN6UXrGq2Yv319v73jcF
p6s2UilD28/7kEHbvArGX6gXVHM/l3DSFSTueHsN1ggNmm7ooDN57J7h87rwP0Vz
gvWoMfO7Oypv78v3Te8p5w==
-----END PRIVATE KEY-----`

describe('getAccessToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = ORIGINAL_ENV.GOOGLE_SERVICE_ACCOUNT_EMAIL
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = ORIGINAL_ENV.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  })

  it('exchanges a signed JWT for an access token via the Google OAuth endpoint', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@test-project.iam.gserviceaccount.com'
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = TEST_PRIVATE_KEY

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'fresh-access-token', expires_in: 3600 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const token = await getAccessToken()

    expect(token).toBe('fresh-access-token')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' })
    )
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as URLSearchParams
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    expect(typeof body.get('assertion')).toBe('string')
    expect(body.get('assertion')!.split('.')).toHaveLength(3)
  })

  it('throws a descriptive error when the token exchange fails', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@test-project.iam.gserviceaccount.com'
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = TEST_PRIVATE_KEY

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid_grant' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAccessToken()).rejects.toThrow(/401/)
  })

  it('throws if any of the required env vars are missing', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = TEST_PRIVATE_KEY

    await expect(getAccessToken()).rejects.toThrow(/GOOGLE_SERVICE_ACCOUNT_EMAIL/)
  })
})
