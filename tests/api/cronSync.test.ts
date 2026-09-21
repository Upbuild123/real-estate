import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../lib/driveSync', () => ({
  syncDriveFolder: vi.fn().mockResolvedValue({ newFiles: 1, skipped: 0, failed: 0 }),
}))

vi.mock('../../lib/properties', () => ({
  listProperties: vi.fn(),
}))

vi.mock('../../lib/notifications', () => ({
  checkAndNotify: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from '../../app/api/cron/sync/route'
import { syncDriveFolder } from '../../lib/driveSync'
import { listProperties } from '../../lib/properties'
import { checkAndNotify } from '../../lib/notifications'

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET
const ORIGINAL_NOTIFICATION_EMAIL_TO = process.env.NOTIFICATION_EMAIL_TO

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

  it('syncs every active property that has a googleDriveFolderId configured, skipping those without one', async () => {
    process.env.CRON_SECRET = 'test-secret'
    ;(listProperties as any).mockResolvedValueOnce([
      { id: 'prop-1', name: 'Ide', googleDriveFolderId: '1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ' },
      { id: 'prop-2', name: 'No Folder Property', googleDriveFolderId: null },
    ])

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(syncDriveFolder).toHaveBeenCalledTimes(1)
    expect(syncDriveFolder).toHaveBeenCalledWith({
      id: 'prop-1',
      googleDriveFolderId: '1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ',
    })
    expect(body.results).toHaveLength(1)
    expect(body.results[0].propertyId).toBe('prop-1')
    expect(body.skippedProperties).toEqual(['prop-2'])
  })

  it('continues syncing remaining properties if one property sync throws', async () => {
    process.env.CRON_SECRET = 'test-secret'
    ;(listProperties as any).mockResolvedValueOnce([
      { id: 'prop-1', name: 'Ide', googleDriveFolderId: '1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ' },
      { id: 'prop-2', name: 'D05', googleDriveFolderId: '1abcDEF23456ghijKLmnop789QRstuv0' },
    ])
    ;(syncDriveFolder as any).mockRejectedValueOnce(new Error('Google Drive API error'))
    ;(syncDriveFolder as any).mockResolvedValueOnce({ newFiles: 1, skipped: 0, failed: 0 })

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.results).toHaveLength(2)
    expect(body.results[0].status).toBe('failed')
    expect(body.results[1].status).toBe('success')
  })

  it('calls checkAndNotify when NOTIFICATION_EMAIL_TO is configured', async () => {
    process.env.CRON_SECRET = 'test-secret'
    process.env.NOTIFICATION_EMAIL_TO = 'michael.sloyer@gmail.com'
    ;(listProperties as any).mockResolvedValueOnce([])
    ;(checkAndNotify as any).mockClear()

    await GET(authedRequest())

    expect(checkAndNotify).toHaveBeenCalledWith({ to: 'michael.sloyer@gmail.com' })
  })

  it('does not call checkAndNotify when NOTIFICATION_EMAIL_TO is not configured', async () => {
    process.env.CRON_SECRET = 'test-secret'
    delete process.env.NOTIFICATION_EMAIL_TO
    ;(listProperties as any).mockResolvedValueOnce([])
    ;(checkAndNotify as any).mockClear()

    await GET(authedRequest())

    expect(checkAndNotify).not.toHaveBeenCalled()
  })

  it('still returns a successful response even if checkAndNotify throws', async () => {
    process.env.CRON_SECRET = 'test-secret'
    process.env.NOTIFICATION_EMAIL_TO = 'michael.sloyer@gmail.com'
    ;(listProperties as any).mockResolvedValueOnce([])
    ;(checkAndNotify as any).mockRejectedValueOnce(new Error('Resend is down'))

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)
  })
})

afterAll(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET
  process.env.NOTIFICATION_EMAIL_TO = ORIGINAL_NOTIFICATION_EMAIL_TO
})
