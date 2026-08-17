import { put } from '@vercel/blob'

export async function uploadToStorage(filename: string, buffer: Buffer): Promise<string> {
  // Private: these are personal financial statement PDFs, not publicly accessible files.
  // allowOverwrite: syncDropboxFolder only reaches this call for a file it believes is new
  // (deduped by DropboxFile.dropboxFileId beforehand), but a prior sync attempt that failed
  // after uploading and before recording the DropboxFile row (or a manually reset retry)
  // can leave a blob already sitting under this filename — retrying must not fail on that.
  const blob = await put(filename, buffer, { access: 'private', allowOverwrite: true })
  return blob.url
}
