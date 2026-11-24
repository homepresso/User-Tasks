/**
 * The core PDF form importer (server-only): fillable PDFs (AcroForm, hybrid
 * XFA), dynamic XFA forms → UserTasks forms (drafts to review in the
 * designer). Served by the generic importer endpoints (lib/services/
 * importers: dry-run analyze, import, audit) like the Nintex importer;
 * files are never stored.
 *
 * Options
 *   name                 the form name (default: the PDF's title)
 *   pages                steps (default: a step per PDF page with fields) | single
 *   available_in_menu    list the form in the Forms menu
 *   ai                   "Use AI for the hard parts" for THIS import (default off)
 *   ai_consent           the person confirmed the PDF's content goes to the
 *                        workspace's AI provider (required with `ai`)
 *   ai_result            import only: the AI answer the analysis returned
 *                        (report.details.ai.answer), re-validated and merged
 *                        again — so an import never calls the provider twice
 *
 * The AI assist (ai.ts) runs only when ALL hold: the workspace's Agent has a
 * usable provider (its own key — BYOK — or an Integrations connection), an
 * admin turned on "Let importers use AI for hard PDFs" (Settings → Agent),
 * the person may edit forms, ticked the option and confirmed the consent.
 * It uses the person's Agent connection (profiles apply), the Agent's
 * limits (daily messages, monthly cost caps), a burst limit, records usage
 * (capability "designer") and writes an audit entry saying what was sent
 * where. With the option off nothing is sent anywhere.
 */

import type { ImporterContribution } from '@/lib/extensions/manifest'
import type { ImportFile, ImportReport, ImportResult } from '@/lib/extensions/sdk'
import { hasPerm, requirePerm, ServiceError, type ServiceContext } from '@/lib/services/context'
import { mergeAiAnswer, runAiAssist, type AiComplete, type AiMessage } from './ai'
import { analyzePdf, type PdfAnalysis, type StylingImageMode } from './analyze'
import { buildForms, type BuildOptions } from './build'
import type { StyleOptions } from './style-plan'
import { PdfImportError } from './load'
import { pdfModelSchema, type PdfFormModel, type PdfModelAnswer } from './model'
import { pdfReport } from './report'

export const PDF_IMPORTER_ID = 'pdf'

export const CORE_PDF_IMPORTER: ImporterContribution = {
  key: 'pdf',
  label: 'PDF form (.pdf)',
  description: 'Fillable PDF forms (AcroForm, with XFA captions when present) and dynamic XFA forms: fields, labels, choices, required fields, Acrobat formats and validation, show / hide scripts and printed "go to question …" instructions become a UserTasks form. Optional AI assist for flat and scanned PDFs.',
  produces: ['form'],
  accepts: ['.pdf'],
  multiple: false,
  filesOptional: false,
  preview: false,
  options: [
    { name: 'name', label: 'Form name', type: 'string' },
    { name: 'pages', label: 'Pages', type: 'select', options: [{ value: 'steps', label: 'Each PDF page is a step' }, { value: 'single', label: 'One page' }], default: 'steps' },
    { name: 'available_in_menu', label: 'Show in the Forms menu', type: 'boolean' },
    { name: 'tables', label: 'Turn tables into repeating lists', type: 'boolean', default: true },
    { name: 'keep_tables', label: 'Tables to keep as separate fields (ids from the analysis, comma separated)', type: 'string' },
    { name: 'table_rows', label: 'Rows a list allows', type: 'select', options: [{ value: 'pdf', label: 'As many as the PDF has' }, { value: 'unlimited', label: 'Unlimited' }], default: 'pdf' },
    { name: 'styling', label: 'Bring in styling and images (logo, pictures, headings, instructions, dividers, a theme from the PDF\'s colours and fonts)', type: 'boolean', default: true },
    { name: 'styling_images', label: 'Styling: the logo and pictures', type: 'boolean', default: true },
    { name: 'styling_theme', label: 'Styling: theme', type: 'select', options: [{ value: 'new', label: 'A new form theme from the PDF' }, { value: 'workspace', label: 'Use the workspace theme instead' }], default: 'new' },
    { name: 'styling_text', label: 'Styling: headings, instructions and dividers', type: 'boolean', default: true },
    { name: 'styling_backgrounds', label: 'Styling: include page backgrounds / watermarks', type: 'boolean', default: false },
    { name: 'styling_footer', label: 'Styling: keep a repeated page footer once', type: 'boolean', default: false },
    { name: 'ai', label: 'Use AI for the hard parts (sends the PDF\'s content to your workspace\'s AI provider)', type: 'boolean' },
    { name: 'ai_consent', label: 'I understand the PDF\'s content is sent to the workspace\'s AI provider', type: 'boolean' },
    { name: 'ai_result', label: 'AI answer from the analysis (import only)', type: 'string' },
  ] as ImporterContribution['options'],
}

