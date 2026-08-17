import { Dropbox } from 'dropbox'

function client(): Dropbox {
  return new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN })
}

export async function listPdfFiles(
  folderPath: string
): Promise<{ id: string; name: string; pathLower: string; serverModified: Date }[]> {
  const dbx = client()
  const response = await dbx.filesListFolder({ path: folderPath })
  return response.result.entries
    .filter((entry: any) => entry['.tag'] === 'file' && entry.name.toLowerCase().endsWith('.pdf'))
    .map((entry: any) => ({
      id: entry.id,
      name: entry.name,
      pathLower: entry.path_lower,
      serverModified: new Date(entry.server_modified),
    }))
}

export async function downloadFile(pathLower: string): Promise<Buffer> {
  const dbx = client()
  const response = await dbx.filesDownload({ path: pathLower })
  return (response.result as any).fileBinary as Buffer
}
