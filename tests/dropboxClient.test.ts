import { describe, it, expect, vi } from 'vitest'

vi.mock('dropbox', () => {
  const mockFilesListFolder = vi.fn().mockResolvedValue({
    result: {
      entries: [
        { '.tag': 'file', id: 'id1', name: 'a.pdf', path_lower: '/ide/a.pdf', server_modified: '2026-02-15T00:00:00Z' },
        { '.tag': 'file', id: 'id2', name: 'b.xlsx', path_lower: '/ide/b.xlsx', server_modified: '2026-02-15T00:00:00Z' },
        { '.tag': 'folder', id: 'id3', name: 'subfolder', path_lower: '/ide/subfolder' },
      ],
    },
  })

  const mockFilesDownload = vi.fn().mockResolvedValue({
    result: { fileBinary: Buffer.from('pdf-bytes') },
  })

  return {
    Dropbox: vi.fn(function() {
      return {
        filesListFolder: mockFilesListFolder,
        filesDownload: mockFilesDownload,
      }
    }),
  }
})

import { listPdfFiles, downloadFile } from '../lib/dropboxClient'

describe('dropboxClient', () => {
  it('lists only PDF files, filtering out other file types and folders', async () => {
    const files = await listPdfFiles('/ide')
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('a.pdf')
  })

  it('downloads a file as a Buffer', async () => {
    const buffer = await downloadFile('/ide/a.pdf')
    expect(buffer.toString()).toBe('pdf-bytes')
  })
})
