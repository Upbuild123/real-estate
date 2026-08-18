import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../lib/dropboxAuth', () => ({
  getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
}))

import { listPdfFiles, downloadFile } from '../lib/dropboxClient'

describe('dropboxClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists only PDF files, filtering out other file types and folders, using a refreshed access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [
          { '.tag': 'file', id: 'id1', name: 'a.pdf', path_lower: '/ide/a.pdf', server_modified: '2026-02-15T00:00:00Z' },
          { '.tag': 'file', id: 'id2', name: 'b.xlsx', path_lower: '/ide/b.xlsx', server_modified: '2026-02-15T00:00:00Z' },
          { '.tag': 'folder', id: 'id3', name: 'subfolder', path_lower: '/ide/subfolder' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const files = await listPdfFiles('/ide')

    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('a.pdf')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dropboxapi.com/2/files/list_folder',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer mock-access-token' }),
      })
    )
  })

  it('throws a descriptive error when listing fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'expired_access_token' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listPdfFiles('/ide')).rejects.toThrow(/401/)
  })

  it('downloads a file as a Buffer via the Dropbox content API directly, using a refreshed access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('pdf-bytes').buffer,
    })
    vi.stubGlobal('fetch', fetchMock)

    const buffer = await downloadFile('/ide/a.pdf')

    expect(buffer.toString()).toBe('pdf-bytes')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://content.dropboxapi.com/2/files/download',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-access-token',
          'Dropbox-API-Arg': JSON.stringify({ path: '/ide/a.pdf' }),
        }),
      })
    )
  })

  it('throws a descriptive error when the download request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => 'path/not_found/',
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadFile('/ide/missing.pdf')).rejects.toThrow(/409/)
  })
})
