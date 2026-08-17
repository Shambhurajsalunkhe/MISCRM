'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { resolveTarget, targetFromFormData, targetFromRow } from '@/lib/attachments'
import {
  isAllowedExtension,
  isAllowedMimeType,
  MAX_UPLOAD_BYTES,
  remove,
  safeFileName,
  store,
} from '@/lib/storage'
import {
  actionError,
  actionSuccess,
  optionalString,
  type ActionState,
} from '@/lib/form'
import { DOCUMENT_TYPES } from '@/lib/document-types'
import type { DocumentType } from '@/generated/prisma/enums'

/**
 * Typed uploads against a lead or a client (README §36).
 *
 * The bytes go to `src/lib/storage.ts`, which writes them outside `public/`;
 * the row here records what they are and who attached them. Downloads go back
 * through a route handler that re-checks visibility — a `storageKey` is not a
 * capability.
 */
export async function uploadDocumentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ACTIVITY_MANAGE, async (actor) => {
    const target = targetFromFormData(formData)
    if (!target) return actionError('Missing the record to attach this to.')

    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return actionError('Choose a file to upload.', { file: 'No file selected.' })
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return actionError('That file is too large.', {
        file: `Maximum ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
      })
    }

    // Both the declared type and the extension, since the type is whatever the
    // browser chose to send: an .html file announced as image/png would pass
    // the first check alone.
    if (!isAllowedMimeType(file.type) || !isAllowedExtension(safeFileName(file.name))) {
      return actionError('That file type is not accepted.', {
        file: 'Documents, spreadsheets, presentations, images, text and zip files only.',
      })
    }

    const docTypeRaw = formData.get('docType')
    const docType = DOCUMENT_TYPES.includes(docTypeRaw as DocumentType)
      ? (docTypeRaw as DocumentType)
      : 'OTHER'

    // Visibility is checked before the bytes are written, so a request for
    // someone else's lead leaves nothing behind on disk.
    const resolved = await resolveTarget(actor, target)
    if (!resolved) return actionError('That record no longer exists.')

    const stored = await store(file)

    try {
      await prisma.document.create({
        data: {
          ...stored,
          docType,
          description: optionalString(formData.get('description')),
          uploadedById: actor.id,
          ...resolved.link,
        },
      })
    } catch (error) {
      // The row is what makes the file reachable. Without it the bytes are
      // unreferenced, so clean them up rather than leaving them on disk
      // forever with nothing pointing at them.
      await remove(stored.storageKey)
      throw error
    }

    revalidatePath(resolved.path)
    return actionSuccess(`${stored.fileName} uploaded.`)
  })
}

export async function deleteDocumentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ACTIVITY_MANAGE, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') return actionError('Missing document id.')

    const document = await prisma.document.findUnique({
      where: { id },
      select: {
        storageKey: true,
        fileName: true,
        uploadedById: true,
        leadId: true,
        clientId: true,
        requirementId: true,
        candidateId: true,
        submissionId: true,
        quotationId: true,
        contractId: true,
        invoiceId: true,
      },
    })
    if (!document) return actionError('That document no longer exists.')

    const target = targetFromRow(document)
    if (!target) return actionError('That document belongs to a record you cannot see.')

    const resolved = await resolveTarget(actor, target)
    if (!resolved) return actionError('That record no longer exists.')

    if (
      document.uploadedById !== actor.id &&
      !(await can(actor, PERMISSIONS.LEAD_DELETE))
    ) {
      return actionError('You can only remove documents you uploaded yourself.')
    }

    // Row first. A deleted row with an orphaned file wastes disk; a deleted
    // file with a live row is a download that 500s for everyone who tries it.
    await prisma.document.delete({ where: { id } })

    // The row is already gone, so the user's request has succeeded whatever
    // happens next. Letting a storage error propagate here would report a
    // failure for a deletion that did in fact happen, and the retry would then
    // fail on the missing row. Log the key instead, for reconciliation.
    try {
      await remove(document.storageKey)
    } catch (error) {
      console.error(
        '[documents] row deleted but file remains',
        document.storageKey,
        error,
      )
    }

    revalidatePath(resolved.path)
    return actionSuccess(`${document.fileName} removed.`)
  })
}
