export type WorkflowActivityStatus = 'draft' | 'active' | 'archived'
export type WorkflowActivitySourceKind = 'upload' | 'inline'

export interface WorkflowActivityManifestField {
  id: string
  name: string
  label: string
  type: string
  description?: string
  required?: boolean
  defaultValue?: any
}

export interface WorkflowActivityPresentationMetadata {
  displayName?: string
  purpose?: string
  recommendedFor?: string
  summary?: string
  setupNotes: string[]
}

export interface WorkflowActivityReadinessCheck {
  severity: 'warning' | 'info'
  message: string
}

export interface WorkflowActivityReadinessResult {
  score: number
  findings: WorkflowActivityReadinessCheck[]
  ready: boolean
}

export interface PortableWorkflowActivityPayload {
  version: 1
  asset_type: 'workflow_activity'
  workflow_activity: {
    name: string
    description: string | null
    key: string
    status: WorkflowActivityStatus
    source_kind: WorkflowActivitySourceKind
    version: string
    icon_name: string
    color: string
    source_code: string
    manifest: Record<string, any>
    demo_inputs: Record<string, any>
    tags: string[]
    source_filename: string | null
  }
}

export function slugifyWorkflowActivityKey(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function safeParseJson<T>(text: string, fallback: T): T {
  if (!text.trim()) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export function exportWorkflowActivityAsset(activity: any): PortableWorkflowActivityPayload {
  return {
    version: 1,
    asset_type: 'workflow_activity',
    workflow_activity: {
      name: activity.name ?? 'Untitled activity',
      description: activity.description ?? null,
      key: activity.key ?? slugifyWorkflowActivityKey(activity.name ?? 'custom_activity'),
      status: activity.status ?? 'draft',
      source_kind: activity.source_kind ?? 'inline',
      version: activity.version ?? '1.0.0',
      icon_name: activity.icon_name ?? 'Puzzle',
      color: activity.color ?? '#0EA5E9',
      source_code: activity.source_code ?? '',
      manifest: activity.manifest ?? { inputs: [], outputs: [] },
      demo_inputs: activity.demo_inputs ?? {},
      tags: Array.isArray(activity.tags) ? activity.tags : [],
      source_filename: activity.source_filename ?? null,
    },
  }
}

export function parseWorkflowActivityImportPayload(text: string) {
  try {
    const parsed = JSON.parse(text)
    const payload = parsed?.workflow_activity ?? parsed
    if (!payload || typeof payload !== 'object') {
      return { payload: null, error: 'Import file must contain a workflow_activity object' }
    }
    return { payload, error: null }
  } catch {
    return { payload: null, error: 'Import file must be valid JSON' }
  }
}

function normalizeWorkflowManifestFields(value: any): WorkflowActivityManifestField[] {
  if (!Array.isArray(value)) return []
  return value
    .map((field: any, index: number) => {
      const name = String(field?.name ?? field?.key ?? field?.id ?? `field_${index + 1}`).trim()
      if (!name) return null
      return {
        id: String(field?.id ?? name),
        name,
        label: String(field?.label ?? name.replace(/[_-]+/g, ' ')).replace(/\b\w/g, (char) => char.toUpperCase()),
        type: String(field?.type ?? 'string').toLowerCase(),
        description: typeof field?.description === 'string' ? field.description : undefined,
        required: Boolean(field?.required),
        defaultValue: field?.default ?? field?.defaultValue,
      } satisfies WorkflowActivityManifestField
    })
    .filter(Boolean) as WorkflowActivityManifestField[]
}

export function normalizeWorkflowActivityManifest(manifest: any) {
  const setupNotes = Array.isArray(manifest?.setup_notes)
    ? manifest.setup_notes
    : Array.isArray(manifest?.setupNotes)
      ? manifest.setupNotes
      : []
  return {
    inputs: normalizeWorkflowManifestFields(manifest?.inputs),
    outputs: normalizeWorkflowManifestFields(manifest?.outputs),
    ...(typeof manifest?.display_name === 'string' && manifest.display_name.trim()
      ? { display_name: manifest.display_name.trim() }
      : typeof manifest?.displayName === 'string' && manifest.displayName.trim()
        ? { display_name: manifest.displayName.trim() }
        : {}),
    ...(typeof manifest?.purpose === 'string' && manifest.purpose.trim()
      ? { purpose: manifest.purpose.trim() }
      : {}),
    ...(typeof manifest?.recommended_for === 'string' && manifest.recommended_for.trim()
      ? { recommended_for: manifest.recommended_for.trim() }
      : typeof manifest?.recommendedFor === 'string' && manifest.recommendedFor.trim()
        ? { recommended_for: manifest.recommendedFor.trim() }
        : {}),
    ...(typeof manifest?.summary === 'string' && manifest.summary.trim()
      ? { summary: manifest.summary.trim() }
      : typeof manifest?.guidance === 'string' && manifest.guidance.trim()
        ? { summary: manifest.guidance.trim() }
        : {}),
    ...(setupNotes.length > 0
      ? { setup_notes: setupNotes.map((note: any) => String(note ?? '').trim()).filter(Boolean) }
      : {}),
  }
}

export function getWorkflowActivityInputDefinitions(manifest: Record<string, any> | null | undefined) {
  return normalizeWorkflowActivityManifest(manifest).inputs
}

export function getWorkflowActivityOutputDefinitions(manifest: Record<string, any> | null | undefined) {
  return normalizeWorkflowActivityManifest(manifest).outputs
}

export function getWorkflowActivityPresentation(manifest: Record<string, any> | null | undefined): WorkflowActivityPresentationMetadata {
  const normalized = normalizeWorkflowActivityManifest(manifest)
  return {
    displayName: typeof normalized.display_name === 'string' && normalized.display_name.trim() ? normalized.display_name.trim() : undefined,
    purpose: typeof normalized.purpose === 'string' && normalized.purpose.trim() ? normalized.purpose.trim() : undefined,
    recommendedFor: typeof normalized.recommended_for === 'string' && normalized.recommended_for.trim() ? normalized.recommended_for.trim() : undefined,
    summary: typeof normalized.summary === 'string' && normalized.summary.trim() ? normalized.summary.trim() : undefined,
    setupNotes: Array.isArray(normalized.setup_notes) ? normalized.setup_notes.map((note: any) => String(note ?? '').trim()).filter(Boolean) : [],
  }
}

export function getWorkflowActivityDisplayName(manifest: Record<string, any> | null | undefined, fallback?: string | null) {
  const presentation = getWorkflowActivityPresentation(manifest)
  return presentation.displayName || fallback || null
}

export function getWorkflowActivitySummary(manifest: Record<string, any> | null | undefined) {
  const presentation = getWorkflowActivityPresentation(manifest)
  if (presentation.summary) return presentation.summary
  if (presentation.purpose) return presentation.purpose

  const inputs = getWorkflowActivityInputDefinitions(manifest)
  const outputs = getWorkflowActivityOutputDefinitions(manifest)

  const inputNames = inputs.slice(0, 3).map((input) => input.label)
  const outputNames = outputs.slice(0, 3).map((output) => output.label)

  const inputSummary = inputs.length === 0
    ? 'no inputs'
    : `${inputNames.join(', ')}${inputs.length > 3 ? ` and ${inputs.length - 3} more` : ''}`
  const outputSummary = outputs.length === 0
    ? 'no outputs'
    : `${outputNames.join(', ')}${outputs.length > 3 ? ` and ${outputs.length - 3} more` : ''}`

  return `Takes ${inputSummary} and returns ${outputSummary}.`
}

export function getWorkflowActivitySetupNotes(manifest: Record<string, any> | null | undefined) {
  return getWorkflowActivityPresentation(manifest).setupNotes
}

export function getWorkflowActivityReadiness(params: {
  manifest: Record<string, any> | null | undefined
  name?: string | null
  key?: string | null
}): WorkflowActivityReadinessResult {
  const manifest = params.manifest
  const inputs = getWorkflowActivityInputDefinitions(manifest)
  const presentation = getWorkflowActivityPresentation(manifest)
  const displayName = getWorkflowActivityDisplayName(manifest, params.name)?.trim() ?? ''
  const purpose = presentation.purpose?.trim() ?? ''
  const summary = getWorkflowActivitySummary(manifest).trim()
  const recommendedFor = presentation.recommendedFor?.trim() ?? ''
  const setupNotes = presentation.setupNotes
  const technicalNameMatch = displayName.toLowerCase() === String(params.key || params.name || '').trim().toLowerCase()

  const findings: WorkflowActivityReadinessCheck[] = []

  if (!presentation.displayName?.trim()) {
    findings.push({ severity: 'warning', message: 'Add a display name so the activity reads naturally in the workflow palette and on the canvas.' })
  } else if (technicalNameMatch && /[_-]/.test(displayName)) {
    findings.push({ severity: 'warning', message: 'The display name still looks technical. Consider using a human-friendly label instead of the raw key style.' })
  }

  if (!purpose) {
    findings.push({ severity: 'warning', message: 'Add a one-line purpose so first-time designers know when to use this activity.' })
  } else if (purpose.length < 40) {
    findings.push({ severity: 'info', message: 'The one-line purpose is quite short. A little more context can make the activity easier to choose correctly.' })
  }

  if (!summary) {
    findings.push({ severity: 'warning', message: 'Add a workflow summary so the canvas node and simple mode explain what the step does.' })
  }

  if (!recommendedFor) {
    findings.push({ severity: 'info', message: 'Add a recommended audience to help teams understand who this activity is best for.' })
  }

  if (inputs.length > 0 && setupNotes.length === 0) {
    findings.push({ severity: 'warning', message: 'This activity takes inputs but has no setup notes yet. Add a couple of notes to guide designers through the mapping.' })
  } else if (inputs.length > 0 && setupNotes.length === 1) {
    findings.push({ severity: 'info', message: 'One setup note is a good start. Adding a second note often makes onboarding much clearer.' })
  }

  const warningCount = findings.filter((item) => item.severity === 'warning').length
  return {
    findings,
    score: Math.max(0, 5 - warningCount),
    ready: warningCount === 0,
  }
}
