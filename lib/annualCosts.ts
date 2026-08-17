import { db } from './db'
import { amortizeAnnual } from './amortization'
import type { AnnualCost } from '@prisma/client'

type CostType = 'tax' | 'insurance'

export async function upsertAnnualCost(input: {
  propertyId: string
  costType: CostType
  year: number
  annualAmount: number
}): Promise<AnnualCost> {
  return db.annualCost.upsert({
    where: {
      propertyId_costType_year: {
        propertyId: input.propertyId,
        costType: input.costType,
        year: input.year,
      },
    },
    update: { annualAmount: input.annualAmount },
    create: input,
  })
}

export async function getAnnualCost(propertyId: string, costType: CostType, year: number): Promise<AnnualCost | null> {
  return db.annualCost.findUnique({
    where: { propertyId_costType_year: { propertyId, costType, year } },
  })
}

export async function getMonthlyAmortizedCost(propertyId: string, costType: CostType, year: number): Promise<number> {
  const record = await getAnnualCost(propertyId, costType, year)
  return record ? amortizeAnnual(record.annualAmount) : 0
}
