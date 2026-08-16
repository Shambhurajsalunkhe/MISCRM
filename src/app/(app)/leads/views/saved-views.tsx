'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { CheckboxField, Input } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { RowAction } from '@/components/row-action'
import { IDLE } from '@/lib/form'
import { cn } from '@/lib/cn'
import { deleteViewAction, saveViewAction } from './actions'

export type SavedViewItem = {
  id: string
  name: string
  query: string
  isShared: boolean
  isOwn: boolean
  ownerName: string
}

/**
 * The saved-view strip above the lead list (README §30).
 *
 * Each view is a plain link to `/leads?<its filters>`, so opening one is a
 * normal navigation: the URL ends up exactly as if the filters had been typed,
 * which keeps the back button, bookmarking and the export button all working
 * with no special case for "I arrived here from a view".
 */
export function SavedViews({
  views,
  currentQuery,
  canSave,
  canShare,
}: {
  views: SavedViewItem[]
  /** The filters currently applied, as a query string. */
  currentQuery: string
  canSave: boolean
  canShare: boolean
}) {
  const [state, formAction] = useActionState(saveViewAction, IDLE)
  const [open, setOpen] = useState(false)

  const currentParams = new URLSearchParams(currentQuery)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {views.map((view) => {
          const active = view.query === currentQuery

          return (
            <span
              key={view.id}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
                active
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700',
              )}
            >
              <Link href={`/leads?${view.query}`} className="hover:underline">
                {view.name}
              </Link>
              {view.isShared && !view.isOwn ? (
                <span
                  className={active ? 'text-slate-300' : 'text-slate-400'}
                  title={`Shared by ${view.ownerName}`}
                >
                  · {view.ownerName}
                </span>
              ) : null}
              {view.isOwn ? (
                <RowAction
                  action={deleteViewAction}
                  id={view.id}
                  label="×"
                  confirmMessage={`Delete the view “${view.name}”?`}
                />
              ) : null}
            </span>
          )
        })}

        {canSave && currentQuery !== '' ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
            {open ? 'Cancel' : 'Save these filters'}
          </Button>
        ) : null}
      </div>

      {open ? (
        <form
          action={formAction}
          className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-3"
        >
          {/* The current filters travel with the form, so what gets saved is
              exactly what is on screen rather than whatever the URL becomes by
              the time the action runs. */}
          {[...currentParams.entries()].map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}

          <div className="min-w-52">
            <label htmlFor="view-name" className="sr-only">
              View name
            </label>
            <Input
              id="view-name"
              name="name"
              placeholder="e.g. My overdue follow-ups"
              autoFocus
              required
            />
          </div>

          {canShare ? (
            <CheckboxField
              label="Share with the team"
              name="isShared"
              hint="They still see only their own leads."
            />
          ) : null}

          <SubmitButton size="sm">Save view</SubmitButton>
        </form>
      ) : null}

      <FormMessage state={state} />
    </div>
  )
}
