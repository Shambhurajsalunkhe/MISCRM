'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { auditedTransaction, prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { PERMISSIONS } from '@/lib/permissions'
import { resolveCounterOwner } from '@/lib/prospecting/people'
import {
  addDays,
  dateKey,
  parseDateKey,
  startOfWeek,
  todayKey,
  weekDays,
} from '@/lib/prospecting/dates'
import {
  actionError,
  actionSuccess,
  optionalString,
  type ActionState,
} from '@/lib/form'

/**
 * A counter is a count of things somebody did in a day. The bounds are sanity
 * checks rather than business rules: negative is meaningless, and six figures
 * of calls in one day by one person is a typo, not a record-breaking Tuesday.
 */
const countSchema = z.coerce
  .number()
  .int('Whole numbers only.')
  .min(0, 'Counts cannot be negative.')
  .max(100_000, 'That looks like a typo — check the number.')

/** `cell:<metricId>:<yyyy-MM-dd>`, the grid's input name. */
const CELL_NAME = /^cell:([^:]+):(\d{4}-\d{2}-\d{2})$/

type Cell = { metricId: string; dateKey: string; count: number }

/**
 * Save a whole week of counters for one person and one vertical.
 *
 * Written as one submit rather than a save-per-cell because that is how the
 * entry actually happens — a BDE fills Monday to Friday on Friday afternoon —
 * and because a partial week is a wrong week: the bridge % divides by these
 * numbers, so five saved days and two lost ones reads as a genuinely worse
 * conversion rate rather than as missing data.
 *
 * A zero clears the cell instead of storing `0`. "No pitches on Wednesday" and
 * "nobody has said what happened on Wednesday" are the same fact for every
 * query here — both sum to nothing — and keeping the row would only make the
 * audit trail longer without making it truer.
 */
export async function saveWeekAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.PROSPECTING_LOG, async (actor) => {
    const verticalId = optionalString(formData.get('verticalId'))
    const weekValue = optionalString(formData.get('week'))

    if (!verticalId) return actionError('Choose a vertical.')

    const week = weekValue ? parseDateKey(weekValue) : null
    if (!week) return actionError('That week is not a valid date.')

    const owner = await resolveCounterOwner(
      actor,
      optionalString(formData.get('userId')),
    )

    if (!owner) {
      return actionError(
        'You can only log counters for yourself and the people who report to you.',
        { userId: 'Choose someone in your team.' },
      )
    }

    const vertical = await prisma.salesVertical.findFirst({
      where: { id: verticalId, isActive: true },
      select: { id: true, name: true },
    })

    if (!vertical) {
      return actionError('That vertical is not available.', {
        verticalId: 'Choose an active vertical.',
      })
    }

    // The metrics this vertical actually has, read fresh. The form was rendered
    // from the same list, but master data can change between the two — and a
    // metric id from another vertical would file Upwork pitches under LinkedIn.
    const metrics = await prisma.verticalMetric.findMany({
      where: { verticalId: vertical.id, isActive: true },
      select: { id: true },
    })

    const metricIds = new Set(metrics.map((metric) => metric.id))

    const monday = startOfWeek(week)
    const days = new Set(weekDays(monday).map(dateKey))
    const today = todayKey()

    const cells: Cell[] = []
    const fieldErrors: Record<string, string> = {}

    for (const [name, raw] of formData.entries()) {
      const match = CELL_NAME.exec(name)
      if (!match || typeof raw !== 'string') continue

      const [, metricId, day] = match

      // Silently ignored rather than rejected: a stale tab whose vertical has
      // since lost a metric should still be able to save the rest of the week.
      if (!metricIds.has(metricId) || !days.has(day)) continue

      // Tomorrow's calls have not been made yet. The input is disabled in the
      // grid; this is the half of that rule which cannot be bypassed.
      if (day > today) continue

      const trimmed = raw.trim()
      if (trimmed === '') {
        cells.push({ metricId, dateKey: day, count: 0 })
        continue
      }

      const parsed = countSchema.safeParse(trimmed)
      if (!parsed.success) {
        fieldErrors[name] = parsed.error.issues[0]?.message ?? 'Enter a whole number.'
        continue
      }

      cells.push({ metricId, dateKey: day, count: parsed.data })
    }

    if (Object.keys(fieldErrors).length > 0) {
      return actionError('Some of these are not whole numbers.', fieldErrors)
    }

    if (cells.length === 0) {
      return actionError('There was nothing to save.')
    }

    const written = cells.filter((cell) => cell.count > 0).length

    await auditedTransaction(async (tx) => {
      // What is already stored for this week. Most cells in a submit are
      // unchanged and most of those are empty, so knowing which rows exist
      // turns "clear every blank cell" from a delete per cell into nothing at
      // all — and each of those deletes costs the audit writer a pre-image read
      // to discover it matched no rows.
      const stored = await tx.prospectingActivity.findMany({
        where: {
          userId: owner.id,
          verticalId: vertical.id,
          activityDate: { gte: monday, lte: addDays(monday, 6) },
        },
        select: { metricId: true, activityDate: true, count: true },
      })

      const existing = new Map(
        stored.map((row) => [
          `${row.metricId}:${dateKey(row.activityDate)}`,
          row.count,
        ]),
      )

      for (const cell of cells) {
        const activityDate = parseDateKey(cell.dateKey)!
        const before = existing.get(`${cell.metricId}:${cell.dateKey}`)

        if (cell.count === 0) {
          if (before === undefined) continue

          // `deleteMany`, not `delete`: the row was read a moment ago, but a
          // concurrent save could have removed it, and `delete` throws on a
          // miss where this simply does nothing.
          await tx.prospectingActivity.deleteMany({
            where: {
              userId: owner.id,
              verticalId: vertical.id,
              metricId: cell.metricId,
              activityDate,
            },
          })
          continue
        }

        // Unchanged. The audit writer already diffs updates to nothing, but not
        // issuing the write at all is cheaper and says the same thing.
        if (before === cell.count) continue

        await tx.prospectingActivity.upsert({
          where: {
            userId_verticalId_metricId_activityDate: {
              userId: owner.id,
              verticalId: vertical.id,
              metricId: cell.metricId,
              activityDate,
            },
          },
          // Only `count`. Notes and the itemised `referenceUrl` are not on this
          // grid, and writing them as null here would erase whatever set them.
          update: { count: cell.count },
          create: {
            userId: owner.id,
            verticalId: vertical.id,
            metricId: cell.metricId,
            activityDate,
            count: cell.count,
          },
        })
      }
    })

    revalidatePath('/prospecting')
    revalidatePath('/prospecting/summary')
    // The funnel reads the same counters, and its top half is wrong until it
    // re-renders.
    revalidatePath('/reports/funnel')

    const who = owner.id === actor.id ? '' : ` for ${owner.name}`
    return actionSuccess(
      written === 0
        ? `${vertical.name} week cleared${who}.`
        : `${vertical.name} week saved${who} — ${written} ${
            written === 1 ? 'entry' : 'entries'
          }.`,
    )
  })
}
