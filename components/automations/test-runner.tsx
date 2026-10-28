'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play, X, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight, Copy, ClipboardCheck, Loader2, Zap, Plus, Trash2, PlayCircle, ListChecks, TriangleAlert, Maximize2, Minimize2, SlidersHorizontal, PauseCircle } from 'lucide-react'
import { validateWorkflow } from '@/lib/workflow-validation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { logStepId, RuntimeCanvas, StepChip } from './runtime-canvas'
import { computeRunOverlay } from '@/lib/workflow-run-overlay'
import { TaskFields } from '@/components/tasks/task-fields'
import { FormLookupProvider } from '@/components/forms/lookup-field'
import { normalizeFormLayout, type FormLayout } from '@/lib/forms/layout'
import { parseFormThemeOverrides, type FormThemeOverrides } from '@/lib/forms/form-theme'
import { coerceTaskFieldValues, normalizeTaskFields, validateTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import type { UserVariable, Swimlane } from './workflow-builder'
import type { WorkflowNode, WorkflowEdge } from '@/lib/workflow-schema'
import { TaskDescription } from '@/components/tasks/task-description'
import { WorkflowStartFormView } from '@/components/forms/workflow-start-form-view'
import { rememberTaskValues, runAllPauseDecision, savedTaskValuesFor, type CaseTaskValues, type TestPausePrompt } from '@/lib/automations/test-run-all'
import { serverRead } from '@/lib/server-read'
import type { FormButton } from '@/lib/forms/buttons'
import {
  caseFormValues as caseFormValuesOf, copyCaseInputs, fieldText, formDefaultValues, parseFieldText, plainFieldKeys, startFormKind, valueChips, withCaseFormValue,
  type WorkflowStartForm,
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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused' | null
  /** Run All left the case paused here ("Paused at …"). */
  pausedAt?: string
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

export function TestRunner({ workflowId, nodes, edges, userVariables, swimlanes = [], triggerType, workflowActive = false, onClose }: TestRunnerProps) {
  // Test cases
  const [testCases, setTestCases] = useState<TestCase[]>(() => {
    const defaults: Record<string, string> = {}
    for (const v of userVariables) defaults[v.name] = v.defaultValue ?? ''
    return [{ id: crypto.randomUUID(), name: 'Default', values: defaults, status: null }]
  })
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
  /** The step the current case is paused at (mirrors the prompt state for synchronous reads). */
  const pausePromptRef = useRef<(TestPausePrompt & { eventId: string; fields?: TaskFieldDef[] }) | null>(null)
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
        body: JSON.stringify(formSubmission ? { workflow_id: workflowId, form_submission: formSubmission } : { workflow_id: workflowId, variables }),
      })

      if (resp.status === 422 && formSubmission) {
        const json = await resp.json().catch(() => null) as { error?: string; fields?: Record<string, string> } | null
        setFormErrors(json?.fields ?? {})
        setFormFailure(json?.error ?? 'The form could not be submitted')
        appendLog({ level: 'error', message: `Form not submitted: ${json?.error ?? resp.status}`, ...(json?.fields ? { metadata: json.fields } : {}) })
        setTestCases(prev => prev.map(c => c.id === tc.id ? { ...c, status: 'failed' } : c))
        setShowInputs(true)
        setDone(true); doneRef.current = true
        setFinalStatus('failed'); finalStatusRef.current = 'failed'
        caseSnapshotsRef.current[tc.id] = { nodeResults: {}, logs: [...logsRef.current], finalStatus: 'failed', pausedNodeId: null, pausedEventId: null, pausedRunId: null, done: true }
        return null
      }
      if (formSpec && view === 'form' && !runningAll) setShowInputs(false)

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
      current = await resumeTestTask({ eventId: prompt.eventId, title: prompt.title, fields: prompt.fields ?? [] }, decision.outcome, decision.values, { log: false })
    }
    return current === 'completed' ? 'completed' : 'failed'
  }

  /** Resume the paused test run from its User Task with an outcome and values; returns the run's status. */
  async function resumeTestTask(prompt: { eventId: string; title: string; fields: TaskFieldDef[] }, outcome: string, values: Record<string, unknown>, options: { log?: boolean } = {}): Promise<string | undefined> {
    const taskData = { ...values, ...coerceTaskFieldValues(prompt.fields, values) }
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
    setRunning(true)
    // Cleanup previous runs
    await cleanupAllRuns()
    setTestCases(prev => prev.map(c => ({ ...c, status: null })))
    await executeSingleCase(selectedCase, buttonId)
    setRunning(false)
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
    const errors = validateTaskFieldValues(fields, caseFormValues(selectedCase))
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    setFormErrors({})
    if (formSpec.kind === 'form') setTestCases(prev => prev.map(c => c.id === selectedCase.id ? { ...c, buttonId: button.id } : c))
    setFormBusy(button.id)
    try { await runSingle(formSpec.kind === 'form' ? button.id : undefined) } finally { setFormBusy(null) }
  }

  async function runAll() {
    setRunning(true)
    setRunningAll(true)
    runningAllRef.current = true
    abortRef.current = false
    // Cleanup previous runs
    await cleanupAllRuns()
    setTestCases(prev => prev.map(c => ({ ...c, status: null })))

    for (const tc of testCases) {
      if (abortRef.current) break
      await executeSingleCase(tc)
      // Brief pause between cases for visual clarity
      await new Promise(r => setTimeout(r, 600))
    }

    runningAllRef.current = false
    setRunning(false)
    setRunningAll(false)
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
          setTestTaskValues({ ...((event.data.values ?? {}) as Record<string, unknown>), ...(savedValues ?? {}) })
          setTestTaskErrors({})
          pausePromptRef.current = {
            kind: 'task', nodeId: event.node_id, eventId: event.data.event_id, title: event.data.task_title ?? 'Task',
            outcomes: Array.isArray(event.data.outcomes) ? event.data.outcomes : ['completed'],
            fields: normalizeTaskFields(event.data.fields),
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'var(--theme-overlay)' }}>
      <div
        data-test-runner=""
        data-maximised={maximised ? '' : undefined}
        style={maximised
          ? { width: '100vw', height: '100dvh', padding: 8 }
          // Resizable from the bottom-right corner.
          : { resize: 'both', overflow: 'auto', minWidth: 'min(500px, 95vw)', minHeight: '400px', width: '90vw', maxWidth: '98vw', height: '90vh', maxHeight: '98vh' }}
      >
        <div
          className="flex flex-col rounded-2xl border shadow-2xl overflow-hidden w-full h-full"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-surface-border)',
          }}
        >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
          <div className="flex items-center gap-2">
            <Play size={16} style={{ color: 'var(--theme-primary-text)' }} />
            <span className="text-sm font-semibold">Test Workflow</span>
            {running && (
              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full animate-pulse"
                style={{ backgroundColor: 'color-mix(in srgb, var(--status-info) 8%, transparent)', color: 'var(--status-info)' }}>
                <Loader2 size={10} className="animate-spin" />
                {runningAll ? `Running ${testCases.findIndex(c => c.status === 'running') + 1}/${testCases.length}` : 'Running'}
              </span>
            )}
            {done && !running && (completedCount > 0 || failedCount > 0 || pausedCount > 0 || finalStatus === 'waiting_for_event') && (
              <div className="flex items-center gap-1.5">
                {finalStatus === 'waiting_for_event' && pausedCount === 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full animate-pulse"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 8%, transparent)', color: 'var(--theme-warning)' }}>
                    <Clock size={10} /> Awaiting Action
                  </span>
                )}
                {completedCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--theme-success) 8%, transparent)', color: 'var(--theme-success)' }}>
                    <CheckCircle size={10} /> {completedCount} passed
                  </span>
                )}
                {failedCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--theme-danger) 8%, transparent)', color: 'var(--theme-danger)' }}>
                    <XCircle size={10} /> {failedCount} failed
                  </span>
                )}
                {pausedCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 8%, transparent)', color: 'var(--theme-warning)' }}>
                    <PauseCircle size={10} /> {pausedCount} paused
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setMaximised((m) => !m)} className="p-1 rounded hover:opacity-70"
              style={{ color: 'var(--theme-muted-text)' }} aria-pressed={maximised}
              aria-label={maximised ? 'Restore dialog size' : 'Expand to the full window'} title={maximised ? 'Restore' : 'Expand'}>
              {maximised ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button type="button" onClick={handleClose} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }} aria-label="Close test runner">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Main body: sidebar + content */}
        <div className="flex flex-1 flex-col sm:flex-row overflow-hidden">
          {/* Left: Test Cases List (a strip above the form on phones) */}
          <div className="w-full sm:w-64 max-h-[30vh] sm:max-h-none shrink-0 flex flex-col overflow-hidden border-b sm:border-b-0 sm:border-r" style={{ borderColor: 'var(--theme-surface-border)' }}>
            {/* Test case list header */}
            <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>
                Test Cases ({testCases.length})
              </span>
              <button onClick={addTestCase} disabled={running}
                className="p-1 rounded hover:opacity-70 disabled:opacity-30"
                style={{ color: 'var(--theme-primary-text)' }}>
                <Plus size={14} />
              </button>
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
                    setFormErrors({}); setFormFailure(null)
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
                  className="px-3 py-2 cursor-pointer transition-colors group"
                  style={{
                    backgroundColor: selectedCaseId === tc.id ? 'var(--theme-primary-light)' : 'transparent',
                    borderBottom: '1px solid var(--theme-surface-border)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    {/* Status indicator */}
                    {tc.status === 'running' ? (
                      <Loader2 size={12} className="shrink-0 animate-spin" style={{ color: 'var(--status-info)' }} />
                    ) : tc.status === 'completed' ? (
                      <CheckCircle size={12} className="shrink-0" style={{ color: 'var(--theme-success)' }} />
                    ) : tc.status === 'failed' ? (
                      <XCircle size={12} className="shrink-0" style={{ color: 'var(--theme-danger)' }} />
                    ) : tc.status === 'paused' ? (
                      <PauseCircle size={12} className="shrink-0" style={{ color: 'var(--theme-warning)' }} aria-label={tc.pausedAt ?? 'Paused'} />
                    ) : (
                      <Clock size={12} className="shrink-0" style={{ color: 'var(--theme-muted-text)', opacity: 0.4 }} />
                    )}

                    <input
                      value={tc.name}
                      onChange={e => updateCaseName(tc.id, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      disabled={running}
                      className="flex-1 text-xs font-medium bg-transparent border-none outline-none truncate disabled:cursor-pointer"
                      style={{ color: selectedCaseId === tc.id ? 'var(--theme-primary-text)' : 'var(--theme-card-text)' }}
                    />

                    {testCases.length > 1 && !running && (
                      <button
                        onClick={e => { e.stopPropagation(); removeTestCase(tc.id) }}
                        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:text-[color:var(--theme-danger)] transition-opacity"
                        style={{ color: 'var(--theme-muted-text)' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>

                  {tc.status === 'paused' && tc.pausedAt && (
                    <p className="mt-0.5 text-[10px] truncate" style={{ color: 'var(--theme-warning)' }} title={tc.pausedAt}>{tc.pausedAt}</p>
                  )}

                  {/* Preview of the form's values */}
                  {formSpec?.kind === 'form' && plainKeys.length > 0 && (() => {
                    const { chips, more } = valueChips(caseFormValues(tc), plainKeys.map((k) => k.key))
                    return (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {chips.map((chip) => (
                          <span key={chip} className="text-[9px] px-1 py-0.5 rounded font-mono truncate max-w-[80px]" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>{chip}</span>
                        ))}
                        {more > 0 && <span className="text-[9px] px-1 py-0.5" style={{ color: 'var(--theme-muted-text)' }}>+{more}</span>}
                      </div>
                    )
                  })()}
                  {/* Preview of variable values */}
                  {userVariables.length > 0 && formSpec?.kind !== 'form' && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {userVariables.slice(0, 3).map(v => (
                        <span key={v.name} className="text-[9px] px-1 py-0.5 rounded font-mono truncate max-w-[80px]"
                          style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                          {v.name}={tc.values[v.name] || '""'}
                        </span>
                      ))}
                      {userVariables.length > 3 && (
                        <span className="text-[9px] px-1 py-0.5" style={{ color: 'var(--theme-muted-text)' }}>
                          +{userVariables.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Bottom actions */}
            <div className="px-3 py-2 space-y-1.5 shrink-0" style={{ borderTop: '1px solid var(--theme-surface-border)' }}>
              <Button size="sm" onClick={addTestCase} variant="outline" disabled={running} className="w-full !text-xs !h-7 gap-1">
                <Plus size={12} /> Add Test Case
              </Button>
              {selectedCase && !running && (
                <Button size="sm" onClick={() => duplicateTestCase(selectedCase)} variant="outline" className="w-full !text-xs !h-7 gap-1">
                  <Copy size={12} /> Duplicate Selected
                </Button>
              )}
            </div>
          </div>

          {/* Right: Variables + Canvas/Logs */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* The start form, as its users see it */}
            {formSpec && view === 'form' && showInputs && (
              <div className={`px-4 py-3 ${showCanvas ? 'shrink-0 max-h-[55%]' : 'flex-1 min-h-0'} overflow-auto`} data-test-start-form={formSpec.kind}
                style={{ borderBottom: '1px solid var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>
                    {formSpec.kind === 'form' ? `Form “${formSpec.form.name}”` : 'Start form'} — {selectedCase.name}
                  </p>
                  <ViewToggle view={view} onChange={setView} />
                </div>
                <div className="mx-auto max-w-3xl">
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
                    startLabel="Start test run"
                    note={
                      <p className="mt-3 text-[11px]" style={{ color: 'var(--theme-muted-text)' }} data-test-submission-note>
                        {formSpec.kind === 'form'
                          ? 'Test submission: the run starts with what this form would send. Nothing is stored, no other workflow is triggered and the button’s actions only show in the Logs.'
                          : 'Test run: starts this workflow’s draft with these inputs.'}
                        {runsBlocked ? ' Fix the configuration issues (or choose Run anyway) first.' : ''}
                      </p>
                    }
                  />
                </div>
              </div>
            )}

            {/* The form's values as plain inputs (power users) */}
            {formSpec?.kind === 'form' && view === 'fields' && showInputs && (
              <div className="px-5 py-3 shrink-0 space-y-2 max-h-[45%] overflow-auto" style={{ borderBottom: '1px solid var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>
                    Form values — {selectedCase.name}
                  </p>
                  <ViewToggle view={view} onChange={setView} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {plainKeys.map(k => (
                    <div key={k.key}>
                      <label htmlFor={`tf-plain-${k.key}`} className="text-[10px] font-medium mb-0.5 block" style={{ color: 'var(--theme-muted-text)' }}>
                        form.{k.key}<span className="ml-1 opacity-60">({k.type})</span>
                      </label>
                      <Input
                        id={`tf-plain-${k.key}`}
                        value={fieldText(caseFormValues(selectedCase)[k.key])}
                        onChange={e => updateCaseForm(selectedCase.id, k.key, parseFieldText(e.target.value))}
                        placeholder={k.label}
                        className="!text-xs !h-7 font-mono"
                        disabled={running}
                        aria-invalid={formErrors[k.key] ? true : undefined}
                      />
                      {formErrors[k.key] && <p className="mt-0.5 text-[10px]" style={{ color: 'var(--theme-danger)' }}>{formErrors[k.key]}</p>}
                    </div>
                  ))}
                </div>
                {formFailure && <p className="text-[11px]" role="alert" style={{ color: 'var(--theme-danger)' }}>{formFailure}</p>}
              </div>
            )}

            {/* Variable inputs for selected case */}
            {userVariables.length > 0 && showInputs && (!formSpec || (formSpec.kind === 'start_form' && view === 'fields')) && (
              <div className="px-5 py-3 shrink-0 space-y-2" style={{ borderBottom: '1px solid var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>
                    Variables — {selectedCase.name}
                  </p>
                  {formSpec && <ViewToggle view={view} onChange={setView} />}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {userVariables.map(v => (
                    <div key={v.name}>
                      <label className="text-[10px] font-medium mb-0.5 block" style={{ color: 'var(--theme-muted-text)' }}>
                        {v.name}
                        <span className="ml-1 opacity-60">({v.type})</span>
                      </label>
                      <Input
                        value={selectedCase.values[v.name] ?? ''}
                        onChange={e => updateCaseValue(selectedCase.id, v.name, e.target.value)}
                        placeholder={v.description || v.defaultValue || v.name}
                        className="!text-xs !h-7 font-mono"
                        disabled={running}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pre-run validation — same checks that gate publishing */}
            {!validation.valid && (
              <div className="px-5 py-2 shrink-0 space-y-1" style={{ borderBottom: '1px solid color-mix(in srgb, var(--theme-warning) 35%, var(--theme-surface-border))', backgroundColor: 'color-mix(in srgb, var(--theme-warning) 8%, var(--theme-card-bg))' }}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--theme-warning)' }}>
                  <TriangleAlert size={12} />
                  {validation.totalErrors} configuration issue{validation.totalErrors === 1 ? '' : 's'} found — fix before testing
                </div>
                {validation.nodeErrors.slice(0, 4).map((nodeError) => (
                  <p key={nodeError.nodeId} className="text-[10px]" style={{ color: 'var(--theme-card-text)' }}>
                    {nodeError.nodeLabel}: {nodeError.errors.join(', ')}
                  </p>
                ))}
                {validation.nodeErrors.length > 4 && (
                  <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>…and {validation.nodeErrors.length - 4} more</p>
                )}
                {!validationOverride && (
                  <button
                    type="button"
                    onClick={() => setValidationOverride(true)}
                    className="text-[10px] font-medium hover:opacity-80"
                    style={{ color: 'var(--theme-warning)' }}
                  >
                    Run anyway — I know what I&apos;m doing
                  </button>
                )}
              </div>
            )}

            {/* Action bar */}
            <div className="flex items-center gap-2 px-5 py-2 shrink-0" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
              <Button size="sm" onClick={() => void runSingle()} disabled={running || runsBlocked} className="gap-1.5" title={runsBlocked ? 'Fix the configuration issues above (or choose Run anyway)' : undefined}>
                {running && !runningAll ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
                {running && !runningAll ? 'Running...' : 'Run Selected'}
              </Button>

              {testCases.length > 1 && (
                <label className="flex items-center gap-1.5 text-[11px] select-none" style={{ color: 'var(--theme-muted-text)' }}
                  title="Run All never waits at a User Task: with this on, a task this case has completed before is completed again with the same outcome and values; otherwise the case is reported as paused and the next one runs">
                  <input type="checkbox" checked={autoCompleteTasks} disabled={running}
                    onChange={(e) => { setAutoCompleteTasks(e.target.checked); autoCompleteRef.current = e.target.checked }} />
                  Complete tasks with saved values
                </label>
              )}

              {testCases.length > 1 && (
                <Button size="sm" variant="outline" onClick={runAll} disabled={running || runsBlocked} className="gap-1.5" title={runsBlocked ? 'Fix the configuration issues above (or choose Run anyway)' : undefined}>
                  {runningAll ? <Loader2 size={14} className="animate-spin" /> : <ListChecks size={14} />}
                  {runningAll ? `Running ${testCases.findIndex(c => c.status === 'running') + 1}/${testCases.length}...` : 'Run All'}
                </Button>
              )}

              {(userVariables.length > 0 || formSpec) && (
                <Button size="sm" variant="ghost" onClick={() => setShowInputs((v) => !v)} className="gap-1.5" aria-pressed={!showInputs}
                  title={showInputs ? 'Hide the inputs (more room for the canvas)' : 'Show the inputs'}>
                  <SlidersHorizontal size={14} /> {formSpec && view === 'form' ? (showInputs ? 'Hide form' : 'Show form') : (showInputs ? 'Hide inputs' : 'Show inputs')}
                </Button>
              )}

              {showCanvas && (
                <div className="flex ml-4 border rounded-lg overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)' }}>
                  {(['canvas', 'logs'] as const).map(t => (
                    <button key={t} onClick={() => setTab(t)}
                      className="px-3 py-1 text-[11px] font-medium transition-colors"
                      style={{
                        backgroundColor: tab === t ? 'var(--theme-primary-light)' : 'transparent',
                        color: tab === t ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                      }}>
                      {t === 'canvas' ? 'Process View' : `Logs (${logCount})`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Test-mode User Task Action Panel */}
            {testTaskPrompt && !resuming && (
              <div className="mx-4 mb-2 rounded-lg border-2 p-4 animate-in fade-in"
                style={{ borderColor: 'var(--theme-warning)', backgroundColor: 'color-mix(in srgb, var(--theme-warning) 3%, transparent)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 12%, transparent)' }}>
                    <Clock size={16} style={{ color: 'var(--theme-warning)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{testTaskPrompt.title}</p>
                    {testTaskPrompt.description && (
                      <TaskDescription value={testTaskPrompt.description} className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }} />
                    )}
                    <p className="text-[10px] mt-1" style={{ color: 'var(--theme-warning)' }}>
                      Test mode — action this task to continue the workflow
                    </p>
                    {testTaskPrompt.fields.length > 0 && (
                      <div className="mt-3">
                        <FormLookupProvider source={{ kind: 'preview' }}>
                        <TaskFields
                          compact
                          fields={testTaskPrompt.fields}
                          layout={testTaskPrompt.layout}
                          theme={testTaskPrompt.theme}
                          values={testTaskValues}
                          errors={testTaskErrors}
                          onChange={(key, value) => setTestTaskValues(prev => ({ ...prev, [key]: value }))}
                        />
                        </FormLookupProvider>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      {testTaskPrompt.outcomes.map(outcome => (
                        <Button key={outcome} size="sm" disabled={resuming}
                        onClick={async () => {
                          const fieldErrors = validateTaskFieldValues(testTaskPrompt.fields, testTaskValues)
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
                        }}
                          style={{ backgroundColor: 'var(--theme-warning)', borderColor: 'var(--theme-warning)', color: 'var(--theme-on-warning)' }}>
                          {resuming ? 'Resuming...' : outcome.charAt(0).toUpperCase() + outcome.slice(1)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Test-mode Server Event Action Panel */}
            {testServerEvent && !resuming && (
              <div className="mx-4 mb-2 rounded-lg border-2 p-4 animate-in fade-in"
                style={{ borderColor: 'var(--status-info)', backgroundColor: 'color-mix(in srgb, var(--status-info) 3%, transparent)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--status-info) 12%, transparent)' }}>
                    <Clock size={16} style={{ color: 'var(--status-info)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">Waiting for: {testServerEvent.eventName}</p>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--status-info)' }}>
                      Test mode — resume this server event to continue the workflow
                    </p>
                    <div className="flex items-center gap-2 mt-3">
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
                        }}
                        style={{ backgroundColor: 'var(--status-info)', borderColor: 'var(--status-info)', color: 'var(--theme-on-info)' }}>
                        {resuming ? 'Resuming...' : 'Resume Event'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Content area: the run canvas fills it (its zoom controls stay inside the dialog). */}
            <div className={`${!showCanvas && formSpec && view === 'form' && showInputs ? 'hidden' : 'flex-1'} min-h-0 flex flex-col ${showCanvas && tab === 'canvas' ? 'overflow-hidden p-3' : 'overflow-auto'}`}>
              {!showCanvas && !(formSpec && view === 'form' && showInputs) && (
                <div className="flex flex-col items-center justify-center h-full py-16">
                  <Zap size={40} style={{ color: 'var(--theme-muted-text)', opacity: 0.3 }} />
                  <p className="text-sm mt-3" style={{ color: 'var(--theme-muted-text)' }}>
                    {formSpec
                      ? 'Fill in the form and press its button (or Run Selected / Run All) to start the test'
                      : userVariables.length > 0
                      ? 'Configure test cases on the left, then Run Selected or Run All'
                      : 'Click Run Selected to execute the workflow'}
                  </p>
                </div>
              )}

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
                      <div className="mx-3 mb-2 rounded-xl border p-3 space-y-2"
                        style={{ borderColor: 'color-mix(in srgb, var(--theme-warning) 25%, transparent)', backgroundColor: 'var(--theme-card-bg)' }}>
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--theme-warning)' }}>Server Event ID</span>
                        <div className="flex items-center gap-1.5">
                          <code className="flex-1 text-[10px] font-mono px-2 py-1.5 rounded-lg select-all break-all"
                            style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}>
                            {nodeEventId}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(nodeEventId)
                              setCopiedEventId(true)
                              setTimeout(() => setCopiedEventId(false), 2000)
                            }}
                            className="shrink-0 p-1.5 rounded-lg transition-colors hover:opacity-80"
                            style={{ backgroundColor: 'var(--theme-surface)', color: copiedEventId ? 'var(--theme-success)' : 'var(--theme-muted-text)' }}
                            title="Copy event ID"
                            aria-label="Copy event ID"
                          >
                            {copiedEventId ? <ClipboardCheck size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                        <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>Use this ID to complete the event via the API:</p>
                        <code className="block text-[9px] font-mono px-2 py-1.5 rounded-lg select-all" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
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
                      {running && <Loader2 size={20} className="animate-spin mb-2" style={{ color: 'var(--theme-primary-text)' }} />}
                      <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                        {running ? 'Waiting for logs...' : 'No logs'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-end px-4 py-2" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
                        <button onClick={copyAllLogs}
                          className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg hover:opacity-80"
                          style={{ backgroundColor: copiedAll ? 'color-mix(in srgb, var(--theme-success) 8%, transparent)' : 'var(--theme-surface)', color: copiedAll ? 'var(--theme-success)' : 'var(--theme-muted-text)' }}>
                          {copiedAll ? <ClipboardCheck size={12} /> : <Copy size={12} />}
                          {copiedAll ? 'Copied!' : 'Copy All'}
                        </button>
                      </div>
                      <div className="divide-y" style={{ borderColor: 'var(--theme-surface-border)' }}>
                        {logs.map((log: any, idx: number) => {
                          const isExpanded = expandedLog === idx
                          const colors: Record<string, string> = { info: 'var(--status-info)', warn: 'var(--theme-warning)', error: 'var(--theme-danger)', debug: 'var(--theme-muted-text)' }
                          const color = colors[log.level] ?? 'var(--theme-muted-text)'
                          return (
                            <div key={idx} className="px-4 py-2 cursor-pointer hover:opacity-90 group animate-in fade-in slide-in-from-bottom-1 duration-200"
                              onClick={() => setExpandedLog(isExpanded ? null : idx)}>
                              <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                <span className="text-[10px] font-mono w-10 shrink-0 uppercase" style={{ color }}>{log.level}</span>
                                {log.node_label && (() => {
                                  const stepId = logStepId(log, nodes)
                                  return <StepChip label={log.node_label} onFocus={stepId ? () => focusStep(stepId) : undefined} />
                                })()}
                                <span className="text-xs flex-1 truncate">{log.message}</span>
                                {log.duration_ms != null && (
                                  <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--theme-muted-text)' }}>{log.duration_ms}ms</span>
                                )}
                                <button onClick={e => copyLog(e, idx)}
                                  className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                  style={{ color: copiedIdx === idx ? 'var(--theme-success)' : 'var(--theme-muted-text)' }}>
                                  {copiedIdx === idx ? <ClipboardCheck size={12} /> : <Copy size={12} />}
                                </button>
                                {log.metadata && (isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
                              </div>
                              {isExpanded && log.metadata && (
                                <pre className="mt-1 text-[10px] font-mono p-2 rounded overflow-x-auto"
                                  style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
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
        </div>
        </div>
      </div>
    </div>
  )
}

/** "Show as form" / "Show as fields" (power users: the raw values). */
function ViewToggle({ view, onChange }: { view: 'form' | 'fields'; onChange: (view: 'form' | 'fields') => void }) {
  return (
    <button type="button" onClick={() => onChange(view === 'form' ? 'fields' : 'form')}
      className="text-[11px] font-medium rounded px-2 py-0.5 hover:opacity-80" data-test-form-view={view}
      style={{ color: 'var(--theme-primary-text)', backgroundColor: 'var(--theme-primary-light)' }}>
      {view === 'form' ? 'Show as fields' : 'Show as form'}
    </button>
  )
}
