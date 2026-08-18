import { db } from './db'

export interface UpcomingLeaseExpiration {
  roomNumber: string
  lessee: string
  leaseEnd: string
  month: string
}

const WINDOW_DAYS = 90

// For each room, only the most recent rent-roll snapshot is meaningful — an older month's
// leaseEnd could be stale (renewed since, or the tenant moved out). "Most recent" is
// determined by which RentRollEntry has the latest month per room, not by createdAt, since
// re-ingestion of an old statement shouldn't change what "latest" means.
export async function getUpcomingLeaseExpirations(
  propertyId: string,
  now: Date = new Date()
): Promise<UpcomingLeaseExpiration[]> {
  const entries = await db.rentRollEntry.findMany({
    where: { propertyId, leaseEnd: { not: null } },
    // A mid-month tenant turnover can leave two rows for the same room in the same month
    // (outgoing tenant's lease ending, incoming tenant's lease starting) — ordering by
    // leaseStart descending after month means the incoming tenant's row is seen first.
    orderBy: [{ month: 'desc' }, { leaseStart: 'desc' }],
  })

  const latestByRoom = new Map<string, (typeof entries)[number]>()
  for (const entry of entries) {
    if (!latestByRoom.has(entry.roomNumber)) {
      latestByRoom.set(entry.roomNumber, entry)
    }
  }

  const windowEnd = new Date(now)
  windowEnd.setDate(windowEnd.getDate() + WINDOW_DAYS)

  const upcoming = Array.from(latestByRoom.values())
    .filter((entry) => entry.leaseEnd !== null)
    .filter((entry) => {
      const leaseEndDate = new Date(entry.leaseEnd as string)
      return leaseEndDate >= now && leaseEndDate <= windowEnd
    })
    .map((entry) => ({
      roomNumber: entry.roomNumber,
      lessee: entry.lessee,
      leaseEnd: entry.leaseEnd as string,
      month: entry.month,
    }))

  return upcoming.sort((a, b) => a.leaseEnd.localeCompare(b.leaseEnd))
}
