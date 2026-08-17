import 'server-only'

import { prisma } from '@/lib/db'
import { recordAudit } from '@/lib/audit/record'
import { booleanSetting } from '@/lib/settings'

/**
 * The de-duplication step in the flowchart's Lead Intake band
 * (docs/01-data-model.md §1).
 *
 * Two different mechanisms, doing two different jobs:
 *
 *  - **`dedupeKey` is a unique constraint.** Normalised client name plus email
 *    domain. Creating a second `Acme Corp` on `acme.com` is refused outright,
 *    because that is not a second company — it is the same account entered
 *    twice, and splitting one client's leads across two rows breaks every
 *    per-client roll-up the CRM exists to produce.
 *  - **Everything else warns.** A matching contact email, phone or company
 *    LinkedIn is *evidence* of a duplicate, not proof: agencies share switchboard
 *    numbers and one person genuinely does move between companies. These surface
 *    as a warning the user can read and proceed past, which is what the settings
 *    screen's own description promises ("These warn; they never block").
 *
 * The warnings are what /admin/settings toggles. The unique constraint is not
 * negotiable and has no switch.
 */

export type DuplicateWarning = {
  /** What matched, phrased for someone who has not seen the other record. */
  message: string
  /** Where to look, when the match is a record the user may open. */
  href?: string
}

/**
 * Record that someone saved past a duplicate warning, and why.
 *
 * docs/01-data-model.md §1 requires the override to be audited, and each form
 * that offers one tells the user in as many words that the reason is kept. The
 * ORM writer cannot see it — no column changed to record the decision — so it
 * is written explicitly, against the record that was created in spite of the
 * warning, with the warnings it was created in spite of.
 *
 * Lives here rather than beside one of the three call sites so that none of
 * them can quietly forget it: the promise is made by the shared warning UI, so
 * the keeping of it belongs next to the code that finds the duplicates.
 */
export async function recordDuplicateOverride(input: {
  entityType: 'CLIENT' | 'CONTACT' | 'CANDIDATE'
  entityId: string
  reason: string
  warnings: DuplicateWarning[]
  userId: string
}): Promise<void> {
  await recordAudit({
    entityType: input.entityType,
    entityId: input.entityId,
    action: 'CREATE',
    fieldName: '(duplicate override)',
    oldValue: input.warnings.map((warning) => warning.message).join(' | '),
    newValue: input.reason,
    userId: input.userId,
  })
}

/**
 * Normalised client identity.
 *
 * Built from `clientName`, not `companyName`: the company is optional now, and a
 * unique key that most rows leave blank collapses them onto one value.
 *
 * Lower-cased, punctuation-stripped, and with the suffixes that differ between
 * two spellings of the same company removed — `Acme Corp.`, `ACME Corporation`
 * and `Acme Inc` all collapse to `acme`. The email domain is appended when
 * there is one, so two genuinely unrelated clients called Apex still get
 * distinct keys as long as their contacts have addresses.
 */
export function buildDedupeKey(
  clientName: string,
  emailDomain: string | null,
): string {
  const name = clientName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(
      /\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|pvt|private|plc|llp|sa|bv|ag)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()

  // An empty name after stripping — "Ltd." on its own — would collapse every
  // such client onto one key and make the second one unsavable. Fall back to
  // the raw text, which is at least distinct.
  const base = name === '' ? clientName.toLowerCase().trim() : name

  return emailDomain ? `${base}@${emailDomain}` : base
}

/** The domain half of an email address, lower-cased. `null` if there isn't one. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at < 0 || at === email.length - 1) return null
  return email.slice(at + 1).toLowerCase().trim() || null
}

/**
 * Digits only, last ten kept.
 *
 * `+1 (415) 555-0134`, `0014155550134` and `415-555-0134` are the same phone
 * number written by three people. Comparing the last ten digits matches them
 * without needing to know each country's trunk prefix rules — and because this
 * only ever produces a *warning*, an occasional false match costs a sentence on
 * screen rather than a refused save.
 */
export function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 7 ? digits.slice(-10) : null
}

