import { prisma } from '@/lib/db'
import { can } from '@/lib/authz'
import { requireUser } from '@/lib/auth/session'
import { PERMISSIONS } from '@/lib/permissions'
import { Card } from '@/components/ui/page'
import { DocumentTable } from '@/components/documents/document-table'
import { UploadForm } from '@/components/documents/upload-form'
import { loadRequirement } from '../requirement'

type Params = Promise<{ id: string }>

export default async function RequirementDocumentsPage({
  params,
}: {
  params: Params
}) {
  const viewer = await requireUser()
  const { id } = await params
  const requirement = await loadRequirement(viewer, id)

  const [documents, canManage] = await Promise.all([
    prisma.document.findMany({
      where: { requirementId: requirement.id },
      select: {
        id: true,
        fileName: true,
        docType: true,
        description: true,
        sizeBytes: true,
        createdAt: true,
        uploadedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    can(viewer, PERMISSIONS.ACTIVITY_MANAGE),
  ])

  return (
    <Card
      title="Documents"
      description="The job description and anything else the client sent for this role. Downloads are checked against the same visibility rules as the requirement itself."
      actions={
        canManage ? (
          <UploadForm
            parent={{ kind: 'requirement', id: requirement.id }}
            // A requirement's attachments are overwhelmingly the JD. Resumes
            // belong on the candidate, where they are reusable across every
            // requirement that person is submitted to.
            defaultDocType="REQUIREMENT_DOC"
          />
        ) : null
      }
    >
      <DocumentTable documents={documents} canManage={canManage} />
    </Card>
  )
}
