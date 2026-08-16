import type { z } from 'zod'

/**
 * The single shape every server action in this app returns to `useActionState`.
 *
 * `fieldErrors` is keyed by input `name`, so a form can render each message
 * beside the offending control instead of dumping everything into one banner.
 */
export type ActionState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string>
}

export const IDLE: ActionState = { status: 'idle' }

export function actionError(
  message: string,
  fieldErrors?: Record<string, string>,
): ActionState {
  return { status: 'error', message, fieldErrors }
}

export function actionSuccess(message: string): ActionState {
  return { status: 'success', message }
}

/**
 * Flatten a Zod failure into `fieldErrors`, keeping the first message per
 * field. Issues with an empty path (from `.refine()` on the whole object)
 * become the banner message.
 */
export function fromZodError(error: z.ZodError): ActionState {
  const fieldErrors: Record<string, string> = {}
  let formMessage: string | undefined

  for (const issue of error.issues) {
    const key = issue.path.join('.')
    if (!key) {
      formMessage ??= issue.message
      continue
    }
    fieldErrors[key] ??= issue.message
  }

  return actionError(
    formMessage ?? 'Please correct the highlighted fields.',
    Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
  )
}

/**
 * `FormData.get` returns `null` for an absent field; Zod's `.optional()`
 * accepts `undefined` but not `null`. Normalising here keeps every action's
 * parse call free of `?? undefined` noise.
 *
 * Unchecked checkboxes are absent from the payload entirely, which is why
 * boolean fields must use `checkboxValue` rather than reading this map.
 */
export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value
  }
  return values
}

/** An unchecked checkbox sends nothing at all, so absence means false. */
export function checkboxValue(formData: FormData, name: string): boolean {
  return formData.get(name) !== null
}

/** Trim to a string, or `null` when the field was left blank. */
export function optionalString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
