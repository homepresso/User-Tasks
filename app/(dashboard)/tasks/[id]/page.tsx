"use client"

import { use, useEffect, useMemo, useState } from 'react'
import { serverRead } from '@/lib/server-read'
import { RecentActivity } from '@/components/timeline/run-timeline'
import { TimelineSheet } from '@/components/timeline/timeline-sheet'
import { listTaskEvents } from '@/app/actions/activity'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { TaskHeader } from '@/components/tasks/task-header'
import { WorkflowContext } from '@/components/tasks/workflow-context'
import { EffortBox } from '@/components/tasks/effort-box'
import { TaskTree } from '@/components/tasks/task-tree'
import { ActivityTimeline } from '@/components/tasks/timeline'
import { TaskDetailRealtime } from '@/components/tasks/task-detail-realtime'
import { TaskFields } from '@/components/tasks/task-fields'
import { FormLookupProvider } from '@/components/forms/lookup-field'
import { FormHeaderBlock } from '@/components/forms/form-shell'
import { TaskFormButtons } from '@/components/tasks/task-form-buttons'
import { OnBehalfBanner, OnBehalfProvider, useOnBehalf, type TaskActMode } from '@/components/tasks/on-behalf'
import { UnassignedTaskBanner } from '@/components/tasks/assign-task'
import { ViewerBanner } from '@/components/tasks/invite-viewers'
import { normalizeFormHeader } from '@/lib/forms/header'
import { lookupItemKey } from '@/lib/forms/lookup'
import { ProgressOverride } from '@/components/tasks/progress-override'
import { TaskDescription } from '@/components/tasks/task-description'
import { TaskTabs, taskTabs, type TaskTab } from '@/components/tasks/task-tabs'
import { TaskAttachmentsTab, useTaskAttachmentCount } from '@/components/tasks/task-attachments-tab'
import { usePermissions } from '@/lib/permissions-context'
import { TaskLinksPanel } from '@/components/tasks/task-links-panel'
import { TimerWidget } from '@/components/tasks/timer-widget'
import { ManualEffortEntry } from '@/components/tasks/manual-effort-entry'
import { useAppStore } from '@/stores/app-store'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { InlineNotice } from '@/components/ui/inline-notice'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { Check, ExternalLink, Save, SearchX } from 'lucide-react'
import { normalizeTaskFields, valueFields } from '@/lib/task-field-schema'
import { FORM_STATE_KEY, submittingButtonKeys } from '@/lib/forms/form-state'
import { FORM_PARAMS_KEY, FORM_VARS_KEY, withFormContext } from '@/lib/forms/form-params'
import { isPlainObject } from '@/lib/utils/guards'
import { normalizeFormLayout } from '@/lib/forms/layout'
import { parseFormThemeOverrides } from '@/lib/forms/form-theme'
import { formCardWidth } from '@/lib/forms/form-width'
import { TaskCompletedScreen, type TaskCompletedEvent } from '@/components/tasks/task-completed-screen'
import { resolveTaskCompletion, taskCompletedOverride } from '@/lib/tasks/completion-screen'
import { useAssistantSurface } from '@/lib/assistants/client-registry'

// Task tree plus tenant badge, assignee/assigner names and workflow source, read server-side.
async function loadTaskDetail(id: string) {
  return (await serverRead('tasks.detail', { id })).data
}

type TaskDetailData = NonNullable<Awaited<ReturnType<typeof loadTaskDetail>>>

