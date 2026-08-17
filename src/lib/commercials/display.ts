import type { BadgeTone } from '@/components/ui/badge'
import type {
  BillingCycle,
  ContractStatus,
  DemoStatus,
  InvoiceStatus,
  PaymentMode,
  QuotationStatus,
} from '@/generated/prisma/enums'

/**
 * Labels and tones for the commercial records — the same job
 * `src/lib/leads/display.ts` and `src/lib/staffing/display.ts` do one level up.
 *
 * Money statuses appear on more screens than anything else in this app: the
 * register, the detail page, the lead's Commercials tab, the client page and
 * every revenue figure that explains itself. One mapping is what stops OVERDUE
 * being red on the register and amber on the lead.
 */

export const DEMO_STATUS_LABELS: Record<DemoStatus, string> = {
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
  NO_SHOW: 'No show',
  RESCHEDULED: 'Rescheduled',
  CANCELLED: 'Cancelled',
}

export const DEMO_STATUS_TONES: Record<DemoStatus, BadgeTone> = {
  SCHEDULED: 'info',
  COMPLETED: 'success',
  NO_SHOW: 'warning',
  RESCHEDULED: 'warning',
  CANCELLED: 'neutral',
}

export const DEMO_STATUSES: DemoStatus[] = [
  'SCHEDULED',
  'COMPLETED',
  'NO_SHOW',
  'RESCHEDULED',
  'CANCELLED',
]

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
}

export const QUOTATION_STATUS_TONES: Record<QuotationStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'warning',
}

export const QUOTATION_STATUSES: QuotationStatus[] = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
]

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  SIGNED: 'Signed',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  TERMINATED: 'Terminated',
}

export const CONTRACT_STATUS_TONES: Record<ContractStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  SIGNED: 'success',
  ACTIVE: 'success',
  COMPLETED: 'neutral',
  TERMINATED: 'danger',
}

export const CONTRACT_STATUSES: ContractStatus[] = [
  'DRAFT',
  'SENT',
  'SIGNED',
  'ACTIVE',
  'COMPLETED',
  'TERMINATED',
]

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  ONE_TIME: 'One-time',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  MILESTONE: 'Per milestone',
  RETAINER: 'Retainer',
}

export const BILLING_CYCLES: BillingCycle[] = [
  'ONE_TIME',
  'MONTHLY',
  'QUARTERLY',
  'MILESTONE',
  'RETAINER',
]

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  PENDING: 'Pending',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
}

export const INVOICE_STATUS_TONES: Record<InvoiceStatus, BadgeTone> = {
  PENDING: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: 'neutral',
}

/**
 * README §19 names four statuses; CANCELLED is the fifth the schema carries so
 * that an invoice raised in error can stop counting without being deleted out
 * from under its receipts. It sits last for that reason.
 */
export const INVOICE_STATUSES: InvoiceStatus[] = [
  'PENDING',
  'PARTIALLY_PAID',
  'OVERDUE',
  'PAID',
  'CANCELLED',
]

/** The statuses that still owe money — what Pending Revenue is drawn from. */
export const INVOICE_OPEN_STATUSES: InvoiceStatus[] = [
  'PENDING',
  'PARTIALLY_PAID',
  'OVERDUE',
]

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  BANK_TRANSFER: 'Bank transfer',
  WIRE: 'Wire',
  UPWORK: 'Upwork',
  PAYPAL: 'PayPal',
  STRIPE: 'Stripe',
  CHEQUE: 'Cheque',
  CASH: 'Cash',
  OTHER: 'Other',
}

export const PAYMENT_MODES: PaymentMode[] = [
  'BANK_TRANSFER',
  'WIRE',
  'UPWORK',
  'PAYPAL',
  'STRIPE',
  'CHEQUE',
  'CASH',
  'OTHER',
]
