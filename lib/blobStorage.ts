import { put } from '@vercel/blob'

export async function uploadToStorage(filename: string, buffer: Buffer): Promise<string> {
  const blob = await put(filename, buffer, { access: 'public' })
  return blob.url
}
