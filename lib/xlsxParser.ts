import ExcelJS from 'exceljs'

// Converts every sheet in the workbook to a plain-text, row-by-row dump — good enough for an
// LLM to read structurally without needing exact column offsets, and sidesteps ExcelJS's
// merged-cell value duplication (a header cell merged across several columns repeats its text
// in every one of those columns when read via row.values).
export async function xlsxToText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  // exceljs's bundled fast-csv dependency ships its own (older) @types/node, whose Buffer type
  // is nominally incompatible with this project's — a type-only conflict with no runtime effect.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])

  const sections: string[] = []

  for (const sheet of workbook.worksheets) {
    const lines: string[] = [`=== Sheet: ${sheet.name} ===`]

    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: false }, (cell) => {
        let value: string
        try {
          value = cell.text?.trim() ?? ''
        } catch {
          // ExcelJS throws reading .text on some merged-cell edge cases where the underlying
          // value is null despite the cell reporting non-empty — fall back to the raw value.
          value = String(cell.value ?? '').trim()
        }
        // A cell merged across several columns repeats its value in every one of those
        // columns — collapse immediate repeats rather than passing the noise through.
        if (value && value !== cells[cells.length - 1]) cells.push(value)
      })
      if (cells.length > 0) {
        lines.push(cells.join(' | '))
      }
    })

    sections.push(lines.join('\n'))
  }

  return sections.join('\n\n')
}
