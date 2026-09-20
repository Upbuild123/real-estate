import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../lib/googleDriveAuth', () => ({
  getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
}))

import { listStatementFiles, downloadFile } from '../lib/googleDriveClient'

describe('googleDriveClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists PDF files, filtering out unrelated xlsx workbooks and Drive folders', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          { id: 'id1', name: 'a.pdf', mimeType: 'application/pdf', modifiedTime: '2026-02-15T00:00:00.000Z' },
          { id: 'id2', name: '2026 result vs budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', modifiedTime: '2026-02-15T00:00:00.000Z' },
          { id: 'id3', name: 'subfolder', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-02-15T00:00:00.000Z' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const files = await listStatementFiles('folder-abc')

    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('a.pdf')
    expect(files[0].id).toBe('id1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('https://www.googleapis.com/drive/v3/files')
    expect(url).toContain(encodeURIComponent("'folder-abc' in parents and trashed=false"))
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer mock-access-token' })
  })

  it('lists an xlsx statement whose filename matches the "<id>_<YYYY-MM>_report" pattern', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          { id: 'id1', name: '457917_2026-08_report.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', modifiedTime: '2026-08-14T00:00:00.000Z' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const files = await listStatementFiles('folder-abc')

    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('457917_2026-08_report.xlsx')
  })

  it('throws a descriptive error when listing fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid credentials' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listStatementFiles('folder-abc')).rejects.toThrow(/401/)
  })

  it('downloads a file as a Buffer via the Drive media endpoint, using a refreshed access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('pdf-bytes').buffer,
    })
    vi.stubGlobal('fetch', fetchMock)

    const buffer = await downloadFile('file-id-1')

    expect(buffer.toString()).toBe('pdf-bytes')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/file-id-1?alt=media',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer mock-access-token' }),
      })
    )
  })

  it('throws a descriptive error when the download request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'File not found',
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadFile('missing-id')).rejects.toThrow(/404/)
  })
})
