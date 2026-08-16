'use client'

import { useRouter } from 'next/navigation'

import { Select } from '@/components/ui/field'

/**
 * Switches which vertical's stage list is shown.
 *
 * Navigates rather than filtering client-side, so the selection lives in the
 * URL and the page stays a server component — the stage rows come straight
 * from the database on each change.
 */
export function VerticalPicker({
  verticals,
  selectedId,
}: {
  verticals: Array<{ id: string; name: string; isActive: boolean }>
  selectedId: string
}) {
  const router = useRouter()

  return (
    <>
      <label htmlFor="vertical-picker" className="sr-only">
        Vertical
      </label>
      <Select
        id="vertical-picker"
        value={selectedId}
        onChange={(event) => {
          router.push(`/admin/master/stages?vertical=${event.target.value}`)
        }}
        className="h-8 w-auto py-0 text-xs"
      >
        {verticals.map((vertical) => (
          <option key={vertical.id} value={vertical.id}>
            {vertical.name}
            {vertical.isActive ? '' : ' (inactive)'}
          </option>
        ))}
      </Select>
    </>
  )
}
