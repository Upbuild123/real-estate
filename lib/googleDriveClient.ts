import { getAccessToken } from './googleDriveAuth'

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

export async function listStatementFiles(
  folderId: string
): Promise<{ id: string; name: string; modifiedTime: Date }[]> {
  const accessToken = await getAccessToken()

  const query = `'${folderId}' in parents and trashed=false`
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime)')}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google Drive files.list failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.files
    .filter((file: any) => file.mimeType !== 'application/vnd.google-apps.folder' && isStatementFile(file.name))
    .map((file: any) => ({
      id: file.id,
      name: file.name,
      modifiedTime: new Date(file.modifiedTime),
    }))
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const accessToken = await getAccessToken()

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google Drive download failed (${response.status}): ${errorText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
