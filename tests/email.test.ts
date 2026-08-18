import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendStatementsReadyEmail } from '../lib/email'

const ORIGINAL_RESEND_API_KEY = process.env.RESEND_API_KEY

describe('sendStatementsReadyEmail', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.RESEND_API_KEY = ORIGINAL_RESEND_API_KEY
  })

  it('posts to the Resend API with the expected recipient, subject, and API key', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'email_123' }) })
    vi.stubGlobal('fetch', fetchMock)

    await sendStatementsReadyEmail({
      to: 'michael.sloyer@gmail.com',
      month: '2026-06',
      propertyNames: ['Ide building', 'Residence DO5'],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        }),
      })
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.to).toEqual(['michael.sloyer@gmail.com'])
    expect(body.subject).toContain('June 2026')
    expect(body.html).toContain('Ide building')
    expect(body.html).toContain('Residence DO5')
  })

  it('throws a descriptive error when the Resend API responds with an error', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'invalid from address' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sendStatementsReadyEmail({ to: 'michael.sloyer@gmail.com', month: '2026-06', propertyNames: ['Ide building'] })
    ).rejects.toThrow(/422/)
  })

  it('throws if RESEND_API_KEY is not configured', async () => {
    delete process.env.RESEND_API_KEY
    await expect(
      sendStatementsReadyEmail({ to: 'michael.sloyer@gmail.com', month: '2026-06', propertyNames: ['Ide building'] })
    ).rejects.toThrow(/RESEND_API_KEY/)
  })
})
