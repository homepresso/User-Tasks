'use client'

/**
 * Full-screen email template editor: HTML code editor (CodeMirror, lazy
 * loaded) or Design blocks on the left, a live sandboxed preview on the
 * right, the variables panel beside the editor. Plain-text part with
 * "Generate from HTML", starters, lint (structure, client compatibility,
 * unknown variables, Gmail clipping), CSS inlining on save, test send to the
 * signed-in person, and an unsaved-changes guard.
 */

import dynamic from 'next/dynamic'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, ArrowLeft, Braces, CheckCircle2, Code2, Info, LayoutTemplate, Paintbrush, Send, Settings2, Sparkles, Type, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { Tabs } from '@/components/ui/tabs'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { InlineNotice } from '@/components/ui/inline-notice'
import { TagInput } from '@/components/ui/tag-input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Popover } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { getEmailEditorContext, getEmailSampleFromForm, saveEmailTemplate, sendEmailTemplateTest } from '@/app/actions/email-templates'
import { serverRead } from '@/lib/server-read'
import { getPublicConfig } from '@/lib/config/public'
import { lintEmailHtml, byteLength, GMAIL_CLIP_BYTES, type EmailLintIssue } from '@/lib/email-editor/lint'
import { htmlToEmailText } from '@/lib/email-editor/html-to-text'
import { formatEmailHtml } from '@/lib/email-editor/format'
import { extractPreheader, setPreheader } from '@/lib/email-editor/preview'
import { designToHtml, emptyDesign, newBlock, readDesign, type EmailDesign } from '@/lib/email-editor/blocks'
import { starterContent, starterTemplates, type StarterTemplate } from '@/lib/email-editor/starters'
import { renderEmailTemplate } from '@/lib/email-editor/render'
import { normalizeVariableDeclarations, sampleValues, templateVariables, type EmailVariableDeclaration } from '@/lib/email-editor/variables'
import { EmailPreviewFrame } from './email-preview-frame'
import { EmailVariablesPanel } from './email-variables-panel'
import { EmailDesignEditor, type InsertTarget } from './email-design-editor'
import type { HtmlCodeEditorApi } from './html-code-editor'
import { cn } from '@/lib/utils'

const HtmlCodeEditor = dynamic(() => import('./html-code-editor'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-fg-muted"><Spinner className="mr-2" /> Loading editor…</div>,
})

export interface EditableEmailTemplate {
  id?: string
  name: string
  description: string | null
  subject: string
  html_body: string
  text_body: string
  tags?: string[]
  variables?: EmailVariableDeclaration[]
}

type EditorTab = 'html' | 'design' | 'text' | 'settings'

interface Draft {
  name: string
  description: string
  tags: string[]
  subject: string
  html: string
  text: string
  declarations: EmailVariableDeclaration[]
}

const draftOf = (t: EditableEmailTemplate | null): Draft => ({
  name: t?.name ?? '',
  description: t?.description ?? '',
  tags: t?.tags ?? [],
  subject: t?.subject ?? '',
  html: t?.html_body ?? '',
  text: t?.text_body ?? '',
  declarations: normalizeVariableDeclarations(t?.variables ?? []),
})

const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b)

/** Debounce a fast-changing value (preview / lint while typing). */
function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return out
}

