/**
 * Which sections the lead form shows, per vertical (README §6).
 *
 * Driven by the module switches on `SalesVertical` wherever one exists, and by
 * the vertical's `code` only for the labelling that has no switch behind it. A
 * new vertical added in Master Data therefore gets a working form immediately —
 * the common pipeline with a generic reference field — rather than falling
 * through to nothing.
 *
 * The alternative, a hard-coded map of the eight verticals, would have made
 * "Verticals are editable master data" (README §33) untrue the moment somebody
 * added a ninth.
 */

export type VerticalModules = {
  code: string
  name: string
  usesRequirements: boolean
  usesCandidates: boolean
  usesDemos: boolean
  usesQuotations: boolean
  usesContracts: boolean
  usesInvoicing: boolean
}

export type LeadFormLayout = {
  /** Catalogue picker: a service for delivery work, a product for Product Sales. */
  catalogue: 'service' | 'product' | 'none'
  showCampaign: boolean
  reference: { label: string; hint?: string } | null
  /** Shown under the header: what happens to this lead after it is created. */
  afterCreateNote: string | null
}

/** Per-code labels for the one free-text URL field the schema gives us. */
const REFERENCE_LABELS: Record<string, { label: string; hint?: string }> = {
  UP: { label: 'Upwork job URL', hint: 'The posting this pitch answered.' },
  LI: { label: 'LinkedIn profile or post URL' },
  EM: { label: 'Reference URL', hint: 'Landing page or campaign link, if there was one.' },
  CC: { label: 'Reference URL' },
  ST: { label: 'Job description URL' },
  DM: { label: 'Landing page URL' },
  PR: { label: 'Product page URL' },
  OT: { label: 'Referral or website URL' },
}

export function leadFormLayout(vertical: VerticalModules): LeadFormLayout {
  return {
    catalogue: vertical.usesDemos || vertical.usesQuotations
      ? 'product'
      : 'service',

    // Campaigns are what Digital Marketing counts leads against, and contracts
    // are the switch that identifies it. Anywhere else the field is noise.
    showCampaign: vertical.usesContracts,

    reference: REFERENCE_LABELS[vertical.code] ?? { label: 'Reference URL' },

    afterCreateNote: vertical.usesRequirements
      ? 'Individual requirements (REQ-001, REQ-002…) are added to this lead after it is created — one client can raise several at once.'
      : vertical.usesDemos
        ? 'Demos are recorded against this lead once it exists; one inquiry can hold several.'
        : null,
  }
}
