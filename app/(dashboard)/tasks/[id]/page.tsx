"use client"

import { use, useEffect, useMemo, useState } from 'react'
import { serverRead } from '@/lib/server-read'
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
import { normalizeFormHeader } from '@/lib/forms/header'
import { lookupItemKey } from '@/lib/forms/lookup'
import { ProgressOverride } from '@/components/tasks/progress-override'
import { TaskLinksPanel } from '@/components/tasks/task-links-panel'
import { TimerWidget } from '@/components/tasks/timer-widget'
import { ManualEffortEntry } from '@/components/tasks/manual-effort-entry'
import { useAppStore } from '@/stores/app-store'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Check, Save } from 'lucide-react'
import { normalizeTaskFields, valueFields } from '@/lib/task-field-schema'
import { normalizeFormLayout } from '@/lib/forms/layout'
import { parseFormThemeOverrides } from '@/lib/forms/form-theme'

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
  const [onBehalfNote, setOnBehalfNote] = useState('')

  if (isLoading) return null
  if (!data) return null

  const workflowTask = Boolean(data.treeData.task.is_workflow_task && data.treeData.task.event_id)
  const mode = (access?.mode ?? null) as TaskActMode | null
  const open = !['completed', 'cancelled'].includes(data.treeData.task.status)
  return (
    <OnBehalfProvider mode={mode} workflowTask={workflowTask} note={onBehalfNote}>
      {workflowTask && open && mode && mode !== 'assignee' && (
        <div className="max-w-4xl mx-auto">
          <OnBehalfBanner mode={mode} assigneeName={data.assigneeName ?? null} note={onBehalfNote} onNoteChange={setOnBehalfNote} />
        </div>
      )}
      <TaskDetailContent
        key={id}
        id={id}
        data={data}
        events={events ?? []}
        collaborators={collaborators}
      />
    </OnBehalfProvider>
  )
}

