import { put } from '@vercel/blob'

export async function uploadToStorage(filename: string, buffer: Buffer): Promise<string> {
  // Private: these are personal financial statement PDFs, not publicly accessible files.
  const blob = await put(filename, buffer, { access: 'private' })
  return blob.url
}
