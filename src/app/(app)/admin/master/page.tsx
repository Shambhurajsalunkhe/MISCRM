import Link from 'next/link'

import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { AccessDenied } from '@/components/access-denied'
import { PageHeader } from '@/components/ui/page'
import { MASTER_ENTITIES } from './registry'

export const metadata = { title: 'Master data · Sales CRM' }

/**
 * The two screens that are not registry-driven, because their rows carry
 * behaviour rather than just a name. See the note at the top of registry.ts.
 */
const BESPOKE = [
  {
    href: '/admin/master/verticals',
    title: 'Verticals',
    description:
      'The eight acquisition channels, their lead-code prefixes and which modules each one exposes.',
  },
  {
    href: '/admin/master/stages',
    title: 'Stages',
    description:
      'Pipeline stages per vertical with their common-stage mapping and aging thresholds, plus the requirement and candidate stage lists.',
  },
]

export default async function MasterDataPage() {
  const viewer = await pageAccess(PERMISSIONS.ADMIN_MASTER)
  if (!viewer) return <AccessDenied what="master data" />

  const [
    verticalCount,
    stageCount,
    sourceCount,
    lostReasonCount,
    productCount,
    countryCount,
    requirementTypeCount,
    tagCount,
  ] = await Promise.all([
    prisma.salesVertical.count({ where: { isActive: true } }),
    prisma.pipelineStage.count({ where: { isActive: true } }),
    prisma.leadSource.count({ where: { isActive: true } }),
    prisma.lostReason.count({ where: { isActive: true } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.country.count({ where: { isActive: true } }),
    prisma.requirementType.count({ where: { isActive: true } }),
    prisma.tag.count({ where: { isActive: true } }),
  ])

  const counts: Record<string, number> = {
    '/admin/master/verticals': verticalCount,
    '/admin/master/stages': stageCount,
    sources: sourceCount,
    'lost-reasons': lostReasonCount,
    products: productCount,
    countries: countryCount,
    'requirement-types': requirementTypeCount,
    tags: tagCount,
  }

  const cards = [
    ...BESPOKE.map((item) => ({ ...item, count: counts[item.href] ?? 0 })),
    ...MASTER_ENTITIES.map((entity) => ({
      href: `/admin/master/${entity.slug}`,
      title: entity.title,
      description: entity.description,
      count: counts[entity.slug] ?? 0,
    })),
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Master data"
        description="The lists every other screen picks from. Rows are deactivated rather than deleted, so historical records keep the value they were saved with."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-xs"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 group-hover:underline">
                {card.title}
              </h2>
              <span className="shrink-0 text-xs text-slate-500">
                {card.count} active
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              {card.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
