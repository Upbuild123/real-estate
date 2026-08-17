import { describe, it, expect } from 'vitest'
import { parsePeriod, formatPeriodLabel, listPeriodOptions } from '../lib/periods'

describe('parsePeriod', () => {
  it('parses a specific month period into its single month', () => {
    expect(parsePeriod('2026-06')).toEqual(['2026-06'])
  })

  it('parses a full-year period into all 12 months', () => {
    expect(parsePeriod('2025-full')).toEqual([
      '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
      '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
    ])
  })

  it('parses a YTD period into January through the given "as of" month', () => {
    expect(parsePeriod('2026-ytd', new Date('2026-08-17'))).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
    ])
  })

  it('throws on an unrecognized period string', () => {
    expect(() => parsePeriod('not-a-period')).toThrow()
  })
})

describe('formatPeriodLabel', () => {
  it('labels a specific month', () => {
    expect(formatPeriodLabel('2026-06')).toBe('June 2026')
  })

  it('labels a full-year period', () => {
    expect(formatPeriodLabel('2025-full')).toBe('2025 Full Year')
  })

  it('labels a YTD period', () => {
    expect(formatPeriodLabel('2026-ytd')).toBe('2026 YTD')
  })
})

describe('listPeriodOptions', () => {
  it('includes YTD for the current year, full-year for prior years, and individual months back to the earliest available month', () => {
    const options = listPeriodOptions({ earliestMonth: '2025-01', asOf: new Date('2026-08-17') })
    const values = options.map((o) => o.value)

    expect(values).toContain('2026-ytd')
    expect(values).toContain('2025-full')
    expect(values).toContain('2025-01')
    expect(values).toContain('2026-06')
    expect(values).not.toContain('2024-full')
    expect(values).not.toContain('2026-09') // future month, no data possible yet
  })
})
