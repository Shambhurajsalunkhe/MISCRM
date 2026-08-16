import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { AccessDenied } from '@/components/access-denied'
import { ActiveToggle } from '@/components/active-toggle'
import { ActiveBadge, Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  saveCandidateStageAction,
  saveRequirementStageAction,
  setPipelineStageActiveAction,
} from './actions'
import { COMMON_STAGE_LABELS } from './common-stages'
import { MoveStage } from './move-stage'
import { PipelineStageForm } from './pipeline-stage-form'
import { SimpleStageForm } from './simple-stage-form'
import { VerticalPicker } from './vertical-picker'

export const metadata = { title: 'Stages · Sales CRM' }

export default async function StagesPage({
  searchParams,
}: {
  searchParams: Promise<{ vertical?: string; edit?: string; list?: string }>
}) {
  const viewer = await pageAccess(PERMISSIONS.ADMIN_MASTER)
  if (!viewer) return <AccessDenied what="master data" />

  const { vertical, edit, list } = await searchParams

  const verticals = await prisma.salesVertical.findMany({
    select: { id: true, name: true, code: true, isActive: true },
    orderBy: { sortOrder: 'asc' },
  })

  const selectedVertical =
    verticals.find((item) => item.id === vertical) ?? verticals[0]

  const [stages, requirementStages, candidateStages] = await Promise.all([
    selectedVertical
      ? prisma.pipelineStage.findMany({
          where: { verticalId: selectedVertical.id },
          select: {
            id: true,
            name: true,
            code: true,
            commonStage: true,
            sortOrder: true,
            isWon: true,
            isLost: true,
            isActive: true,
            agingThresholdDays: true,
            _count: { select: { leadsAtStage: true } },
          },
          orderBy: { sortOrder: 'asc' },
        })
      : Promise.resolve([]),
    prisma.requirementStage.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        sortOrder: true,
        isWon: true,
        isLost: true,
        isActive: true,
        agingThresholdDays: true,
        _count: { select: { requirements: true } },
      },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.candidateStage.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        sortOrder: true,
        isPlaced: true,
        isRejected: true,
        isActive: true,
        _count: { select: { submissions: true } },
      },
      orderBy: { sortOrder: 'asc' },
    }),
  ])

  const baseHref = selectedVertical
    ? `/admin/master/stages?vertical=${selectedVertical.id}`
    : '/admin/master/stages'

  const hasWon = stages.some((stage) => stage.isWon)
  const hasLost = stages.some((stage) => stage.isLost)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stages"
        description="Each vertical has its own stage list. The common-stage column is the mapping that lets the all-vertical pipeline chart work without anyone entering a status twice (decision D5)."
        actions={
          <ButtonLink href="/admin/master" variant="secondary">
            All master data
          </ButtonLink>
        }
      />

      <Card
        title="Pipeline stages"
        description="Ordered top to bottom. The aging threshold is the number of days after which a lead sitting here is flagged in the Pipeline Aging report."
        actions={
          <div className="flex gap-2">
            <VerticalPicker
              verticals={verticals}
              selectedId={selectedVertical?.id ?? ''}
            />
            {edit === 'new' || !selectedVertical ? null : (
              <ButtonLink href={`${baseHref}&edit=new`} size="sm">
                Add stage
              </ButtonLink>
            )}
          </div>
        }
      >
        {!selectedVertical ? (
          <p className="text-sm text-slate-500">
            No verticals yet. Add one on the Verticals screen first.
          </p>
        ) : (
          <div className="space-y-3">
            {hasWon && hasLost ? null : (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {selectedVertical.name} has no{' '}
                {!hasWon && !hasLost
                  ? 'winning or losing'
                  : !hasWon
                    ? 'winning'
                    : 'losing'}{' '}
                stage. Leads in this vertical cannot be closed, and every
                conversion percentage for it will read zero.
              </p>
            )}

            {edit === 'new' ? (
              <PipelineStageForm verticalId={selectedVertical.id} />
            ) : null}

            <Table>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>Stage</TH>
                  <TH>Common stage</TH>
                  <TH>Aging</TH>
                  <TH>Outcome</TH>
                  <TH>Leads here</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>

              <TBody>
                {stages.map((stage, index) => (
                  <TR key={stage.id}>
                    {edit === stage.id ? (
                      <TD colSpan={8}>
                        <PipelineStageForm
                          verticalId={selectedVertical.id}
                          stage={{
                            id: stage.id,
                            name: stage.name,
                            code: stage.code,
                            commonStage: stage.commonStage,
                            agingThresholdDays: stage.agingThresholdDays,
                            isWon: stage.isWon,
                            isLost: stage.isLost,
                          }}
                        />
                      </TD>
                    ) : (
                      <>
                        <TD>
                          <div className="flex items-center">
                            <MoveStage
                              id={stage.id}
                              direction="up"
                              disabled={index === 0}
                            />
                            <MoveStage
                              id={stage.id}
                              direction="down"
                              disabled={index === stages.length - 1}
                            />
                          </div>
                        </TD>
                        <TD>
                          <span className="font-medium text-slate-900">
                            {stage.name}
                          </span>
                          <div className="font-mono text-xs text-slate-400">
                            {stage.code}
                          </div>
                        </TD>
                        <TD className="text-slate-600">
                          {COMMON_STAGE_LABELS[stage.commonStage] ??
                            stage.commonStage}
                        </TD>
                        <TD className="text-slate-600">
                          {stage.agingThresholdDays === null
                            ? '—'
                            : `${stage.agingThresholdDays} days`}
                        </TD>
                        <TD>
                          {stage.isWon ? <Badge tone="success">Won</Badge> : null}
                          {stage.isLost ? <Badge tone="danger">Lost</Badge> : null}
                          {!stage.isWon && !stage.isLost ? (
                            <span className="text-slate-400">—</span>
                          ) : null}
                        </TD>
                        <TD className="text-slate-600">
                          {stage._count.leadsAtStage}
                        </TD>
                        <TD>
                          <ActiveBadge active={stage.isActive} />
                        </TD>
                        <TD>
                          <div className="flex justify-end gap-1">
                            <ButtonLink
                              href={`${baseHref}&edit=${stage.id}`}
                              variant="ghost"
                              size="sm"
                            >
                              Edit
                            </ButtonLink>
                            <ActiveToggle
                              action={setPipelineStageActiveAction}
                              id={stage.id}
                              isActive={stage.isActive}
                              confirmMessage={
                                stage.isActive
                                  ? `Deactivate ${stage.name}? It stops being an option when moving a lead forward. Stage history already recorded against it is kept.`
                                  : `Reactivate ${stage.name}?`
                              }
                            />
                          </div>
                        </TD>
                      </>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      <Card
        title="Requirement stages"
        description="One global list for every staffing requirement. Outcome and revenue live here rather than on the lead (decision D8), so this is where a placement is recorded."
        actions={
          list === 'requirement-new' ? null : (
            <ButtonLink href={`${baseHref}&list=requirement-new`} size="sm">
              Add stage
            </ButtonLink>
          )
        }
      >
        <div className="space-y-3">
          {list === 'requirement-new' ? (
            <SimpleStageForm
              action={saveRequirementStageAction}
              flags={[
                { name: 'isWon', label: 'Placement' },
                { name: 'isLost', label: 'Lost' },
              ]}
              showAging
              cancelHref={baseHref}
            />
          ) : null}

          <Table>
            <THead>
              <TR>
                <TH>Stage</TH>
                <TH>Aging</TH>
                <TH>Outcome</TH>
                <TH>In use</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {requirementStages.map((stage) => (
                <TR key={stage.id}>
                  {list === `requirement-${stage.id}` ? (
                    <TD colSpan={6}>
                      <SimpleStageForm
                        action={saveRequirementStageAction}
                        stage={{
                          id: stage.id,
                          name: stage.name,
                          code: stage.code,
                          agingThresholdDays: stage.agingThresholdDays,
                          flags: { isWon: stage.isWon, isLost: stage.isLost },
                        }}
                        flags={[
                          { name: 'isWon', label: 'Placement' },
                          { name: 'isLost', label: 'Lost' },
                        ]}
                        showAging
                        cancelHref={baseHref}
                      />
                    </TD>
                  ) : (
                    <>
                      <TD>
                        <span className="font-medium text-slate-900">
                          {stage.name}
                        </span>
                        <div className="font-mono text-xs text-slate-400">
                          {stage.code}
                        </div>
                      </TD>
                      <TD className="text-slate-600">
                        {stage.agingThresholdDays === null
                          ? '—'
                          : `${stage.agingThresholdDays} days`}
                      </TD>
                      <TD>
                        {stage.isWon ? (
                          <Badge tone="success">Placement</Badge>
                        ) : null}
                        {stage.isLost ? <Badge tone="danger">Lost</Badge> : null}
                        {!stage.isWon && !stage.isLost ? (
                          <span className="text-slate-400">—</span>
                        ) : null}
                      </TD>
                      <TD className="text-slate-600">
                        {stage._count.requirements}
                      </TD>
                      <TD>
                        <ActiveBadge active={stage.isActive} />
                      </TD>
                      <TD>
                        <div className="flex justify-end">
                          <ButtonLink
                            href={`${baseHref}&list=requirement-${stage.id}`}
                            variant="ghost"
                            size="sm"
                          >
                            Edit
                          </ButtonLink>
                        </div>
                      </TD>
                    </>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </Card>

      <Card
        title="Candidate stages"
        description="The per-submission pipeline: one candidate submitted to two requirements sits at a different stage in each (decision D9)."
        actions={
          list === 'candidate-new' ? null : (
            <ButtonLink href={`${baseHref}&list=candidate-new`} size="sm">
              Add stage
            </ButtonLink>
          )
        }
      >
        <div className="space-y-3">
          {list === 'candidate-new' ? (
            <SimpleStageForm
              action={saveCandidateStageAction}
              flags={[
                { name: 'isPlaced', label: 'Placed' },
                { name: 'isRejected', label: 'Rejected' },
              ]}
              showAging={false}
              cancelHref={baseHref}
            />
          ) : null}

          <Table>
            <THead>
              <TR>
                <TH>Stage</TH>
                <TH>Outcome</TH>
                <TH>In use</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {candidateStages.map((stage) => (
                <TR key={stage.id}>
                  {list === `candidate-${stage.id}` ? (
                    <TD colSpan={5}>
                      <SimpleStageForm
                        action={saveCandidateStageAction}
                        stage={{
                          id: stage.id,
                          name: stage.name,
                          code: stage.code,
                          flags: {
                            isPlaced: stage.isPlaced,
                            isRejected: stage.isRejected,
                          },
                        }}
                        flags={[
                          { name: 'isPlaced', label: 'Placed' },
                          { name: 'isRejected', label: 'Rejected' },
                        ]}
                        showAging={false}
                        cancelHref={baseHref}
                      />
                    </TD>
                  ) : (
                    <>
                      <TD>
                        <span className="font-medium text-slate-900">
                          {stage.name}
                        </span>
                        <div className="font-mono text-xs text-slate-400">
                          {stage.code}
                        </div>
                      </TD>
                      <TD>
                        {stage.isPlaced ? (
                          <Badge tone="success">Placed</Badge>
                        ) : null}
                        {stage.isRejected ? (
                          <Badge tone="danger">Rejected</Badge>
                        ) : null}
                        {!stage.isPlaced && !stage.isRejected ? (
                          <span className="text-slate-400">—</span>
                        ) : null}
                      </TD>
                      <TD className="text-slate-600">
                        {stage._count.submissions}
                      </TD>
                      <TD>
                        <ActiveBadge active={stage.isActive} />
                      </TD>
                      <TD>
                        <div className="flex justify-end">
                          <ButtonLink
                            href={`${baseHref}&list=candidate-${stage.id}`}
                            variant="ghost"
                            size="sm"
                          >
                            Edit
                          </ButtonLink>
                        </div>
                      </TD>
                    </>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </Card>
    </div>
  )
}
