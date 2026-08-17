'use client'

import { Field, Select } from '@/components/ui/field'
import type { CommercialLeadOption } from '@/lib/commercials/options'

/**
 * The lead a quotation, contract or invoice belongs to.
 *
 * When the parent is already fixed — arriving from the lead's own tab — the
 * control renders as a read-only statement plus a hidden input rather than a
 * one-option dropdown. A picker that can only be set to what it already says
 * invites the reader to check it, and there is nothing to check.
 */
export function LeadPicker({
  leads,
  lockedLead,
  truncated,
  error,
}: {
  leads: CommercialLeadOption[]
  lockedLead?: CommercialLeadOption
  /** The picker hit its cap, so the lead they want may not be in it. */
  truncated?: boolean
  error?: string
}) {
  if (lockedLead) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <input type="hidden" name="leadId" value={lockedLead.id} />
        <span className="font-medium text-slate-900">{lockedLead.leadCode}</span>
        <span className="text-slate-500">
          {' '}
          · {lockedLead.companyName} · {lockedLead.title}
        </span>
      </div>
    )
  }

  return (
    <Field
      label="Lead"
      htmlFor="leadId"
      required
      error={error}
      hint={
        truncated
          ? 'Showing the most recent leads only. If the one you want is missing, start from that lead’s own tab instead.'
          : undefined
      }
    >
      <Select id="leadId" name="leadId" defaultValue="" required>
        <option value="">Choose a lead…</option>
        {leads.map((lead) => (
          <option key={lead.id} value={lead.id}>
            {lead.leadCode} · {lead.companyName} · {lead.title}
          </option>
        ))}
      </Select>
    </Field>
  )
}