export interface PdfOptions {
  name: string | null
  pages: 'steps' | 'single'
  availableInMenu: boolean | undefined
  ai: boolean
  aiConsent: boolean
  aiResult: PdfModelAnswer | null
  /** Tables → repeating lists (default on). */
  tables: boolean
  keepTables: string[]
  tableRows: 'pdf' | 'unlimited'
  /** "Bring in styling and images" (default on) and what of it; null = off (the plain import). */
  style: StyleOptions | null
}

const truthy = (v: unknown) => v === true || v === 'true'

export function pdfOptions(raw: Record<string, unknown>): PdfOptions {
  const name = typeof raw.name === 'string' ? raw.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 100) : ''
  let aiResult: PdfModelAnswer | null = null
  const r = raw.ai_result
  if (r !== undefined && r !== null && r !== '') {
    let value: unknown = r
    if (typeof r === 'string') { try { value = JSON.parse(r) } catch { throw ServiceError.validation('ai_result must be the JSON the analysis returned') } }
    const parsed = pdfModelSchema.safeParse(value)
    if (!parsed.success) throw ServiceError.validation('ai_result is not a valid AI answer: analyse the PDF again')
    aiResult = parsed.data
  }
  return {
    name: name || null,
    pages: raw.pages === 'single' ? 'single' : 'steps',
    availableInMenu: typeof raw.available_in_menu === 'boolean' ? raw.available_in_menu : undefined,
    ai: truthy(raw.ai), aiConsent: truthy(raw.ai_consent), aiResult,
    tables: raw.tables === undefined || raw.tables === null || raw.tables === '' ? true : truthy(raw.tables),
    keepTables: (Array.isArray(raw.keep_tables) ? raw.keep_tables : typeof raw.keep_tables === 'string' ? raw.keep_tables.split(',') : [])
      .map((x) => String(x).trim()).filter((x) => /^table_\d{1,4}$/.test(x)).slice(0, 200),
    tableRows: raw.table_rows === 'unlimited' ? 'unlimited' : 'pdf',
    style: styleOptionsOf(raw),
  }
}

const unset = (v: unknown) => v === undefined || v === null || v === ''

/** The styling options (each defaults as the dialog does); null when "Bring in styling and images" is off. */
export function styleOptionsOf(raw: Record<string, unknown>): StyleOptions | null {
  if (!unset(raw.styling) && !truthy(raw.styling)) return null
  const on = (v: unknown, dflt: boolean) => (unset(v) ? dflt : truthy(v))
  const style: StyleOptions = {
    images: on(raw.styling_images, true),
    theme: raw.styling_theme !== 'workspace' && raw.styling_theme !== false && raw.styling_theme !== 'false',
    text: on(raw.styling_text, true),
    backgrounds: on(raw.styling_backgrounds, false),
    footer: on(raw.styling_footer, false),
  }
  return style.images || style.theme || style.text ? style : null
}

/* ── AI availability ─────────────────────────────────────────────────── */

export interface PdfAiAvailability {
  /** The option can be used here (provider + admin setting + permission). */
  available: boolean
  /** Why not (shown beside the disabled option). */
  reason: string | null
  /** A provider is configured (the setting may still be off). */
  configured: boolean
  /** Where an admin sets it up. */
  settings_href: string
  /** The provider people's PDFs would go to (no key, no URL). */
  provider: string | null
  model: string | null
}

