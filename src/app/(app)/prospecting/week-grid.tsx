'use client'

import { useActionState, useState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { IDLE } from '@/lib/form'
import { cn } from '@/lib/cn'
import { saveWeekAction } from './actions'

export type GridMetric = { id: string; label: string }

export type GridDay = {
  /** `yyyy-MM-dd`, also half of each input's name. */
  key: string
  weekday: string
  day: number
  /** Not yet happened, so not yet countable. */
  isFuture: boolean
  isToday: boolean
}

export function cellName(metricId: string, dayKey: string): string {
  return `cell:${metricId}:${dayKey}`
}

/**
 * A week of counters, metrics down and days across (docs/03 §1).
 *
 * The grid is client-side for one reason: the totals. Entering a week is
 * checking a week — someone reconciling forty pitches against their Upwork
 * history wants the row total to move as they type, and a server round-trip per
 * keystroke to render a number the browser can add up itself would be absurd.
 * The inputs are still plain form fields with real `name`s, so the whole thing
 * submits and validates exactly as it would without JavaScript.
 */
export function WeekGrid({
  verticalId,
  week,
  userId,
  metrics,
  days,
  initial,
}: {
  verticalId: string
  week: string
  userId: string
  metrics: GridMetric[]
  days: GridDay[]
  /** `metricId:yyyy-MM-dd` -> count, for the cells that already have one. */
  initial: Record<string, number>
}) {
  const [state, formAction] = useActionState(saveWeekAction, IDLE)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initial).map(([key, value]) => [key, String(value)]),
    ),
  )

  const errors = state.fieldErrors ?? {}

  const read = (metricId: string, dayKey: string): number => {
    const raw = values[`${metricId}:${dayKey}`]
    const parsed = Number(raw)
    return raw && Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  const rowTotal = (metricId: string) =>
    days.reduce((total, day) => total + read(metricId, day.key), 0)

  const columnTotal = (dayKey: string) =>
    metrics.reduce((total, metric) => total + read(metric.id, dayKey), 0)

  const grandTotal = metrics.reduce(
    (total, metric) => total + rowTotal(metric.id),
    0,
  )

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="verticalId" value={verticalId} />
      <input type="hidden" name="week" value={week} />
      <input type="hidden" name="userId" value={userId} />

      <FormMessage state={state} />

      <Table>
        <THead>
          <TR>
            <TH className="sticky left-0 bg-slate-50">Metric</TH>
            {days.map((day) => (
              <TH
                key={day.key}
                className={cn(
                  'text-center',
                  day.isToday ? 'text-slate-900' : undefined,
                )}
              >
                {day.weekday}
                <span className="ml-1 font-normal normal-case">{day.day}</span>
              </TH>
            ))}
            <TH className="text-right">Total</TH>
          </TR>
        </THead>
        <TBody>
          {metrics.map((metric) => (
            <TR key={metric.id}>
              <TD className="sticky left-0 bg-white font-medium text-slate-900">
                {metric.label}
              </TD>
              {days.map((day) => {
                const name = cellName(metric.id, day.key)
                const error = errors[name]

                return (
                  <TD key={day.key} className="p-1 text-center">
                    <label className="sr-only" htmlFor={name}>
                      {metric.label} on {day.weekday} {day.day}
                    </label>
                    <input
                      id={name}
                      name={name}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      disabled={day.isFuture}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${name}-error` : undefined}
                      value={values[`${metric.id}:${day.key}`] ?? ''}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [`${metric.id}:${day.key}`]: event.target.value,
                        }))
                      }
                      className={cn(
                        'h-9 w-16 rounded-md border bg-white text-center text-sm text-slate-900',
                        'transition focus:outline-2 focus:outline-offset-0 focus:outline-slate-900/20',
                        'disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50',
                        error ? 'border-red-400' : 'border-slate-300',
                        day.isToday ? 'ring-1 ring-slate-900/10' : undefined,
                      )}
                    />
                    {/* The banner says only that something is wrong. Which cell
                        and why has to be on the cell — a red border with no
                        message is not a message, and to a screen reader
                        `aria-invalid` alone is "invalid" with no reason. */}
                    {error ? (
                      <p
                        id={`${name}-error`}
                        className="mt-0.5 max-w-24 text-xs text-red-600"
                      >
                        {error}
                      </p>
                    ) : null}
                  </TD>
                )
              })}
              <TD className="text-right font-medium text-slate-900 tabular-nums">
                {rowTotal(metric.id).toLocaleString('en-GB')}
              </TD>
            </TR>
          ))}

          <TR className="bg-slate-50 hover:bg-slate-50">
            <TD className="sticky left-0 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Day total
            </TD>
            {days.map((day) => (
              <TD
                key={day.key}
                className="text-center font-medium text-slate-700 tabular-nums"
              >
                {columnTotal(day.key).toLocaleString('en-GB')}
              </TD>
            ))}
            <TD className="text-right font-semibold text-slate-900 tabular-nums">
              {grandTotal.toLocaleString('en-GB')}
            </TD>
          </TR>
        </TBody>
      </Table>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton>Save week</SubmitButton>
        <ButtonLink href="/prospecting/summary" variant="secondary">
          View summary
        </ButtonLink>
        <p className="text-xs text-slate-500">
          Saving replaces this week’s numbers for whoever is selected. A blank or
          zero cell removes the entry.
        </p>
      </div>
    </form>
  )
}
