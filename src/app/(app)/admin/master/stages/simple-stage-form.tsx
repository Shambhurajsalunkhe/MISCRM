'use client'

import { useActionState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { Checkbox, Input } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE, type ActionState } from '@/lib/form'

export type SimpleStageValues = {
  id: string
  name: string
  code: string
  agingThresholdDays?: number | null
  flags: Record<string, boolean>
}

/**
 * The requirement and candidate stage lists.
 *
 * They differ from pipeline stages in two ways: they are global rather than
 * per-vertical, and their outcome flags are named differently
 * (`isWon`/`isLost` vs `isPlaced`/`isRejected`). Everything else is the same
 * row, so the flags are passed in rather than hard-coded.
 */
export function SimpleStageForm({
  action,
  stage,
  flags,
  showAging,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  stage?: SimpleStageValues
  flags: Array<{ name: string; label: string }>
  showAging: boolean
  cancelHref: string
}) {
  const [state, formAction] = useActionState(action, IDLE)
  const errors = state.fieldErrors ?? {}
  const key = stage?.id ?? 'new'

  return (
    <form action={formAction} className="space-y-2">
      {stage ? <input type="hidden" name="id" value={stage.id} /> : null}

      <FormMessage state={state} />

      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-44 flex-1">
          <label htmlFor={`${key}-name`} className="sr-only">
            Stage name
          </label>
          <Input
            id={`${key}-name`}
            name="name"
            defaultValue={stage?.name ?? ''}
            placeholder="Stage name"
            aria-invalid={Boolean(errors.name)}
            autoFocus
            required
          />
          {errors.name ? (
            <p className="mt-1 text-xs text-red-600">{errors.name}</p>
          ) : null}
        </div>

        <div className="min-w-36">
          <label htmlFor={`${key}-code`} className="sr-only">
            Code
          </label>
          <Input
            id={`${key}-code`}
            name="code"
            defaultValue={stage?.code ?? ''}
            placeholder="CODE"
            className="font-mono uppercase"
            aria-invalid={Boolean(errors.code)}
            required
          />
          {errors.code ? (
            <p className="mt-1 text-xs text-red-600">{errors.code}</p>
          ) : null}
        </div>

        {showAging ? (
          <div className="w-28">
            <label htmlFor={`${key}-aging`} className="sr-only">
              Aging threshold in days
            </label>
            <Input
              id={`${key}-aging`}
              name="agingThresholdDays"
              inputMode="numeric"
              defaultValue={
                stage?.agingThresholdDays === null ||
                stage?.agingThresholdDays === undefined
                  ? ''
                  : String(stage.agingThresholdDays)
              }
              placeholder="Days"
              aria-invalid={Boolean(errors.agingThresholdDays)}
            />
            {errors.agingThresholdDays ? (
              <p className="mt-1 text-xs text-red-600">
                {errors.agingThresholdDays}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-3 py-1.5">
          {flags.map((flag) => (
            <label
              key={flag.name}
              className="flex items-center gap-1.5 text-sm text-slate-700"
            >
              <Checkbox
                name={flag.name}
                defaultChecked={stage?.flags[flag.name] ?? false}
              />
              {flag.label}
            </label>
          ))}
        </div>

        <SubmitButton>{stage ? 'Save' : 'Add'}</SubmitButton>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
      </div>

      {/* The outcome flags are validated as a pair — "cannot be both" attaches
          to the first of them — so the message belongs under the row rather
          than beside one checkbox. */}
      {flags.some((flag) => errors[flag.name]) ? (
        <p className="text-xs text-red-600">
          {flags.map((flag) => errors[flag.name]).find(Boolean)}
        </p>
      ) : null}
    </form>
  )
}
