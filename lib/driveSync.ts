import { db } from './db'
import { listStatementFiles, downloadFile } from './googleDriveClient'
import { uploadToStorage } from './blobStorage'
import { ingestStatement } from './extraction/extractStatement'
import { ingestLoanDocument } from './extraction/extractLoan'
import { runAnomalyRules } from './anomalyRules'

// A SourceFile row alone doesn't mean the file was ever successfully processed — a sync
// can be interrupted (e.g. a serverless function timeout mid-loop) after creating the row
// but before extraction/ingestion completes or succeeds. Distinguishing "done" from
// "recorded but unfinished" is what lets a later sync call safely retry the latter instead
// of skipping it forever.
async function wasSuccessfullyProcessed(sourceFile: { id: string; fileType: string }): Promise<boolean> {
  if (sourceFile.fileType === 'statement') {
    const extraction = await db.extraction.findUnique({ where: { sourceFileId: sourceFile.id } })
    return extraction?.status === 'success'
  }
  const loan = await db.loan.findFirst({ where: { sourceFileId: sourceFile.id } })
  return loan !== null
}

export async function syncDriveFolder(property: {
  id: string
  googleDriveFolderId: string
}): Promise<{ newFiles: number; skipped: number; failed: number }> {
  const files = await listStatementFiles(property.googleDriveFolderId)
  let newFiles = 0
  let skipped = 0
  let failed = 0

  for (const file of files) {
    const existing = await db.sourceFile.findUnique({ where: { driveFileId: file.id } })

    if (existing && (await wasSuccessfullyProcessed(existing))) {
      skipped++
      continue
    }

    const buffer = await downloadFile(file.id)
    const storageUrl = await uploadToStorage(file.name, buffer)
    const fileType = file.name.toLowerCase().includes('loan') ? 'loan' : 'statement'

    const sourceFile = existing
      ? await db.sourceFile.update({
          where: { id: existing.id },
          data: { storageUrl, uploadedAt: file.modifiedTime, fileType },
        })
      : await db.sourceFile.create({
          data: {
            propertyId: property.id,
            driveFileId: file.id,
            filename: file.name,
            uploadedAt: file.modifiedTime,
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
            ? { sourceFileId: sourceFile.id, propertyId: property.id, xlsxBase64: fileBase64 }
            : { sourceFileId: sourceFile.id, propertyId: property.id, pdfBase64: fileBase64 }
        )
        if (result.status === 'success') {
          await runAnomalyRules(property.id, result.activityMonth)
        }
      } else {
        await ingestLoanDocument({
          sourceFileId: sourceFile.id,
          propertyId: property.id,
          pdfBase64: fileBase64,
        })
      }
    } catch (err) {
      // Don't let one file's extraction failure abort the sync of the rest of the folder.
      failed++
      console.error(`driveSync: extraction failed for file ${file.name} (${file.id}):`, err)
    }
  }

  return { newFiles, skipped, failed }
}
