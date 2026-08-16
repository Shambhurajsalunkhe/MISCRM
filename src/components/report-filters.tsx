import { ButtonLink } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import type { ReportFilters } from '@/lib/prospecting/filters'

export type FilterOption = { value: string; label: string }

/**
 * The filter bar shared by the counter summary and the vertical funnel.
 *
 * A plain GET form, so applying a filter produces a URL. That is what makes the
 * drill-down chain in README §37 work at all — every number on these screens
 * links onward carrying its own filter state, and the state has to be somewhere
 * a link can reach.
 */
export function ReportFilterBar({
  action,
  filters,
  from,
  to,
  verticals,
  people,
  teams,
  verticalLabel = 'All verticals',
  hidden,
}: {
  action: string
  filters: ReportFilters
  /** The resolved range, so the inputs show the default rather than blanks. */
  from: string
  to: string
  verticals?: FilterOption[]
  people: FilterOption[]
  teams: FilterOption[]
  /**
   * Label for the "no vertical chosen" option. Pass `null` where the screen
   * always has one — the funnel draws a single vertical, so an "all verticals"
   * entry there would offer something it cannot render, and repeating the
   * current vertical as the blank label made the same name appear twice.
   */
  verticalLabel?: string | null
  /** Kept across a submit — the funnel's chosen vertical, for instance. */
  hidden?: Record<string, string>
}) {
  return (
    <form
      method="get"
      action={action}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
    >
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div>
        <label htmlFor="from" className="mb-1 block text-xs font-medium text-slate-600">
          From
        </label>
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={from}
          className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 shadow-xs"
        />
      </div>

      <div>
        <label htmlFor="to" className="mb-1 block text-xs font-medium text-slate-600">
          To
        </label>
        <input
          id="to"
          name="to"
          type="date"
          defaultValue={to}
          className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 shadow-xs"
        />
      </div>

      {verticals ? (
        <FilterSelect
          id="vertical"
          label="Vertical"
          blank={verticalLabel}
          value={filters.vertical}
          options={verticals}
        />
      ) : null}

      <FilterSelect
        id="user"
        label="Person"
        blank="Everyone"
        value={filters.user}
        options={people}
      />

      <FilterSelect
        id="team"
        label="Team"
        blank="All teams"
        value={filters.team}
        options={teams}
      />

      <button
        type="submit"
        className="h-9 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        Apply
      </button>
      <ButtonLink href={action} variant="ghost">
        Clear
      </ButtonLink>
    </form>
  )
}

function FilterSelect({
  id,
  label,
  blank,
  value,
  options,
}: {
  id: string
  label: string
  /** `null` drops the empty option, making the select a required choice. */
  blank: string | null
  value: string | undefined
  options: FilterOption[]
}) {
  return (
    <div className="min-w-40">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      <Select id={id} name={id} defaultValue={value ?? ''}>
        {blank === null ? null : <option value="">{blank}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  )
}
