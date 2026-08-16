import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/session'
import { resolveTarget, targetFromRow } from '@/lib/attachments'
import { etagFor, read, safeFileName } from '@/lib/storage'

/**
 * Download one document.
 *
 * A route handler rather than a static file under `public/`, because the answer
 * to "may I have this file" is the same answer as "may I see the lead it hangs
 * off" — and only this side of the app knows it. The `storageKey` is not a
 * capability: knowing it gets you nothing without a session that can see the
 * parent record.
 *
 * Everything is served as an attachment. An uploaded SVG or HTML file rendered
 * inline would execute as this origin, with the signed-in user's cookie.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return new Response('Unauthorised', { status: 401 })

  const { id } = await params

  const document = await prisma.document.findUnique({
    where: { id },
    select: {
      fileName: true,
      mimeType: true,
      storageKey: true,
      leadId: true,
      clientId: true,
      requirementId: true,
      candidateId: true,
      submissionId: true,
    },
  })

  // 404 for both "gone" and "not yours". A 403 would confirm that a document
  // with this id exists, which is exactly what the visibility rules withhold.
  if (!document) return new Response('Not found', { status: 404 })

  const target = targetFromRow(document)

  if (!target || !(await resolveTarget(user, target))) {
    return new Response('Not found', { status: 404 })
  }

  let bytes: Buffer
  try {
    bytes = await read(document.storageKey)
  } catch (error) {
    console.error('[documents] stored file missing', id, error)
    return new Response('Not found', { status: 404 })
  }

  const etag = etagFor(bytes)
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } })
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename="${safeFileName(document.fileName)}"`,
      // `private` because the permission check above is per user: a shared
      // cache holding this response would serve it to the next person.
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
    },
  })
}