/**
 * The two columns a contact's phone number occupies, from one input.
 *
 * `phone` keeps what the user typed, because that is what they want to read
 * back. `phoneNormalised` carries the comparison form. Every write path builds
 * both through this, so the two cannot drift — a row saved with a stale
 * `phoneNormalised` is a row the duplicate check silently stops seeing.
 *
 * The backfill in the `contact_phone_normalised` migration applies the same
 * rule in SQL; if this function changes, that rule has to be re-applied.
 */
export function contactPhoneFields(phone: string | null): {
  phone: string | null
  phoneNormalised: string | null
} {
  return { phone, phoneNormalised: normalisePhone(phone) }
}

/** Compare hostnames, ignoring scheme, `www.` and trailing slashes. */
export function normaliseUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim().toLowerCase()
  if (trimmed === '') return null

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    const host = parsed.hostname.replace(/^www\./, '')
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${host}${path}`
  } catch {
    return trimmed
  }
}

/**
 * Look for signs that this client already exists.
 *
 * `excludeClientId` is set when editing, so a client is never reported as a
 * duplicate of itself.
 */
export async function findClientDuplicates(input: {
  clientName: string
  companyName?: string | null
  website?: string | null
  companyLinkedIn?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  excludeClientId?: string | null
}): Promise<DuplicateWarning[]> {
  const warnings: DuplicateWarning[] = []
  const notSelf = input.excludeClientId
    ? { id: { not: input.excludeClientId } }
    : {}

  const nameMatch = await prisma.client.findFirst({
    where: {
      ...notSelf,
      isDeleted: false,
      clientName: { equals: input.clientName.trim(), mode: 'insensitive' },
    },
    select: { id: true, clientName: true, clientCode: true },
  })

  if (nameMatch) {
    warnings.push({
      message: `${nameMatch.clientName} (${nameMatch.clientCode}) already exists with this client name.`,
      href: `/clients/${nameMatch.id}`,
    })
  }

  // The company is a warning, never the key. Two people at the same firm are two
  // legitimate clients on Upwork and one account in Staffing, and only the person
  // filling the form knows which — but they cannot decide what they are not told.
  const company = input.companyName?.trim()
  if (company) {
    const companyMatch = await prisma.client.findFirst({
      where: {
        ...notSelf,
        isDeleted: false,
        companyName: { equals: company, mode: 'insensitive' },
      },
      select: { id: true, clientName: true, clientCode: true },
    })

    if (companyMatch) {
      warnings.push({
        message: `${companyMatch.clientName} (${companyMatch.clientCode}) is already recorded at ${company}.`,
        href: `/clients/${companyMatch.id}`,
      })
    }
  }

  const website = normaliseUrl(input.website)
  const linkedIn = normaliseUrl(input.companyLinkedIn)

  // `contains` on the normalised host rather than an equality test: the stored
  // value is whatever the user typed, so `https://acme.com/` must still match a
  // stored `acme.com`.
  for (const [value, label] of [
    [website, 'website'],
    [linkedIn, 'LinkedIn page'],
  ] as const) {
    if (!value) continue

    const match = await prisma.client.findFirst({
      where: {
        ...notSelf,
        isDeleted: false,
        ...(label === 'website'
          ? { website: { contains: value, mode: 'insensitive' as const } }
          : { companyLinkedIn: { contains: value, mode: 'insensitive' as const } }),
      },
      select: { id: true, clientName: true, clientCode: true },
    })

    if (match) {
      warnings.push({
        message: `${match.clientName} (${match.clientCode}) has the same ${label}.`,
        href: `/clients/${match.id}`,
      })
    }
  }

  warnings.push(
    ...(await findContactDuplicates({
      email: input.contactEmail,
      phone: input.contactPhone,
      excludeClientId: input.excludeClientId,
    })),
  )

  return warnings
}