const SETTINGS_HREF = '/settings/assistants'

/** Pure: availability from the settings row's facts. */
export function aiAvailabilityFrom(input: { usable: boolean; importAi: boolean; canEdit: boolean; provider: string | null; model: string | null }): PdfAiAvailability {
  const base = { configured: input.usable, settings_href: SETTINGS_HREF, provider: input.usable ? input.provider : null, model: input.usable ? input.model : null }
  if (!input.usable) return { ...base, available: false, reason: 'No AI provider is set up for this workspace: an admin connects one in Settings → Agent.' }
  if (!input.importAi) return { ...base, available: false, reason: 'An admin has not allowed AI for PDF imports (Settings → Agent → "Let importers use AI for hard PDFs").' }
  if (!input.canEdit) return { ...base, available: false, reason: 'You need permission to edit forms.' }
  return { ...base, available: true, reason: null }
}

export async function pdfAiAvailability(ctx: ServiceContext): Promise<PdfAiAvailability> {
  const { serviceRoleClient } = await import('@/lib/services/_shared')
  const { loadAssistantSettings, rowLooksUsable } = await import('@/lib/assistants/settings')
  const db = await serviceRoleClient(ctx)
  const row = await loadAssistantSettings(db, ctx.tenantId).catch(() => null)
  return aiAvailabilityFrom({ usable: rowLooksUsable(row), importAi: row?.agent.import_ai === true, canEdit: hasPerm(ctx, 'forms.edit'), provider: row?.provider ?? null, model: row?.model || null })
}

/* ── the AI call (the workspace's Agent connection) ──────────────────── */

export interface AiRunInfo { provider: string; model: string; pages: number; images: number; ocr_pages: number; calls: number; tokens: number; error: string | null }