export function EmailTemplateEditor({ template, onClose, onSaved }: {
  template: EditableEmailTemplate | null
  onClose(): void
  /** After a save: the stored template (the editor stays open). */
  onSaved(saved: EditableEmailTemplate & { id: string }): void
}) {
  const [baseline, setBaseline] = useState<Draft>(() => draftOf(template))
  const [draft, setDraft] = useState<Draft>(() => draftOf(template))
  const [id, setId] = useState<string | undefined>(template?.id)
  const [tab, setTab] = useState<EditorTab>(() => (readDesign(template?.html_body ?? '').editable ? 'design' : 'html'))
  const [mobilePane, setMobilePane] = useState<'edit' | 'preview'>('edit')
  const [showVariables, setShowVariables] = useState(true)
  const [inlineOnSave, setInlineOnSave] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'warning' | 'info'; message: string; title?: string } | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [starterPick, setStarterPick] = useState(() => !template?.html_body)
  const [confirmStarter, setConfirmStarter] = useState<StarterTemplate | null>(null)
  const [sampleFormId, setSampleFormId] = useState('')
  const [testState, setTestState] = useState<{ busy: boolean; result?: { sent: boolean; to: string | null; error?: string; detail?: string | null } }>({ busy: false })
  const codeApi = useRef<HtmlCodeEditorApi | null>(null)
  const target = useRef<InsertTarget | null>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const dirty = !sameDraft(draft, baseline)
  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value })), [])

  // Editor context (branding for starters, email setup, my address) and sample forms.
  const { data: context } = useQuery({ queryKey: ['email-editor-context'], queryFn: () => getEmailEditorContext(), staleTime: 60_000 })
  const { data: forms = [] } = useQuery({
    queryKey: ['email-editor-forms'],
    queryFn: async () => { const { data, error } = await serverRead('forms.list'); return error ? [] : ((data as { forms?: Array<{ id: string; name: string }> } | null)?.forms ?? []) },
    staleTime: 60_000,
  })
  const { data: formSample } = useQuery({
    queryKey: ['email-editor-form-sample', sampleFormId],
    queryFn: () => getEmailSampleFromForm(sampleFormId),
    enabled: !!sampleFormId,
    staleTime: 60_000,
  })

  // Unsaved changes: closing the tab asks the browser to confirm.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // Derived (debounced while typing).
  const html = useDeferredValue(draft.html)
  const lintSource = useMemo(() => ({ html: draft.html, subject: draft.subject, text: draft.text, declarations: draft.declarations }), [draft.html, draft.subject, draft.text, draft.declarations])
  const lintInput = useDebounced(lintSource, 300)
  const issues = useMemo(() => lintEmailHtml(lintInput), [lintInput])
  const variables = useMemo(() => templateVariables({ subject: draft.subject, html_body: html, text_body: draft.text }, draft.declarations), [draft.subject, html, draft.text, draft.declarations])
  const designState = useMemo(() => readDesign(html), [html])
  const preheader = useMemo(() => extractPreheader(draft.html), [draft.html])
  const previewInput = useMemo(() => ({ html: draft.html, subject: draft.subject, text: draft.text }), [draft.html, draft.subject, draft.text])
  const previewSource = useDebounced(previewInput, 250)
  const appUrl = (getPublicConfig().appUrl || '').trim().replace(/\/+$/, '') || (typeof window !== 'undefined' ? window.location.origin : 'https://app.example.com')
  const samples = useMemo(() => sampleValues(variables, formSample?.values ?? {}, appUrl), [variables, formSample, appUrl])
  const rendered = useMemo(() => renderEmailTemplate({ subject: previewSource.subject, html_body: previewSource.html, text_body: previewSource.text }, { variables: samples }), [previewSource, samples])
  const renderedPreheader = useMemo(() => extractPreheader(rendered.html), [rendered.html])
  const counts = { error: issues.filter((i) => i.severity === 'error').length, warning: issues.filter((i) => i.severity === 'warning').length, info: issues.filter((i) => i.severity === 'info').length }
  const sizeKb = byteLength(draft.html) / 1024

  const insert = useCallback((token: string) => {
    if (target.current) { target.current.insert(token); return }
    if (tab === 'html' && codeApi.current) { codeApi.current.insert(token); return }
    if (tab === 'text') { textTarget.insert(token); return }
    codeApi.current?.insert(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Plain inputs / textareas as insert targets.
  const inputTarget = (el: () => HTMLInputElement | HTMLTextAreaElement | null, key: 'subject' | 'text'): InsertTarget => ({
    insert(text) {
      const node = el()
      if (!node) return
      const start = node.selectionStart ?? node.value.length
      const end = node.selectionEnd ?? start
      set(key, node.value.slice(0, start) + text + node.value.slice(end))
      requestAnimationFrame(() => { node.focus(); node.setSelectionRange(start + text.length, start + text.length) })
    },
  })
  const textTarget = inputTarget(() => textRef.current, 'text')

  const applyDesign = (design: EmailDesign) => set('html', setPreheader(designToHtml(design), preheader))

  const applyStarter = (starter: StarterTemplate) => {
    const content = starterContent(starter)
    setDraft((d) => ({
      ...d,
      name: d.name || content.name,
      description: d.description || content.description,
      subject: content.subject,
      html: content.html_body,
      text: content.text_body,
      declarations: content.variables,
    }))
    setTab('design')
    setStarterPick(false)
    setConfirmStarter(null)
  }

  async function save() {
    if (saving) return
    if (!draft.name.trim()) { setTab('settings'); setNotice({ tone: 'error', message: 'Give the template a name (Settings).' }); return }
    if (!draft.subject.trim()) { subjectRef.current?.focus(); setNotice({ tone: 'error', message: 'A subject is required.' }); return }
    if (!draft.html.trim()) { setNotice({ tone: 'error', message: 'The HTML body is empty.' }); return }
    setSaving(true)
    setNotice(null)
    try {
      const saved = await saveEmailTemplate({
        id, name: draft.name, description: draft.description, subject: draft.subject, htmlBody: draft.html,
        textBody: draft.text, tags: draft.tags, variables: draft.declarations, inlineCss: inlineOnSave,
      })
      if (saved) {
        const next: Draft = { ...draftOf({ ...saved, text_body: saved.text_body, variables: saved.variables?.length ? saved.variables : draft.declarations }), tags: saved.tags ?? draft.tags }
        setId(saved.id)
        setBaseline(next)
        setDraft(next)
        onSaved({ ...saved, description: saved.description ?? null })
        const inlined = saved.inlined ? ` · CSS inlined (${saved.inlined} rule${saved.inlined === 1 ? '' : 's'})` : ''
        setNotice({ tone: 'success', message: `Saved${inlined}.` })
      } else {
        setBaseline(draft)
        setNotice({ tone: 'info', message: 'Already saved.' })
      }
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to save template' })
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    setTestState({ busy: true })
    try {
      const result = await sendEmailTemplateTest({ template_id: id ?? null, name: draft.name, subject: draft.subject, html_body: draft.html, text_body: draft.text, variables: samples })
      setTestState({ busy: false, result })
    } catch (error) {
      setTestState({ busy: false, result: { sent: false, to: null, error: error instanceof Error ? error.message : 'The test could not be sent' } })
    }
  }

  // ⌘S / Ctrl+S saves.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveRef.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const requestClose = () => { if (dirty) setConfirmClose(true); else onClose() }
  const starters = useMemo(() => starterTemplates(context?.branding ?? {}), [context?.branding])

  const issueIcon = (severity: EmailLintIssue['severity']) => severity === 'error' ? <AlertCircle size={14} className="shrink-0 text-danger" /> : severity === 'warning' ? <AlertTriangle size={14} className="shrink-0 text-warning" /> : <Info size={14} className="shrink-0 text-info" />

  const editorPane = (
    <div className="flex min-h-0 flex-1 flex-col" onFocusCapture={(e) => {
      // Typing in the code editor makes it the insert target.
      if ((e.target as HTMLElement).closest?.('[data-email-code-editor]')) target.current = null
    }}>
      <div className="flex items-center gap-2 border-b border-border-subtle px-3">
        <Tabs<EditorTab>
          bordered={false}
          aria-label="Editor"
          value={tab}
          onValueChange={(v) => { target.current = null; setTab(v) }}
          items={[
            { value: 'design', label: 'Design', icon: <Paintbrush size={14} /> },
            { value: 'html', label: 'HTML', icon: <Code2 size={14} />, count: counts.error || undefined },
            { value: 'text', label: 'Plain text', icon: <Type size={14} /> },
            { value: 'settings', label: 'Settings', icon: <Settings2 size={14} /> },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          {tab === 'html' && <Button type="button" size="sm" variant="ghost" leadingIcon={<Wand2 />} onClick={() => set('html', formatEmailHtml(draft.html))}>Format</Button>}
          <IconButton size="sm" label={showVariables ? 'Hide variables' : 'Show variables'} icon={<Braces />} aria-pressed={showVariables} variant={showVariables ? 'secondary' : 'ghost'} onClick={() => setShowVariables((v) => !v)} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
          {tab === 'html' && (
            <HtmlCodeEditor
              value={draft.html}
              onChange={(v) => set('html', v)}
              onReady={(api) => { codeApi.current = api }}
              issues={issues}
              declarations={draft.declarations}
              extraVariables={(formSample?.fields ?? []).map((f) => ({ name: `form.${f.key}`, label: f.label, group: 'Sample form' }))}
              placeholder="<p>Hello {{submitted_by_name}}</p>"
              className="h-full"
            />
          )}
          {tab === 'design' && (
            <EmailDesignEditor
              design={designState.design}
              editable={designState.editable}
              onChange={applyDesign}
              onStartDesign={(design) => applyDesign(design ?? { ...emptyDesign(context?.branding?.accent ? { accent: context.branding.accent } : {}), blocks: [newBlock('header'), newBlock('heading'), newBlock('text'), newBlock('button'), newBlock('footer')] })}
              onFocusTarget={(t) => { target.current = t }}
            />
          )}
          {tab === 'text' && (
            <div className="flex h-full min-h-0 flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="secondary" leadingIcon={<Sparkles />} onClick={() => set('text', htmlToEmailText(draft.html))}>Generate from HTML</Button>
                <span className="text-xs text-fg-muted">Shown by clients that do not display HTML and used for in-app task notifications. Left blank, it is generated when you save.</span>
              </div>
              <Textarea
                ref={textRef}
                value={draft.text}
                onChange={(e) => set('text', e.target.value)}
                onFocus={() => { target.current = textTarget }}
                aria-label="Plain text body"
                placeholder="Plain-text version of the email"
                className="min-h-0 flex-1 resize-none font-mono text-xs"
              />
            </div>
          )}
          {tab === 'settings' && (
            <div className="max-w-xl space-y-4 overflow-y-auto p-4">
              <Field label="Name"><Input value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={120} required aria-label="Template name" /></Field>
              <Field label="Description" optional><Input value={draft.description} onChange={(e) => set('description', e.target.value)} /></Field>
              <Field label="Tags" optional><TagInput value={draft.tags} onChange={(tags) => set('tags', tags)} aria-label="Tags" /></Field>
              <Checkbox
                label="Inline CSS when saving"
                description="Moves <style> rules onto the elements as style attributes (many clients drop <style>). Dark-mode and responsive @media rules stay in <style>."
                checked={inlineOnSave}
                onChange={(e) => setInlineOnSave(e.target.checked)}
              />
              <div className="rounded-md bg-subtle p-3 text-xs text-fg-muted">
                Unsafe markup (scripts, frames, forms, event handlers, <code>javascript:</code> links) is removed when the template is saved. Workflows use the template on <strong>Send Email</strong> steps and as a <strong>User Task</strong> assignment notification; variables the template declares appear there as a mapping table.
              </div>
              <Button type="button" variant="secondary" leadingIcon={<LayoutTemplate />} onClick={() => setStarterPick(true)}>Start from a starter template…</Button>
            </div>
          )}
        </div>
        {showVariables && tab !== 'settings' && (
          <EmailVariablesPanel
            className="hidden w-64 shrink-0 border-l border-border-subtle md:flex"
            variables={variables}
            declarations={draft.declarations}
            onDeclarationsChange={(d) => set('declarations', d)}
            onInsert={insert}
            formFields={formSample?.fields}
            formName={formSample?.form.name}
          />
        )}
      </div>
    </div>
  )

  return (
    <section className="fixed inset-0 z-40 flex flex-col bg-bg" aria-label="Email template editor" data-email-template-editor="">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-panel px-3 py-2">
        <IconButton label="Back to email templates" icon={<ArrowLeft />} onClick={requestClose} />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-fg">{draft.name.trim() || (id ? 'Untitled template' : 'New email template')}</h1>
          <p className="text-2xs text-fg-muted">{dirty ? 'Unsaved changes' : id ? 'All changes saved' : 'Not saved yet'}</p>
        </div>
        {dirty && <Badge tone="warning" dot>Unsaved</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Popover
            aria-label="Problems"
            width={384}
            className="p-0"
            trigger={(p) => (
              <Button type="button" size="sm" variant="ghost" data-email-issues="" {...p} leadingIcon={counts.error ? <AlertCircle className="text-danger" /> : counts.warning ? <AlertTriangle className="text-warning" /> : <CheckCircle2 className="text-success" />}>
                {counts.error + counts.warning === 0 ? 'No problems' : `${counts.error ? `${counts.error} error${counts.error === 1 ? '' : 's'}` : ''}${counts.error && counts.warning ? ', ' : ''}${counts.warning ? `${counts.warning} warning${counts.warning === 1 ? '' : 's'}` : ''}`}
              </Button>
            )}
          >
            {(close) => (
              <>
                <div className="border-b border-border-subtle px-3 py-2 text-xs text-fg-muted">
                  HTML size <span className={cn('num font-medium', sizeKb * 1024 > GMAIL_CLIP_BYTES ? 'text-danger' : 'text-fg')}>{sizeKb.toFixed(1)} KB</span> of Gmail&apos;s 102 KB clipping limit
                </div>
                <ul className="max-h-80 overflow-y-auto p-1" data-email-issue-list="">
                  {issues.length === 0 && <li className="px-2 py-3 text-xs text-fg-muted">No problems found.</li>}
                  {issues.map((issue, i) => (
                    <li key={`${issue.rule}-${issue.from}-${i}`}>
                      <button type="button" className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => { if (issue.to > issue.from) { close(); setTab('html'); setTimeout(() => codeApi.current?.reveal(issue.from, issue.to), 80) } }}>
                        {issueIcon(issue.severity)}
                        <span className="text-fg">{issue.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Popover>
          <Button type="button" size="sm" variant="secondary" leadingIcon={<LayoutTemplate />} onClick={() => setStarterPick(true)}>Starters</Button>
          <Popover
            aria-label="Send a test email"
            width={320}
            onOpenChange={(open) => { if (!open) setTestState({ busy: false }) }}
            trigger={(p) => <Button type="button" size="sm" variant="secondary" leadingIcon={<Send />} disabled={context ? !context.canTestSend : false} {...p}>Send test</Button>}
          >
            <div className="space-y-2" data-email-test-send="">
              <p className="text-sm font-medium text-fg">Send a test to yourself</p>
              <p className="text-xs text-fg-muted">The current draft with the preview&apos;s sample values goes to <strong className="text-fg">{context?.me.email ?? 'your address'}</strong> only. The subject starts with [Test].</p>
              {context && !context.email.ready && (
                <InlineNotice tone="warning" title="Email may not be set up" message={`${context.email.problem ?? 'No email provider is configured.'} The provider's response is shown if the send fails.`} />
              )}
              {testState.result && (testState.result.sent
                ? <InlineNotice tone="success" message={`Sent to ${testState.result.to}. Check your inbox (and spam folder).`} />
                : <InlineNotice tone="danger" title="Not sent" message={testState.result.error ?? 'The test could not be sent'}>
                  {testState.result.detail && <p className="mt-1 break-words font-mono text-2xs opacity-80">Provider said: {testState.result.detail}</p>}
                </InlineNotice>)}
              <div className="flex justify-end">
                <Button type="button" size="sm" leadingIcon={<Send />} loading={testState.busy} onClick={() => void sendTest()} disabled={!context?.me.email}>Send test</Button>
              </div>
            </div>
          </Popover>
          <Button type="button" size="sm" variant="ghost" onClick={requestClose}>Close</Button>
          <Button type="button" size="sm" onClick={() => void save()} loading={saving} kbd="⌘S">Save</Button>
        </div>
      </header>

      {notice && <div className="border-b border-border-subtle px-3 py-2"><InlineNotice tone={notice.tone} title={notice.title} message={notice.message} onDismiss={() => setNotice(null)} /></div>}

      {/* Subject / preheader */}
      <div className="grid gap-2 border-b border-border-subtle bg-panel px-3 py-2 md:grid-cols-2">
        <label className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs font-medium text-fg-muted">Subject</span>
          <Input ref={subjectRef} value={draft.subject} onChange={(e) => set('subject', e.target.value)} onFocus={() => { target.current = inputTarget(() => subjectRef.current, 'subject') }} maxLength={500} placeholder="Action needed: {{user_task_title}}" aria-label="Subject" className="h-8" />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs font-medium text-fg-muted">Preheader</span>
          <Input value={preheader} onChange={(e) => set('html', setPreheader(draft.html, e.target.value))} placeholder="Inbox preview text (optional)" aria-label="Preheader" className="h-8" />
        </label>
      </div>

      {/* Phones: one pane at a time. */}
      <div className="flex items-center justify-center border-b border-border-subtle py-1.5 lg:hidden">
        <SegmentedControl<'edit' | 'preview'> size="sm" aria-label="Pane" value={mobilePane} onValueChange={setMobilePane} options={[{ value: 'edit', text: 'Edit' }, { value: 'preview', text: 'Preview' }]} />
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        <div className={cn('min-h-0 flex-col border-r border-border-subtle lg:flex', mobilePane === 'edit' ? 'flex' : 'hidden')}>{editorPane}</div>
        <EmailPreviewFrame
          className={cn('min-h-0 lg:flex', mobilePane === 'preview' ? 'flex' : 'hidden')}
          html={rendered.html}
          subject={rendered.subject}
          preheader={renderedPreheader}
          toolbarExtra={
            <Select aria-label="Sample data" value={sampleFormId} onChange={(e) => setSampleFormId(e.target.value)} className="h-7 max-w-44 text-xs">
              <option value="">Default sample values</option>
              {forms.map((f) => <option key={f.id} value={f.id}>Form: {f.name}</option>)}
            </Select>
          }
        />
      </div>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Discard your changes?"
        description="This template has unsaved changes. Close without saving?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => { setConfirmClose(false); onClose() }}
      />

      <Dialog open={starterPick} onOpenChange={setStarterPick}>
        <DialogContent size="lg" title="Start from a template" description="Professional starters using your workspace branding. They open in the Design tab — change anything.">
          <div className="grid gap-3 p-1 pt-3 sm:grid-cols-2" data-email-starters="">
            {starters.map((starter) => (
              <button
                key={starter.id}
                type="button"
                className="rounded-lg border border-border-subtle p-3 text-left hover:border-primary hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                onClick={() => { if (draft.html.trim() && dirty || (draft.html.trim() && id)) setConfirmStarter(starter); else applyStarter(starter) }}
                data-starter={starter.id}
              >
                <p className="text-sm font-medium text-fg">{starter.name}</p>
                <p className="mt-0.5 text-xs text-fg-muted">{starter.description}</p>
                <p className="mt-2 truncate font-mono text-2xs text-fg-subtle">{starter.subject}</p>
              </button>
            ))}
            <button type="button" className="rounded-lg border border-dashed border-border p-3 text-left hover:bg-muted" onClick={() => setStarterPick(false)}>
              <p className="text-sm font-medium text-fg">{draft.html.trim() ? 'Keep the current content' : 'Blank — write HTML'}</p>
              <p className="mt-0.5 text-xs text-fg-muted">{draft.html.trim() ? 'Close without changing anything.' : 'Start with an empty HTML editor.'}</p>
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!confirmStarter}
        onOpenChange={(open) => { if (!open) setConfirmStarter(null) }}
        title="Replace the content?"
        description="The starter replaces the subject, HTML, plain text and variables (name and tags stay). You can undo by closing without saving."
        confirmLabel="Use starter"
        onConfirm={() => { if (confirmStarter) applyStarter(confirmStarter) }}
      />
    </section>
  )
}
