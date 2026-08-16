import 'server-only'

import { prisma } from '@/lib/db'

/**
 * The simple master-data lists, described rather than hand-built.
 *
 * Seven of the `/admin/master/*` screens are the same screen: a table of named
 * rows with an inline add/edit form and a deactivate toggle. Writing them out
 * seven times produces seven places to fix the next bug in the edit flow, so
 * they share one page (`[entity]/page.tsx`) and one pair of server actions,
 * driven by this registry.
 *
 * What is *not* here: verticals and the stage lists. Those carry ordering,
 * common-stage mapping and behaviour flags whose validation is specific enough
 * that forcing them into this shape would cost more than it saves. They get
 * their own screens.
 *
 * Each entry keeps its own typed Prisma calls — the generic part is the UI and
 * the plumbing, not the queries, so nothing here reaches a model by string.
 */

export type MasterField = {
  name: string
  label: string
  type: 'text' | 'number' | 'select'
  required?: boolean
  hint?: string
  placeholder?: string
  /** Populated at request time for `select` fields. */
  optionsKey?: string
}

export type MasterRow = {
  id: string
  isActive: boolean
  /** Keyed by field name; what the inline form is populated with. */
  values: Record<string, string>
  /** Shown in the row's "In use" column, e.g. "12 leads". */
  usage: string
}

export type SaveFailure = { message: string; field?: string }

export type SelectOption = { value: string; label: string }

export type MasterEntity = {
  slug: string
  title: string
  /** Singular, lower case: "lead source". Used in generated messages. */
  noun: string
  description: string
  fields: MasterField[]
  loadOptions?: () => Promise<Record<string, SelectOption[]>>
  list: () => Promise<MasterRow[]>
  save: (
    id: string | null,
    values: Record<string, string>,
  ) => Promise<SaveFailure | null>
  setActive: (id: string, isActive: boolean) => Promise<void>
}

/** '' from a blank input means "not set", not "empty string". */
function orNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

async function verticalOptions(): Promise<SelectOption[]> {
  const verticals = await prisma.salesVertical.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { sortOrder: 'asc' },
  })
  return verticals.map((vertical) => ({
    value: vertical.id,
    label: vertical.name,
  }))
}

const leadSources: MasterEntity = {
  slug: 'sources',
  title: 'Lead sources',
  noun: 'lead source',
  description:
    'Where a lead came from. Leave the vertical blank for a source that applies everywhere — Referral, Website, and so on.',
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    {
      name: 'verticalId',
      label: 'Vertical',
      type: 'select',
      optionsKey: 'verticals',
      hint: 'Blank = all verticals',
    },
  ],
  loadOptions: async () => ({ verticals: await verticalOptions() }),
  list: async () => {
    const rows = await prisma.leadSource.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        verticalId: true,
        vertical: { select: { name: true } },
        _count: { select: { leads: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })

    return rows.map((row) => ({
      id: row.id,
      isActive: row.isActive,
      values: {
        name: row.name,
        verticalId: row.verticalId ?? '',
        // Read-only display value for the table cell.
        _verticalLabel: row.vertical?.name ?? 'All verticals',
      },
      usage: plural(row._count.leads, 'lead'),
    }))
  },
  save: async (id, values) => {
    const name = values.name?.trim() ?? ''
    const verticalId = orNull(values.verticalId)

    // `@@unique([name, verticalId])`, plus a partial index covering the NULL
    // case (migration 20260815190000). Filtering on `verticalId: null`
    // explicitly is what makes this findFirst match the same rows the index
    // constrains — omitting the key would match any vertical.
    const clash = await prisma.leadSource.findFirst({
      where: { name, verticalId },
    })
    if (clash && clash.id !== id) {
      return {
        message: 'That source already exists for that vertical.',
        field: 'name',
      }
    }

    if (id) {
      await prisma.leadSource.update({ where: { id }, data: { name, verticalId } })
    } else {
      await prisma.leadSource.create({ data: { name, verticalId } })
    }
    return null
  },
  setActive: async (id, isActive) => {
    await prisma.leadSource.update({ where: { id }, data: { isActive } })
  },
}

