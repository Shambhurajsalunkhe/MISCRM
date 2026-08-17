import 'server-only'

import { cache } from 'react'
import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'
import { leadChildVisibilityFilter } from '@/lib/visibility'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * The quotation behind the detail screen.
 *
 * `notFound()` rather than a forbidden page, for the reason `loadLead` gives: a
 * quotation outside this user's scope has to be indistinguishable from one that
 * does not exist, or the 403 itself confirms that a quote with that id is out
 * there.
 */
export const loadQuotation = cache(async (user: CurrentUser, id: string) => {
  const quotation = await prisma.quotation.findFirst({
    where: { id, ...(await leadChildVisibilityFilter(user)) },
    select: {
      id: true,
      quoteNumber: true,
      quoteDate: true,
      validUntil: true,
      subtotal: true,
      discount: true,
      taxAmount: true,
      totalAmount: true,
      status: true,
      notes: true,
      createdAt: true,
      leadId: true,
      lead: {
        select: {
          id: true,
          leadCode: true,
          title: true,
          status: true,
          dealValue: true,
          client: { select: { id: true, clientName: true } },
          assignedTo: { select: { name: true } },
          vertical: { select: { name: true, usesInvoicing: true } },
        },
      },
      items: {
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          product: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
      },
      invoices: {
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          amountPending: true,
          amountReceived: true,
          dueDate: true,
          status: true,
        },
        orderBy: { invoiceDate: 'asc' },
      },
      documents: {
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
      },
    },
  })

  if (!quotation) notFound()

  return quotation
})
