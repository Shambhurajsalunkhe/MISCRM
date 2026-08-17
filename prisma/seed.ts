import 'dotenv/config'

import bcrypt from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../src/generated/prisma/client'
import type { CommonStage, UserRole } from '../src/generated/prisma/enums'

/**
 * Master data seed — Phase 1.
 *
 * Every value here comes from docs/02-funnels-and-metrics.md. The seed is
 * idempotent: it upserts, so re-running it after you have edited a stage name
 * in the admin UI will reset that row but never duplicate it.
 */

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})

// ---------------------------------------------------------------------------
// Permission defaults (mirrors src/lib/permissions.ts)
// ---------------------------------------------------------------------------

const PERMISSION_KEYS = [
  'lead.create',
  'lead.view',
  'lead.edit',
  'lead.stage',
  'lead.assign',
  'lead.commercial',
  'lead.delete',
  'prospecting.log',
  'activity.manage',
  'staffing.requirement.manage',
  'staffing.candidate.manage',
  'commercial.manage',
  'commercial.payment',
  'report.view',
  'report.revenue',
  'report.performance',
  'data.export',
  'admin.users',
  'admin.master',
  'admin.audit',
] as const

const BDE = [
  'lead.create',
  'lead.view',
  'lead.edit',
  'lead.assign',
  'prospecting.log',
  'activity.manage',
  'staffing.candidate.manage',
]

const BDM = [
  ...BDE,
  'lead.stage',
  'lead.commercial',
  'staffing.requirement.manage',
  'commercial.manage',
  'report.view',
  'report.revenue',
  'report.performance',
  'data.export',
]

const MANAGER = [...BDM, 'lead.delete', 'commercial.payment']
const SALES_HEAD = [...MANAGER, 'admin.users', 'admin.audit']
const ADMIN = [...PERMISSION_KEYS]

const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  BDE,
  BDM,
  MANAGER,
  SALES_HEAD,
  ADMIN,
}

// ---------------------------------------------------------------------------
// Verticals, stages and pre-lead counters
// ---------------------------------------------------------------------------

type StageSeed = {
  code: string
  name: string
  commonStage: CommonStage
  isWon?: boolean
  isLost?: boolean
  agingThresholdDays?: number
}

type MetricSeed = { key: string; label: string; isLeadTrigger?: boolean }

type VerticalSeed = {
  code: string
  name: string
  leadPrefix: string
  colorHex: string
  usesRequirements?: boolean
  usesCandidates?: boolean
  usesDemos?: boolean
  usesQuotations?: boolean
  usesContracts?: boolean
  metrics: MetricSeed[]
  stages: StageSeed[]
}

const WON: StageSeed = {
  code: 'WON',
  name: 'Won',
  commonStage: 'WON',
  isWon: true,
}
const LOST: StageSeed = {
  code: 'LOST',
  name: 'Lost',
  commonStage: 'LOST',
  isLost: true,
}

/** Shared tail used by LinkedIn, Email and Cold Calling. */
const OUTBOUND_TAIL: StageSeed[] = [
  {
    code: 'OPPORTUNITY_CREATED',
    name: 'Opportunity Created',
    commonStage: 'CONTACTED',
    agingThresholdDays: 7,
  },
  {
    code: 'REQUIREMENT_GATHERING',
    name: 'Requirement Gathering',
    commonStage: 'REQUIREMENT_GATHERING',
    agingThresholdDays: 10,
  },
  {
    code: 'PROPOSAL_SHARED',
    name: 'Proposal Shared',
    commonStage: 'PROPOSAL',
    agingThresholdDays: 14,
  },
  {
    code: 'NEGOTIATION',
    name: 'Negotiation',
    commonStage: 'NEGOTIATION',
    agingThresholdDays: 21,
  },
  WON,
  LOST,
]

