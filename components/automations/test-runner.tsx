'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { useQuery } from '@tanstack/react-query'
import { Play, X, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight, Copy, ClipboardCheck, Loader2, Zap, Plus, Trash2, PlayCircle, ListChecks, TriangleAlert, Maximize2, Minimize2, SlidersHorizontal, PauseCircle, Sparkles } from 'lucide-react'
import { validateWorkflow } from '@/lib/workflow-validation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge, StatusPill } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { overlayClass } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { formatCount } from '@/lib/format/number'
import { formatDurationMs } from '@/lib/format/duration'
import { plural } from '@/lib/format/plural'
import { logStepId, RuntimeCanvas, StepChip } from './runtime-canvas'
import { computeRunOverlay } from '@/lib/workflow-run-overlay'
import { TaskFields } from '@/components/tasks/task-fields'
import { FormBarRegistration } from '@/components/forms/form-shell'
import { stripFormState } from '@/lib/forms/form-state'
import { FormLookupProvider } from '@/components/forms/lookup-field'
import { FormAttachmentsProvider } from '@/components/forms/attachments-field'
import { normalizeFormLayout, type FormLayout } from '@/lib/forms/layout'
import { parseFormThemeOverrides, type FormThemeOverrides } from '@/lib/forms/form-theme'
import { coerceTaskFieldValues, normalizeTaskFields, validateTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import type { UserVariable, Swimlane } from './workflow-builder'
import type { WorkflowNode, WorkflowEdge } from '@/lib/workflow-schema'
import { TaskDescription } from '@/components/tasks/task-description'
import { WorkflowStartFormView } from '@/components/forms/workflow-start-form-view'
import { rememberTaskValues, runAllPauseDecision, savedTaskValuesFor, testTaskStartValues, type CaseTaskValues, type TestPausePrompt } from '@/lib/automations/test-run-all'
import { serverRead } from '@/lib/server-read'
import { AgentDialogButton, useAgentDock } from '@/components/assistants/assistant-panel'
import { askAgentToFix, useAgentState } from '@/components/assistants/agent-store'
import { canAskAgentToFix, failureAttachment, FIX_PROMPT } from '@/lib/assistants/failure'
import { formStartGate, NEEDS_FORM_INPUT, rememberSubmission, runAllCaseDecision, runSelectedDecision, TEST_START_LABEL } from '@/lib/automations/test-form-start'
import type { FormButton } from '@/lib/forms/buttons'
import { formCardWidth } from '@/lib/forms/form-width'
import { linkedFormIds } from '@/lib/forms/definition'
import { usePermissions } from '@/lib/permissions-context'
import {
  caseFormValues as caseFormValuesOf, copyCaseInputs, fieldText, formDefaultValues, parseFieldText, plainFieldKeys, startFormKind, valueChips, withCaseFormValue,
  type StartFormCase, type WorkflowStartForm,
} from '@/lib/forms/workflow-start-form'

interface TestCase {
  id: string
  name: string
  values: Record<string, string>
  /** A "Form submitted" workflow: the form's values (typed; lookups' `_item` too). */
  formValues?: Record<string, unknown>
  /** The form button the case submits with (default: the first submitting one). */
  buttonId?: string
  /** What the tester entered the last time they completed each User Task in this case (Run All can reuse it). */
  taskValues?: CaseTaskValues
  /** What this case's form last submitted (accepted by the server): Run All reruns it (lib/automations/test-form-start). */
  submitted?: StartFormCase
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'skipped' | null
  /** Run All left the case paused here ("Paused at …"). */
  pausedAt?: string
  /** Run All skipped the case ("Needs form input"). */
  skippedReason?: string
}

interface TestRunnerProps {
  workflowId: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  userVariables: UserVariable[]
  swimlanes?: Swimlane[]
  triggerType?: string
  /** The workflow is active: cards show the same live dot as on the designer. */
  workflowActive?: boolean
  onClose: () => void
  /** For "Ask Agent to fix": the workflow's name, and whether the person can edit it. */
  workflowName?: string | null
  canEdit?: boolean
  /** Start with these inputs (the Agent's "Re-run test"), and run them once the runner is ready. */
  initialValues?: Record<string, string> | null
  autoRun?: boolean
}


/** Cancel the caller's own waiting test runs of a workflow (and their tasks). */
function cancelWaitingTestRuns(workflowId: string) {
  if (!workflowId) return Promise.resolve()
  return fetch('/api/workflows/cleanup-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow_id: workflowId }),
    keepalive: true,
  }).then(() => undefined, () => undefined)
}

