# Migrate document sync from Dropbox to Google Drive

## Context

The property manager now uploads monthly statements and loan documents to Google Drive instead of Dropbox (example folder: `https://drive.google.com/drive/folders/1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ`). The app's sync integration — auth, file listing/download, the sync loop, and the schema/UI that reference Dropbox — needs to be replaced end to end. This is a full swap, not a dual-support period: Dropbox-specific code, naming, and env vars are removed.

## Auth

Service account, not OAuth refresh token. The PM shares each property's Drive folder with the service account's email (a one-time manual step per property, same as sharing today's Dropbox folder path was implicit). This avoids refresh-token lifecycle management entirely.

- New env vars: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (PEM, `\n`-escaped as is conventional for env-var-stored keys).
- `lib/googleDriveAuth.ts` replaces `lib/dropboxAuth.ts`. It mints a fresh OAuth access token per call (same "always mint fresh, never cache across serverless invocations" approach as today) by:
  1. Building a JWT (`RS256`, scope `https://www.googleapis.com/auth/drive.readonly`, `aud: https://oauth2.googleapis.com/token`, standard `iat`/`exp` 1 hour out) signed with the service account private key using Node's `crypto` module directly — no `googleapis` SDK dependency, consistent with the existing "raw HTTP calls, no SDK" approach.
  2. POSTing that JWT to Google's token endpoint (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`) to exchange it for an access token.
- Exported function: `getAccessToken(): Promise<string>`, same signature as today.
- Errors: throw a descriptive error if required env vars are missing, and if the token exchange HTTP call fails (mirroring today's Dropbox error messages).

## Client

`lib/googleDriveClient.ts` replaces `lib/dropboxClient.ts`.

- `listStatementFiles(folderId: string): Promise<{ id: string; name: string; modifiedTime: Date }[]>` — calls Drive's `GET https://www.googleapis.com/drive/v3/files` with `q="'<folderId>' in parents and trashed=false"` and `fields=files(id,name,modifiedTime,mimeType)`, filtered through the existing `isStatementFile(name)` predicate (unchanged — same `.pdf`/`.xlsx` filename rules). Folders/non-file entries are naturally excluded since the query only returns children (mimeType check excludes Drive-native folders, i.e. skip `application/vnd.google-apps.folder`).
- `downloadFile(fileId: string): Promise<Buffer>` — calls `GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media`.
- Both take a fresh access token from `getAccessToken()` per call, same as today.
- The return shape drops Dropbox's `pathLower` (Drive addresses files by ID, not path) — callers use `id` directly for download.

## Sync engine

`lib/driveSync.ts` replaces `lib/dropboxSync.ts`. Exported function renamed `syncDriveFolder` (was `syncDropboxFolder`), same signature shape but taking `{ id: string; googleDriveFolderId: string }`. Logic is otherwise unchanged: list files, skip already-successfully-processed ones (dedup via the renamed `SourceFile` model, see below), download, upload to blob storage, dispatch to `ingestStatement`/`ingestLoanDocument`, run anomaly rules on success, catch per-file extraction errors so one bad file doesn't abort the folder.

## Schema (new migration, not editing history)

- `Property.dropboxFolderPath` → `Property.googleDriveFolderId`.
- `DropboxFile` model → `SourceFile` (generic: it's not inherently Dropbox-specific, and this survives future storage-provider changes).
  - `DropboxFile.dropboxFileId` (external file id, `@unique`) → `SourceFile.driveFileId`.
  - Relation name `dropboxFiles` on `Property` → `sourceFiles`.
- `Extraction.dropboxFileId` (FK to `DropboxFile.id`, i.e. the *internal* row id, confusingly named after the external id it isn't) → `Extraction.sourceFileId`.
- `Loan.sourceFileId` is already generically named — unchanged.

## Call-site renames

- `extractStatement.ts` / `extractLoan.ts`: param `dropboxFileId` → `sourceFileId` (this already holds the internal `SourceFile.id`/DB row id, not an external id — the rename also fixes the pre-existing misnomer).
- `app/api/sync/route.ts`, `app/api/cron/sync/route.ts`: use `googleDriveFolderId` / `syncDriveFolder`, error messages updated to say "Google Drive folder".
- `app/api/properties/route.ts`: request body field `dropboxFolderPath` → `googleDriveFolderId`.
- `app/admin/AdminView.tsx`: state var and label renamed; label copy becomes "Google Drive Folder ID (optional, e.g. from the folder's URL: drive.google.com/drive/folders/**FOLDER_ID**)".
- `app/api/loans/upload/route.ts`: `dropboxFileId: null` → `sourceFileId: null`.
- `lib/blobStorage.ts`: comment references only, update wording.

## Tests

Rename and rewrite to match Drive API shapes:
- `tests/dropboxAuth.test.ts` → `tests/googleDriveAuth.test.ts`: JWT construction + token exchange against `oauth2.googleapis.com/token`, missing-env-var and failed-exchange error cases.
- `tests/dropboxClient.test.ts` → `tests/googleDriveClient.test.ts`: list filters out folders/non-statement xlsx, accepts pattern-matching xlsx and any pdf, download hits `alt=media`, error cases for both.
- `tests/dropboxSync.test.ts` → `tests/driveSync.test.ts`: same scenarios (new file creates `SourceFile`, already-processed file skipped, per-file extraction failure doesn't abort folder), mocks updated to `googleDriveClient`.
- `tests/api/sync.test.ts`, `tests/api/cronSync.test.ts`, `tests/properties.test.ts`, `tests/extraction/extractLoan.test.ts`, `tests/extraction/extractStatement.test.ts`: field/param renames only, same assertions.

## Out of scope

- No dual-provider support window — this is a full cutover.
- No UI/back-fill migration tool for existing `DropboxFile` rows; the new migration renames the table/columns in place, so existing data (and its Dropbox-sourced `driveFileId` values, which are actually old Dropbox file IDs) is preserved as historical record, just under the new column name. Old rows won't collide with newly-synced Drive file IDs since Dropbox and Drive ID formats don't overlap.
- Existing properties' `googleDriveFolderId` will be `null` after migration (Dropbox paths aren't valid Drive folder IDs) — the PM/admin must re-enter each property's Drive folder ID via `/admin` after this ships.