const VERTICALS: VerticalSeed[] = [
  {
    code: 'UP',
    name: 'Upwork',
    leadPrefix: 'UP',
    colorHex: '#14A800',
    metrics: [
      {
        key: 'PITCHES_SUBMITTED',
        label: 'Pitches Submitted',
        isLeadTrigger: true,
      },
    ],
    stages: [
      {
        code: 'CLIENT_RESPONSE',
        name: 'Client Response',
        commonStage: 'NEW',
        agingThresholdDays: 5,
      },
      {
        code: 'REQUIREMENT_GATHERING',
        name: 'Requirement Gathering',
        commonStage: 'REQUIREMENT_GATHERING',
        agingThresholdDays: 10,
      },
      {
        code: 'ESTIMATION_SHARED',
        name: 'Estimation Shared',
        commonStage: 'PROPOSAL',
        agingThresholdDays: 14,
      },
      {
        code: 'NEGOTIATION',
        name: 'Negotiation',
        commonStage: 'NEGOTIATION',
        agingThresholdDays: 21,
      },
      WON,
      LOST,
    ],
  },
  {
    code: 'LI',
    name: 'LinkedIn',
    leadPrefix: 'LI',
    colorHex: '#0A66C2',
    metrics: [
      { key: 'PROSPECTS_IDENTIFIED', label: 'Prospects Identified' },
      { key: 'OUTREACH_SENT', label: 'Outreach Sent', isLeadTrigger: true },
    ],
    stages: [
      {
        code: 'RESPONSE_RECEIVED',
        name: 'Response Received',
        commonStage: 'NEW',
        agingThresholdDays: 5,
      },
      ...OUTBOUND_TAIL,
    ],
  },
  {
    code: 'EM',
    name: 'Email',
    leadPrefix: 'EM',
    colorHex: '#7C3AED',
    metrics: [
      { key: 'EMAILS_SENT', label: 'Emails Sent', isLeadTrigger: true },
    ],
    stages: [
      {
        code: 'RESPONSE_RECEIVED',
        name: 'Response Received',
        commonStage: 'NEW',
        agingThresholdDays: 5,
      },
      ...OUTBOUND_TAIL,
    ],
  },
  {
    code: 'CC',
    name: 'Cold Calling',
    leadPrefix: 'CC',
    colorHex: '#F59E0B',
    metrics: [
      { key: 'CALLS_MADE', label: 'Calls Made' },
      { key: 'CALLS_CONNECTED', label: 'Calls Connected', isLeadTrigger: true },
    ],
    stages: [
      {
        code: 'INTERESTED_PROSPECT',
        name: 'Interested Prospect',
        commonStage: 'NEW',
        agingThresholdDays: 5,
      },
      ...OUTBOUND_TAIL,
    ],
  },
  {
    code: 'ST',
    name: 'Staffing',
    leadPrefix: 'ST',
    colorHex: '#0EA5E9',
    usesRequirements: true,
    usesCandidates: true,
    metrics: [
      { key: 'CLIENT_OUTREACH', label: 'Client Outreach', isLeadTrigger: true },
    ],
    stages: [
      {
        code: 'CLIENT_RESPONDED',
        name: 'Client Responded',
        commonStage: 'NEW',
        agingThresholdDays: 7,
      },
      {
        code: 'ACTIVE_ACCOUNT',
        name: 'Active Account',
        commonStage: 'CONTACTED',
        agingThresholdDays: 30,
      },
      WON,
      LOST,
    ],
  },
  {
    code: 'DM',
    name: 'Digital Marketing',
    leadPrefix: 'DM',
    colorHex: '#EC4899',
    usesContracts: true,
    metrics: [
      { key: 'CAMPAIGNS_RUN', label: 'Campaigns Run' },
      {
        key: 'SERVICE_INQUIRIES',
        label: 'Service Inquiries',
        isLeadTrigger: true,
      },
    ],
    stages: [
      {
        code: 'LEAD_GENERATED',
        name: 'Lead Generated',
        commonStage: 'NEW',
        agingThresholdDays: 5,
      },
      {
        code: 'QUALIFIED_LEAD',
        name: 'Qualified Lead',
        commonStage: 'CONTACTED',
        agingThresholdDays: 7,
      },
      {
        code: 'REQUIREMENT_GATHERING',
        name: 'Requirement Gathering',
        commonStage: 'REQUIREMENT_GATHERING',
        agingThresholdDays: 10,
      },
      {
        code: 'PROPOSAL_SHARED',
        name: 'Proposal Shared',
        commonStage: 'PROPOSAL',
        agingThresholdDays: 14,
      },
      {
        code: 'NEGOTIATION',
        name: 'Negotiation',
        commonStage: 'NEGOTIATION',
        agingThresholdDays: 21,
      },
      WON,
      LOST,
    ],
  },
  {
    code: 'PR',
    name: 'Product Sales',
    leadPrefix: 'PR',
    colorHex: '#DC2626',
    usesDemos: true,
    usesQuotations: true,
    metrics: [],
    stages: [
      {
        code: 'PRODUCT_INQUIRY',
        name: 'Product Inquiry',
        commonStage: 'NEW',
        agingThresholdDays: 3,
      },
      {
        code: 'DEMO_SCHEDULED',
        name: 'Demo Scheduled',
        commonStage: 'CONTACTED',
        agingThresholdDays: 7,
      },
      {
        code: 'DEMO_COMPLETED',
        name: 'Demo Completed',
        commonStage: 'REQUIREMENT_GATHERING',
        agingThresholdDays: 7,
      },
      {
        code: 'QUOTATION_SHARED',
        name: 'Quotation Shared',
        commonStage: 'PROPOSAL',
        agingThresholdDays: 14,
      },
      {
        code: 'NEGOTIATION',
        name: 'Negotiation',
        commonStage: 'NEGOTIATION',
        agingThresholdDays: 21,
      },
      { code: 'WON', name: 'Order / Won', commonStage: 'WON', isWon: true },
      LOST,
    ],
  },
  {
    code: 'OT',
    name: 'Other Sources',
    leadPrefix: 'OT',
    colorHex: '#64748B',
    metrics: [],
    stages: [
      { code: 'NEW', name: 'New', commonStage: 'NEW', agingThresholdDays: 5 },
      {
        code: 'CONTACTED',
        name: 'Contacted',
        commonStage: 'CONTACTED',
        agingThresholdDays: 7,
      },
      {
        code: 'REQUIREMENT_GATHERING',
        name: 'Requirement Gathering',
        commonStage: 'REQUIREMENT_GATHERING',
        agingThresholdDays: 10,
      },
      {
        code: 'PROPOSAL_SHARED',
        name: 'Proposal Shared',
        commonStage: 'PROPOSAL',
        agingThresholdDays: 14,
      },
      {
        code: 'NEGOTIATION',
        name: 'Negotiation',
        commonStage: 'NEGOTIATION',
        agingThresholdDays: 21,
      },
      WON,
      LOST,
    ],
  },
]

