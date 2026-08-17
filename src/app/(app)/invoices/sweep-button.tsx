'use client'

import { useActionState } from 'react'

import { SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { sweepOverdueAction } from './actions'

/**
 * Re-evaluate OVERDUE across the ledger, by hand.
 *
 * The same function a scheduler calls at /api/jobs/overdue-invoices. It exists
 * as a button because the stored status is what indexed queries filter on, and
 * an administrator setting the system up — or checking it after a night the
 * scheduler missed — should not have to wait until tomorrow to see the column
 * agree with the chips.
 */
export function SweepButton() {
  const [state, formAction] = useActionState(sweepOverdueAction, IDLE)

  return (
    <form action={formAction} className="flex items-center gap-2">
      {state.status !== 'idle' && state.message ? (
        <span
          className={
            state.status === 'error'
              ? 'text-xs text-red-600'
              : 'text-xs text-slate-500'
          }
        >
          {state.message}
        </span>
      ) : null}
      <SubmitButton variant="secondary" size="sm" pendingLabel="Sweeping…">
        Re-check overdue
      </SubmitButton>
    </form>
  )
}
