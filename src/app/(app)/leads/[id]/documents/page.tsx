import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { Card } from '@/components/ui/page'
import { DocumentTable } from '@/components/documents/document-table'
import { UploadForm } from '@/components/documents/upload-form'
import { loadLead } from '../lead'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Documents · Sales CRM' }

export default async function LeadDocumentsPage({ params }: { params: Params }) {
  const viewer = await requireUser()
  const { id } = await params
  const lead = await loadLead(viewer, id)

  const [documents, canManage] = await Promise.all([
    prisma.document.findMany({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        docType: true,
        description: true,
        sizeBytes: true,
        createdAt: true,
        uploadedBy: { select: { name: true } },
      },
    }),
    can(viewer, PERMISSIONS.ACTIVITY_MANAGE),
  ])

  return (
    <Card
      title="Documents"
      description="Requirement documents, proposals, estimates and chat transcripts. Downloads are checked against the same visibility rules as the lead itself."
      actions={
        canManage ? (
          <UploadForm
            parent={{ kind: 'lead', id: lead.id }}
            // Staffing leads collect resumes; everyone else starts at the
            // requirement document. A default that is right most of the time
            // beats one that is right never.
            defaultDocType={
              lead.vertical.usesCandidates ? 'RESUME' : 'REQUIREMENT_DOC'
            }
          />
        ) : null
      }
    >
      <DocumentTable documents={documents} canManage={canManage} />
    </Card>
  )
}