// ---------------------------------------------------------------------------
// Staffing stage lists (README §15 and §16)
// ---------------------------------------------------------------------------

const REQUIREMENT_STAGES = [
  { code: 'REQUIREMENT_RECEIVED', name: 'Requirement Received' },
  { code: 'REQUIREMENT_QUALIFIED', name: 'Requirement Qualified' },
  { code: 'CANDIDATE_SOURCING', name: 'Candidate Sourcing' },
  { code: 'PROFILES_SHARED', name: 'Profiles Shared' },
  { code: 'CLIENT_SHORTLISTED', name: 'Client Shortlisted' },
  { code: 'INTERVIEW', name: 'Interview' },
  { code: 'SELECTION_OFFER', name: 'Selection / Offer' },
  { code: 'PLACEMENT', name: 'Placement', isWon: true },
  { code: 'LOST', name: 'Lost / Not Selected', isLost: true },
]

const CANDIDATE_STAGES = [
  { code: 'SOURCED', name: 'Sourced' },
  { code: 'PROFILE_SHARED', name: 'Profile Shared' },
  { code: 'CLIENT_REVIEWING', name: 'Client Reviewing' },
  { code: 'SHORTLISTED', name: 'Shortlisted' },
  { code: 'INTERVIEW_SCHEDULED', name: 'Interview Scheduled' },
  { code: 'INTERVIEW_COMPLETED', name: 'Interview Completed' },
  { code: 'SELECTED', name: 'Selected' },
  { code: 'OFFER', name: 'Offer' },
  { code: 'JOINED_PLACED', name: 'Joined / Placed', isPlaced: true },
  { code: 'REJECTED', name: 'Rejected', isRejected: true },
]

const REQUIREMENT_TYPES = [
  'Full-time',
  'Contract',
  'Contract to Hire',
  'Offshore',
]

const LOST_REASONS = [
  'Budget too high',
  'Timeline mismatch',
  'Lost to competitor',
  'No response from client',
  'Requirement cancelled',
  'Scope not a fit',
  'Client went in-house',
  'Other',
]