const lostReasons: MasterEntity = {
  slug: 'lost-reasons',
  title: 'Lost reasons',
  noun: 'lost reason',
  description:
    'Chosen when a lead or a staffing requirement is marked Lost. These drive the lost-reason breakdown in the Won/Lost report.',
  fields: [
    { name: 'name', label: 'Reason', type: 'text', required: true },
    {
      name: 'verticalId',
      label: 'Vertical',
      type: 'select',
      optionsKey: 'verticals',
      hint: 'Blank = all verticals',
    },
  ],
  loadOptions: async () => ({ verticals: await verticalOptions() }),
  list: async () => {
    const rows = await prisma.lostReason.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        verticalId: true,
        vertical: { select: { name: true } },
        _count: { select: { leads: true, requirements: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })

    return rows.map((row) => ({
      id: row.id,
      isActive: row.isActive,
      values: {
        name: row.name,
        verticalId: row.verticalId ?? '',
        _verticalLabel: row.vertical?.name ?? 'All verticals',
      },
      usage: `${plural(row._count.leads, 'lead')}, ${plural(row._count.requirements, 'requirement')}`,
    }))
  },
  save: async (id, values) => {
    const name = values.name?.trim() ?? ''
    const verticalId = orNull(values.verticalId)

    const clash = await prisma.lostReason.findFirst({
      where: { name, verticalId },
    })
    if (clash && clash.id !== id) {
      return {
        message: 'That reason already exists for that vertical.',
        field: 'name',
      }
    }

    if (id) {
      await prisma.lostReason.update({ where: { id }, data: { name, verticalId } })
    } else {
      await prisma.lostReason.create({ data: { name, verticalId } })
    }
    return null
  },
  setActive: async (id, isActive) => {
    await prisma.lostReason.update({ where: { id }, data: { isActive } })
  },
}