async function runWorkspaceAi(ctx: ServiceContext, analysis: PdfAnalysis, bytes: Uint8Array, completeOverride?: AiComplete): Promise<{ answer: PdfModelAnswer | null; info: AiRunInfo }> {
  const { serviceRoleClient, audit } = await import('@/lib/services/_shared')
  const settings = await import('@/lib/assistants/settings')
  const { checkAssistantLimits, recordAssistantUsage, AssistantLimitError } = await import('@/lib/assistants/limits')
  const db = await serviceRoleClient(ctx)
  const row = await settings.loadAssistantSettings(db, ctx.tenantId)
  if (!row || !settings.rowLooksUsable(row) || row.agent.import_ai !== true) throw ServiceError.forbidden('AI for PDF imports is not available in this workspace')
  const { availabilityUser } = await import('@/lib/services/assistants')
  const user = await availabilityUser(db, ctx.tenantId, ctx.actorId!, ctx.permissions ?? new Set())
  let connection
  let profile
  try {
    ;({ connection, profile } = await settings.resolvePersonConnection(db, row, { userId: ctx.actorId!, roleIds: user.roleIds, teamIds: user.teamIds }, 'forms'))
  } catch (error) {
    if (error instanceof settings.AssistantConfigError) throw ServiceError.validation(error.message)
    throw error
  }
  try {
    await checkAssistantLimits(db, ctx.tenantId, ctx.actorId!, row.limits, new Date(), profile ? { id: profile.id, name: profile.name, monthly_cost_cap: profile.limits.monthly_cost_cap ?? null } : null)
  } catch (error) {
    if (error instanceof AssistantLimitError) throw new ServiceError('rate_limited', error.message)
    throw error
  }
  const { rateLimit } = await import('@/lib/rate-limit')
  const burst = await rateLimit(`pdf-import-ai:${ctx.tenantId}:${ctx.actorId}`, { max: 10, windowMs: 3_600_000 })
  if (!burst.ok) throw new ServiceError('rate_limited', 'Too many AI-assisted PDF analyses in the last hour: try again later.')

  // Scanned pages: their images when the model sees, else OCR text when the instance has it.
  const images: Array<{ page: number; dataUrl: string }> = []
  const ocr: Array<{ page: number; text: string }> = []
  if (analysis.model.kind === 'scanned') {
    const { modelAcceptsImages } = await import('@/lib/assistants/engine')
    const vision = modelAcceptsImages(connection.provider, connection.model)
    const { openPdf, pageImageForModel, pageImagePng } = await import('@/lib/documents/pdf')
    const doc = await openPdf(bytes)
    try {
      const pages = Math.min(analysis.stats.pages || doc.numPages, vision ? 8 : 5)
      let ocrProvider: { recognize(png: Buffer, opts: { languages: string }): Promise<{ text: string }>; close?: () => Promise<void> } | null = null
      if (!vision) {
        const { instanceTesseractAvailable, openOcrProvider } = await import('@/lib/documents/ocr')
        if (await instanceTesseractAvailable().catch(() => false)) ocrProvider = await openOcrProvider('eng').catch(() => null)
      }
      try {
        for (let p = 1; p <= pages; p++) {
          if (vision) {
            const png = await pageImageForModel(doc, p).catch(() => null)
            if (png) images.push({ page: p, dataUrl: `data:image/png;base64,${png.toString('base64')}` })
          } else if (ocrProvider) {
            const png = await pageImagePng(doc, p).catch(() => null)
            if (png) ocr.push({ page: p, text: (await ocrProvider.recognize(png, { languages: 'eng' })).text.slice(0, 20_000) })
          }
        }
      } finally { await ocrProvider?.close?.().catch(() => {}) }
    } finally { await doc.destroy?.().catch?.(() => {}) }
  }

  const complete: AiComplete = completeOverride ?? (async (messages: AiMessage[]) => {
    const { callModel } = await import('@/lib/agent-executor')
    const { chatBodyParams } = await import('@/lib/agents/provider')
    const body = { model: connection.model, messages, ...chatBodyParams(connection.provider, connection.model, { maxTokens: 16_000, temperature: 0 }) }
    // Retries: the shared policy (lib/agents/retry.ts) within the request's budget.
    const res = await callModel(connection.url, connection.headers, body, { deadline: Date.now() + 110_000, fetchImpl: fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), provider: connection.provider })
    if (!res.ok) {
      // A friendly message (lib/agents/errors.ts); the technical one goes to the server log only.
      const { describeFailure, forViewer, technicalSummary } = await import('@/lib/agents/errors')
      const view = describeFailure(res.failure)
      console.warn(`[pdf-import] AI provider failed: ${view.code} (${technicalSummary(view)})`)
      throw new ServiceError('internal', view.message, { status: 502, details: { failure: forViewer(view, false), provider_failure: true } })
    }
    const content = res.json?.choices?.[0]?.message?.content
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c?.text ?? '').join('') : ''
    return { text, usage: res.json?.usage ?? null }
  })
  let result
  let failure: ServiceError | null = null
  try {
    result = await runAiAssist({ model: analysis.model, pages: analysis.pages, images, ocr }, complete)
  } catch (error) {
    failure = error instanceof ServiceError ? error : new ServiceError('internal', `The AI provider failed: ${error instanceof Error ? error.message : 'unknown error'}`, { status: 502 })
    result = { answer: null, calls: 1, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, usageMissing: true, error: failure.message }
  }
  const info: AiRunInfo = { provider: connection.provider, model: connection.model, pages: analysis.pages.length, images: images.length, ocr_pages: ocr.length, calls: result.calls, tokens: result.usage.total_tokens, error: result.error }
  // The provider never answered (failed after its retries): not usage.
  const providerFailed = Boolean(failure && (failure.details as { provider_failure?: boolean } | undefined)?.provider_failure)
  if (!providerFailed) await recordAssistantUsage(db, {
    tenantId: ctx.tenantId, userId: ctx.actorId ?? null, capability: 'designer', provider: connection.provider, model: connection.model, modelRule: profile?.id ?? null,
    status: result.answer ? 'completed' : 'failed', usage: result.usage, llmCalls: result.calls, toolCalls: 0, usageMissing: result.usageMissing, error: result.error,
    source: 'pdf_import',
  })
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'ai_assist',
    summary: `PDF import: "${analysis.fileName}" sent to the workspace's AI provider (${connection.provider}, ${connection.model})`,
    metadata: { kind: 'pdf_import_ai', file: analysis.fileName, hash: analysis.hash, provider: connection.provider, model: connection.model, pages: info.pages, images: info.images, ocr_pages: info.ocr_pages, calls: info.calls, tokens: info.tokens, ok: Boolean(result.answer) },
  }).catch(() => undefined)
  if (failure) throw failure
  return { answer: result.answer, info }
}