export function TestRunner({ workflowId, nodes, edges, userVariables, swimlanes = [], triggerType, workflowActive = false, onClose, workflowName = null, canEdit = false, initialValues = null, autoRun = false }: TestRunnerProps) {
  // Test cases
  const [testCases, setTestCases] = useState<TestCase[]>(() => {
    const defaults: Record<string, string> = {}
    for (const v of userVariables) defaults[v.name] = v.defaultValue ?? ''
    return [{ id: crypto.randomUUID(), name: initialValues ? 'Re-run' : 'Default', values: { ...defaults, ...(initialValues ?? {}) }, status: null }]
  })
  // The Agent: this runner (an overlay) hosts its panel; a failed run can be handed to it.
  const agentPanel = useAgentDock()
  const agentState = useAgentState()
  const [selectedCaseId, setSelectedCaseId] = useState(testCases[0].id)
  const selectedCase = testCases.find(c => c.id === selectedCaseId) ?? testCases[0]

  // The form the workflow starts from (Form submitted trigger / start form):
  // drawn as its users see it instead of the plain variable inputs.
  const startKind = useMemo(() => startFormKind(nodes), [nodes])
  const { data: startForm } = useQuery({
    queryKey: ['test-start-form', workflowId, startKind],
    enabled: Boolean(startKind),
    staleTime: 0,
    queryFn: async (): Promise<WorkflowStartForm> => {
      const { data, error } = await serverRead('automations.startForm', { workflow_id: workflowId, draft: true })
      return error || !data ? { kind: 'none', reason: error?.message } : data as WorkflowStartForm
    },
  })
  const formSpec = startKind && startForm && startForm.kind !== 'none' ? startForm : null
  // With a form start nothing runs until the form's own button is pressed
  // (and its checks pass): Run Selected shows the form, Run All reruns each
  // case's last submission, nothing runs while the form is loading.
  const gate = useMemo(() => formStartGate(startKind, startKind ? startForm : undefined), [startKind, startForm])
  // The Agent's "Re-run test": run the same inputs once the start form (if any) is known.
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (!autoRun || autoRanRef.current || (startKind && !startForm)) return
    const t = window.setTimeout(() => {
      if (autoRanRef.current || !onRunSelectedRef.current) return
      autoRanRef.current = true
      onRunSelectedRef.current()
    }, 300)
    return () => window.clearTimeout(t)
  }, [autoRun, startKind, startForm])
  const [formPrompt, setFormPrompt] = useState<string | null>(null)
  const formPanelRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<'form' | 'fields'>('form')
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [formFailure, setFormFailure] = useState<string | null>(null)
  const [formBusy, setFormBusy] = useState<string | null>(null)
  const formDefaults = useMemo(() => (formSpec?.kind === 'form' ? formDefaultValues(formSpec.form.fields) : {}), [formSpec])
  const plainKeys = useMemo(() => (formSpec?.kind === 'form' ? plainFieldKeys(formSpec.form.fields) : []), [formSpec])

  /** The values the case's form shows (keyed by field key). */
  function caseFormValues(tc: TestCase): Record<string, unknown> {
    return caseFormValuesOf(formSpec, tc, formDefaults)
  }

  function updateCaseForm(id: string, key: string, value: unknown) {
    setFormErrors((prev) => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next })
    setTestCases(prev => prev.map(c => c.id === id ? withCaseFormValue(formSpec, c, key, value) : c))
  }

  // Execution state
  const [running, setRunning] = useState(false)
  // Synchronous guard: two clicks in one frame would start two test runs.
  const runGuard = useSubmitGuard()
  const [runningAll, setRunningAll] = useState(false)
  const [done, setDone] = useState(false)
  const [finalStatus, setFinalStatus] = useState<string | null>(null)
  const [nodeResults, setNodeResults] = useState<Record<string, any>>({})
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [pausedNodeId, setPausedNodeId] = useState<string | null>(null)
  const [pausedEventId, setPausedEventId] = useState<string | null>(null)
  const [pausedRunId, setPausedRunId] = useState<string | null>(null)
  const [logs, setLogs] = useState<any[]>([])
  const [runIds, setRunIds] = useState<string[]>([])

  // Per-case result snapshots — so users can click back and see previous results
  const caseSnapshotsRef = useRef<Record<string, {
    nodeResults: Record<string, any>; logs: any[]; finalStatus: string | null;
    pausedNodeId: string | null; pausedEventId: string | null; pausedRunId: string | null; done: boolean
  }>>({})
  const [expandedLog, setExpandedLog] = useState<number | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [tab, setTab] = useState<'canvas' | 'logs'>('canvas')
  /** Dialog fills the window (more room for the run canvas). */
  const [maximised, setMaximised] = useState(false)
  const [showInputs, setShowInputs] = useState(true)
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; nonce: number } | null>(null)
  const focusStep = (nodeId: string) => { setTab('canvas'); setFocusRequest({ nodeId, nonce: Date.now() }) }
  const [copiedEventId, setCopiedEventId] = useState(false)
  const [testTaskPrompt, setTestTaskPrompt] = useState<{
    eventId: string; nodeId: string; title: string; description: string; outcomes: string[]; fields: TaskFieldDef[]; layout: FormLayout | null; theme: FormThemeOverrides | null
  } | null>(null)
  const [testTaskValues, setTestTaskValues] = useState<Record<string, unknown>>({})
  const [testTaskErrors, setTestTaskErrors] = useState<Record<string, string>>({})
  const [testServerEvent, setTestServerEvent] = useState<{
    eventId: string; nodeId: string; eventName: string
  } | null>(null)
  const [resuming, setResuming] = useState(false)
  const resumeResolveRef = useRef<((status?: string) => void) | null>(null)
  // Run All: never wait at a paused step (lib/automations/test-run-all.ts).
  const runningAllRef = useRef(false)
  const [autoCompleteTasks, setAutoCompleteTasks] = useState(true)
  const autoCompleteRef = useRef(true)
  // "Use form drafts": User Tasks linking a reusable form show its unpublished draft (testers with Edit forms).
  // Off by default — a test run uses the published forms, as real runs of the workflow draft do.
  const { can } = usePermissions()
  const linksForms = useMemo(() => linkedFormIds(nodes).size > 0, [nodes])
  const [useFormDrafts, setUseFormDrafts] = useState(false)
  /** The step the current case is paused at (mirrors the prompt state for synchronous reads). */
  const pausePromptRef = useRef<(TestPausePrompt & { eventId: string; fields?: TaskFieldDef[]; values?: Record<string, unknown> }) | null>(null)
  /** The case being executed (whose saved task values apply). */
  const currentCaseIdRef = useRef<string | null>(null)
  const testCasesRef = useRef<TestCase[]>([])
  testCasesRef.current = testCases
  const logsEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef(false)

  // Pre-run static validation. Blocks the run buttons with an escape hatch:
  // static checks are intentionally stricter than the runtime (which often
  // degrades to { skipped } instead of failing), so "Run anyway" stays available.
  const validation = useMemo(() => validateWorkflow(nodes, triggerType), [nodes, triggerType])
  const [validationOverride, setValidationOverride] = useState(false)
  const runsBlocked = !validation.valid && !validationOverride


  // Test runs left waiting (paused at a User Task / server event) are
  // cancelled when the runner opens (runs a closed runner or a reload lost
  // track of), when it closes or the page goes away. Only the caller's own
  // test runs of this workflow — never production runs (cleanup-test route).
  useEffect(() => {
    void cancelWaitingTestRuns(workflowId)
    const onPageHide = () => { void cancelWaitingTestRuns(workflowId) }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      void cancelWaitingTestRuns(workflowId)
    }
  }, [workflowId])

  useEffect(() => {
    if (tab === 'logs' && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs.length, tab])

  function addTestCase() {
    const defaults: Record<string, string> = {}
    for (const v of userVariables) defaults[v.name] = v.defaultValue ?? ''
    const newCase: TestCase = { id: crypto.randomUUID(), name: `Test ${testCases.length + 1}`, values: defaults, status: null }
    setTestCases(prev => [...prev, newCase])
    setSelectedCaseId(newCase.id)
  }

  function duplicateTestCase(tc: TestCase) {
    const newCase: TestCase = { id: crypto.randomUUID(), name: `${tc.name} (copy)`, ...copyCaseInputs(tc), status: null }
    setTestCases(prev => [...prev, newCase])
    setSelectedCaseId(newCase.id)
  }

  function removeTestCase(id: string) {
    if (testCases.length <= 1) return
    setTestCases(prev => prev.filter(c => c.id !== id))
    if (selectedCaseId === id) setSelectedCaseId(testCases.find(c => c.id !== id)!.id)
  }

  function updateCaseName(id: string, name: string) {
    setTestCases(prev => prev.map(c => c.id === id ? { ...c, name } : c))
  }

  function updateCaseValue(id: string, varName: string, value: string) {
    setTestCases(prev => prev.map(c => c.id === id ? { ...c, values: { ...c.values, [varName]: value } } : c))
  }

  function buildVariables(values: Record<string, string>) {
    const variables: Record<string, any> = {}
    for (const uv of userVariables) {
      if (!uv.name) continue
      const raw = values[uv.name] ?? uv.defaultValue ?? ''
      if (uv.type === 'number') variables[uv.name] = Number(raw) || 0
      else if (uv.type === 'boolean') variables[uv.name] = raw === 'true'
      else if (uv.type === 'object') { try { variables[uv.name] = JSON.parse(raw) } catch { variables[uv.name] = {} } }
      else variables[uv.name] = raw
    }
    return variables
  }

  async function executeSingleCase(tc: TestCase, buttonId?: string): Promise<string | null> {
    setSelectedCaseId(tc.id)
    setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, status: 'running' } : c))
    setNodeResults({}); nodeResultsRef.current = {}
    setAgentLive({})
    logsRef.current = []; finalStatusRef.current = null; pausedNodeIdRef.current = null; pausedEventIdRef.current = null; doneRef.current = false
    setActiveNodeId(null)
    setPausedNodeId(null)
    setPausedEventId(null)
    setPausedRunId(null)
    setTestTaskPrompt(null)
    setTestServerEvent(null)
    pausePromptRef.current = null
    currentCaseIdRef.current = tc.id
    setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, pausedAt: undefined } : c))
    setLogs([])
    setDone(false)
    setFinalStatus(null)
    setTab('canvas')

    // Add separator log for multi-run
    if (runningAllRef.current) {
      logsRef.current = [{ level: 'info', message: `── Test Case: ${tc.name} ──` }]
      setLogs(logsRef.current)
    }

    const variables = buildVariables(tc.values)
    let caseRunId: string | null = null
    let caseStatus: string = 'failed'
    // A "Form submitted" workflow starts from a TEST submission of its form
    // (checked like a real one; nothing stored or triggered — the server
    // builds the trigger's payload and logs what the button would do).
    const formSubmission = formSpec?.kind === 'form'
      ? { values: caseFormValues(tc), button_id: buttonId ?? tc.buttonId ?? null }
      : null
    setFormFailure(null)

    try {
      const resp = await fetch('/api/workflows/execute-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ ...(formSubmission ? { workflow_id: workflowId, form_submission: formSubmission } : { workflow_id: workflowId, variables }), ...(useFormDrafts ? { form_drafts: true } : {}) }),
      })

      if (resp.status === 422) {
        const json = await resp.json().catch(() => null) as { error?: string; fields?: Record<string, string> } | null
        setFormErrors(json?.fields ?? {})
        setFormFailure(json?.error ?? 'The form could not be submitted')
        appendLog({ level: 'error', message: `${gate.kind === 'none' ? 'Not started' : 'Form not submitted'}: ${json?.error ?? resp.status}`, ...(json?.fields ? { metadata: json.fields } : {}) })
        setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, status: 'failed' } : c))
        setShowInputs(true)
        setDone(true); doneRef.current = true
        setFinalStatus('failed'); finalStatusRef.current = 'failed'
        caseSnapshotsRef.current[tc.id] = { nodeResults: {}, logs: [...logsRef.current], finalStatus: 'failed', pausedNodeId: null, pausedEventId: null, pausedRunId: null, done: true }
        return null
      }
      if (formSpec && view === 'form' && !runningAll) setShowInputs(false)
      // The server accepted the form's values: Run All reruns this submission.
      if (resp.ok && (gate.kind === 'form' || gate.kind === 'start_form')) {
        const submitted = rememberSubmission({ values: tc.values, ...(formSubmission ? { formValues: formSubmission.values } : {}), ...(formSubmission?.button_id ? { buttonId: formSubmission.button_id } : {}) })
        setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, submitted } : c))
      }

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        appendLog({ level: 'error', message: `API error ${resp.status}: ${errText || 'No response body'}` })
        setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, status: 'failed' } : c))
        setTab('logs')
        return null
      }

      const contentType = resp.headers.get('content-type') ?? ''

      // Handle JSON fallback (non-streaming) — used on Vercel deployment
      if (contentType.includes('application/json')) {
        const json = await resp.json()
        console.log('[TestRunner] JSON response:', json.result?.status, 'events:', json.events?.length)
        for (const event of json.events ?? []) {
          if (event.type === 'done') {
            caseStatus = event.data?.status ?? 'completed'
            caseRunId = event.data?.run_id ?? null
          }
          handleSSEEvent(event)
        }
        if (json.result) {
          caseStatus = json.result.status ?? 'completed'
          caseRunId = json.result.run_id ?? null
          handleSSEEvent({ type: 'done', data: json.result })
        }
        setActiveNodeId(null)
        setFinalStatus(caseStatus); finalStatusRef.current = caseStatus
        setDone(true); doneRef.current = true
        if (caseRunId) setRunIds(prev => [...prev, caseRunId!])

        // If paused at a user task or server event: Run All completes it with
        // saved values or moves on; a single run waits for the tester.
        if (caseStatus === 'waiting_for_event') {
          setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, status: 'running' } : c))
          caseSnapshotsRef.current[tc.id] = { nodeResults: { ...nodeResultsRef.current }, logs: [...logsRef.current], finalStatus: finalStatusRef.current, pausedNodeId: pausedNodeIdRef.current, pausedEventId: pausedEventIdRef.current, pausedRunId: pausedRunIdRef.current, done: true }
          const finalSt = await settlePausedCase(tc)
          setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, status: finalSt } : c))
        } else {
          const finalSt = caseStatus === 'completed' ? 'completed' : 'failed'
          setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, status: finalSt } : c))
        }
        caseSnapshotsRef.current[tc.id] = { nodeResults: { ...nodeResultsRef.current }, logs: [...logsRef.current], finalStatus: finalStatusRef.current, pausedNodeId: pausedNodeIdRef.current, pausedEventId: pausedEventIdRef.current, pausedRunId: pausedRunIdRef.current, done: true }
        return caseRunId
      }

      if (!resp.body) {
        appendLog({ level: 'error', message: 'No response body from server' })
        setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, status: 'failed' } : c))
        setTab('logs')
        return null
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''
        for (const chunk of lines) {
          const dataLine = chunk.trim()
          if (!dataLine.startsWith('data: ')) continue
          try {
            const event = JSON.parse(dataLine.slice(6))
            if (event.type === 'done') {
              caseStatus = event.data?.status ?? 'completed'
              caseRunId = event.data?.run_id ?? null
            }
            handleSSEEvent(event)
          } catch { /* skip */ }
        }
      }
      if (buffer.trim().startsWith('data: ')) {
        try {
          const event = JSON.parse(buffer.trim().slice(6))
          if (event.type === 'done') {
            caseStatus = event.data?.status ?? 'completed'
            caseRunId = event.data?.run_id ?? null
          }
          handleSSEEvent(event)
        } catch { /* skip */ }
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      console.error('[TestRunner] Execution error:', msg, err)
      appendLog({ level: 'error', message: `Execution error: ${msg}` })
      setTab('logs')
    }

    setActiveNodeId(null)
    setFinalStatus(caseStatus); finalStatusRef.current = caseStatus
    setDone(true); doneRef.current = true
    if (caseRunId) setRunIds(prev => [...prev, caseRunId!])

    // If paused at a user task in test mode: Run All completes it with saved
    // values or moves on; a single run waits for the user to action it.
    if (caseStatus === 'waiting_for_event') {
      // Save snapshot before waiting so user can click back and see results
      caseSnapshotsRef.current[tc.id] = { nodeResults: { ...nodeResultsRef.current }, logs: [...logsRef.current], finalStatus: finalStatusRef.current, pausedNodeId: pausedNodeIdRef.current, pausedEventId: pausedEventIdRef.current, pausedRunId: pausedRunIdRef.current, done: true }
      const finalSt = await settlePausedCase(tc)
      setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, status: finalSt } : c))
    } else {
      const finalSt = caseStatus === 'completed' ? 'completed' : 'failed'
      setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, status: finalSt } : c))
    }

    // Save final snapshot for this case
    caseSnapshotsRef.current[tc.id] = { nodeResults: { ...nodeResultsRef.current }, logs: [...logsRef.current], finalStatus: finalStatusRef.current, pausedNodeId: pausedNodeIdRef.current, pausedEventId: pausedEventIdRef.current, pausedRunId: pausedRunIdRef.current, done: true }
    return caseRunId
  }

  /**
   * A case paused at a User Task / server event. Run All never waits: the
   * task is completed with the case's saved values (option on), else the
   * case is reported "Paused at …" and the next one runs. A single run waits
   * for the tester (again at each further pause).
   */
  async function settlePausedCase(tc: TestCase): Promise<TestCase['status']> {
    let current: string | undefined = 'waiting_for_event'
    while (current === 'waiting_for_event') {
      if (abortRef.current) return 'failed'
      if (!runningAllRef.current) {
        current = await new Promise<string | undefined>(resolve => { resumeResolveRef.current = resolve })
        continue
      }
      const prompt = pausePromptRef.current
      const saved = testCasesRef.current.find(c => c.id === tc.id)?.taskValues ?? tc.taskValues
      const decision = runAllPauseDecision(prompt, saved, autoCompleteRef.current)
      if (decision.action === 'skip' || !prompt || prompt.kind !== 'task') {
        const label = decision.action === 'skip' ? decision.label : 'Paused'
        appendLog({ level: 'warn', message: `${label} — Run All moves on to the next case (the paused test run is cleaned up)` })
        setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, pausedAt: label } : c))
        return 'paused'
      }
      appendLog({ level: 'info', message: `Completing "${prompt.title}" with this case's saved task values (outcome "${decision.outcome}")` })
      current = await resumeTestTask({ eventId: prompt.eventId, title: prompt.title, fields: prompt.fields ?? [] }, decision.outcome, testTaskStartValues(prompt.fields ?? [], prompt.values, decision.values), { log: false })
    }
    return current === 'completed' ? 'completed' : 'failed'
  }

  /** Action the test task with an outcome (its buttons, or an in-form Submit). */
  async function actionTestTask(outcome: string) {
    if (!testTaskPrompt) return
    const fieldErrors = validateTaskFieldValues(testTaskPrompt.fields, testTaskValues, { layout: testTaskPrompt.layout })
    if (Object.keys(fieldErrors).length > 0) {
      setTestTaskErrors(fieldErrors)
      return
    }
    // Remembered for this case: Run All can complete this task with them.
    const caseId = currentCaseIdRef.current
    const nodeId = testTaskPrompt.nodeId
    if (caseId) setTestCases(prev => prev.map(c => c.id === caseId ? { ...c, taskValues: rememberTaskValues(c.taskValues, nodeId, outcome, testTaskValues) } : c))
    const status = await resumeTestTask(testTaskPrompt, outcome, testTaskValues)
    if (resumeResolveRef.current) {
      resumeResolveRef.current(status)
      resumeResolveRef.current = null
    }
  }

  /** Resume the paused test run from its User Task with an outcome and values; returns the run's status. */
  async function resumeTestTask(prompt: { eventId: string; title: string; fields: TaskFieldDef[] }, outcome: string, values: Record<string, unknown>, options: { log?: boolean } = {}): Promise<string | undefined> {
    const taskData = { ...stripFormState(values), ...coerceTaskFieldValues(prompt.fields, values) }
    setResuming(true)
    setTestTaskPrompt(null)
    pausePromptRef.current = null
    if (options.log !== false) appendLog({ level: 'info', message: `Resuming workflow from "${prompt.title}" with outcome "${outcome}"` })
    let status: string | undefined
    try {
      const resumeKey = pausedRunIdRef.current ?? pausedEventIdRef.current ?? prompt.eventId
      const resp = await fetch('/api/workflows/execute-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({
          workflow_id: workflowId,
          resume_event_id: resumeKey,
          variables: { outcome, outcome_notes: `Test action: ${outcome}`, task_data: taskData },
        }),
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        throw new Error(errText || `Resume failed with status ${resp.status}`)
      }
      const resumeStatus = await processResumeResponse(resp)
      appendLog({ level: 'info', message: `Resume request completed with status "${resumeStatus ?? finalStatusRef.current ?? 'unknown'}"` })
      status = resumeStatus ?? finalStatusRef.current ?? 'completed'
    } catch (err: any) {
      appendLog({ level: 'error', message: `Resume failed: ${err.message}` })
      setFinalStatus('failed')
      finalStatusRef.current = 'failed'
      status = 'failed'
    }
    setResuming(false)
    return status
  }

  // Refs that mirror state for synchronous snapshot capture
  const nodeResultsRef = useRef<Record<string, any>>({})
  const logsRef = useRef<any[]>([])
  /** Run Agent steps' streamed replies (Save & Test streams the model's tokens). */
  const [agentLive, setAgentLive] = useState<Record<string, { text: string; streaming: boolean }>>({})
  const finalStatusRef = useRef<string | null>(null)
  const pausedNodeIdRef = useRef<string | null>(null)
  const pausedEventIdRef = useRef<string | null>(null)
  const pausedRunIdRef = useRef<string | null>(null)
  const doneRef = useRef(false)

  function appendLog(entry: any) {
    // Ref synced synchronously (not in the updater) so same-tick snapshots
    // capture the full log — see node_complete comment in handleSSEEvent.
    logsRef.current = [...logsRef.current, entry]
    setLogs(logsRef.current)
  }

  async function runSingle(buttonId?: string) {
    await runGuard.run(async () => {
      setFormPrompt(null)
      setRunning(true)
      // Cleanup previous runs
      await cleanupAllRuns()
      setTestCases(prev => prev.map(c => ({ ...c, status: null })))
      await executeSingleCase(selectedCase, buttonId)
      setRunning(false)
    })
  }

  /**
   * Run Selected. With a form start (form view) it never runs: it shows and
   * focuses the case's form, which starts the test from its own button.
   */
  const onRunSelectedRef = useRef<(() => void) | null>(null)
  useEffect(() => { onRunSelectedRef.current = onRunSelected })
  function onRunSelected() {
    const decision = runSelectedDecision(gate, view)
    if (decision.action === 'run') { void runSingle(); return }
    setFormPrompt(decision.message)
    if (decision.action === 'blocked') return
    setShowInputs(true)
    requestAnimationFrame(() => {
      const panel = formPanelRef.current
      panel?.scrollIntoView({ block: 'nearest' })
      panel?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])')?.focus()
    })
  }

  /** A button of the start form: validate as the form does, then start the test with it. */
  async function pressFormButton(button: FormButton) {
    if (!formSpec || running) return
    setFormFailure(null)
    if (runsBlocked && button.kind !== 'cancel') { setFormFailure('Fix the configuration issues above (or choose Run anyway) first.'); return }
    if (button.kind === 'cancel') {
      // A real Cancel discards the answers: reset this case to the form's defaults.
      setTestCases(prev => prev.map(c => c.id === selectedCase.id ? { ...c, formValues: {} } : c))
      setFormErrors({})
      return
    }
    const fields = formSpec.kind === 'form' ? formSpec.form.fields : formSpec.fields
    const errors = validateTaskFieldValues(fields, caseFormValues(selectedCase), { layout: formSpec.kind === 'form' ? formSpec.form.layout : formSpec.layout })
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    setFormErrors({})
    if (formSpec.kind === 'form') setTestCases(prev => prev.map(c => c.id === selectedCase.id ? { ...c, buttonId: button.id } : c))
    setFormBusy(button.id)
    try { await runSingle(formSpec.kind === 'form' ? button.id : undefined) } finally { setFormBusy(null) }
  }

  async function runAll() {
    await runGuard.run(async () => {
      setRunning(true)
      setRunningAll(true)
      runningAllRef.current = true
      abortRef.current = false
      // Cleanup previous runs
      await cleanupAllRuns()
      setTestCases(prev => prev.map(c => ({ ...c, status: null, skippedReason: undefined })))
      setFormPrompt(null)

      for (const tc of testCasesRef.current) {
        if (abortRef.current) break
        // A form start reruns the case's last submission; never submitted → skipped.
        const decision = runAllCaseDecision(gate, tc)
        if (decision.action === 'skip') {
          const log = { level: 'warn', message: `── Test Case: ${tc.name} ── ${decision.label}${decision.label === NEEDS_FORM_INPUT ? ': select the case, fill in the form and press its button (Run All then reruns that submission)' : ''}` }
          setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, status: 'skipped', skippedReason: decision.label } : c))
          caseSnapshotsRef.current[tc.id] = { nodeResults: {}, logs: [log], finalStatus: null, pausedNodeId: null, pausedEventId: null, pausedRunId: null, done: true }
          continue
        }
        await executeSingleCase({ ...tc, ...decision.inputs })
        // Brief pause between cases for visual clarity
        await new Promise(r => setTimeout(r, 600))
      }

      runningAllRef.current = false
      setRunning(false)
      setRunningAll(false)
    })
  }

  function handleSSEEvent(event: any) {
    switch (event.type) {
      case 'node_start':
        setActiveNodeId(event.node_id)
        break
      case 'node_complete':
        // Sync the ref SYNCHRONOUSLY, not inside the state updater: updaters
        // run at React flush time, but the per-case snapshot is captured in
        // the same tick the events arrive (JSON fallback processes every
        // event synchronously) — an updater-synced ref would still be empty,
        // snapshotting a blank canvas for every case except the live last one.
        nodeResultsRef.current = { ...nodeResultsRef.current, [event.node_id]: event.data }
        setNodeResults(nodeResultsRef.current)
        setActiveNodeId(null)
        // Check if this is a test-mode user task prompt
        if (event.data?.status === 'test_user_task') {
          setTestTaskPrompt({
            eventId: event.data.event_id,
            nodeId: event.node_id!,
            title: event.data.task_title,
            description: event.data.task_description,
            outcomes: event.data.outcomes ?? ['completed'],
            fields: normalizeTaskFields(event.data.fields),
            layout: normalizeFormLayout(event.data.form_layout, normalizeTaskFields(event.data.fields).map((f) => f.key)),
            theme: parseFormThemeOverrides(event.data.form_theme),
          })
          // The case's saved values for this task (last time the tester completed it) over the defaults.
          const savedValues = savedTaskValuesFor(testCasesRef.current.find(c => c.id === currentCaseIdRef.current)?.taskValues, event.node_id)
          const promptFields = normalizeTaskFields(event.data.fields)
          const prefilled = (event.data.values ?? {}) as Record<string, unknown>
          setTestTaskValues(testTaskStartValues(promptFields, prefilled, savedValues))
          setTestTaskErrors({})
          pausePromptRef.current = {
            kind: 'task', nodeId: event.node_id, eventId: event.data.event_id, title: event.data.task_title ?? 'Task',
            outcomes: Array.isArray(event.data.outcomes) ? event.data.outcomes : ['completed'],
            fields: promptFields,
            values: prefilled,
          }
        }
        // Check if this is a test-mode server event waiting for callback
        if (event.data?.status === 'test_server_event') {
          setTestServerEvent({
            eventId: event.data.event_id,
            nodeId: event.node_id!,
            eventName: event.data.event_name ?? 'event',
          })
          pausePromptRef.current = { kind: 'event', nodeId: event.node_id!, eventId: event.data.event_id, eventName: event.data.event_name ?? 'event' }
        }
        break
      case 'node_error':
        nodeResultsRef.current = { ...nodeResultsRef.current, [event.node_id]: event.data }
        setNodeResults(nodeResultsRef.current)
        setActiveNodeId(null)
        break
      case 'log':
        // A Run Agent step streaming its reply: shown live on the step, not as log lines.
        if (event.node_id && (event.data?.type === 'delta' || event.data?.type === 'delta_reset' || event.data?.type === 'tool_call_delta')) {
          const nodeId = String(event.node_id)
          if (event.data.type === 'tool_call_delta') break
          setAgentLive(prev => {
            const current = prev[nodeId]?.text ?? ''
            const text = event.data.type === 'delta_reset' ? '' : current + String(event.data.text ?? '')
            return { ...prev, [nodeId]: { text, streaming: true } }
          })
          break
        }
        if (event.node_id && event.data?.type === 'tool_call') {
          // The model moved on to a tool call: what it streamed so far stays, the next reply starts below it.
          setAgentLive(prev => prev[String(event.node_id)] ? { ...prev, [String(event.node_id)]: { text: `${prev[String(event.node_id)].text}\n→ ${event.data.toolCall?.toolName ?? 'tool'}\n`, streaming: true } } : prev)
        }
        // Agent loop events (Run Agent steps) carry no message: describe them.
        if (event.data && !event.data.message && typeof event.data.type === 'string') {
          const d = event.data
          const message = d.type === 'iteration' ? `Agent: model call ${d.iteration ?? ''}`.trim()
            : d.type === 'tool_call' ? `Agent: calling ${d.toolCall?.toolName ?? 'a tool'}`
            : d.type === 'tool_result' ? `Agent: ${d.toolCall?.toolName ?? 'tool'} returned${d.toolCall?.status && d.toolCall.status !== 'ok' ? ` (${d.toolCall.status})` : ''}`
            : d.type === 'complete' ? `Agent: finished (${d.usage?.total_tokens ?? 0} tokens)`
            : d.type === 'approval_required' ? `Agent: ${d.toolCall?.toolName ?? 'a tool call'} needs approval`
            : d.type === 'error' ? `Agent: ${d.error ?? 'error'}`
            : null
          if (message) { appendLog({ level: d.type === 'error' ? 'warn' : 'info', message, node_id: event.node_id }); break }
        }
        appendLog(event.data)
        break
      case 'done':
        const newStatus = event.data?.status ?? 'completed'
        setFinalStatus(newStatus); finalStatusRef.current = newStatus
        if (event.data?.run_id) {
          setPausedRunId(event.data.run_id)
          pausedRunIdRef.current = event.data.run_id
          setRunIds(prev => [...prev, event.data.run_id])
        }
        if (event.data?.error) {
          appendLog({ level: 'error', message: `Workflow finished with error: ${event.data.error}` })
        } else if (newStatus === 'completed') {
          appendLog({ level: 'info', message: 'Workflow finished successfully' })
        }
        // A pause is logged by the engine itself ("Workflow paused — …"); not repeated here.
        if (event.data?.paused_node_id) {
          setPausedNodeId(event.data.paused_node_id); pausedNodeIdRef.current = event.data.paused_node_id
          if (event.data?.event_id) { setPausedEventId(event.data.event_id); pausedEventIdRef.current = event.data.event_id }
        } else if (newStatus === 'completed' || newStatus === 'failed') {
          setPausedNodeId(null); pausedNodeIdRef.current = null
          setPausedEventId(null); pausedEventIdRef.current = null
          setPausedRunId(null); pausedRunIdRef.current = null
          setTestTaskPrompt(null)
          setTestServerEvent(null)
        }
        doneRef.current = true
        break
    }
  }

  async function processResumeResponse(resp: Response): Promise<string | undefined> {
    let resumeStatus: string | undefined
    const ct = resp.headers.get('content-type') ?? ''
    const beforeNodeCount = Object.keys(nodeResultsRef.current).length
    const beforeLogCount = logsRef.current.length

    if (ct.includes('application/json')) {
      const json = await resp.json()
      for (const event of json.events ?? []) {
        if (event.type === 'done') resumeStatus = event.data?.status ?? resumeStatus
        handleSSEEvent(event)
      }
      if (json.result) {
        resumeStatus = json.result.status ?? resumeStatus
        handleSSEEvent({ type: 'done', data: json.result })
      }
      const afterNodeCount = Object.keys(nodeResultsRef.current).length
      const afterLogCount = logsRef.current.length
      if (afterLogCount === beforeLogCount) {
        appendLog({
          level: resumeStatus === 'failed' ? 'error' : 'info',
          message: `Resume returned status: ${resumeStatus ?? 'unknown'}`,
        })
      }
      if ((resumeStatus === 'completed' || resumeStatus === 'failed') && afterNodeCount === beforeNodeCount) {
        appendLog({ level: 'warn', message: 'Resume finished without any downstream node executions' })
      }
      return resumeStatus
    }

    if (!resp.body) return resumeStatus

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done: streamDone, value } = await reader.read()
      if (streamDone) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim().startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.trim().slice(6))
          if (event.type === 'done') resumeStatus = event.data?.status ?? resumeStatus
          handleSSEEvent(event)
        } catch {}
      }
    }
    if (buffer.trim().startsWith('data: ')) {
      try {
        const event = JSON.parse(buffer.trim().slice(6))
        if (event.type === 'done') resumeStatus = event.data?.status ?? resumeStatus
        handleSSEEvent(event)
      } catch {}
    }

    const afterNodeCount = Object.keys(nodeResultsRef.current).length
    const afterLogCount = logsRef.current.length
    if (afterLogCount === beforeLogCount) {
      appendLog({
        level: resumeStatus === 'failed' ? 'error' : 'info',
        message: `Resume returned status: ${resumeStatus ?? 'unknown'}`,
      })
    }
    if ((resumeStatus === 'completed' || resumeStatus === 'failed') && afterNodeCount === beforeNodeCount) {
      appendLog({ level: 'warn', message: 'Resume finished without any downstream node executions' })
    }

    return resumeStatus
  }

  async function cleanupAllRuns() {
    for (const rid of runIds) {
      await fetch('/api/workflows/cleanup-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: rid }),
        keepalive: true,
      }).catch(() => {})
    }
    setRunIds([])
  }

  function handleClose() {
    abortRef.current = true
    cleanupAllRuns()
    onClose()
  }

  // Canvas: the designer's cards with this run as an overlay (shared with the run viewer).
  /** "Ask Agent to fix": the failure (redacted) goes to the Agent; a fix it makes can be re-run with the same inputs. */
  function askFix() {
    const failedId = Object.entries(nodeResults).find(([, r]) => r?.status === 'error')?.[0] ?? null
    const failedLog = [...logs].reverse().find((l) => l?.level === 'error')
    const error = (failedId ? nodeResults[failedId]?.error : null) ?? failedLog?.metadata?.error ?? failedLog?.message ?? 'The run failed'
    const attachment = failureAttachment({
      workflow: { id: workflowId, name: workflowName }, nodes: nodes as never, edges: edges as never,
      failedNodeId: failedId, error: String(error), logs, inputs: selectedCase.values, source: 'test', triggerType: triggerType ?? null,
    })
    askAgentToFix(attachment, { workflowId, values: selectedCase.values }, FIX_PROMPT)
  }

  const runOverlay = computeRunOverlay({
    nodes,
    edges,
    nodeResults,
    pausedNodeId,
    runWaiting: finalStatus === 'waiting_for_event',
    activeNodeId,
  })

  function formatLogLine(log: any) {
    const dur = log.duration_ms != null ? ` (${log.duration_ms}ms)` : ''
    const node = log.node_label ? ` [${log.node_label}]` : ''
    const meta = log.metadata ? `\n  ${JSON.stringify(log.metadata, null, 2).replace(/\n/g, '\n  ')}` : ''
    return `${log.level.toUpperCase()}${node} ${log.message}${dur}${meta}`
  }

  function copyLog(e: React.MouseEvent, idx: number) {
    e.stopPropagation()
    navigator.clipboard.writeText(formatLogLine(logs[idx]))
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  function copyAllLogs() {
    navigator.clipboard.writeText(logs.map(formatLogLine).join('\n'))
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 1500)
  }

  const showCanvas = running || done || resuming
  const logCount = logs.length
  const completedCount = testCases.filter(c => c.status === 'completed').length
  const failedCount = testCases.filter(c => c.status === 'failed').length
  const pausedCount = testCases.filter(c => c.status === 'paused').length
  const skippedCount = testCases.filter(c => c.status === 'skipped').length
  const formStart = gate.kind === 'form' || gate.kind === 'start_form'
  const startBlocked = runsBlocked || gate.kind === 'loading'

  return (
    <div className={`${overlayClass} flex items-center justify-center`}>
      <div
        data-test-runner=""
        data-maximised={maximised ? '' : undefined}
        style={maximised
          ? { width: '100vw', height: '100dvh', padding: 8 }
          // Resizable from the bottom-right corner.
          : { resize: 'both', overflow: 'auto', minWidth: 'min(500px, 95vw)', minHeight: '400px', width: '90vw', maxWidth: '98vw', height: '90vh', maxHeight: '98vh' }}
      >
        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-elevated text-fg shadow-elev-3">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Play size={16} className="shrink-0 text-primary-text" aria-hidden="true" />
            <h2 className="text-base font-semibold text-fg">Test workflow</h2>
            {running && (
              <Badge pill tone="info" className="gap-1">
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                {runningAll ? `Running ${testCases.findIndex(c => c.status === 'running') + 1}/${testCases.length}` : 'Running'}
              </Badge>
            )}
            {!running && skippedCount > 0 && (
              <Badge pill tone="warning" className="gap-1" data-test-skipped-count>
                <TriangleAlert size={12} aria-hidden="true" /> {skippedCount} need{skippedCount === 1 ? 's' : ''} form input
              </Badge>
            )}
            {done && !running && (completedCount > 0 || failedCount > 0 || pausedCount > 0 || finalStatus === 'waiting_for_event') && (
              <div className="flex items-center gap-1.5">
                {finalStatus === 'waiting_for_event' && pausedCount === 0 && (
                  <StatusPill status="waiting_for_event" label="Awaiting action" />
                )}
                {completedCount > 0 && (
                  <StatusPill status="completed" label={`${formatCount(completedCount)} passed`} />
                )}
                {failedCount > 0 && (
                  <StatusPill status="failed" label={`${formatCount(failedCount)} failed`} />
                )}
                {pausedCount > 0 && (
                  <StatusPill status="paused" label={`${formatCount(pausedCount)} paused`} />
                )}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {done && !running && (failedCount > 0 || finalStatus === 'failed') && canAskAgentToFix(agentState.availability, canEdit) && (
              <Button size="sm" variant="secondary" leadingIcon={<Sparkles />} onClick={askFix} data-testid="test-ask-agent-fix">Ask Agent to fix</Button>
            )}
            <AgentDialogButton />
            <IconButton size="sm" onClick={() => setMaximised((m) => !m)} aria-pressed={maximised}
              label={maximised ? 'Restore dialog size' : 'Expand to the full window'}
              icon={maximised ? <Minimize2 /> : <Maximize2 />} />
            <IconButton size="sm" onClick={handleClose} label="Close test runner" icon={<X />} />
          </div>
        </div>

        {/* Main body: sidebar + content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
          {/* Left: Test Cases List (a strip above the form on phones) */}
          <div className="flex max-h-[30vh] w-full shrink-0 flex-col overflow-hidden border-b border-border-subtle sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r">
            {/* Test case list header */}
            <div className="flex items-center justify-between border-b border-border-subtle py-1.5 pl-3 pr-1.5">
              <span className="text-xs font-medium text-fg-muted">
                Test cases <span className="num">({formatCount(testCases.length)})</span>
              </span>
              <IconButton size="sm" onClick={addTestCase} disabled={running} label="Add test case" icon={<Plus />} />
            </div>

            {/* Test case items */}
            <div className="flex-1 overflow-y-auto">
              {testCases.map((tc) => (
                <div
                  key={tc.id}
                  onClick={() => {
                    // While a run is in flight, allow browsing already-finished
                    // cases (their snapshots are immutable) — just never steal
                    // focus from the case that's actively executing.
                    if (running && !caseSnapshotsRef.current[tc.id]?.done) return
                    // Save current case snapshot before switching
                    if (!running && selectedCaseId && doneRef.current) {
                      caseSnapshotsRef.current[selectedCaseId] = { nodeResults: { ...nodeResultsRef.current }, logs: [...logsRef.current], finalStatus: finalStatusRef.current, pausedNodeId: pausedNodeIdRef.current, pausedEventId: pausedEventIdRef.current, pausedRunId: pausedRunIdRef.current, done: true }
                    }
                    setSelectedCaseId(tc.id)
                    setFormErrors({}); setFormFailure(null); setFormPrompt(null)
                    // Restore snapshot if available
                    const snap = caseSnapshotsRef.current[tc.id]
                    if (snap) {
                      setNodeResults(snap.nodeResults); nodeResultsRef.current = snap.nodeResults
                      setLogs(snap.logs); logsRef.current = snap.logs
                      setFinalStatus(snap.finalStatus); finalStatusRef.current = snap.finalStatus
                      setPausedNodeId(snap.pausedNodeId); pausedNodeIdRef.current = snap.pausedNodeId
                      setPausedEventId(snap.pausedEventId); pausedEventIdRef.current = snap.pausedEventId
                      setPausedRunId(snap.pausedRunId); pausedRunIdRef.current = snap.pausedRunId
                      setDone(snap.done); doneRef.current = snap.done
                      setActiveNodeId(null)
                      setTestTaskPrompt(null)
                      setTestServerEvent(null)
                    }
                  }}
                  className={`group relative flex min-h-8 cursor-pointer flex-col justify-center border-b border-border-subtle px-3 py-1.5 transition-colors ${selectedCaseId === tc.id ? 'bg-primary-wash' : 'hover:bg-subtle'}`}
                >
                  {selectedCaseId === tc.id && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                  <div className="flex items-center gap-2">
                    {/* Status indicator */}
                    {tc.status === 'running' ? (
                      <Loader2 size={14} className="shrink-0 animate-spin text-info" />
                    ) : tc.status === 'completed' ? (
                      <CheckCircle size={14} className="shrink-0 text-success" />
                    ) : tc.status === 'failed' ? (
                      <XCircle size={14} className="shrink-0 text-danger" />
                    ) : tc.status === 'paused' ? (
                      <PauseCircle size={14} className="shrink-0 text-warning" aria-label={tc.pausedAt ?? 'Paused'} />
                    ) : tc.status === 'skipped' ? (
                      <TriangleAlert size={14} className="shrink-0 text-warning" aria-label={tc.skippedReason ?? 'Skipped'} />
                    ) : (
                      <Clock size={14} className="shrink-0 text-fg-subtle" />
                    )}

                    <input
                      value={tc.name}
                      onChange={e => updateCaseName(tc.id, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      disabled={running}
                      aria-label="Test case name"
                      className={`min-w-0 flex-1 truncate rounded-sm border-none bg-transparent text-ui font-medium disabled:cursor-pointer ${selectedCaseId === tc.id ? 'text-primary-text' : 'text-fg'}`}
                    />

                    {testCases.length > 1 && !running && (
                      <IconButton
                        size="sm"
                        variant="danger-ghost"
                        onClick={e => { e.stopPropagation(); removeTestCase(tc.id) }}
                        label="Remove test case"
                        icon={<Trash2 />}
                        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
                      />
                    )}
                  </div>

                  {tc.status === 'skipped' && tc.skippedReason && (
                    <p className="mt-0.5 truncate text-2xs text-warning" title={tc.skippedReason} data-test-case-skipped>{tc.skippedReason}</p>
                  )}
                  {tc.status === 'paused' && tc.pausedAt && (
                    <p className="mt-0.5 truncate text-2xs text-warning" title={tc.pausedAt}>{tc.pausedAt}</p>
                  )}

                  {/* Preview of the form's values */}
                  {formSpec?.kind === 'form' && plainKeys.length > 0 && (() => {
                    const { chips, more } = valueChips(caseFormValues(tc), plainKeys.map((k) => k.key))
                    return (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {chips.map((chip) => (
                          <span key={chip} className="max-w-[80px] truncate rounded-sm bg-subtle px-1 font-mono text-2xs text-fg-muted">{chip}</span>
                        ))}
                        {more > 0 && <span className="num px-1 text-2xs text-fg-muted">+{more}</span>}
                      </div>
                    )
                  })()}
                  {/* Preview of variable values */}
                  {userVariables.length > 0 && formSpec?.kind !== 'form' && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {userVariables.slice(0, 3).map(v => (
                        <span key={v.name} className="max-w-[80px] truncate rounded-sm bg-subtle px-1 font-mono text-2xs text-fg-muted">
                          {v.name}={tc.values[v.name] || '""'}
                        </span>
                      ))}
                      {userVariables.length > 3 && (
                        <span className="num px-1 text-2xs text-fg-muted">
                          +{userVariables.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Bottom actions */}
            <div className="shrink-0 space-y-1.5 border-t border-border-subtle px-3 py-2">
              <Button size="sm" onClick={addTestCase} variant="secondary" disabled={running} className="w-full" leadingIcon={<Plus />}>
                Add test case
              </Button>
              {selectedCase && !running && (
                <Button size="sm" onClick={() => duplicateTestCase(selectedCase)} variant="secondary" className="w-full" leadingIcon={<Copy />}>
                  Duplicate selected
                </Button>
              )}
            </div>
          </div>

          {/* Right: Variables + Canvas/Logs */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* The start form, as its users see it */}
            {formSpec && view === 'form' && showInputs && (
              <div ref={formPanelRef} className={`border-b border-border-subtle bg-subtle px-4 py-3 ${showCanvas ? 'shrink-0 max-h-[55%]' : 'flex-1 min-h-0'} overflow-auto`} data-test-start-form={formSpec.kind}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-fg-muted">
                    {formSpec.kind === 'form' ? `Form “${formSpec.form.name}”` : 'Start form'} — {selectedCase.name}
                  </p>
                  <ViewToggle view={view} onChange={setView} />
                </div>
                {/* Form width (lib/forms/form-width.ts): the panel is the available width. */}
                {(() => { const w = formCardWidth(formSpec.kind === 'form' ? formSpec.form.theme_overrides : formSpec.theme_overrides, formSpec.kind === 'form' ? formSpec.form.fields : formSpec.fields); return (
                <div className={`mx-auto ${w.className}`} style={w.style as React.CSSProperties} data-form-width-mode={w.width}>
                  <FormAttachmentsProvider source={formSpec.kind === 'start_form' ? { kind: 'test', workflowId } : null}>
                  <WorkflowStartFormView
                    spec={formSpec}
                    idPrefix={`test-form-${selectedCase.id.slice(0, 8)}-`}
                    values={caseFormValues(selectedCase)}
                    errors={formErrors}
                    onChange={(key, value) => updateCaseForm(selectedCase.id, key, value)}
                    onPress={(button) => void pressFormButton(button)}
                    busy={formBusy}
                    disabled={running}
                    failure={formFailure}
                    startLabel={TEST_START_LABEL}
                    note={
                      <>
                      {formPrompt && (
                        <p className="mt-3 text-xs font-medium text-primary-text" role="status" data-test-form-prompt>{formPrompt}</p>
                      )}
                      <p className="mt-3 text-2xs text-fg-muted" data-test-submission-note>
                        {formSpec.kind === 'form'
                          ? 'Test submission: the run starts with what this form would send. Nothing is stored, no other workflow is triggered and the button’s actions only show in the Logs.'
                          : 'Test run: starts this workflow’s draft with these inputs.'}
                        {runsBlocked ? ' Fix the configuration issues (or choose Run anyway) first.' : ''}
                      </p>
                      </>
                    }
                  />
                  </FormAttachmentsProvider>
                </div>
                ) })()}
              </div>
            )}

            {/* The form's values as plain inputs (power users) */}
            {formSpec?.kind === 'form' && view === 'fields' && showInputs && (
              <div className="max-h-[45%] shrink-0 space-y-2 overflow-auto border-b border-border-subtle bg-subtle px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-fg-muted">
                    Form values — {selectedCase.name}
                  </p>
                  <ViewToggle view={view} onChange={setView} />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {plainKeys.map(k => (
                    <div key={k.key}>
                      <label htmlFor={`tf-plain-${k.key}`} className="mb-1 block font-mono text-xs font-medium text-fg">
                        form.{k.key}<span className="ml-1 font-sans font-normal text-fg-muted">({k.type})</span>
                      </label>
                      <Input
                        id={`tf-plain-${k.key}`}
                        size="sm"
                        value={fieldText(caseFormValues(selectedCase)[k.key])}
                        onChange={e => updateCaseForm(selectedCase.id, k.key, parseFieldText(e.target.value))}
                        placeholder={k.label}
                        className="font-mono"
                        disabled={running}
                        aria-invalid={formErrors[k.key] ? true : undefined}
                      />
                      {formErrors[k.key] && <p className="mt-0.5 text-xs text-danger">{formErrors[k.key]}</p>}
                    </div>
                  ))}
                </div>
                {formFailure && <p className="text-xs text-danger" role="alert">{formFailure}</p>}
              </div>
            )}

            {/* Variable inputs for selected case */}
            {userVariables.length > 0 && showInputs && (!formSpec || (formSpec.kind === 'start_form' && view === 'fields')) && (
              <div className={`${testTaskPrompt ? 'max-h-[20%]' : 'max-h-[40%]'} shrink-0 space-y-2 overflow-auto border-b border-border-subtle bg-subtle px-5 py-3`} data-test-variables>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-fg-muted">
                    Variables — {selectedCase.name}
                  </p>
                  {formSpec && <ViewToggle view={view} onChange={setView} />}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {userVariables.map(v => (
                    <div key={v.name}>
                      <label htmlFor={`tr-var-${v.name}`} className="mb-1 block font-mono text-xs font-medium text-fg">
                        {v.name}
                        <span className="ml-1 font-sans font-normal text-fg-muted">({v.type})</span>
                      </label>
                      <Input
                        id={`tr-var-${v.name}`}
                        size="sm"
                        value={selectedCase.values[v.name] ?? ''}
                        onChange={e => updateCaseValue(selectedCase.id, v.name, e.target.value)}
                        placeholder={v.description || v.defaultValue || v.name}
                        className="font-mono"
                        disabled={running}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pre-run validation — same checks that gate publishing */}
            {!validation.valid && (
              <div className="shrink-0 space-y-1 border-b border-border-subtle bg-warning-wash px-5 py-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-warning">
                  <TriangleAlert size={14} aria-hidden="true" />
                  {plural(validation.totalErrors, 'configuration issue')} found — fix before testing
                </div>
                {validation.nodeErrors.slice(0, 4).map((nodeError) => (
                  <p key={nodeError.nodeId} className="text-xs text-fg">
                    {nodeError.nodeLabel}: {nodeError.errors.join(', ')}
                  </p>
                ))}
                {validation.nodeErrors.length > 4 && (
                  <p className="text-xs text-fg-muted">…and {validation.nodeErrors.length - 4} more</p>
                )}
                {!validationOverride && (
                  <button
                    type="button"
                    onClick={() => setValidationOverride(true)}
                    className="text-xs font-medium text-warning hover:underline"
                  >
                    Run anyway — I know what I&apos;m doing
                  </button>
                )}
              </div>
            )}

            {/* Action bar */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle px-5 py-2">
              <Button size="sm" onClick={onRunSelected} disabled={running || startBlocked} data-test-run-selected
                leadingIcon={running && !runningAll ? <Loader2 className="animate-spin" /> : <PlayCircle />}
                title={runsBlocked ? 'Fix the configuration issues above (or choose Run anyway)' : gate.kind === 'loading' ? 'Loading the start form…' : formStart && view === 'form' ? 'Opens this case’s form: the test starts when you press its button' : undefined}>
                {running && !runningAll ? 'Running…' : 'Run selected'}
              </Button>

              {linksForms && can('forms.edit') && (
                <label className="flex select-none items-center gap-1.5 text-xs text-fg-muted" data-test-form-drafts=""
                  title="Off: User Task steps show their linked forms as published (what the workflow uses). On: they show each form's unpublished draft, when it has one">
                  <input type="checkbox" checked={useFormDrafts} disabled={running} onChange={(e) => setUseFormDrafts(e.target.checked)} />
                  Use form drafts
                </label>
              )}

              {testCases.length > 1 && (
                <label className="flex select-none items-center gap-1.5 text-xs text-fg-muted"
                  title="Run All never waits at a User Task: with this on, a task this case has completed before is completed again with the same outcome and values; otherwise the case is reported as paused and the next one runs">
                  <input type="checkbox" checked={autoCompleteTasks} disabled={running}
                    onChange={(e) => { setAutoCompleteTasks(e.target.checked); autoCompleteRef.current = e.target.checked }} />
                  Complete tasks with saved values
                </label>
              )}

              {testCases.length > 1 && (
                <Button size="sm" variant="secondary" onClick={runAll} disabled={running || startBlocked} data-test-run-all
                  leadingIcon={runningAll ? <Loader2 className="animate-spin" /> : <ListChecks />}
                  title={runsBlocked ? 'Fix the configuration issues above (or choose Run anyway)' : formStart ? 'Reruns each case with the values its form last submitted; cases never submitted are skipped (needs form input)' : undefined}>
                  {runningAll ? `Running ${testCases.findIndex(c => c.status === 'running') + 1}/${testCases.length}…` : formStart ? 'Run all (saved values)' : 'Run all'}
                </Button>
              )}

              {(userVariables.length > 0 || formSpec) && (
                <Button size="sm" variant="ghost" onClick={() => setShowInputs((v) => !v)} aria-pressed={!showInputs} leadingIcon={<SlidersHorizontal />}
                  title={showInputs ? 'Hide the inputs (more room for the canvas)' : 'Show the inputs'}>
                  {formSpec && view === 'form' ? (showInputs ? 'Hide form' : 'Show form') : (showInputs ? 'Hide inputs' : 'Show inputs')}
                </Button>
              )}

              {showCanvas && (
                <SegmentedControl
                  aria-label="Test result view"
                  size="sm"
                  className="ml-auto"
                  value={tab}
                  onValueChange={setTab}
                  options={[
                    { value: 'canvas', text: 'Process view' },
                    { value: 'logs', text: <>Logs <span className="num">({formatCount(logCount)})</span></> },
                  ]}
                />
              )}
            </div>

            {formPrompt && !(formSpec && view === 'form' && showInputs) && (
              <p className="shrink-0 border-b border-border-subtle px-5 py-2 text-xs font-medium text-warning" role="status" data-test-form-prompt>{formPrompt}</p>
            )}

            {/* Test-mode User Task Action Panel */}
            {testTaskPrompt && !resuming && (
              // A long form scrolls inside the panel; the outcome buttons stay in its footer.
              <div className="mx-4 my-2 flex min-h-[10rem] max-h-max flex-[3_1_0%] flex-col overflow-hidden rounded-lg border border-warning bg-warning-wash animate-in fade-in" data-test-task-panel>
                <div className="flex min-h-0 flex-1 items-start gap-3 overflow-y-auto p-4" data-test-task-scroll>
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-panel text-warning">
                    <Clock size={16} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-fg">{testTaskPrompt.title}</p>
                    {testTaskPrompt.description && (
                      <TaskDescription value={testTaskPrompt.description} className="mt-0.5 text-xs text-fg-muted" />
                    )}
                    <p className="mt-1 text-xs text-warning">
                      Test mode — action this task to continue the workflow
                    </p>
                    {testTaskPrompt.fields.length > 0 && (
                      <div className="mt-3">
                        <FormLookupProvider source={{ kind: 'preview' }}>
                        <FormAttachmentsProvider source={{ kind: 'test', workflowId }}>
                        <TaskFields
                          compact
                          fields={testTaskPrompt.fields}
                          layout={testTaskPrompt.layout}
                          theme={testTaskPrompt.theme}
                          values={testTaskValues}
                          errors={testTaskErrors}
                          onChange={(key, value) => setTestTaskValues(prev => ({ ...prev, [key]: value }))}
                          footer={<FormBarRegistration buttons={testTaskPrompt.outcomes.map((o) => ({ id: o.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[^a-z0-9]+/, '') || 'outcome', label: o, kind: 'outcome' as const, style: 'primary' as const, outcome: o }))} onClick={(b) => void actionTestTask(b.outcome ?? testTaskPrompt.outcomes[0])} />}
                        />
                        </FormAttachmentsProvider>
                        </FormLookupProvider>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-warning px-4 py-2" data-test-task-actions>
                  {testTaskPrompt.outcomes.map((outcome, i) => (
                    <Button key={outcome} size="sm" variant={i === 0 ? 'primary' : 'secondary'} disabled={resuming}
                      onClick={() => void actionTestTask(outcome)}>
                      {resuming ? 'Resuming…' : outcome.charAt(0).toUpperCase() + outcome.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Test-mode Server Event Action Panel */}
            {testServerEvent && !resuming && (
              <div className="mx-4 my-2 rounded-lg border border-info bg-info-wash p-4 animate-in fade-in">
                <div className="flex items-start gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-panel text-info">
                    <Clock size={16} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-fg">Waiting for: {testServerEvent.eventName}</p>
                    <p className="mt-1 text-xs text-info">
                      Test mode — resume this server event to continue the workflow
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <Button size="sm" disabled={resuming}
                        onClick={async () => {
                          setResuming(true)
                          setTestServerEvent(null)
                          appendLog({ level: 'info', message: `Resuming workflow for server event "${testServerEvent.eventName}"` })
                          try {
                            const resumeKey = pausedRunIdRef.current ?? pausedEventIdRef.current ?? testServerEvent.eventId
                            const resp = await fetch('/api/workflows/execute-stream', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                              body: JSON.stringify({
                                workflow_id: workflowId,
                                resume_event_id: resumeKey,
                                variables: {},
                              }),
                            })
                            if (!resp.ok) {
                              const errText = await resp.text().catch(() => '')
                              throw new Error(errText || `Resume failed with status ${resp.status}`)
                            }
                            const resumeStatus = await processResumeResponse(resp)
                            appendLog({ level: 'info', message: `Resume request completed with status "${resumeStatus ?? finalStatusRef.current ?? 'unknown'}"` })
                            if (resumeResolveRef.current) {
                              resumeResolveRef.current(resumeStatus ?? finalStatusRef.current ?? 'completed')
                              resumeResolveRef.current = null
                            }
                          } catch (err: any) {
                            appendLog({ level: 'error', message: `Resume failed: ${err.message}` })
                            setFinalStatus('failed')
                            finalStatusRef.current = 'failed'
                            if (resumeResolveRef.current) {
                              resumeResolveRef.current('failed')
                              resumeResolveRef.current = null
                            }
                          }
                          setResuming(false)
                        }}>
                        {resuming ? 'Resuming…' : 'Resume event'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Content area: the run canvas fills it (its zoom controls stay inside the dialog). */}
            <div className={`${!showCanvas && formSpec && view === 'form' && showInputs ? 'hidden' : 'flex-1'} min-h-0 flex flex-col ${showCanvas && tab === 'canvas' ? 'overflow-hidden p-3' : 'overflow-auto'}`}>
              {!showCanvas && !(formSpec && view === 'form' && showInputs) && (
                <EmptyState
                  icon={Zap}
                  className="h-full"
                  title={gate.kind === 'unavailable' ? 'Test can’t start' : 'No test run yet'}
                  description={gate.kind === 'unavailable'
                    ? gate.reason
                    : formSpec
                    ? 'Fill in the form and press its button to start the test (Run all reruns each case’s last submission)'
                    : userVariables.length > 0
                    ? 'Configure test cases on the left, then Run selected or Run all'
                    : 'Click Run selected to execute the workflow'}
                />
              )}

              {showCanvas && tab === 'canvas' && Object.entries(agentLive).filter(([, v]) => v.text).map(([nodeId, v]) => {
                const label = nodes.find((n) => n.id === nodeId)?.label ?? 'Run Agent'
                const streaming = activeNodeId === nodeId
                return (
                  <div key={nodeId} className="mb-2 shrink-0 space-y-1 rounded-lg border border-border bg-panel p-3" data-testid="test-runner-agent-stream" aria-live="polite">
                    <span className="text-xs font-medium text-primary-text">{label} · agent reply{streaming ? ' (streaming)' : ''}</span>
                    <p className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-fg">{v.text}</p>
                  </div>
                )
              })}
              {showCanvas && tab === 'canvas' && (
                <RuntimeCanvas
                  nodes={nodes}
                  edges={edges}
                  swimlanes={swimlanes}
                  overlay={runOverlay}
                  nodeResults={nodeResults}
                  workflowActive={workflowActive}
                  workflowId={workflowId}
                  fill
                  focusRequest={focusRequest}
                  markerPrefix="tr-arrow"
                  label="Test run canvas"
                  renderDetails={(node) => {
                    const nr = nodeResults[node.id]
                    const isWaiting = pausedNodeId === node.id && finalStatus === 'waiting_for_event'
                    const nodeEventId = nr?.output?.event_id ?? (isWaiting ? pausedEventId : null)
                    if (!nodeEventId || !(isWaiting || nr?.status === 'waiting')) return null
                    return (
                      <div className="mx-3 mb-2 space-y-2 rounded-lg border border-border bg-panel p-3">
                        <span className="text-xs font-medium text-warning">Server event ID</span>
                        <div className="flex items-center gap-1.5">
                          <code className="flex-1 select-all break-all rounded-md bg-subtle px-2 py-1.5 font-mono text-2xs text-fg">
                            {nodeEventId}
                          </code>
                          <IconButton
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(nodeEventId)
                              setCopiedEventId(true)
                              setTimeout(() => setCopiedEventId(false), 2000)
                            }}
                            className={copiedEventId ? 'text-success' : undefined}
                            label="Copy event ID"
                            icon={copiedEventId ? <ClipboardCheck /> : <Copy />}
                          />
                        </div>
                        <p className="text-2xs text-fg-muted">Use this ID to complete the event via the API:</p>
                        <code className="block select-all rounded-md bg-subtle px-2 py-1.5 font-mono text-2xs text-fg-muted">
                          POST /api/v1/workflows/events/{nodeEventId}/complete
                        </code>
                      </div>
                    )
                  }}
                />
              )}

              {showCanvas && tab === 'logs' && (
                <div className="overflow-auto">
                  {logCount === 0 ? (
                    <div className="flex flex-col items-center py-8">
                      {running && <Loader2 size={20} className="mb-2 animate-spin text-primary-text" />}
                      <p className="text-xs text-fg-muted">
                        {running ? 'Waiting for logs…' : 'No logs'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-end border-b border-border-subtle px-4 py-1.5">
                        <Button size="sm" variant="ghost" onClick={copyAllLogs} className={copiedAll ? 'text-success' : undefined}
                          leadingIcon={copiedAll ? <ClipboardCheck /> : <Copy />}>
                          {copiedAll ? 'Copied' : 'Copy all'}
                        </Button>
                      </div>
                      <div className="divide-y divide-border-subtle">
                        {logs.map((log: any, idx: number) => {
                          const isExpanded = expandedLog === idx
                          const tone = LOG_LEVEL_TONE[log.level] ?? LOG_LEVEL_TONE.debug
                          return (
                            <div key={idx} className="group cursor-pointer px-4 py-2 animate-in fade-in slide-in-from-bottom-1 duration-200 hover:bg-subtle"
                              onClick={() => setExpandedLog(isExpanded ? null : idx)}>
                              <div className="flex items-center gap-2">
                                <span className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} />
                                <span className={`w-10 shrink-0 font-mono text-2xs ${tone.text}`}>{log.level}</span>
                                {log.node_label && (() => {
                                  const stepId = logStepId(log, nodes)
                                  return <StepChip label={log.node_label} onFocus={stepId ? () => focusStep(stepId) : undefined} />
                                })()}
                                <span className="flex-1 truncate text-xs text-fg">{log.message}</span>
                                {log.duration_ms != null && (
                                  <span className="num shrink-0 font-mono text-2xs text-fg-muted">{formatDurationMs(log.duration_ms)}</span>
                                )}
                                <IconButton
                                  size="sm"
                                  onClick={e => copyLog(e, idx)}
                                  label="Copy log entry"
                                  icon={copiedIdx === idx ? <ClipboardCheck /> : <Copy />}
                                  className={`opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 ${copiedIdx === idx ? 'text-success' : ''}`}
                                />
                                {log.metadata && (isExpanded ? <ChevronDown size={12} className="shrink-0 text-fg-muted" /> : <ChevronRight size={12} className="shrink-0 text-fg-muted" />)}
                              </div>
                              {isExpanded && log.metadata && (
                                <pre className="mt-1 overflow-x-auto rounded-md bg-subtle p-2 font-mono text-2xs text-fg-muted">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              )}
                            </div>
                          )
                        })}
                        <div ref={logsEndRef} />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          {agentPanel}
        </div>
        </div>
      </div>
    </div>
  )
}

/** Log level → dot and text colour. */
const LOG_LEVEL_TONE: Record<string, { dot: string; text: string }> = {
  info: { dot: 'bg-info', text: 'text-info' },
  warn: { dot: 'bg-warning', text: 'text-warning' },
  error: { dot: 'bg-danger', text: 'text-danger' },
  debug: { dot: 'bg-fg-subtle', text: 'text-fg-muted' },
}

/** "Show as form" / "Show as fields" (power users: the raw values). */
function ViewToggle({ view, onChange }: { view: 'form' | 'fields'; onChange: (view: 'form' | 'fields') => void }) {
  return (
    <Button type="button" size="sm" variant="ghost" onClick={() => onChange(view === 'form' ? 'fields' : 'form')}
      className="text-primary-text" data-test-form-view={view}>
      {view === 'form' ? 'Show as fields' : 'Show as form'}
    </Button>
  )
}
