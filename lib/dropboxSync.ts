import { db } from './db'
import { listPdfFiles, downloadFile } from './dropboxClient'
import { uploadToStorage } from './blobStorage'

export async function syncDropboxFolder(property: {
  id: string
  dropboxFolderPath: string
}): Promise<{ newFiles: number; skipped: number }> {
  const files = await listPdfFiles(property.dropboxFolderPath)
  let newFiles = 0
  let skipped = 0

  for (const file of files) {
    const existing = await db.dropboxFile.findUnique({ where: { dropboxFileId: file.id } })
    if (existing) {
      skipped++
      continue
    }

    const buffer = await downloadFile(file.pathLower)
    const storageUrl = await uploadToStorage(file.name, buffer)
    const fileType = file.name.toLowerCase().includes('loan') ? 'loan' : 'statement'

    await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: file.id,
        filename: file.name,
        uploadedAt: file.serverModified,
        fileType,
        storageUrl,
      },
    })
    newFiles++
  }

  return { newFiles, skipped }
}
