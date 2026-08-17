import { db } from './db'
import { listPdfFiles, downloadFile } from './dropboxClient'
import { uploadToStorage } from './blobStorage'
import { ingestStatement } from './extraction/extractStatement'
import { ingestLoanDocument } from './extraction/extractLoan'
import { runAnomalyRules } from './anomalyRules'

export async function syncDropboxFolder(property: {
  id: string
  dropboxFolderPath: string
}): Promise<{ newFiles: number; skipped: number; failed: number }> {
  const files = await listPdfFiles(property.dropboxFolderPath)
  let newFiles = 0
  let skipped = 0
  let failed = 0

  for (const file of files) {
    const existing = await db.dropboxFile.findUnique({ where: { dropboxFileId: file.id } })
    if (existing) {
      skipped++
      continue
    }

    const buffer = await downloadFile(file.pathLower)
    const storageUrl = await uploadToStorage(file.name, buffer)
    const fileType = file.name.toLowerCase().includes('loan') ? 'loan' : 'statement'

    const dropboxFile = await db.dropboxFile.create({
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

    const pdfBase64 = buffer.toString('base64')

    try {
      if (fileType === 'statement') {
        const result = await ingestStatement({
          dropboxFileId: dropboxFile.id,
          propertyId: property.id,
          pdfBase64,
        })
        if (result.status === 'success') {
          await runAnomalyRules(property.id, result.activityMonth)
        }
      } else {
        await ingestLoanDocument({
          dropboxFileId: dropboxFile.id,
          propertyId: property.id,
          pdfBase64,
        })
      }
    } catch (err) {
      // Don't let one file's extraction failure abort the sync of the rest of the folder.
      failed++
      console.error(`dropboxSync: extraction failed for file ${file.name} (${file.id}):`, err)
    }
  }

  return { newFiles, skipped, failed }
}
