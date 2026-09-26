import { db } from './db'
import type { Property } from '@prisma/client'

export async function createProperty(input: {
  name: string
  address: string
  googleDriveFolderId?: string
}): Promise<Property> {
  return db.property.create({ data: input })
}

export async function listProperties(): Promise<Property[]> {
  return db.property.findMany({ where: { active: true }, orderBy: { name: 'asc' } })
}

export async function getProperty(id: string): Promise<Property | null> {
  return db.property.findUnique({ where: { id } })
}

export async function updatePropertyDriveFolder(id: string, googleDriveFolderId: string | null): Promise<Property> {
  return db.property.update({ where: { id }, data: { googleDriveFolderId } })
}
