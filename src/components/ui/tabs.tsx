'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/cn'

export type TabItem = {
  label: string
  href: string
  /** Shown as a count beside the label, e.g. the number of documents. */
  count?: number
  /**
   * Match this href only when the path is exactly equal. Needed for a tab set
   * whose first entry is the parent of every other — `/leads/[id]` would
   * otherwise stay highlighted while `/leads/[id]/timeline` is open.
   */
  exact?: boolean
}

/**
 * A row of links styled as tabs.
 *
 * Links rather than client-side state: each tab is a real URL, so a lead's
 * timeline can be linked to directly, the back button works, and every tab is
 * a server component that fetches only its own data.
 */
export function LinkTabs({ tabs }: { tabs: TabItem[] }) {
  const pathname = usePathname()

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`)

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition',
              active
                ? 'border-slate-900 font-medium text-slate-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' ? (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-xs',
                  active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
