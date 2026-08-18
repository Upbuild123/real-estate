import { getAccessToken } from './dropboxAuth'

// Both list and download go through direct HTTP calls (not the `dropbox` SDK) — a fresh
// access token is minted per call via getAccessToken (dropboxAuth.ts), and an earlier bug
// showed the SDK's browser/Node environment auto-detection can misfire on Vercel's
// serverless runtime anyway, so bypassing it entirely for both operations is more reliable.
export async function listPdfFiles(
  folderPath: string
): Promise<{ id: string; name: string; pathLower: string; serverModified: Date }[]> {
  const accessToken = await getAccessToken()

  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: folderPath }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Dropbox list_folder failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.entries
    .filter((entry: any) => entry['.tag'] === 'file' && entry.name.toLowerCase().endsWith('.pdf'))
    .map((entry: any) => ({
      id: entry.id,
      name: entry.name,
      pathLower: entry.path_lower,
      serverModified: new Date(entry.server_modified),
    }))
}

export async function downloadFile(pathLower: string): Promise<Buffer> {
  const accessToken = await getAccessToken()

  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
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
