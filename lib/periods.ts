// A "period" string is one of: "YYYY-MM" (a specific month), "YYYY-full" (Jan-Dec of that
// year), or "YYYY-ytd" (Jan through the current calendar month of that year, as of `now`).

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthsInYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

export function parsePeriod(period: string, now: Date = new Date()): string[] {
  const monthMatch = period.match(/^(\d{4})-(\d{2})$/)
  if (monthMatch) {
    return [period]
  }

  const fullMatch = period.match(/^(\d{4})-full$/)
  if (fullMatch) {
    return monthsInYear(Number(fullMatch[1]))
  }

  const ytdMatch = period.match(/^(\d{4})-ytd$/)
  if (ytdMatch) {
    const year = Number(ytdMatch[1])
    const currentMonth = now.getMonth() + 1 // getMonth() is 0-indexed
    return monthsInYear(year).slice(0, currentMonth)
  }

  throw new Error(`Unrecognized period: ${period}`)
}

export function formatPeriodLabel(period: string): string {
  const monthMatch = period.match(/^(\d{4})-(\d{2})$/)
  if (monthMatch) {
    const [, year, month] = monthMatch
    return `${MONTH_NAMES[Number(month) - 1]} ${year}`
  }

  const fullMatch = period.match(/^(\d{4})-full$/)
  if (fullMatch) {
    return `${fullMatch[1]} Full Year`
  }

  const ytdMatch = period.match(/^(\d{4})-ytd$/)
  if (ytdMatch) {
    return `${ytdMatch[1]} YTD`
  }

  throw new Error(`Unrecognized period: ${period}`)
}

export interface PeriodOption {
  value: string
  label: string
}

// Builds the list of selectable periods: YTD for the current year, full-year for every
// complete prior year back to the earliest available month, and each individual month back
// to the earliest available month (so a specific month within the current year is reachable
// even before the year is complete).
export function listPeriodOptions(params: { earliestMonth: string; asOf?: Date }): PeriodOption[] {
  const now = params.asOf ?? new Date()
  const currentYear = now.getFullYear()
  const earliestYear = Number(params.earliestMonth.split('-')[0])

  const options: PeriodOption[] = []

  options.push({ value: `${currentYear}-ytd`, label: formatPeriodLabel(`${currentYear}-ytd`) })

  for (let year = currentYear - 1; year >= earliestYear; year--) {
    options.push({ value: `${year}-full`, label: formatPeriodLabel(`${year}-full`) })
  }

  const currentMonth = now.getMonth() + 1
  for (let year = currentYear; year >= earliestYear; year--) {
    const maxMonth = year === currentYear ? currentMonth : 12
    const minMonth = year === earliestYear ? Number(params.earliestMonth.split('-')[1]) : 1
    for (let month = maxMonth; month >= minMonth; month--) {
      const value = `${year}-${String(month).padStart(2, '0')}`
      options.push({ value, label: formatPeriodLabel(value) })
    }
  }

  return options
}
