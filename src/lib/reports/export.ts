import 'server-only'

import { toCsv } from '@/lib/csv'
import {
  cellText,
  excelFormat,
  type ReportFormat,
  type ReportTable,
} from '@/lib/reports/table'

/**
 * The three report writers (README §29).
 *
 * All three take the same `ReportTable`, so a report is exportable the moment it
 * produces one and no format can drift from another. What differs is only what
 * each medium is for:
 *
 *  - **CSV** goes into somebody else's tool. Reuses `src/lib/csv.ts`, which
 *    already handles the two things that matter — the BOM Excel needs to read
 *    UTF-8, and the leading tab that stops a cell beginning `=` being executed
 *    as a formula.
 *  - **Excel** is for someone who will keep working on the numbers, so cells stay
 *    numeric with a format on the column rather than becoming pretty strings, the
 *    header freezes, and the filter set goes on a second sheet where it cannot be
 *    mistaken for data.
 *  - **PDF** is for someone who will read it and forward it, so it carries its
 *    period and filters on the page and nothing about it is editable.
 *
 * `exceljs` and `@react-pdf/renderer` are imported dynamically. Both are large
 * and neither is wanted on a page render — this module is only ever reached from
 * an export route, and a static import would pull both into any server bundle
 * that touched a report.
 */

const CONTENT_TYPES: Record<ReportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
}

function fileName(basename: string, format: ReportFormat, now: Date): string {
  const stamp = now.toISOString().slice(0, 10)
  return `${basename}-${stamp}.${format}`
}

/** A single row of text, for CSV: numbers formatted the way the screen shows them. */
function textRows(table: ReportTable, currency: string): string[][] {
  const rows = table.rows.map((row) =>
    table.columns.map((column, index) =>
      cellText(row[index] ?? null, column.format, currency),
    ),
  )

  if (table.footer) {
    rows.push(
      table.columns.map((column, index) =>
        cellText(table.footer?.[index] ?? null, column.format, currency),
      ),
    )
  }

  return rows
}

async function toXlsx(table: ReportTable, currency: string): Promise<Buffer> {
  // ExcelJS is CommonJS, so a dynamic import hands back a module namespace whose
  // `default` is the real export object. Reading `Workbook` off the namespace
  // directly works under Next's bundler and throws "not a constructor" under
  // plain Node — which is the difference between a route that works in the app
  // and one that works in a script, so both paths are covered here.
  const imported = await import('exceljs')
  const ExcelJS = (imported.default ?? imported) as typeof import('exceljs')

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Sales CRM'
  workbook.created = new Date()

  // Excel refuses sheet names over 31 characters or containing []*/\?:
  const sheetName = table.title.replace(/[[\]*/\\?:]/g, ' ').slice(0, 31)
  const sheet = workbook.addWorksheet(sheetName || 'Report')

  sheet.columns = table.columns.map((column) => ({
    header: column.header,
    width: Math.max(column.width ?? 16, 10),
    style: {
      numFmt: excelFormat(column.format, currency),
      alignment: {
        horizontal:
          column.format && column.format !== 'text' ? 'right' : 'left',
      },
    },
  }))

  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' },
  }

  for (const row of table.rows) {
    sheet.addRow(table.columns.map((_, index) => row[index] ?? null))
  }

  if (table.footer) {
    const footer = sheet.addRow(
      table.columns.map((_, index) => table.footer?.[index] ?? null),
    )
    footer.font = { bold: true }
    footer.border = { top: { style: 'thin' } }
  }

  // The header stays visible while scrolling — the one spreadsheet nicety that
  // matters on a report of a few hundred rows.
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(table.columns.length, 1) },
  }

  const notes = workbook.addWorksheet('Filters')
  notes.columns = [
    { header: 'Field', width: 24 },
    { header: 'Value', width: 60 },
  ]
  notes.getRow(1).font = { bold: true }
  notes.addRow(['Report', table.title])
  if (table.subtitle) notes.addRow(['What the numbers mean', table.subtitle])
  for (const [label, value] of table.meta ?? []) notes.addRow([label, value])
  notes.addRow(['Exported', new Date().toLocaleString('en-GB')])

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

/**
 * The download response for a report in one of the three formats.
 *
 * `no-store` for the same reason the CSV list exports use it: an export is a
 * snapshot of live data behind a visibility scope, and a cached copy served to
 * the next person could be both stale and not theirs to read.
 */
export async function reportResponse(
  table: ReportTable,
  format: ReportFormat,
  basename: string,
  currency = '$',
): Promise<Response> {
  const now = new Date()

  const body: string | Uint8Array =
    format === 'csv'
      ? toCsv(textRows(table, currency), [
          ...table.columns.map((column, index) => ({
            header: column.header,
            value: (row: string[]) => row[index],
          })),
        ])
      : format === 'xlsx'
        ? await toXlsx(table, currency)
        : await (async () => {
            const { reportToPdf } = await import('@/lib/reports/pdf')
            return reportToPdf(table, currency, now)
          })()

  return new Response(body as BodyInit, {
    headers: {
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${fileName(basename, format, now)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
