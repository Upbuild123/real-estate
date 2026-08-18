import { db } from './db'
import { listProperties } from './properties'
import { sendStatementsReadyEmail } from './email'

// The most recent month for which EVERY given property has at least one FinancialRecord —
// i.e. the newest month you could truthfully say "both PDFs are in." Returns null if the
// property list is empty or no month is common to all of them yet.
export async function getLatestCommonMonth(propertyIds: string[]): Promise<string | null> {
  if (propertyIds.length === 0) return null

  const monthSets = await Promise.all(
    propertyIds.map(async (propertyId) => {
      const records = await db.financialRecord.findMany({
        where: { propertyId },
        distinct: ['month'],
        select: { month: true },
      })
      return new Set(records.map((r) => r.month))
    })
  )

  const [first, ...rest] = monthSets
  const common = Array.from(first).filter((month) => rest.every((set) => set.has(month)))

  if (common.length === 0) return null
  return common.sort().at(-1) as string
}

export async function hasNotifiedForMonth(month: string): Promise<boolean> {
  const existing = await db.monthlyNotification.findUnique({ where: { month } })
  return existing !== null
}

export async function recordNotification(month: string): Promise<void> {
  await db.monthlyNotification.upsert({
    where: { month },
    update: {},
    create: { month },
  })
}

// Call after a sync so the "statements are ready" email goes out the moment every active
// property has data for a given month — rather than on a fixed calendar date, since the
// property manager doesn't upload on a perfectly consistent schedule (usually the 15th, but
// sometimes as late as the 20th).
export async function checkAndNotify(params: { to: string; propertyIds?: string[] }): Promise<void> {
  const propertyIds = params.propertyIds ?? (await listProperties()).map((p) => p.id)

  const month = await getLatestCommonMonth(propertyIds)
  if (!month) return

  if (await hasNotifiedForMonth(month)) return

  const properties = await db.property.findMany({ where: { id: { in: propertyIds } } })

  await sendStatementsReadyEmail({
    to: params.to,
    month,
    propertyNames: properties.map((p) => p.name),
  })

  await recordNotification(month)
}
