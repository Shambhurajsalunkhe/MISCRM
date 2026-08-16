/**
 * The settings an administrator may edit, and how to render each one.
 *
 * `AppSetting` is a key/value table, so nothing about a row tells the UI
 * whether it holds a month number, a boolean or free text. That belongs here
 * rather than in the database: a setting the application no longer reads
 * should disappear from this screen even if the row is still present, and a
 * new one should be editable the moment the code that reads it ships.
 *
 * Keys match the seed in prisma/seed.ts.
 */
export type SettingDefinition = {
  key: string
  label: string
  hint: string
  type: 'text' | 'boolean' | 'select'
  options?: Array<{ value: string; label: string }>
  /** Applied after trimming, before validation and storage. */
  normalise?: (value: string) => string
  validate?: (value: string) => string | null
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export const SETTING_GROUPS: Array<{
  heading: string
  description: string
  settings: SettingDefinition[]
}> = [
  {
    heading: 'Money and dates',
    description:
      'All monetary values are stored in a single currency (decision D4). Changing the code here relabels the UI; it does not convert anything already recorded.',
    settings: [
      {
        key: 'currency',
        label: 'Currency code',
        hint: 'Three letters, e.g. USD.',
        type: 'text',
        // ISO 4217 codes are upper case. Storing "usd" would leave every
        // formatter to normalise it again, or not.
        normalise: (value) => value.toUpperCase(),
        validate: (value) =>
          /^[A-Z]{3}$/.test(value) ? null : 'Three letters, e.g. USD.',
      },
      {
        key: 'currency.symbol',
        label: 'Currency symbol',
        hint: 'Shown beside amounts.',
        type: 'text',
        validate: (value) =>
          value.length >= 1 && value.length <= 4
            ? null
            : 'One to four characters.',
      },
      {
        key: 'fiscal_year_start_month',
        label: 'Fiscal year starts',
        hint: 'Drives the year-to-date ranges on reports.',
        type: 'select',
        options: MONTHS.map((month, index) => ({
          value: String(index + 1),
          label: month,
        })),
      },
    ],
  },
  {
    heading: 'Lead codes',
    description:
      'Lead codes read PREFIX-0001, with the prefix set per vertical. Existing codes are never rewritten.',
    settings: [
      {
        key: 'lead_code_padding',
        label: 'Digits in a lead code',
        hint: '4 gives UP-0001. Only affects codes issued from now on.',
        type: 'select',
        options: [3, 4, 5, 6].map((digits) => ({
          value: String(digits),
          label: `${digits} — UP-${'1'.padStart(digits, '0')}`,
        })),
      },
    ],
  },
  {
    heading: 'Duplicate detection',
    description:
      'Checked while a client or lead is being created. These warn; they never block, because a genuine second enquiry from the same company is normal.',
    settings: [
      {
        key: 'dedupe.warn_on_contact_email',
        label: 'Warn when a contact email already exists',
        hint: '',
        type: 'boolean',
      },
      {
        key: 'dedupe.warn_on_phone',
        label: 'Warn when a contact phone number already exists',
        hint: '',
        type: 'boolean',
      },
    ],
  },
]

export const SETTING_DEFINITIONS: SettingDefinition[] = SETTING_GROUPS.flatMap(
  (group) => group.settings,
)

export function settingDefinition(key: string): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((definition) => definition.key === key)
}
