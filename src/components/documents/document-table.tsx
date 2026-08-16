import { DOCUMENT_TYPE_LABELS } from '@/lib/document-types'
import { formatBytes } from '@/lib/storage'
import { formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { RowAction } from '@/components/row-action'
import { deleteDocumentAction } from '@/server/documents'
import type { DocumentType } from '@/generated/prisma/enums'

export type DocumentRow = {
  id: string
  fileName: string
  docType: DocumentType
  description: string | null
  sizeBytes: number
  createdAt: Date
  uploadedBy: { name: string }
}

export function DocumentTable({
  documents,
  canManage,
}: {
  documents: DocumentRow[]
  canManage: boolean
}) {
  if (documents.length === 0) {
    return <EmptyState>No documents attached yet.</EmptyState>
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>File</TH>
          <TH>Type</TH>
          <TH>Size</TH>
          <TH>Uploaded</TH>
          {canManage ? (
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          ) : null}
        </TR>
      </THead>
      <TBody>
        {documents.map((document) => (
          <TR key={document.id}>
            <TD>
              {/* Served by a route handler that re-checks visibility, not from
                  a public path — see src/app/api/documents/[id]/route.ts. */}
              <a
                href={`/api/documents/${document.id}`}
                className="font-medium text-slate-900 hover:underline"
              >
                {document.fileName}
              </a>
              {document.description ? (
                <div className="text-xs text-slate-500">
                  {document.description}
                </div>
              ) : null}
            </TD>
            <TD>
              <Badge>{DOCUMENT_TYPE_LABELS[document.docType]}</Badge>
            </TD>
            <TD className="text-slate-600">{formatBytes(document.sizeBytes)}</TD>
            <TD className="text-slate-600">
              {formatDate(document.createdAt)}
              <div className="text-xs text-slate-500">
                {document.uploadedBy.name}
              </div>
            </TD>
            {canManage ? (
              <TD>
                <div className="flex justify-end">
                  <RowAction
                    action={deleteDocumentAction}
                    id={document.id}
                    label="Remove"
                    confirmMessage={`Remove ${document.fileName}? The file is deleted from storage.`}
                  />
                </div>
              </TD>
            ) : null}
          </TR>
        ))}
      </TBody>
    </Table>
  )
}
