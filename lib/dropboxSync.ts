import { db } from './db'
import { listStatementFiles, downloadFile } from './dropboxClient'
import { uploadToStorage } from './blobStorage'
import { ingestStatement } from './extraction/extractStatement'
import { ingestLoanDocument } from './extraction/extractLoan'
import { runAnomalyRules } from './anomalyRules'

// A DropboxFile row alone doesn't mean the file was ever successfully processed — a sync
// can be interrupted (e.g. a serverless function timeout mid-loop) after creating the row
// but before extraction/ingestion completes or succeeds. Distinguishing "done" from
// "recorded but unfinished" is what lets a later sync call safely retry the latter instead
// of skipping it forever.
async function wasSuccessfullyProcessed(dropboxFile: { id: string; fileType: string }): Promise<boolean> {
  if (dropboxFile.fileType === 'statement') {
    const extraction = await db.extraction.findUnique({ where: { dropboxFileId: dropboxFile.id } })
    return extraction?.status === 'success'
  }
  const loan = await db.loan.findFirst({ where: { sourceFileId: dropboxFile.id } })
  return loan !== null
}

export async function syncDropboxFolder(property: {
  id: string
  dropboxFolderPath: string
}): Promise<{ newFiles: number; skipped: number; failed: number }> {
  const files = await listStatementFiles(property.dropboxFolderPath)
  let newFiles = 0
  let skipped = 0
  let failed = 0

  for (const file of files) {
    const existing = await db.dropboxFile.findUnique({ where: { dropboxFileId: file.id } })

    if (existing && (await wasSuccessfullyProcessed(existing))) {
      skipped++
      continue
    }

    const buffer = await downloadFile(file.pathLower)
    const storageUrl = await uploadToStorage(file.name, buffer)
    const fileType = file.name.toLowerCase().includes('loan') ? 'loan' : 'statement'

    const dropboxFile = existing
      ? await db.dropboxFile.update({
          where: { id: existing.id },
          data: { storageUrl, uploadedAt: file.serverModified, fileType },
        })
      : await db.dropboxFile.create({
          data: {
            propertyId: property.id,
            dropboxFileId: file.id,
            filename: file.name,
            uploadedAt: file.serverModified,
            fileType,
            storageUrl,
          },
        })

    if (!existing) newFiles++

    const fileBase64 = buffer.toString('base64')
    const isXlsx = file.name.toLowerCase().endsWith('.xlsx')

    try {
      if (fileType === 'statement') {
        const result = await ingestStatement(
          isXlsx
            ? { dropboxFileId: dropboxFile.id, propertyId: property.id, xlsxBase64: fileBase64 }
            : { dropboxFileId: dropboxFile.id, propertyId: property.id, pdfBase64: fileBase64 }
        )
        if (result.status === 'success') {
          await runAnomalyRules(property.id, result.activityMonth)
        }
      } else {
        await ingestLoanDocument({
          dropboxFileId: dropboxFile.id,
          propertyId: property.id,
          pdfBase64: fileBase64,
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