export default function TaskDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const addOpenTask = useAppStore((s) => s.addOpenTask)

  const { data, isLoading } = useQuery({
    queryKey: ['task-detail', id],
    queryFn: () => loadTaskDetail(id),
  })

  useEffect(() => {
    const title = data?.treeData?.task?.title
    if (!title) return
    addOpenTask({ id, title })
  }, [addOpenTask, data?.treeData?.task?.title, id])

  const { data: events = [] } = useQuery({
    queryKey: ['task-events', id],
    enabled: Boolean(data?.treeData?.task?.id),
    // Newest 20 events, read server-side in the task's workspace.
    queryFn: async () => {
      const result = await listTaskEvents(id)
      return result.ok ? (result.data as any[]) : []
    },
  })

  const { data: collaborators = [] } = useQuery({
    queryKey: ['task-collaborators', id],
    enabled: data?.treeData?.task?.assignment_mode === 'collaborative',
    queryFn: async () => (await serverRead('tasks.collaborators', { taskId: id })).data ?? [],
  })

  // Who may action this task: the assignee, a manager on behalf, or nobody else.
  const { data: access } = useQuery({
    queryKey: ['task-act-access', id],
    enabled: Boolean(data?.treeData?.task?.id),
    queryFn: async () => (await serverRead('tasks.actAccess', { taskId: id })).data ?? null,
  })
  // Who invited a viewer (the banner): from the invite list, which a viewer can read.
  const { data: viewerInviter } = useQuery({
    queryKey: ['task-viewer-inviter', id, access?.viewer?.invitedBy ?? null],
    enabled: Boolean(access?.viewer?.invitedBy),
    queryFn: async () => {
      const list = (await serverRead('tasks.viewers', { taskId: id })).data
      const inviter = access?.viewer?.invitedBy
      return list?.viewers.find((v) => v.invited_by?.id === inviter)?.invited_by?.name ?? null
    },
  })
  const [onBehalfNote, setOnBehalfNote] = useState('')
  // The AI task assistant (shown only when available: components/assistants/assistant-host).
  useAssistantSurface(data?.treeData?.task?.id ? { kind: 'task', taskId: id, title: data.treeData.task.title ?? null } : null)

  if (isLoading) return <PageSkeleton variant="detail" />
  if (!data) {
    return (
      <EmptyState
        icon={SearchX}
        title="Task not found"
        description="It may have been deleted, or you don’t have access to it."
        action={{ label: 'Back to my tasks', href: '/tasks' }}
      />
    )
  }

  const workflowTask = Boolean(data.treeData.task.is_workflow_task && data.treeData.task.event_id)
  const mode = (access?.mode ?? null) as TaskActMode | null
  const open = !['completed', 'cancelled'].includes(data.treeData.task.status)
  // Here only through an invite (lib/services/task-viewers): read only, comments allowed.
  const viewer = access?.viewer ?? null
  return (
    <OnBehalfProvider mode={mode} workflowTask={workflowTask} note={onBehalfNote} viewer={Boolean(viewer)}>
      {viewer && (
        <div className="w-full">
          <ViewerBanner invitedByName={viewerInviter ?? null} via={viewer.principalType} inherited={viewer.inherited} />
        </div>
      )}
      {open && access?.unassigned && (
        <div className="w-full">
          <UnassignedTaskBanner taskId={id} canTakeOwnership={access.canTakeOwnership === true} canReassign={access.canReassign === true} />
        </div>
      )}
      {workflowTask && open && mode && mode !== 'assignee' && !access?.unassigned && !viewer && (
        <div className="w-full">
          <OnBehalfBanner mode={mode} basis={access?.basis ?? null} assigneeName={data.assigneeName ?? null} note={onBehalfNote} onNoteChange={setOnBehalfNote} />
        </div>
      )}
      <TaskDetailContent
        key={id}
        id={id}
        data={data}
        events={events ?? []}
        collaborators={collaborators}
        viewer={Boolean(viewer)}
      />
    </OnBehalfProvider>
  )
}

