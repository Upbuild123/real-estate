import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/extraction/extractLoan', () => ({
  ingestLoanDocument: vi.fn().mockResolvedValue({ status: 'success', loanId: 'loan-1' }),
}))

import { POST } from '../../app/api/loans/upload/route'

describe('POST /api/loans/upload', () => {
  it('extracts and stores a loan from an uploaded PDF', async () => {
    const formData = new FormData()
    formData.append('propertyId', 'prop-1')
    formData.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }), 'loan.pdf')

    const request = new Request('http://localhost/api/loans/upload', { method: 'POST', body: formData })
    const response = await POST(request)
    const body = await response.json()
    expect(body).toEqual({ status: 'success', loanId: 'loan-1' })
  })

  it('returns 400 when propertyId is missing', async () => {
    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }), 'loan.pdf')

    const request = new Request('http://localhost/api/loans/upload', { method: 'POST', body: formData })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 400 when file is missing', async () => {
    const formData = new FormData()
    formData.append('propertyId', 'prop-1')

    const request = new Request('http://localhost/api/loans/upload', { method: 'POST', body: formData })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 400 when file field is not an actual file', async () => {
    const formData = new FormData()
    formData.append('propertyId', 'prop-1')
    formData.append('file', 'not-a-file')

    const request = new Request('http://localhost/api/loans/upload', { method: 'POST', body: formData })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })
})