/* ── runner ──────────────────────────────────────────────────────────── */

function buildOptionsOf(analysis: PdfAnalysis, options: PdfOptions): BuildOptions {
  return {
    fileName: analysis.fileName, hash: analysis.hash, pages: options.pages, ...(options.name ? { name: options.name } : {}),
    tables: options.tables, keepTables: options.keepTables, tableRows: options.tableRows,
    ...(options.style && analysis.styling ? { styling: analysis.styling, style: options.style } : {}),
  }
}

function fileOf(files: ImportFile[]): ImportFile {
  const f = files[0]
  if (!f) throw ServiceError.validation('No file was sent')
  return f
}

async function read(file: ImportFile, styling: StylingImageMode | null = null): Promise<PdfAnalysis> {
  try {
    return await analyzePdf(file.bytes, file.name, undefined, { styling: styling ? { images: styling } : false })
  } catch (error) {
    if (error instanceof PdfImportError) throw ServiceError.validation(error.message, { pdf: { code: error.code } })
    throw error
  }
}

export interface PdfAnalyzeDeps { complete?: AiComplete; availability?: (ctx: ServiceContext) => Promise<PdfAiAvailability> }

/** Analyse (and, with the option, run the AI assist): the report, the preview definitions and the AI answer to reuse. */
export async function analyzePdfImport(ctx: ServiceContext, files: ImportFile[], raw: Record<string, unknown>, deps: PdfAnalyzeDeps = {}): Promise<ImportReport> {
  const options = pdfOptions(raw)
  const file = fileOf(files)
  const analysis = await read(file, options.style ? 'preview' : null)
  const availability = await (deps.availability ?? pdfAiAvailability)(ctx).catch(() => aiAvailabilityFrom({ usable: false, importAi: false, canEdit: false, provider: null, model: null }))
  let model: PdfFormModel = analysis.model
  let changes: string[] = []
  let ai: { used: boolean; answer?: PdfModelAnswer | null; info?: AiRunInfo; error?: string | null } = { used: false }
  const warnings = [...analysis.warnings]
  if (options.ai && options.aiResult) {
    // Re-analysis after an AI run (e.g. another page layout): the earlier answer again, no second call.
    ;({ model, changes } = mergeAiAnswer(analysis.model, options.aiResult))
    ai = { used: true, answer: options.aiResult }
  } else if (options.ai) {
    if (!availability.available) throw ServiceError.forbidden(availability.reason ?? 'AI for PDF imports is not available')
    if (!options.aiConsent) throw ServiceError.validation('Confirm that the PDF\'s content may be sent to your workspace\'s AI provider')
    requirePerm(ctx, 'forms.edit')
    const run = await runWorkspaceAi(ctx, analysis, file.bytes, deps.complete)
    if (run.answer) ({ model, changes } = mergeAiAnswer(analysis.model, run.answer))
    else warnings.push(`The AI assist's answer was not usable (${run.info.error ?? 'invalid'}): the result below is the importer's own.`)
    ai = { used: true, answer: run.answer, info: run.info, error: run.info.error }
  }
  const built = buildForms(model, buildOptionsOf(analysis, options))
  const report = pdfReport(model, built, { fileName: analysis.fileName, warnings, aiUsed: ai.used, aiChanges: changes })
  report.details = {
    kind: model.kind,
    pages: model.pages,
    hash: analysis.hash,
    stats: analysis.stats,
    ai_availability: availability,
    ai,
    forms: built.forms.map((f) => ({ name: f.name, counts: f.counts, ...(f.display ? { display: f.display } : {}), definition: { fields: f.fields, layout: f.layout, ...(f.header ? { header: f.header } : {}), ...(f.theme ? { theme: f.theme } : {}) } })),
    styling: options.style
      ? { on: true, options: options.style, read: Boolean(analysis.styling), counts: built.styling?.counts ?? null, theme: built.styling?.theme ?? null, header: built.styling?.header ? { ...built.styling.header, image_url: built.styling.header.image_url ? '(logo)' : undefined } : null, found: analysis.styling ? { images: analysis.styling.images.length, texts: analysis.styling.stats.texts, rules: analysis.styling.rules.length, theme: Boolean(analysis.styling.theme) } : null }
      : { on: false },
    tables: (model.tables ?? []).map((t) => ({
      id: t.id, name: t.name, page: t.page, pages: t.pages, rows: t.rows, max_rows: t.maxRows, columns: t.columns.map((c) => c.label),
      fields: t.itemIds.length, converted: built.converted.includes(t.id),
      key: built.forms.flatMap((f) => f.tables).find((b) => b.id === t.id)?.key ?? null,
    })),
  }
  return report
}

