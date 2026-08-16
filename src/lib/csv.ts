/**
 * CSV writing for the list exports (README §29 asks for Excel and PDF too;
 * those arrive with the reports in Phase 6, where there is a page of formatting
 * to justify the dependency).
 *
 * Two things this gets right that `values.join(',')` does not:
 *
 *  - **Injection.** A cell beginning `=`, `+`, `-` or `@` is executed as a
 *    formula when the file is opened in Excel, and `=HYPERLINK(...)` in an
 *    exported lead title is a phishing link that arrived through our own
 *    export. Those cells are prefixed with a tab, which Excel treats as text.
 *  - **A BOM.** Without it Excel decodes UTF-8 as the local code page, and
 *    every non-ASCII company name comes out mangled.
 */

const NEEDS_QUOTING = /[",\r\n]/
const FORMULA_LEAD = /^[=+\-@\t\r]/

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''

  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? String(value)
        : String(value)

  if (FORMULA_LEAD.test(text)) text = `\t${text}`
  if (NEEDS_QUOTING.test(text)) text = `"${text.replaceAll('"', '""')}"`

  return text
}

export type CsvColumn<T> = {
  header: string
  value: (row: T) => unknown
}

export function toCsv<T>(rows: T[], columns: Array<CsvColumn<T>>): string {
  const lines = [columns.map((column) => cell(column.header)).join(',')]

  for (const row of rows) {
    lines.push(columns.map((column) => cell(column.value(row))).join(','))
  }

  // CRLF: the line ending every spreadsheet application reads without asking.
  return `﻿${lines.join('\r\n')}\r\n`
}

/** A CSV download response, named with the date so saved files stay distinct. */
export function csvResponse(body: string, basename: string): Response {
  const stamp = new Date().toISOString().slice(0, 10)

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${basename}-${stamp}.csv"`,
      // An export is a snapshot of live data; a cached copy served to the next
      // person would be both stale and, given visibility rules, possibly theirs
      // to see rather than ours.
      'Cache-Control': 'no-store',
    },
  })
}
