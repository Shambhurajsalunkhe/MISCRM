import 'server-only'

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'

import { cellText, type ReportTable } from '@/lib/reports/table'

/**
 * The PDF half of the report exports (README §29).
 *
 * React PDF, as the plan's stack table says, and it earns the dependency here in
 * a way it would not have earned it earlier: a report PDF is a repeating table
 * with a header that has to reappear on every page and a footer row that has to
 * stay attached to the numbers above it, which is exactly the layout problem
 * this library solves and exactly what hand-written PDF plumbing gets wrong.
 *
 * Landscape A4 throughout, because these tables are wide and a report that
 * cannot be read without rotating the page is a report nobody opens twice.
 * Helvetica is the built-in font — no `Font.register`, so no network fetch at
 * render time and no missing-glyph surprise on a machine without the font.
 *
 * The filter block is printed above the table rather than left implicit. A PDF
 * outlives the URL that produced it: without the period and the filters on the
 * page, "Won Revenue $412,000" in an email six weeks later is a number with no
 * question attached to it.
 */

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 34,
    paddingHorizontal: 28,
    fontSize: 8.5,
    fontFamily: 'Helvetica',
    color: '#0f172a',
  },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  subtitle: { marginTop: 4, fontSize: 8, color: '#475569', lineHeight: 1.4 },
  metaBlock: {
    marginTop: 8,
    marginBottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  metaItem: { marginRight: 14, marginBottom: 2, fontSize: 7.5, color: '#475569' },
  metaLabel: { fontFamily: 'Helvetica-Bold' },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#94a3b8',
    borderTopWidth: 1,
    borderTopColor: '#94a3b8',
    backgroundColor: '#f1f5f9',
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 3,
  },
  footerRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#94a3b8',
    paddingVertical: 4,
    fontFamily: 'Helvetica-Bold',
  },
  cell: { paddingHorizontal: 3 },
  headerCell: { paddingHorizontal: 3, fontFamily: 'Helvetica-Bold' },
  pageNumber: {
    position: 'absolute',
    bottom: 16,
    left: 28,
    right: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: '#64748b',
  },
})

/**
 * Column widths as flex proportions.
 *
 * A report's own `width` hints are character counts meant for Excel; here they
 * only have to be relative to each other, so they are used as flex weights with
 * a floor. Numeric columns are right-aligned, which is the difference between a
 * column of figures and a column of strings that happen to be digits.
 */
function weight(width: number | undefined): number {
  return Math.max(width ?? 14, 6)
}

function ReportDocument({
  table,
  currency,
  generated,
}: {
  table: ReportTable
  currency: string
  generated: string
}) {
  const columns = table.columns
  const footer = table.footer

  return (
    <Document title={table.title}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>{table.title}</Text>
        {table.subtitle ? (
          <Text style={styles.subtitle}>{table.subtitle}</Text>
        ) : null}

        <View style={styles.metaBlock}>
          {(table.meta ?? []).map(([label, value]) => (
            <Text key={label} style={styles.metaItem}>
              <Text style={styles.metaLabel}>{label}: </Text>
              {value}
            </Text>
          ))}
        </View>

        {/* `fixed` repeats the header on every page — the whole reason this is
            React PDF and not a hand-rolled writer. */}
        <View style={styles.headerRow} fixed>
          {columns.map((column) => (
            <Text
              key={column.header}
              style={[
                styles.headerCell,
                {
                  flexGrow: weight(column.width),
                  flexBasis: 0,
                  textAlign:
                    column.format && column.format !== 'text' && column.format !== 'date'
                      ? 'right'
                      : 'left',
                },
              ]}
            >
              {column.header}
            </Text>
          ))}
        </View>

        {table.rows.map((row, index) => (
          <View key={index} style={styles.row} wrap={false}>
            {columns.map((column, columnIndex) => (
              <Text
                key={column.header}
                style={[
                  styles.cell,
                  {
                    flexGrow: weight(column.width),
                    flexBasis: 0,
                    textAlign:
                      column.format &&
                      column.format !== 'text' &&
                      column.format !== 'date'
                        ? 'right'
                        : 'left',
                  },
                ]}
              >
                {cellText(row[columnIndex] ?? null, column.format, currency)}
              </Text>
            ))}
          </View>
        ))}

        {table.rows.length === 0 ? (
          <Text style={styles.subtitle}>
            No rows matched these filters. The filters are printed above, so this
            page still says what was asked.
          </Text>
        ) : null}

        {footer ? (
          <View style={styles.footerRow}>
            {columns.map((column, columnIndex) => (
              <Text
                key={column.header}
                style={[
                  styles.cell,
                  {
                    flexGrow: weight(column.width),
                    flexBasis: 0,
                    textAlign:
                      column.format &&
                      column.format !== 'text' &&
                      column.format !== 'date'
                        ? 'right'
                        : 'left',
                  },
                ]}
              >
                {cellText(footer[columnIndex] ?? null, column.format, currency)}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.pageNumber} fixed>
          <Text>Sales CRM — generated {generated}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}

export async function reportToPdf(
  table: ReportTable,
  currency: string,
  now: Date = new Date(),
): Promise<Buffer> {
  return renderToBuffer(
    <ReportDocument
      table={table}
      currency={currency}
      generated={now.toLocaleString('en-GB')}
    />,
  )
}