function TaskDetailContent({
  id,
  data,
  events,
  collaborators,
}: {
  id: string
  data: TaskDetailData
  events: Parameters<typeof ActivityTimeline>[0]['events']
  collaborators: Parameters<typeof TaskHeader>[0]['collaborators']
}) {
  const { treeData, tenant, assigneeName, assignerName, workflowSource } = data
  const metadata = (treeData.task.metadata ?? {}) as Record<string, unknown>
  const fields = useMemo(() => normalizeTaskFields(metadata.fields), [metadata.fields])
  const formLayout = useMemo(() => normalizeFormLayout(metadata.form_layout, fields.map((f) => f.key)), [metadata.form_layout, fields])
  const formTheme = useMemo(() => parseFormThemeOverrides(metadata.form_theme), [metadata.form_theme])
  const inputFields = useMemo(() => valueFields(fields), [fields])
  const savedValues = useMemo(
    () => ((metadata.template_values ?? {}) as Record<string, unknown>),
    [metadata.template_values],
  )
  const isOpen = !['completed', 'cancelled'].includes(treeData.task.status)
  const onBehalf = useOnBehalf()
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
      : [[f.key, fieldValues[f.key] ?? null]]))),
    [inputFields, fieldValues],
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

  return (
    <TaskDetailRealtime taskId={id}>
      <div className="max-w-4xl mx-auto">
        <TaskHeader
          task={treeData.task}
          tenant={tenant}
          assigneeName={assigneeName}
          assignerName={assignerName}
          collaborators={collaborators}
          fields={isOpen ? inputFields : []}
          fieldValues={fieldValues}
          onFieldErrors={setFieldErrors}
        />
        {treeData.task.workflow_source_id && (
          <div className="mt-4">
            <WorkflowContext
              workflowSource={workflowSource}
              stepId={treeData.task.workflow_step_id}
              position={treeData.task.workflow_position}
            />
          </div>
        )}
        <div className="mt-5">
          <EffortBox task={treeData.task} />
          <div className="mt-2">
            <ManualEffortEntry taskId={id} tenantId={treeData.task.tenant_id} />
          </div>
        </div>
        <div className="mt-5">
          <TaskLinksPanel taskId={id} />
        </div>
        {Boolean((treeData.task.metadata as any)?.form_url) && (
          <div className="mt-5">
            <a
              href={String((treeData.task.metadata as any).form_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:opacity-80"
              style={{ borderColor: 'var(--theme-primary)', color: 'var(--theme-primary-text)' }}
            >
              Open form ↗
            </a>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
              This task uses an external form.
            </p>
          </div>
        )}
        {hasTaskData && (
          <div className="mt-5">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Task details</h2>
                {canEditFields && (
                  <Button
                    size="sm"
                    variant={hasChanges ? 'default' : 'outline'}
                    onClick={handleSaveFields}
                    disabled={saveState === 'saving' || !hasChanges}
                  >
                    {saveState === 'saved'
                      ? <><Check size={12} className="mr-1" /> Saved</>
                      : <><Save size={12} className="mr-1" /> {saveState === 'saving' ? 'Saving...' : 'Save'}</>}
                  </Button>
                )}
              </div>
              <FormLookupProvider source={canEditFields ? { kind: 'task', taskId: id } : null}>
                <TaskFields
                  fields={fields}
                  values={fieldValues}
                  onChange={canEditFields ? handleFieldChange : undefined}
                  errors={fieldErrors}
                  readOnly={!canEditFields}
                  data={savedValues}
                  layout={formLayout}
                  page={Boolean(formTheme) || normalizeFormHeader(metadata.form_header)?.enabled === true || Array.isArray(metadata.form_buttons)}
                  theme={normalizeFormHeader(metadata.form_header)?.enabled && formTheme?.header ? { ...formTheme, header: undefined } : formTheme}
                  header={(
                    <FormHeaderBlock
                      header={normalizeFormHeader(metadata.form_header)}
                      values={fieldValues}
                      task={{ id, title: treeData.task.title, priority: treeData.task.priority, status: treeData.task.status }}
                      overrides={formTheme}
                    />
                  )}
                  footer={Array.isArray(metadata.form_buttons) ? (
                    <TaskFormButtons
                      closed={!canEditFields}
                      taskId={id}
                      rawButtons={metadata.form_buttons}
                      fields={inputFields}
                      values={draftValues}
                      savedValues={savedValues}
                      placement={formTheme?.button_placement}
                      onErrors={setFieldErrors}
                      onReset={() => { setFieldValues(savedValues); setFieldErrors({}); clearTaskDraft(id) }}
                    />
                  ) : null}
                />
              </FormLookupProvider>
              {saveError && (
                <p className="mt-2 text-xs" style={{ color: 'var(--status-blocked)' }}>{saveError}</p>
              )}
            </Card>
          </div>
        )}
        <ProgressOverride
          taskId={id}
          subtaskProgress={
            treeData.total_count > 1
              ? Math.round((treeData.completed_count / Math.max(treeData.total_count - 1, 1)) * 100)
              : 0
          }
          overridePct={(() => {
            if (treeData.task.progress_pct == null) return null
            if (treeData.total_count <= 1) return Number(treeData.task.progress_pct)
            const computedSubtaskProgress = Math.round(
              (treeData.completed_count / Math.max(treeData.total_count - 1, 1)) * 100
            )
            return Math.abs(Number(treeData.task.progress_pct) - computedSubtaskProgress) > 0
              ? Number(treeData.task.progress_pct)
              : null
          })()}
          totalSubtasks={treeData.total_count > 1 ? treeData.total_count - 1 : 0}
          completedSubtasks={treeData.completed_count}
        />
        <TaskTree
          task={treeData.task}
          subtasks={treeData.subtasks ?? []}
          totalCount={treeData.total_count}
          completedCount={treeData.completed_count}
        />
        <ActivityTimeline events={events} taskId={id} tenantId={treeData.task.tenant_id} />
      </div>
      <TimerWidget taskId={id} tenantId={treeData.task.tenant_id} />
    </TaskDetailRealtime>
  )
}
