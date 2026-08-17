import { ButtonLink } from '@/components/ui/button'

/**
 * CSV / Excel / PDF for the report on screen (README §29).
 *
 * Three links to one route, carrying the report's own query string. Which is the
 * whole point: the export re-runs the *same loader with the same filters*, so
 * what lands in the file is what the person was looking at when they clicked.
 * Phase 2's lead export established the rule and it holds here — an export built
 * from a second, parallel query is an export that quietly stops matching the
 * screen, and since the loaders are also where the visibility scope is applied,
 * a divergent implementation is a leak waiting to happen.
 *
 * Rendered only where the viewer holds `data.export`. A disabled button that
 * explains itself would be better UI in most places, but here the honest reading
 * of the permission matrix is that export is a capability some roles simply do
 * not have, and a greyed-out row of buttons on every report is a permanent
 * reminder of it.
 */
export function ExportButtons({
  report,
  query,
}: {
  /** The registry key — see `src/lib/reports/registry.ts`. */
  report: string
  /** The screen's filter state, already serialised. */
  query: string
}) {
  const href = (format: string) =>
    `/reports/export?report=${encodeURIComponent(report)}&format=${format}${
      query ? `&${query}` : ''
    }`

  return (
    <div className="flex gap-2">
      <ButtonLink href={href('xlsx')} variant="secondary" size="sm">
        Excel
      </ButtonLink>
      <ButtonLink href={href('pdf')} variant="secondary" size="sm">
        PDF
      </ButtonLink>
      <ButtonLink href={href('csv')} variant="ghost" size="sm">
        CSV
      </ButtonLink>
    </div>
  )
}
