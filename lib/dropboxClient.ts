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

// Deliberately bypasses the `dropbox` SDK's filesDownload for content retrieval: its
// browser/Node environment auto-detection can misfire in serverless runtimes (observed on
// Vercel), populating a different response field than the `fileBinary` this code expects and
// silently returning an empty body. A direct call to the content API's HTTP endpoint sidesteps
// that ambiguity entirely.
export async function downloadFile(pathLower: string): Promise<Buffer> {
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DROPBOX_ACCESS_TOKEN}`,
      'Dropbox-API-Arg': JSON.stringify({ path: pathLower }),
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Dropbox download failed (${response.status}): ${errorText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
