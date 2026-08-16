import type { EntityType } from '@/generated/prisma/enums'

/**
 * Which Prisma models the audit writer records, and how.
 *
 * Membership of this map is the switch: a model that is absent is simply not
 * audited. That is deliberate for three groups —
 *
 *  - history tables (`LeadStageHistory`, `RequirementStageHistory`, …) are
 *    themselves the record of what changed, so auditing them would duplicate
 *    every transition;
 *  - transient rows (`Notification`, `LeadSequence`) carry no decision;
 *  - `AuditLog` itself, which would recurse.
 */
export type AuditedModel = {
  entityType: EntityType
  /** Primary key column. Everything uses `id` except `AppSetting`. */
  idField: string
  /**
   * Never written to the audit trail. Secrets, and blobs whose diff would be
   * unreadable anyway.
   */
  redact?: readonly string[]
  /** Columns whose churn is noise rather than a decision. */
  ignore?: readonly string[]
  /** Field to show as the row's name in the audit viewer. */
  labelField?: string
}

/** Columns present on nearly every model that say nothing on their own. */
const TIMESTAMPS = ['createdAt', 'updatedAt'] as const

export const AUDITED_MODELS: Record<string, AuditedModel> = {
  // --- Organisation & access -----------------------------------------------
  User: {
    entityType: 'USER',
    idField: 'id',
    // `passwordHash` must never reach the audit table — a hash in a log that
    // Sales Head can read is a hash that has left its blast radius. `lastLoginAt`
    // would otherwise write an audit row on every single sign-in.
    redact: ['passwordHash'],
    ignore: [...TIMESTAMPS, 'lastLoginAt'],
    labelField: 'name',
  },
  Team: { entityType: 'TEAM', idField: 'id', ignore: TIMESTAMPS, labelField: 'name' },
  Department: {
    entityType: 'DEPARTMENT',
    idField: 'id',
    ignore: TIMESTAMPS,
    labelField: 'name',
  },
  RolePermission: {
    entityType: 'ROLE_PERMISSION',
    idField: 'id',
    labelField: 'permission',
  },

  // --- Master data ----------------------------------------------------------
  SalesVertical: {
    entityType: 'SALES_VERTICAL',
    idField: 'id',
    ignore: TIMESTAMPS,
    labelField: 'name',
  },
  PipelineStage: {
    entityType: 'PIPELINE_STAGE',
    idField: 'id',
    labelField: 'name',
  },
  VerticalMetric: {
    entityType: 'VERTICAL_METRIC',
    idField: 'id',
    labelField: 'label',
  },
  RequirementStage: {
    entityType: 'REQUIREMENT_STAGE',
    idField: 'id',
    labelField: 'name',
  },
  CandidateStage: {
    entityType: 'CANDIDATE_STAGE',
    idField: 'id',
    labelField: 'name',
  },
  RequirementType: {
    entityType: 'REQUIREMENT_TYPE',
    idField: 'id',
    labelField: 'name',
  },
  LeadSource: { entityType: 'LEAD_SOURCE', idField: 'id', labelField: 'name' },
  LostReason: { entityType: 'LOST_REASON', idField: 'id', labelField: 'name' },
  Service: { entityType: 'SERVICE', idField: 'id', labelField: 'name' },
  Product: { entityType: 'PRODUCT', idField: 'id', labelField: 'name' },
  Country: { entityType: 'COUNTRY', idField: 'id', labelField: 'name' },
  Tag: { entityType: 'TAG', idField: 'id', labelField: 'name' },
  AppSetting: {
    entityType: 'APP_SETTING',
    idField: 'key',
    ignore: ['updatedAt'],
    labelField: 'key',
  },
  EmailTemplate: {
    entityType: 'EMAIL_TEMPLATE',
    idField: 'id',
    ignore: TIMESTAMPS,
    labelField: 'name',
  },

  // --- Sales records (screens land in Phases 2-5; the writer is ready now) --
  Client: { entityType: 'CLIENT', idField: 'id', ignore: TIMESTAMPS, labelField: 'companyName' },
  ClientContact: { entityType: 'CONTACT', idField: 'id', ignore: TIMESTAMPS, labelField: 'name' },
  Lead: { entityType: 'LEAD', idField: 'id', ignore: TIMESTAMPS, labelField: 'leadCode' },
  Requirement: { entityType: 'REQUIREMENT', idField: 'id', ignore: TIMESTAMPS, labelField: 'requirementCode' },
  Candidate: { entityType: 'CANDIDATE', idField: 'id', ignore: TIMESTAMPS, labelField: 'fullName' },
  CandidateSubmission: { entityType: 'SUBMISSION', idField: 'id', ignore: TIMESTAMPS },
  Demo: { entityType: 'DEMO', idField: 'id', ignore: TIMESTAMPS },
  Quotation: { entityType: 'QUOTATION', idField: 'id', ignore: TIMESTAMPS, labelField: 'quoteNumber' },
  Contract: { entityType: 'CONTRACT', idField: 'id', ignore: TIMESTAMPS, labelField: 'contractNumber' },
  Invoice: { entityType: 'INVOICE', idField: 'id', ignore: TIMESTAMPS, labelField: 'invoiceNumber' },
  Payment: { entityType: 'PAYMENT', idField: 'id', ignore: TIMESTAMPS },
  ProspectingActivity: { entityType: 'PROSPECTING_ACTIVITY', idField: 'id', ignore: TIMESTAMPS },
}

export function auditedModel(model: string | undefined): AuditedModel | null {
  if (!model) return null
  return AUDITED_MODELS[model] ?? null
}

/** Human-readable labels for the audit viewer's entity filter. */
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  LEAD: 'Lead',
  CLIENT: 'Client',
  CONTACT: 'Contact',
  REQUIREMENT: 'Requirement',
  CANDIDATE: 'Candidate',
  SUBMISSION: 'Submission',
  DEMO: 'Demo',
  QUOTATION: 'Quotation',
  CONTRACT: 'Contract',
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
  USER: 'User',
  PROSPECTING_ACTIVITY: 'Prospecting activity',
  TEAM: 'Team',
  DEPARTMENT: 'Department',
  ROLE_PERMISSION: 'Role permission',
  SALES_VERTICAL: 'Vertical',
  PIPELINE_STAGE: 'Pipeline stage',
  VERTICAL_METRIC: 'Vertical metric',
  REQUIREMENT_STAGE: 'Requirement stage',
  CANDIDATE_STAGE: 'Candidate stage',
  REQUIREMENT_TYPE: 'Requirement type',
  LEAD_SOURCE: 'Lead source',
  LOST_REASON: 'Lost reason',
  SERVICE: 'Service',
  PRODUCT: 'Product',
  COUNTRY: 'Country',
  TAG: 'Tag',
  APP_SETTING: 'App setting',
  EMAIL_TEMPLATE: 'Email template',
}