/**
 * Signs that this person is already in the candidate master.
 *
 * Warnings only — there is no `dedupeKey` equivalent for a candidate, and there
 * should not be. Two people genuinely do share a name, and a hard constraint
 * would make the second one unrecordable; the cost of a duplicate candidate is
 * a Candidates Sourced figure that counts one person twice, which is worth a
 * sentence on screen rather than a refused save. Decision D9's reuse depends on
 * the recruiter *seeing* the existing profile, which is what this produces.
 *
 * Honours the same two /admin/settings switches as the contact check: they say
 * "warn on a matching email" and "warn on a matching phone number" without
 * naming which table, and having candidates ignore them would make the settings
 * screen's own description untrue.
 */
export async function findCandidateDuplicates(input: {
  email?: string | null
  phone?: string | null
  excludeCandidateId?: string | null
}): Promise<DuplicateWarning[]> {
  const warnings: DuplicateWarning[] = []
  const notSelf = input.excludeCandidateId
    ? { id: { not: input.excludeCandidateId } }
    : {}

  const email = input.email?.trim().toLowerCase()
  if (email && (await booleanSetting('dedupe.warn_on_contact_email', true))) {
    const match = await prisma.candidate.findFirst({
      where: { ...notSelf, isDeleted: false, email: { equals: email, mode: 'insensitive' } },
      select: { id: true, fullName: true, candidateCode: true },
    })

    if (match) {
      warnings.push({
        message: `${match.fullName} (${match.candidateCode}) already uses ${email}.`,
        href: `/candidates/${match.id}`,
      })
    }
  }

  const phone = normalisePhone(input.phone)
  if (phone && (await booleanSetting('dedupe.warn_on_phone', true))) {
    const match = await prisma.candidate.findFirst({
      where: { ...notSelf, isDeleted: false, phoneNormalised: phone },
      select: { id: true, fullName: true, candidateCode: true, phone: true },
    })

    if (match) {
      warnings.push({
        message: `${match.fullName} (${match.candidateCode}) has a matching phone number (${match.phone}).`,
        href: `/candidates/${match.id}`,
      })
    }
  }

  return warnings
}

/**
 * Contact-level warnings — the two rows an administrator can switch off in
 * /admin/settings under "Duplicate detection".
 */
export async function findContactDuplicates(input: {
  email?: string | null
  phone?: string | null
  excludeContactId?: string | null
  excludeClientId?: string | null
}): Promise<DuplicateWarning[]> {
  const warnings: DuplicateWarning[] = []

  const notSelf = input.excludeContactId
    ? { id: { not: input.excludeContactId } }
    : {}
  const notSameClient = input.excludeClientId
    ? { clientId: { not: input.excludeClientId } }
    : {}

  const email = input.email?.trim().toLowerCase()
  if (email && (await booleanSetting('dedupe.warn_on_contact_email', true))) {
    const match = await prisma.clientContact.findFirst({
      where: {
        ...notSelf,
        ...notSameClient,
        email: { equals: email, mode: 'insensitive' },
        client: { isDeleted: false },
      },
      select: { id: true, name: true, client: { select: { id: true, clientName: true } } },
    })

    if (match) {
      warnings.push({
        message: `${match.name} at ${match.client.clientName} already uses ${email}.`,
        href: `/clients/${match.client.id}`,
      })
    }
  }

  const phone = normalisePhone(input.phone)
  if (phone && (await booleanSetting('dedupe.warn_on_phone', true))) {
    // Equality against the normalised column, which is indexed. This used to
    // be `phone: { contains: phone }` against the *formatted* column — digits
    // on one side, `+1 (415) 555-0134` on the other, so it matched nothing and
    // the warning never fired for any number anyone had punctuated.
    const match = await prisma.clientContact.findFirst({
      where: {
        ...notSelf,
        ...notSameClient,
        phoneNormalised: phone,
        client: { isDeleted: false },
      },
      select: { id: true, name: true, phone: true, client: { select: { id: true, clientName: true } } },
    })

    if (match) {
      warnings.push({
        message: `${match.name} at ${match.client.clientName} has a matching phone number (${match.phone}).`,
        href: `/clients/${match.client.id}`,
      })
    }
  }

  return warnings
}
