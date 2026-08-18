import { ROLE_SHORT_LABELS } from '@/lib/roles'
import type { UserRole } from '@/generated/prisma/enums'
import { Badge } from '@/components/ui/badge'

export type HierarchyUser = {
  id: string
  name: string
  role: UserRole
  isActive: boolean
  reportingManagerId: string | null
  teamName: string | null
}

type Node = HierarchyUser & { reports: Node[] }

/**
 * Build the reporting tree.
 *
 * Anyone whose manager is missing from the set is treated as a root, so a user
 * pointing at a deleted manager still appears rather than vanishing. Cycles are
 * broken by only ever attaching a node once — `saveUserAction` rejects them at
 * entry, but this renders whatever is actually in the database, including rows
 * that predate that check.
 */
function buildTree(users: HierarchyUser[]): Node[] {
  const nodes = new Map<string, Node>(
    users.map((user) => [user.id, { ...user, reports: [] }]),
  )
  const roots: Node[] = []
  const attached = new Set<string>()

  for (const node of nodes.values()) {
    const parent = node.reportingManagerId
      ? nodes.get(node.reportingManagerId)
      : undefined

    if (!parent || parent.id === node.id) {
      roots.push(node)
      continue
    }

    // Walk up from the parent: if we come back to this node, the edge would
    // close a loop, so leave the node as a root instead of losing it.
    let cursor: Node | undefined = parent
    let cyclic = false
    for (let depth = 0; cursor && depth < 50; depth += 1) {
      if (cursor.id === node.id) {
        cyclic = true
        break
      }
      cursor = cursor.reportingManagerId
        ? nodes.get(cursor.reportingManagerId)
        : undefined
    }

    if (cyclic) {
      roots.push(node)
    } else {
      parent.reports.push(node)
      attached.add(node.id)
    }
  }

  const byName = (a: Node, b: Node) => a.name.localeCompare(b.name)
  for (const node of nodes.values()) node.reports.sort(byName)

  return roots.filter((node) => !attached.has(node.id)).sort(byName)
}

function Branch({ node }: { node: Node }) {
  return (
    <li className="relative pl-4 before:absolute before:left-0 before:top-3.5 before:h-px before:w-2.5 before:bg-slate-200">
      <div className="flex flex-wrap items-center gap-2 py-1.5">
        <a
          href={`/admin/users/${node.id}`}
          className="text-sm font-medium text-slate-900 hover:underline"
        >
          {node.name}
        </a>
        <Badge tone={node.role === 'ADMIN' ? 'info' : 'neutral'}>
          {ROLE_SHORT_LABELS[node.role]}
        </Badge>
        {node.teamName ? (
          <span className="text-xs text-slate-500">{node.teamName}</span>
        ) : null}
        {node.isActive ? null : (
          <Badge tone="warning">Inactive</Badge>
        )}
      </div>

      {node.reports.length > 0 ? (
        <ul className="ml-1 border-l border-slate-200">
          {node.reports.map((child) => (
            <Branch key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function ReportingHierarchy({ users }: { users: HierarchyUser[] }) {
  const roots = buildTree(users)

  if (roots.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No users yet. Add people on the Users tab and set their reporting
        manager.
      </p>
    )
  }

  return (
    <>
      <ul>
        {roots.map((node) => (
          <Branch key={node.id} node={node} />
        ))}
      </ul>
      <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
        This tree is what data visibility is derived from: a BDM sees their own
        records plus everything belonging to anyone beneath them here, and
        anyone in a team they manage.
      </p>
    </>
  )
}