function TaskDetailContent({
  id,
  data,
  events,
  collaborators,
  viewer = false,
}: {
  id: string
  data: TaskDetailData
  events: Parameters<typeof ActivityTimeline>[0]['events']
  collaborators: Parameters<typeof TaskHeader>[0]['collaborators']
  /** An invited viewer: everything read only (comments stay open). */
  viewer?: boolean
}) {
  const { treeData, tenant, assigneeName, assignerName, workflowSource } = data
  const metadata = (treeData.task.metadata ?? {}) as Record<string, unknown>
  const fields = useMemo(() => normalizeTaskFields(metadata.fields), [metadata.fields])
  const formLayout = useMemo(() => normalizeFormLayout(metadata.form_layout, fields.map((f) => f.key)), [metadata.form_layout, fields])
  const formTheme = useMemo(() => parseFormThemeOverrides(metadata.form_theme), [metadata.form_theme])
  // Form width (lib/forms/form-width.ts): wide / full / custom % size the task column; narrow narrows only the card.
  const taskWidth = formCardWidth(formTheme, fields, 'max-w-4xl')
  const formWidth = taskWidth.width
  const inputFields = useMemo(() => valueFields(fields), [fields])
  const savedValues = useMemo(
    () => ((metadata.template_values ?? {}) as Record<string, unknown>),
    [metadata.template_values],
  )
  const isOpen = !['completed', 'cancelled'].includes(treeData.task.status)
  const onBehalf = useOnBehalf()
  const { userId, can } = usePermissions()
  const attachmentCount = useTaskAttachmentCount(id)
  const [mobileBar, setMobileBar] = useState<HTMLDivElement | null>(null)
  // Timeline sheet (header button, Details → Recent activity, ?timeline=1 links).
  const [timelineOpen, setTimelineOpen] = useState(false)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('timeline') === '1') setTimelineOpen(true)
  }, [])
  // The Task completed screen (lib/tasks/completion-screen.ts): shown in place of the tabs once the task is actioned here.
  const [completed, setCompleted] = useState<TaskCompletedEvent | null>(null)
  const { data: completionSettings } = useQuery({
    queryKey: ['task-completion-settings', treeData.task.tenant_id],
    staleTime: 60_000,
    queryFn: async () => (await serverRead('tasks.completionSettings', { taskId: id })).data ?? null,
  })
  /** A completion with an outcome: show the screen when it is on (workspace default, else the form's override). */
  function handleCompleted(outcome: string): boolean {
    if (!completionSettings) return false
    if (!resolveTaskCompletion(completionSettings, taskCompletedOverride(formLayout), outcome).enabled) return false
    setCompleted({ outcome, at: new Date() })
    // The header above shows the task completed (status, no outcome buttons).
    void queryClient.invalidateQueries({ queryKey: ['task-detail', id] })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
    return true
  }
  const canEditFields = isOpen && inputFields.length > 0 && onBehalf.canAct

  const taskDraft = useAppStore((s) => s.taskDrafts[id])
  const setTaskDraft = useAppStore((s) => s.setTaskDraft)
  const clearTaskDraft = useAppStore((s) => s.clearTaskDraft)
  const queryClient = useQueryClient()
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(
    () => (canEditFields && taskDraft ? { ...savedValues, ...taskDraft } : savedValues),
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const draftValues = useMemo(
    // Lookups keep their selected item (labels) in the draft too; the server recomputes it on save.
    () => Object.fromEntries(inputFields.flatMap((f) => (f.type === 'lookup'
      ? [[f.key, fieldValues[f.key] ?? null], [lookupItemKey(f.key), fieldValues[lookupItemKey(f.key)] ?? null]]
      : [[f.key, fieldValues[f.key] ?? null]])).concat(fieldValues[FORM_STATE_KEY] ? [[FORM_STATE_KEY, fieldValues[FORM_STATE_KEY]]] : [])
      // Form variables ride along (validated on the server; only "Include in submission" ones are stored).
      .concat(fieldValues[FORM_VARS_KEY] ? [[FORM_VARS_KEY, fieldValues[FORM_VARS_KEY]]] : [])),
    [inputFields, fieldValues],
  )
  // Parameters: what the workflow step passed (metadata.form_params); variables' initial values filled in.
  const shownValues = useMemo(
    () => withFormContext(formLayout, isPlainObject(metadata.form_params) ? { ...fieldValues, [FORM_PARAMS_KEY]: metadata.form_params } : fieldValues),
    [formLayout, fieldValues, metadata.form_params],
  )
  const hasChanges = inputFields.some((f) => JSON.stringify(fieldValues[f.key] ?? null) !== JSON.stringify(savedValues[f.key] ?? null))

  useEffect(() => {
    if (!canEditFields) return
    if (hasChanges) setTaskDraft(id, draftValues)
    else clearTaskDraft(id)
  }, [canEditFields, clearTaskDraft, draftValues, hasChanges, id, setTaskDraft])

  function handleFieldChange(key: string, value: unknown) {
    setFieldValues((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function handleSaveFields() {
    setSaveState('saving')
    setSaveError(null)
    try {
      const { saveTaskFieldValues } = await import('@/app/actions/tasks')
      const result = await saveTaskFieldValues(id, draftValues, onBehalf.options)
      if (!result.success) {
        if (result.errors._form) setSaveError(result.errors._form)
        setFieldErrors(result.errors)
        setSaveState('idle')
        return
      }
      clearTaskDraft(id)
      setSaveState('saved')
      queryClient.invalidateQueries({ queryKey: ['task-detail', id] })
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save')
      setSaveState('idle')
    }
  }

  const hasTaskData = fields.length > 0 || Object.keys(savedValues).length > 0
  // A button bar (configured, or implied by an in-form Submit button — it presses the bar's Submit).
  const hasFormButtons = Array.isArray(metadata.form_buttons) || submittingButtonKeys(fields).length > 0

  // Normal / narrow forms: a 720px main column and a 320px rail (dependencies, activity) from xl.
  // Wide / full / custom forms keep one stacked column so the form isn't squeezed.
  const withRail = formWidth === 'normal' || formWidth === 'narrow'
  // Progress follows the task's direct subtasks (child_count / completed_child_count, kept by the
  // tasks trigger — nested subtasks roll up into their own parent). A stored progress that differs
  // from that is a manual override.
  const directTotal = Number(treeData.task.child_count ?? 0) || (treeData.subtasks ?? []).filter((s: { parent_task_id?: string | null }) => s.parent_task_id === treeData.task.id).length
  const directDone = treeData.task.child_count != null
    ? Number(treeData.task.completed_child_count ?? 0)
    : (treeData.subtasks ?? []).filter((s: { parent_task_id?: string | null; status?: string }) => s.parent_task_id === treeData.task.id && s.status === 'completed').length
  const subtaskPct = directTotal > 0 ? Math.round((directDone / directTotal) * 100) : 0
  const storedPct = treeData.task.progress_pct == null ? null : Number(treeData.task.progress_pct)
  const progressOverride = (
    <ProgressOverride
      taskId={id}
      subtaskProgress={subtaskPct}
      overridePct={storedPct == null ? null : directTotal === 0 ? storedPct : Math.abs(storedPct - (directDone / directTotal) * 100) >= 0.5 ? storedPct : null}
      totalSubtasks={directTotal}
      completedSubtasks={directDone}
    />
  )
  const taskTree = (
    <TaskTree
      task={treeData.task}
      subtasks={treeData.subtasks ?? []}
      totalCount={treeData.total_count}
      completedCount={treeData.completed_count}
      canAdd={data.canAddSubtasks === true}
      canEdit={can('tasks.complete')}
      depth={data.subtaskDepth ?? 0}
    />
  )
  const links = <TaskLinksPanel taskId={id} readOnly={viewer} />
  const timeline = <ActivityTimeline events={events} taskId={id} tenantId={treeData.task.tenant_id} />
  const externalFormUrl = typeof metadata.form_url === 'string' && metadata.form_url ? metadata.form_url : null
  const hasForm = hasTaskData || Boolean(externalFormUrl)
  // Subtask additions are logged as comment events (with source 'subtask_added'); they aren't comments.
  const commentCount = events.filter((e: { event_type?: string; metadata?: { source?: string } | null }) => e.event_type === 'comment_added' && e.metadata?.source !== 'subtask_added').length

  const details = (
    <div className={withRail ? 'grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8' : 'space-y-5'}>
      <div className="min-w-0 space-y-5">
        {treeData.task.description && (
          <TaskDescription value={treeData.task.description} className="text-sm leading-relaxed text-fg-muted" />
        )}
        {treeData.task.workflow_source_id && (
          <WorkflowContext
            workflowSource={workflowSource}
            stepId={treeData.task.workflow_step_id}
            position={treeData.task.workflow_position}
          />
        )}
        {/* An invited viewer reads effort, progress and subtasks; every control is disabled. */}
        <fieldset disabled={viewer} className="m-0 min-w-0 space-y-5 border-0 p-0" data-task-read-only={viewer ? '' : undefined}>
          <EffortBox
            task={treeData.task}
            actions={viewer ? null : <TimerWidget taskId={id} tenantId={treeData.task.tenant_id} />}
            footer={viewer ? null : <ManualEffortEntry taskId={id} tenantId={treeData.task.tenant_id} />}
          />
          {!viewer && progressOverride}
          {taskTree}
        </fieldset>
      </div>
      <aside className="min-w-0 space-y-5" aria-label="Recent activity and dependencies">
        <RecentActivity target={{ taskId: id }} onOpen={() => setTimelineOpen(true)} />
        {links}
      </aside>
    </div>
  )

  // A themed form (page background, header or buttons) frames itself: no second card around it.
  const themedForm = Boolean(formTheme) || normalizeFormHeader(metadata.form_header)?.enabled === true || hasFormButtons
  const form = (
    <div className={formWidth === 'narrow' ? 'mx-auto max-w-xl space-y-5' : 'space-y-5'}>
      {externalFormUrl && (
        <div>
          <Button variant="secondary" asChild trailingIcon={<ExternalLink />}>
            <a href={externalFormUrl} target="_blank" rel="noopener noreferrer">Open form</a>
          </Button>
          <p className="mt-1 text-xs text-fg-muted">This task uses an external form.</p>
        </div>
      )}
      {hasTaskData && (
        <Card padding={themedForm ? "none" : "md"} id="task-form" className={cn("scroll-mt-4", themedForm ? "border-0 bg-transparent shadow-none" : "max-sm:-mx-1 max-sm:p-4")} data-task-details>
          <div className={cn("mb-3 flex items-center justify-between gap-3", themedForm && "px-1")}>
            <h2 className="text-base font-semibold text-fg">Task form</h2>
            {canEditFields && (
              <Button
                size="sm"
                variant={hasChanges ? 'primary' : 'secondary'}
                onClick={handleSaveFields}
                loading={saveState === 'saving'}
                disabled={!hasChanges}
                leadingIcon={saveState === 'saved' ? <Check /> : <Save />}
              >
                {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
          <FormLookupProvider source={canEditFields ? { kind: 'task', taskId: id } : null}>
            <TaskFields
              fields={fields}
              values={shownValues}
              onChange={canEditFields ? handleFieldChange : undefined}
              errors={fieldErrors}
              readOnly={!canEditFields}
              data={savedValues}
              layout={formLayout}
              persistKey={canEditFields ? `task:${id}` : undefined}
              page={Boolean(formTheme) || normalizeFormHeader(metadata.form_header)?.enabled === true || hasFormButtons}
              theme={normalizeFormHeader(metadata.form_header)?.enabled && formTheme?.header ? { ...formTheme, header: undefined } : formTheme}
              header={(
                <FormHeaderBlock
                  header={normalizeFormHeader(metadata.form_header)}
                  values={shownValues}
                  task={{ id, title: treeData.task.title, priority: treeData.task.priority, status: treeData.task.status }}
                  overrides={formTheme}
                />
              )}
              footer={hasFormButtons ? (
                <TaskFormButtons
                  closed={!canEditFields}
                  taskId={id}
                  rawButtons={metadata.form_buttons}
                  fields={fields}
                  values={draftValues}
                  savedValues={savedValues}
                  placement={formTheme?.button_placement}
                  onErrors={setFieldErrors}
                  layout={formLayout}
                  onCompleted={handleCompleted}
                  onReset={() => { setFieldValues(savedValues); setFieldErrors({}); clearTaskDraft(id) }}
                />
              ) : null}
            />
          </FormLookupProvider>
          {saveError && <InlineNotice tone="danger" className="mt-3">{saveError}</InlineNotice>}
        </Card>
      )}
    </div>
  )

  const assignedToMe = Boolean(userId) && (treeData.task.assignee_id === userId || (collaborators ?? []).some((c: { user_id?: string; id?: string }) => (c.user_id ?? c.id) === userId))
  const tabs = taskTabs({ hasForm, comments: commentCount, attachments: attachmentCount })
  const defaultTab: TaskTab = hasForm && isOpen && assignedToMe ? 'form' : 'details'

  return (
    <TaskDetailRealtime taskId={id}>
      <div
        className={withRail || formWidth === 'full' ? 'w-full' : `${taskWidth.className} mx-auto`}
        style={withRail || formWidth === 'full' ? undefined : (taskWidth.style as React.CSSProperties)}
        data-task-form-width={formWidth}
        data-task-layout={withRail ? 'rail' : 'stacked'}
      >
        <TaskHeader
          task={treeData.task}
          tenant={tenant}
          assigneeName={assigneeName}
          assignerName={assignerName}
          collaborators={collaborators}
          fields={isOpen && inputFields.length ? fields : []}
          fieldValues={fieldValues}
          onFieldErrors={setFieldErrors}
          formLayout={formLayout}
          showDescription={false}
          mobileActionsTarget={mobileBar}
          onCompleted={handleCompleted}
        />
        {completed ? (
          <div className="mt-4" data-task-completed-screen>
            <TaskCompletedScreen taskId={id} taskTitle={treeData.task.title} completed={completed} formLayout={formLayout} />
          </div>
        ) : (
        <TaskTabs taskId={id} tabs={tabs} defaultTab={defaultTab} className="mt-4">
          {(tab) => (
            <div className="pt-5">
              {tab === 'details' && details}
              {tab === 'form' && form}
              {tab === 'comments' && <div className="w-full">{timeline}</div>}
              {tab === 'attachments' && <TaskAttachmentsTab taskId={id} tenantId={treeData.task.tenant_id} canEdit={isOpen && onBehalf.canAct} />}
            </div>
          )}
        </TaskTabs>
        )}
        {/* Phones: the outcome actions stay in reach in a bar at the foot of the page (TaskHeader portals them here). -bottom-6 cancels the shell's 1.5rem of padding above the tab bar, so the bar sits flush on it. */}
        <div
          ref={setMobileBar}
          className="sticky -bottom-6 z-20 -mx-4 mt-4 flex flex-nowrap items-center gap-2 overflow-x-auto border-t border-border bg-panel px-4 py-2 shadow-elev-1 [scrollbar-width:none] empty:hidden md:hidden [&>*]:shrink-0"
          data-task-mobile-actions
        />
        <TimelineSheet target={{ taskId: id }} open={timelineOpen} onOpenChange={setTimelineOpen} />
      </div>
    </TaskDetailRealtime>
  )
}