const COUNTRIES = [
  { name: 'United States', isoCode: 'US', dialCode: '+1', region: 'North America' },
  { name: 'Canada', isoCode: 'CA', dialCode: '+1', region: 'North America' },
  { name: 'United Kingdom', isoCode: 'GB', dialCode: '+44', region: 'Europe' },
  { name: 'Ireland', isoCode: 'IE', dialCode: '+353', region: 'Europe' },
  { name: 'Germany', isoCode: 'DE', dialCode: '+49', region: 'Europe' },
  { name: 'Netherlands', isoCode: 'NL', dialCode: '+31', region: 'Europe' },
  { name: 'United Arab Emirates', isoCode: 'AE', dialCode: '+971', region: 'Middle East' },
  { name: 'Saudi Arabia', isoCode: 'SA', dialCode: '+966', region: 'Middle East' },
  { name: 'Singapore', isoCode: 'SG', dialCode: '+65', region: 'Asia Pacific' },
  { name: 'Australia', isoCode: 'AU', dialCode: '+61', region: 'Asia Pacific' },
  { name: 'India', isoCode: 'IN', dialCode: '+91', region: 'Asia Pacific' },
]

const GENERIC_SOURCES = [
  'Referral',
  'Partner',
  'Website',
  'Direct Inquiry',
  'Existing Client',
  'LinkedIn',
  'Upwork',
  'YouTube',
  'Marketing',
  'Others',
]

/**
 * Sources that were seeded once and should no longer be offered.
 *
 * Deactivated rather than deleted: a lead that was recorded against one still
 * points at it, and deleting the row would either fail on the foreign key or
 * rewrite history that somebody reported on. `isActive: false` takes it out of
 * every picker while leaving those leads readable.
 */
const RETIRED_SOURCES = ['Event / Conference']

const APP_SETTINGS = [
  { key: 'currency', value: 'USD', description: 'Base reporting currency (decision D4)' },
  { key: 'currency.symbol', value: '$', description: 'Symbol shown in the UI' },
  { key: 'fiscal_year_start_month', value: '4', description: '1 = January' },
  { key: 'lead_code_padding', value: '4', description: 'UP-0001 uses 4 digits' },
  { key: 'dedupe.warn_on_contact_email', value: 'true', description: 'Warn when a contact email already exists' },
  { key: 'dedupe.warn_on_phone', value: 'true', description: 'Warn when a contact phone already exists' },
]

// ---------------------------------------------------------------------------

