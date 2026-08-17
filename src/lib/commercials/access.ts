import 'server-only'

import { prisma } from '@/lib/db'
import { leadVisibilityFilter } from '@/lib/visibility'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * The lead behind a commercial record, looked up once and the same way
 * everywhere.
 *
 * Every action in this area takes a lead id from a form field, so the id is
 * never trustworthy on its own — the same reasoning `src/lib/attachments.ts`
 * gives for resolving an activity's parent before writing it. Doing the lookup
 * in one place is what keeps a new commercial screen from inventing a subtly
 * different scope check.
 *
 * The module switches come back with it because they are what decides whether
 * the record is allowed to exist at all: a quotation under a vertical with
 * `usesQuotations` off is not a validation error to be phrased per screen, it
 * is the same refusal every time.
 */
export async function leadForCommercials(user: CurrentUser, leadId: string) {
  return prisma.lead.findFirst({
    where: {
      id: leadId,
      isDeleted: false,
      ...(await leadVisibilityFilter(user)),
    },
    select: {
      id: true,
      leadCode: true,
      title: true,
      clientId: true,
      status: true,
      dealValue: true,
      client: { select: { id: true, companyName: true } },
      vertical: {
        select: {
          id: true,
          name: true,
          usesRequirements: true,
          usesDemos: true,
          usesQuotations: true,
          usesContracts: true,
          usesInvoicing: true,
        },
      },
    },
  })
}

export type CommercialLead = NonNullable<
  Awaited<ReturnType<typeof leadForCommercials>>
>

/**
 * The sentence a screen shows when a vertical has the module switched off.
 *
 * Written once because it says something an administrator can act on. "Product
 * Sales leads do not carry quotations" is a dead end; naming the switch and
 * where it lives turns it into a two-click fix.
 */
export function moduleOffMessage(
  verticalName: string,
  module: 'demos' | 'quotations' | 'contracts' | 'invoicing',
): string {
  return `${verticalName} leads do not use ${module}. It is a switch on the vertical in Master Data, so this appears wherever it is turned on.`
}
