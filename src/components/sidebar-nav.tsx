'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { NavSection } from '@/lib/navigation'

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SidebarNav({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.heading}>
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {section.heading}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'block rounded-md bg-slate-800 px-2 py-1.5 text-sm font-medium text-white'
                        : 'block rounded-md px-2 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800/60 hover:text-white'
                    }
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
