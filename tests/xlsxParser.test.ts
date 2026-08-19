import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { xlsxToText } from '../lib/xlsxParser'

async function buildWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()

  const sheet1 = workbook.addWorksheet('Summary')
  sheet1.addRow(['Month', 'Jul-2026'])
  sheet1.addRow(['Property Name', 'Test Building'])
  sheet1.mergeCells('A3:C3')
  sheet1.getCell('A3').value = 'Merged Header'

  const sheet2 = workbook.addWorksheet('Details')
  sheet2.addRow(['Type', 'Account Item', 'Amount'])
  sheet2.addRow(['Rent', 'Aug-2026', 100000])

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

describe('xlsxToText', () => {
  it('converts every sheet to a readable row-by-row text dump, labeled by sheet name', async () => {
    const buffer = await buildWorkbook()
    const text = await xlsxToText(buffer)

    expect(text).toContain('=== Sheet: Summary ===')
    expect(text).toContain('Month | Jul-2026')
    expect(text).toContain('Property Name | Test Building')
    expect(text).toContain('=== Sheet: Details ===')
    expect(text).toContain('Type | Account Item | Amount')
    expect(text).toContain('Rent | Aug-2026 | 100000')
  })

  it('collapses a merged cell\'s duplicated value across its spanned columns to one entry', async () => {
    const buffer = await buildWorkbook()
    const text = await xlsxToText(buffer)

    expect(text).toContain('Merged Header')
    expect(text).not.toContain('Merged Header | Merged Header')
  })
})
