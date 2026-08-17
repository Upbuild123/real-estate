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
})