export async function importPdf(ctx: ServiceContext, files: ImportFile[], raw: Record<string, unknown>): Promise<ImportResult> {
  requirePerm(ctx, 'forms.edit')
  const options = pdfOptions(raw)
  const file = fileOf(files)
  const analysis = await read(file, options.style ? 'full' : null)
  let model = analysis.model
  let changes: string[] = []
  // The AI answer the analysis returned (never a second provider call): validated again, merged again.
  if (options.ai && options.aiResult) ({ model, changes } = mergeAiAnswer(analysis.model, options.aiResult))
  const built = buildForms(model, buildOptionsOf(analysis, options))
  const report = pdfReport(model, built, { fileName: analysis.fileName, warnings: analysis.warnings, aiUsed: Boolean(options.ai && options.aiResult), aiChanges: changes })
  const usable = built.forms.filter((f) => f.counts.fields)
  if (!usable.length) throw ServiceError.validation(model.kind === 'flat' || model.kind === 'scanned' ? 'This PDF has no fillable fields: turn on "Use AI for the hard parts" to read it, or build the form by hand.' : 'No fields were found in this PDF')
  const forms = await import('@/lib/services/forms')
  const { formDesignerHref } = await import('@/lib/forms/designer-links')
  const styled = usable.some((f) => f.header || f.theme || f.display)
  const assets = styled ? (await import('./assets')).pdfAssetStore(ctx, forms) : null
  const created: ImportResult['created'] = []
  const styleNotes: string[] = []
  try {
    // One theme for every part, named after the form.
    const theme = assets && options.style?.theme && usable[0]?.theme
      ? { source: 'saved' as const, theme_id: await assets.theme(`${(options.name || model.title || 'Imported PDF form').slice(0, 100)} (PDF)`, usable[0].theme, `From the PDF "${analysis.fileName}": its colours and fonts, contrast-checked.`) }
      : null
    if (theme) styleNotes.push('A form theme was made from the PDF\'s colours and fonts (Forms → Themes): change it there, or pick the workspace theme in the form\'s settings.')
    for (const f of usable) {
      const fields = assets ? await assets.fields(f.fields) : f.fields
      const header = assets && f.header ? await assets.header(f.header) : undefined
      const row = await forms.createForm(ctx, {
        name: f.name, description: f.description, tags: f.tags, fields, layout: f.layout,
        ...(theme ? { theme } : {}), ...(header ? { header } : {}),
        ...(options.availableInMenu !== undefined ? { available_in_menu: options.availableInMenu } : {}),
      } as never)
      created.push({ kind: 'form', id: row.id, name: row.name, href: formDesignerHref(row.id) })
    }
  } catch (error) {
    // Nothing half-made is kept.
    for (const c of created) await forms.deleteForm(ctx, c.id).catch(() => undefined)
    await assets?.cleanup().catch(() => undefined)
    throw error
  }
  if (assets?.stored) styleNotes.push(`${assets.stored} picture${assets.stored === 1 ? ' was' : 's were'} stored as form images (re-encoded, metadata removed).`)
  return { report, created, warnings: [...analysis.warnings, ...(usable.length > 1 ? [`The PDF has more fields than one form holds: it became ${usable.length} forms.`] : []), ...styleNotes] }
}
