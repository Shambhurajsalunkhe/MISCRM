'use client'

import { useActionState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { Checkbox, Input, Select } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { savePipelineStageAction } from './actions'
import { COMMON_STAGE_OPTIONS } from './common-stages'

export type PipelineStageValues = {
  id: string
  name: string
  code: string
  commonStage: string
  agingThresholdDays: number | null
  isWon: boolean
  isLost: boolean
}

export function PipelineStageForm({
  verticalId,
  stage,
}: {
  verticalId: string
  stage?: PipelineStageValues
}) {
  const [state, formAction] = useActionState(savePipelineStageAction, IDLE)
  const errors = state.fieldErrors ?? {}
  const key = stage?.id ?? 'new'

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="verticalId" value={verticalId} />
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

        <div className="min-w-48">
          <label htmlFor={`${key}-commonStage`} className="sr-only">
            Common stage
          </label>
          <Select
            id={`${key}-commonStage`}
            name="commonStage"
            defaultValue={stage?.commonStage ?? 'NEW'}
            aria-invalid={Boolean(errors.commonStage)}
          >
            {COMMON_STAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {errors.commonStage ? (
            <p className="mt-1 text-xs text-red-600">{errors.commonStage}</p>
          ) : null}
        </div>

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

        <div className="flex items-center gap-3 py-1.5">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <Checkbox name="isWon" defaultChecked={stage?.isWon} />
            Won
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <Checkbox name="isLost" defaultChecked={stage?.isLost} />
            Lost
          </label>
        </div>

        <SubmitButton>{stage ? 'Save' : 'Add'}</SubmitButton>
        <ButtonLink
          href={`/admin/master/stages?vertical=${verticalId}`}
          variant="secondary"
        >
          Cancel
        </ButtonLink>
      </div>

      {errors.isWon || errors.isLost ? (
        <p className="text-xs text-red-600">{errors.isWon ?? errors.isLost}</p>
      ) : null}
    </form>
  )
}