async function seedMasterData() {
  console.log('→ Countries')
  for (const country of COUNTRIES) {
    await prisma.country.upsert({
      where: { isoCode: country.isoCode },
      update: country,
      create: country,
    })
  }

  console.log('→ Verticals, stages and counters')
  for (const [index, vertical] of VERTICALS.entries()) {
    const { metrics, stages, ...verticalData } = vertical

    // Same reasoning as the stage flags below: spreading the literal would omit
    // an absent optional, so a module switched off here could never be switched
    // off in a database that already had it on.
    //
    // `usesInvoicing` is not in the seed literal at all — Q11 was answered on
    // 16 Aug 2026 with invoicing enabled for *every* vertical (docs/02 §5), so
    // there is nothing per-vertical left to say. It stays a column rather than
    // becoming a constant because an administrator turning it off for one
    // vertical has to remain a supported act; what the seed asserts is only the
    // starting position.
    const verticalRow = {
      ...verticalData,
      sortOrder: index,
      usesRequirements: vertical.usesRequirements ?? false,
      usesCandidates: vertical.usesCandidates ?? false,
      usesDemos: vertical.usesDemos ?? false,
      usesQuotations: vertical.usesQuotations ?? false,
      usesContracts: vertical.usesContracts ?? false,
      usesInvoicing: true,
    }

    const saved = await prisma.salesVertical.upsert({
      where: { code: vertical.code },
      update: verticalRow,
      create: verticalRow,
    })

    for (const [stageIndex, stage] of stages.entries()) {
      // Spreading the literal would omit absent optional flags, so an update
      // could never clear a flag that had moved to another stage. Default
      // every flag explicitly.
      const data = {
        code: stage.code,
        name: stage.name,
        commonStage: stage.commonStage,
        sortOrder: stageIndex,
        isWon: stage.isWon ?? false,
        isLost: stage.isLost ?? false,
        agingThresholdDays: stage.agingThresholdDays ?? null,
      }

      await prisma.pipelineStage.upsert({
        where: {
          verticalId_code: { verticalId: saved.id, code: stage.code },
        },
        update: data,
        create: { ...data, verticalId: saved.id },
      })
    }

    for (const [metricIndex, metric] of metrics.entries()) {
      const data = {
        key: metric.key,
        label: metric.label,
        sortOrder: metricIndex,
        isLeadTrigger: metric.isLeadTrigger ?? false,
      }

      await prisma.verticalMetric.upsert({
        where: { verticalId_key: { verticalId: saved.id, key: metric.key } },
        update: data,
        create: { ...data, verticalId: saved.id },
      })
    }
  }

  console.log('→ Requirement stages')
  for (const [index, stage] of REQUIREMENT_STAGES.entries()) {
    const data = {
      code: stage.code,
      name: stage.name,
      sortOrder: index,
      isWon: stage.isWon ?? false,
      isLost: stage.isLost ?? false,
    }

    await prisma.requirementStage.upsert({
      where: { code: stage.code },
      update: data,
      create: data,
    })
  }

  console.log('→ Candidate stages')
  for (const [index, stage] of CANDIDATE_STAGES.entries()) {
    const data = {
      code: stage.code,
      name: stage.name,
      sortOrder: index,
      isPlaced: stage.isPlaced ?? false,
      isRejected: stage.isRejected ?? false,
    }

    await prisma.candidateStage.upsert({
      where: { code: stage.code },
      update: data,
      create: data,
    })
  }

  console.log('→ Requirement types')
  for (const name of REQUIREMENT_TYPES) {
    await prisma.requirementType.upsert({
      where: { name },
      update: {},
      create: { name },
    })
  }

  console.log('→ Lead sources')
  for (const name of GENERIC_SOURCES) {
    const existing = await prisma.leadSource.findFirst({
      where: { name, verticalId: null },
    })
    if (!existing) {
      await prisma.leadSource.create({ data: { name } })
    } else if (!existing.isActive) {
      // A source that is back on the list is switched back on. Without this, a
      // name that was once retired could never return, because the row already
      // exists and the branch above would skip it.
      await prisma.leadSource.update({
        where: { id: existing.id },
        data: { isActive: true },
      })
    }
  }

  for (const name of RETIRED_SOURCES) {
    await prisma.leadSource.updateMany({
      where: { name, verticalId: null },
      data: { isActive: false },
    })
  }

  console.log('→ Lost reasons')
  for (const name of LOST_REASONS) {
    const existing = await prisma.lostReason.findFirst({
      where: { name, verticalId: null },
    })
    if (!existing) {
      await prisma.lostReason.create({ data: { name } })
    }
  }

  console.log('→ Role permissions')
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    for (const permission of PERMISSION_KEYS) {
      // Sync `allowed` on update as well as create, so changing a default in
      // src/lib/permissions.ts actually takes effect on re-seed.
      //
      // Trade-off worth knowing: this means re-running the seed RESETS any
      // toggles an administrator made in /admin/permissions. That matches how
      // every other master-data table here behaves, and matches what the docs
      // promise. If you want admin edits to survive a re-seed, this is the
      // line to change.
      await prisma.rolePermission.upsert({
        where: {
          role_permission: { role: role as UserRole, permission },
        },
        update: { allowed: permissions.includes(permission) },
        create: {
          role: role as UserRole,
          permission,
          allowed: permissions.includes(permission),
        },
      })
    }
  }

  console.log('→ App settings')
  for (const setting of APP_SETTINGS) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      update: { description: setting.description },
      create: setting,
    })
  }
}

async function seedAdminUser() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD

  if (!email || !password) {
    console.log(
      '→ Admin user SKIPPED — set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env',
    )
    return
  }

  if (password.length < 10) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters.')
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.log(`→ Admin user already exists (${email}) — left untouched`)
    return
  }

  await prisma.department.upsert({
    where: { name: 'Sales' },
    update: {},
    create: { name: 'Sales' },
  })

  await prisma.user.create({
    data: {
      name: 'Administrator',
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'ADMIN',
      designation: 'System Administrator',
    },
  })

  console.log(`→ Admin user created (${email})`)
}

async function main() {
  console.log('Seeding master data…\n')
  await seedMasterData()
  await seedAdminUser()
  console.log('\nDone.')
}

main()
  .catch((error) => {
    console.error('\nSeed failed:\n', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