const services: MasterEntity = {
  slug: 'services',
  title: 'Services',
  noun: 'service',
  description:
    'The service a lead is asking about. Used by Digital Marketing and the general verticals.',
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'category', label: 'Category', type: 'text' },
  ],
  list: async () => {
    const rows = await prisma.service.findMany({
      select: {
        id: true,
        name: true,
        category: true,
        isActive: true,
        _count: { select: { leads: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })

    return rows.map((row) => ({
      id: row.id,
      isActive: row.isActive,
      values: { name: row.name, category: row.category ?? '' },
      usage: plural(row._count.leads, 'lead'),
    }))
  },
  save: async (id, values) => {
    const name = values.name?.trim() ?? ''
    const clash = await prisma.service.findUnique({ where: { name } })
    if (clash && clash.id !== id) {
      return { message: 'That service already exists.', field: 'name' }
    }

    const data = { name, category: orNull(values.category) }
    if (id) {
      await prisma.service.update({ where: { id }, data })
    } else {
      await prisma.service.create({ data })
    }
    return null
  },
  setActive: async (id, isActive) => {
    await prisma.service.update({ where: { id }, data: { isActive } })
  },
}

const products: MasterEntity = {
  slug: 'products',
  title: 'Products',
  noun: 'product',
  description:
    'The Product Sales catalogue. List price is the default that quotation line items start from.',
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'sku', label: 'SKU', type: 'text' },
    { name: 'category', label: 'Category', type: 'text' },
    {
      name: 'listPrice',
      label: 'List price (USD)',
      type: 'number',
      placeholder: '0.00',
    },
  ],
  list: async () => {
    const rows = await prisma.product.findMany({
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        listPrice: true,
        isActive: true,
        _count: { select: { leads: true, demos: true, quotationItems: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })

    return rows.map((row) => ({
      id: row.id,
      isActive: row.isActive,
      values: {
        name: row.name,
        sku: row.sku ?? '',
        category: row.category ?? '',
        // Decimal -> string, so the number input round-trips without the
        // float rounding a Number() cast would introduce.
        listPrice: row.listPrice ? row.listPrice.toString() : '',
      },
      // Quotation line items count too: the deactivation prompt tells the
      // administrator what still references this product, and omitting a
      // referencing table understates that.
      usage: `${plural(row._count.leads, 'lead')}, ${plural(row._count.demos, 'demo')}, ${plural(row._count.quotationItems, 'quote line')}`,
    }))
  },
  save: async (id, values) => {
    const name = values.name?.trim() ?? ''
    const sku = orNull(values.sku)

    const clash = await prisma.product.findUnique({ where: { name } })
    if (clash && clash.id !== id) {
      return { message: 'That product already exists.', field: 'name' }
    }

    if (sku) {
      const skuClash = await prisma.product.findUnique({ where: { sku } })
      if (skuClash && skuClash.id !== id) {
        return { message: 'That SKU is already in use.', field: 'sku' }
      }
    }

    const rawPrice = orNull(values.listPrice)
    if (rawPrice !== null && !/^\d+(\.\d{1,2})?$/.test(rawPrice)) {
      return {
        message: 'Enter a price as a number, with at most two decimal places.',
        field: 'listPrice',
      }
    }

    const data = {
      name,
      sku,
      category: orNull(values.category),
      listPrice: rawPrice,
    }

    if (id) {
      await prisma.product.update({ where: { id }, data })
    } else {
      await prisma.product.create({ data })
    }
    return null
  },
  setActive: async (id, isActive) => {
    await prisma.product.update({ where: { id }, data: { isActive } })
  },
}

const countries: MasterEntity = {
  slug: 'countries',
  title: 'Countries',
  noun: 'country',
  description: 'Client locations, used for the geography filters on reports.',
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    {
      name: 'isoCode',
      label: 'ISO code',
      type: 'text',
      required: true,
      hint: 'Two letters, e.g. US',
    },
    { name: 'dialCode', label: 'Dial code', type: 'text', placeholder: '+1' },
    { name: 'region', label: 'Region', type: 'text' },
  ],
  list: async () => {
    const rows = await prisma.country.findMany({
      select: {
        id: true,
        name: true,
        isoCode: true,
        dialCode: true,
        region: true,
        isActive: true,
        _count: { select: { clients: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })

    return rows.map((row) => ({
      id: row.id,
      isActive: row.isActive,
      values: {
        name: row.name,
        isoCode: row.isoCode,
        dialCode: row.dialCode ?? '',
        region: row.region ?? '',
      },
      usage: plural(row._count.clients, 'client'),
    }))
  },
  save: async (id, values) => {
    const name = values.name?.trim() ?? ''
    const isoCode = (values.isoCode?.trim() ?? '').toUpperCase()

    if (!/^[A-Z]{2}$/.test(isoCode)) {
      return {
        message: 'ISO code must be exactly two letters.',
        field: 'isoCode',
      }
    }

    const nameClash = await prisma.country.findUnique({ where: { name } })
    if (nameClash && nameClash.id !== id) {
      return { message: 'That country already exists.', field: 'name' }
    }

    const codeClash = await prisma.country.findUnique({ where: { isoCode } })
    if (codeClash && codeClash.id !== id) {
      return { message: 'That ISO code is already in use.', field: 'isoCode' }
    }

    const data = {
      name,
      isoCode,
      dialCode: orNull(values.dialCode),
      region: orNull(values.region),
    }

    if (id) {
      await prisma.country.update({ where: { id }, data })
    } else {
      await prisma.country.create({ data })
    }
    return null
  },
  setActive: async (id, isActive) => {
    await prisma.country.update({ where: { id }, data: { isActive } })
  },
}

const tags: MasterEntity = {
  slug: 'tags',
  title: 'Tags',
  noun: 'tag',
  description: 'Free-form labels for leads, on top of the structured fields.',
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    {
      name: 'colorHex',
      label: 'Colour',
      type: 'text',
      placeholder: '#64748B',
      hint: 'Hex, e.g. #64748B',
    },
  ],
  list: async () => {
    const rows = await prisma.tag.findMany({
      select: {
        id: true,
        name: true,
        colorHex: true,
        isActive: true,
        _count: { select: { leads: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })

    return rows.map((row) => ({
      id: row.id,
      isActive: row.isActive,
      values: { name: row.name, colorHex: row.colorHex ?? '' },
      usage: plural(row._count.leads, 'lead'),
    }))
  },
  save: async (id, values) => {
    const name = values.name?.trim() ?? ''
    const colorHex = orNull(values.colorHex)

    if (colorHex && !/^#[0-9a-fA-F]{6}$/.test(colorHex)) {
      return {
        message: 'Colour must be a six-digit hex value, e.g. #64748B.',
        field: 'colorHex',
      }
    }

    const clash = await prisma.tag.findUnique({ where: { name } })
    if (clash && clash.id !== id) {
      return { message: 'That tag already exists.', field: 'name' }
    }

    const data = { name, colorHex }
    if (id) {
      await prisma.tag.update({ where: { id }, data })
    } else {
      await prisma.tag.create({ data })
    }
    return null
  },
  setActive: async (id, isActive) => {
    await prisma.tag.update({ where: { id }, data: { isActive } })
  },
}

const requirementTypes: MasterEntity = {
  slug: 'requirement-types',
  title: 'Requirement types',
  noun: 'requirement type',
  description:
    'The engagement model for a staffing requirement — Full-time, Contract, C2H, Offshore.',
  fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
  list: async () => {
    const rows = await prisma.requirementType.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        _count: { select: { requirements: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })

    return rows.map((row) => ({
      id: row.id,
      isActive: row.isActive,
      values: { name: row.name },
      usage: plural(row._count.requirements, 'requirement'),
    }))
  },
  save: async (id, values) => {
    const name = values.name?.trim() ?? ''
    const clash = await prisma.requirementType.findUnique({ where: { name } })
    if (clash && clash.id !== id) {
      return { message: 'That requirement type already exists.', field: 'name' }
    }

    if (id) {
      await prisma.requirementType.update({ where: { id }, data: { name } })
    } else {
      await prisma.requirementType.create({ data: { name } })
    }
    return null
  },
  setActive: async (id, isActive) => {
    await prisma.requirementType.update({ where: { id }, data: { isActive } })
  },
}

export const MASTER_ENTITIES: MasterEntity[] = [
  leadSources,
  lostReasons,
  services,
  products,
  countries,
  requirementTypes,
  tags,
]

export function masterEntity(slug: string): MasterEntity | null {
  return MASTER_ENTITIES.find((entity) => entity.slug === slug) ?? null
}
