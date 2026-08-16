import { LinkTabs } from '@/components/ui/tabs'

export default function ProspectingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="space-y-5">
      <LinkTabs
        tabs={[
          { label: 'Enter counters', href: '/prospecting', exact: true },
          { label: 'Summary', href: '/prospecting/summary' },
        ]}
      />
      {children}
    </div>
  )
}
