/*
  Rename Dropbox-based schema to Google Drive equivalents. Uses RENAME statements
  (not DROP + CREATE) so that existing data in the DropboxFile table, and the
  dropboxFileId/dropboxFolderPath columns, is preserved across the migration.
*/

-- Rename table DropboxFile -> SourceFile (preserves rows, PK, indexes tied to the table)
ALTER TABLE "DropboxFile" RENAME TO "SourceFile";

-- Rename SourceFile.dropboxFileId -> SourceFile.driveFileId
ALTER TABLE "SourceFile" RENAME COLUMN "dropboxFileId" TO "driveFileId";

-- Rename Extraction.dropboxFileId -> Extraction.sourceFileId
ALTER TABLE "Extraction" RENAME COLUMN "dropboxFileId" TO "sourceFileId";

-- Rename Property.dropboxFolderPath -> Property.googleDriveFolderId
ALTER TABLE "Property" RENAME COLUMN "dropboxFolderPath" TO "googleDriveFolderId";

-- Rename constraints/indexes to match Prisma's naming convention for the new names
ALTER TABLE "SourceFile" RENAME CONSTRAINT "DropboxFile_pkey" TO "SourceFile_pkey";
ALTER TABLE "SourceFile" RENAME CONSTRAINT "DropboxFile_propertyId_fkey" TO "SourceFile_propertyId_fkey";
ALTER TABLE "Extraction" RENAME CONSTRAINT "Extraction_dropboxFileId_fkey" TO "Extraction_sourceFileId_fkey";

ALTER INDEX "DropboxFile_dropboxFileId_key" RENAME TO "SourceFile_driveFileId_key";
ALTER INDEX "Extraction_dropboxFileId_key" RENAME TO "Extraction_sourceFileId_key";
