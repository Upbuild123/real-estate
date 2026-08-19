import { getAccessToken } from './dropboxAuth'

// A monthly statement filename follows "<id>_<YYYY-MM>_report.<ext>" (with the PM's chosen
// extension — pdf or, as of Aug 2026, xlsx). Requiring this pattern for .xlsx specifically
// excludes other spreadsheets the PM occasionally drops in the same folder (e.g. an annual
// "result vs budget" workbook) that aren't monthly statements at all. Older-year PDFs used a
// looser naming convention before this pattern was adopted, so .pdf is accepted unconditionally.
const XLSX_STATEMENT_PATTERN = /^\d+_\d{4}-\d{2}_report/i

function isStatementFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return true
  if (lower.endsWith('.xlsx')) return XLSX_STATEMENT_PATTERN.test(name)
  return false
}

// Both list and download go through direct HTTP calls (not the `dropbox` SDK) — a fresh
// access token is minted per call via getAccessToken (dropboxAuth.ts), and an earlier bug
// showed the SDK's browser/Node environment auto-detection can misfire on Vercel's
// serverless runtime anyway, so bypassing it entirely for both operations is more reliable.
export async function listStatementFiles(
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
    .filter((entry: any) => entry['.tag'] === 'file' && isStatementFile(entry.name))
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
