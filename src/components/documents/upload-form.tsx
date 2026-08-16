'use client'

import { useActionState, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from '@/lib/document-types'
import { IDLE } from '@/lib/form'
import { uploadDocumentAction } from '@/server/documents'

/**
 * Attach a typed document to a lead or a client (README §36).
 *
 * The `<form>` posts a real `File` through the server action; `formData` in the
 * action receives it directly, so there is no separate upload endpoint and no
 * window in which bytes exist without a row to point at them.
 */
export function UploadForm({
  leadId,
  clientId,
  defaultDocType,
}: {
  leadId?: string
  clientId?: string
  defaultDocType?: string
}) {
  const [state, formAction] = useActionState(uploadDocumentAction, IDLE)
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const errors = state.fieldErrors ?? {}

  // A file input cannot be cleared by re-rendering — the browser owns its
  // value — so the form is reset imperatively, but only once the upload has
  // actually succeeded. Resetting inside the submit handler cleared the
  // selection while the request was still in flight, so a rejected file left
  // an error message pointing at a filename the user could no longer see.
  useEffect(() => {
    if (state.status === 'success') formRef.current?.reset()
  }, [state])

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Upload document
      </Button>
    )
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3"
    >
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}

      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="File" htmlFor="document-file" error={errors.file} required>
          <Input id="document-file" name="file" type="file" required />
        </Field>

        <Field label="Type" htmlFor="document-type">
          <Select
            id="document-type"
            name="docType"
            defaultValue={defaultDocType ?? 'OTHER'}
          >
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {DOCUMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Description"
          htmlFor="document-description"
          className="sm:col-span-2"
        >
          <Input
            id="document-description"
            name="description"
            placeholder="What this is, for whoever opens the lead next"
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <SubmitButton size="sm" pendingLabel="Uploading…">
          Upload
        </SubmitButton>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
