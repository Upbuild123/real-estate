import { db } from './db'

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

export async function getMarginalTaxRate(): Promise<number> {
  const raw = await getSetting('marginalTaxRate')
  return raw !== null ? parseFloat(raw) : 0.43
}
