export interface ExcelColumn {
  header: string
  key: string
  width?: number
}

export interface ExcelSheet {
  name: string
  columns: ExcelColumn[]
  rows: Record<string, unknown>[]
}

export const exportToExcel = async (filename: string, sheets: ExcelSheet[]): Promise<void> => {
  const specifier = 'exceljs'
  const ExcelJS: any = await import(/* @vite-ignore */ specifier)
  const WorkbookClass = (ExcelJS.default?.Workbook || ExcelJS.Workbook) as typeof ExcelJS.Workbook
  const workbook = new WorkbookClass()

  for (const s of sheets) {
    const worksheet = workbook.addWorksheet(s.name)
    worksheet.columns = s.columns
    worksheet.addRows(s.rows)
    const headerRow = worksheet.getRow(1)
    headerRow.font = { bold: true, color: { argb: 'FF111827' } }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' }
    }
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const doc = (globalThis as { document?: Document }).document
  if (!doc) return
  const link = doc.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `${filename}.xlsx`)
  doc.body.appendChild(link)
  link.click()
  doc.body.removeChild(link)
  URL.revokeObjectURL(url)
}