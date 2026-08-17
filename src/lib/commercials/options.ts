import 'server-only'

import { prisma } from '@/lib/db'
import { leadVisibilityFilter } from '@/lib/visibility'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * The lead picker the three commercial "new" forms share.
 *
 * Filtered by the module switch rather than by vertical code, so a vertical
 * that starts quoting appears here the moment an administrator ticks the box —
 * the same rule `src/lib/leads/vertical-form.ts` and the funnel builder follow.
 *
 * Capped like every other picker in this app, and for the same reason: a
 * typeahead is the real answer and is worth building once, and the usual route
 * in is the lead's own tab, where no picker is rendered at all.
 */
export const LEAD_PICKER_LIMIT = 500

export type CommercialModule = 'usesQuotations' | 'usesContracts' | 'usesInvoicing'

export type CommercialLeadOption = {
  id: string
  leadCode: string
  title: string
  clientName: string
}

export async function commercialLeadOptions(
  user: CurrentUser,
  module: CommercialModule,
): Promise<CommercialLeadOption[]> {
  const leads = await prisma.lead.findMany({
    where: {
      isDeleted: false,
      vertical: { [module]: true, isActive: true },
      ...(await leadVisibilityFilter(user)),
    },
    select: {
      id: true,
      leadCode: true,
      title: true,
      client: { select: { clientName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LEAD_PICKER_LIMIT,
  })

  return leads.map((lead) => ({
    id: lead.id,
    leadCode: lead.leadCode,
    title: lead.title,
    clientName: lead.client.clientName,
  }))
}

/**
 * One lead named in a `?lead=` query string, re-checked against the viewer's
 * scope and the module switch.
 *
 * Never trusted from the URL: the id arrives in something anyone can edit, and
 * a form that locked itself to whatever was typed there would attach a real
 * invoice to a lead the user cannot see.
 */
export async function lockedLeadOption(
  user: CurrentUser,
  leadId: string | undefined,
  module: CommercialModule,
): Promise<CommercialLeadOption | null> {
  if (!leadId) return null

  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      isDeleted: false,
      vertical: { [module]: true },
      ...(await leadVisibilityFilter(user)),
    },
    select: {
      id: true,
      leadCode: true,
      title: true,
      client: { select: { clientName: true } },
    },
  })

  return lead
    ? {
        id: lead.id,
        leadCode: lead.leadCode,
        title: lead.title,
        clientName: lead.client.clientName,
      }
    : null
}

export type InvoiceSourceOption = {
  /** `kind:id`, or the literal `lead` — one field carrying an exclusive choice. */
  value: string
  label: string
  /** Suggested amount, so the common case is one click rather than re-typing. */
  amount: string | null
}

/**
 * What an invoice on this lead can be raised against.
 *
 * The schema gives `Invoice` three nullable parents of which at most one is set
 * (docs/01 §3) — a contract for Digital Marketing, an accepted quotation for
 * Product Sales, a placement for Staffing. They are offered together in one
 * list because a lead has whichever of them its vertical produces, and a form
 * with three empty pickers would ask the user to know which of them applies.
 *
 * "Nothing in particular" is a real option, not a fallback for missing data.
 * Q11 turned invoicing on for Upwork, LinkedIn, Email, Cold Calling and Other
 * Sources, and none of those five produces a contract, a quote or a placement —
 * their invoices bill the deal itself.
 */
export async function invoiceSourceOptions(
  leadId: string,
): Promise<InvoiceSourceOption[]> {
  const [contracts, quotations, placements] = await Promise.all([
    prisma.contract.findMany({
      where: { leadId, status: { not: 'TERMINATED' } },
      select: { id: true, contractNumber: true, contractValue: true },
      orderBy: { createdAt: 'desc' },
    }),
    // Drafts are left out: a draft is a working document, and billing against
    // one would put a price in front of a client that nobody has sent them.
    prisma.quotation.findMany({
      where: { leadId, status: { in: ['SENT', 'ACCEPTED'] } },
      select: {
        id: true,
        quoteNumber: true,
        totalAmount: true,
        status: true,
      },
      orderBy: { quoteDate: 'desc' },
    }),
    prisma.placement.findMany({
      where: { leadId, reversedAt: null },
      select: {
        id: true,
        placementValue: true,
        candidate: { select: { fullName: true } },
        requirement: { select: { requirementCode: true } },
      },
      orderBy: { joiningDate: 'desc' },
    }),
  ])

  return [
    ...contracts.map((contract) => ({
      value: `contract:${contract.id}`,
      label: `Contract ${contract.contractNumber}`,
      amount: contract.contractValue.toString(),
    })),
    ...quotations.map((quotation) => ({
      value: `quotation:${quotation.id}`,
      label: `Quotation ${quotation.quoteNumber}${quotation.status === 'SENT' ? ' (sent, not yet accepted)' : ''}`,
      amount: quotation.totalAmount.toString(),
    })),
    ...placements.map((placement) => ({
      value: `placement:${placement.id}`,
      label: `Placement — ${placement.candidate.fullName} on ${placement.requirement.requirementCode}`,
      amount: placement.placementValue.toString(),
    })),
    { value: 'lead', label: 'Nothing in particular — bill the deal', amount: null },
  ]
}

export function productOptions() {
  return prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}
