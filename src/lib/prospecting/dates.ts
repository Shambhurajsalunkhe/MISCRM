/**
 * Calendar arithmetic for counter dates.
 *
 * `ProspectingActivity.activityDate` is a `@db.Date` — a calendar day with no
 * time and no zone. Everything in this module therefore works in **UTC**, and
 * that choice is load-bearing rather than cosmetic.
 *
 * The trap: `new Date(2026, 7, 16)` in IST is `2026-08-15T18:30:00Z`. Handed to
 * a `date` column it casts to **15 August**, so a BDE in Delhi logging Sunday's
 * pitches would find them filed against Saturday. Building the instant with
 * `Date.UTC` and reading it back with `getUTC*` keeps the day the user picked,
 * whichever side of the meridian they are on.
 *
 * This is the mirror image of the rule in `src/lib/leads/filters.ts`, which
 * builds *local* midnight — deliberately, because `Lead.createdAt` is a real
 * timestamp and "created on the 16th" means the 16th where the user is. A
 * counter date is not an instant at all, which is why the two differ.
 */

/** `yyyy-MM-dd` for a calendar day, read in UTC. */
export function dateKey(value: Date): string {
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')
  return `${value.getUTCFullYear()}-${month}-${day}`
}

/** `yyyy-MM-dd` -> UTC midnight, or `null` if it is not a real date. */
export function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  // Rejects 31 February, which `Date.UTC` rolls into March without complaint.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return date
}

/** Today as a counter date — the calendar day where the *server* is. */
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

/**
 * The Monday on or before a date.
 *
 * Weeks start on Monday because the grid is a working week and the app formats
 * every date as en-GB. There is no setting behind it yet; if a team wants
 * Sunday-first, this is the one function that has to know.
 */
export function startOfWeek(date: Date): Date {
  // getUTCDay: 0 = Sunday. Sunday belongs to the week that began six days ago.
  const shift = (date.getUTCDay() + 6) % 7
  return addDays(date, -shift)
}

/** The seven days of the week containing `date`, Monday first. */
export function weekDays(date: Date): Date[] {
  const monday = startOfWeek(date)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** "Mon 10" for a grid column header. */
export function shortDayLabel(date: Date): { weekday: string; day: number } {
  return {
    weekday: WEEKDAY_LABELS[(date.getUTCDay() + 6) % 7],
    day: date.getUTCDate(),
  }
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** "16 Aug 2026", matching `formatDate` but reading the date in UTC. */
export function formatCounterDate(value: Date): string {
  return `${String(value.getUTCDate()).padStart(2, '0')} ${
    MONTH_LABELS[value.getUTCMonth()]
  } ${value.getUTCFullYear()}`
}

/** "11–17 Aug 2026" for the week heading, collapsing repeated month and year. */
export function formatWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6)
  const sameMonth = monday.getUTCMonth() === sunday.getUTCMonth()
  const sameYear = monday.getUTCFullYear() === sunday.getUTCFullYear()

  const left = sameMonth
    ? String(monday.getUTCDate())
    : sameYear
      ? `${monday.getUTCDate()} ${MONTH_LABELS[monday.getUTCMonth()]}`
      : formatCounterDate(monday)

  return `${left}–${formatCounterDate(sunday)}`
}
