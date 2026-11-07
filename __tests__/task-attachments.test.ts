import { describe, expect, it } from 'vitest'
import { attachmentPreviewKind, attachmentTypeSuggestions, defaultAttachmentName, normalizeAttachmentType, validateAttachmentMeta } from '@/lib/task-attachments'
import { buildDataTree, rootsForNode, TASK_ATTACHMENT_SCHEMA } from '@/lib/workflow-data-picker'
import { buildTaskDataObject, TASK_VARIABLE_CATALOG } from '@/lib/task-data'
import { validateNode } from '@/lib/workflow-validation'
import { NODE_CATALOG } from '@/lib/workflow-schema'
import { getNodeConfigSummary } from '@/lib/workflow-utils'

describe('task attachment values', () => {
  it('names default to the file name; types are free text with canonical defaults', () => {
    expect(defaultAttachmentName('signed_contract-v2.pdf')).toBe('signed contract v2')
    expect(normalizeAttachmentType('  invoice ')).toBe('Invoice')
    expect(normalizeAttachmentType('Purchase   order')).toBe('Purchase order')
    expect(normalizeAttachmentType('')).toBe('Other')
  })

  it('validates name, type and description lengths and strips control characters', () => {
    expect(validateAttachmentMeta({ name: '', type: 'receipt', description: 'Lunch‮' }, 'r.pdf')).toEqual({ ok: true, value: { name: 'r', type: 'Receipt', description: 'Lunch' } })
    const bad = validateAttachmentMeta({ name: 'x'.repeat(201), type: 'y'.repeat(61), description: 'z'.repeat(2001) })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['description', 'name', 'type'])
    expect(validateAttachmentMeta({ name: '   ' }).ok).toBe(false)
  })

  it('suggests the defaults first, then the workspace\'s own types, deduplicated', () => {
    expect(attachmentTypeSuggestions(['Permit', 'invoice', 'permit'])).toEqual(['Contract', 'Invoice', 'Receipt', 'Evidence', 'Image', 'Other', 'Permit'])
  })

  it('previews raster images only', () => {
    expect(attachmentPreviewKind('image/png')).toBe('image')
    expect(attachmentPreviewKind('application/pdf')).toBeNull()
    expect(attachmentPreviewKind('image/svg+xml')).toBeNull()
    expect(attachmentPreviewKind('text/html')).toBeNull()
  })
})

describe('workflow data picker and outputs', () => {
  const nodes = [
    { id: 'start', type: 'manual', label: 'Start', config: {} },
    { id: 'approve', type: 'user_task', label: 'Approve', config: { outcomes: ['Approved'] } },
    { id: 'each', type: 'loop', label: 'Each file', config: { items: '{{attachments}}', item_var: 'file' } },
    { id: 'read', type: 'doc_read', label: 'Read', config: { source: '{{file}}' } },
    { id: 'attach', type: 'add_task_attachment', label: 'File it', config: { file: '{{doc_file}}' } },
  ]
  const edges = [
    { id: 'e1', source: 'start', target: 'approve' },
    { id: 'e2', source: 'approve', target: 'each' },
    { id: 'e3', source: 'each', target: 'read', label: 'each item' },
    { id: 'e4', source: 'each', target: 'attach', label: 'done' },
  ]

  it('User Task steps output `attachments`, a list of attachment objects', () => {
    const roots = rootsForNode(nodes[1])
    const attachments = roots.find((r) => r.path === 'attachments')!
    expect(attachments.schema).toMatchObject({ type: 'array', items: TASK_ATTACHMENT_SCHEMA })
    expect(TASK_ATTACHMENT_SCHEMA.fields?.map((f) => f.name)).toEqual(expect.arrayContaining(['id', 'name', 'type', 'description', 'file_name', 'mime', 'size', 'url', 'storage_ref', 'uploaded_by', 'created_at']))
  })

  it('a Loop over {{attachments}} gives a typed item', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'read' })
    const loop = groups.find((g) => g.kind === 'loop')!
    const item = loop.roots.find((r) => r.path === 'file')!
    expect(item.schema?.fields?.map((f) => f.name)).toContain('storage_ref')
  })

  it('task triggers expose {{task.attachments}}; the Add Task Attachment step outputs `attachment`', () => {
    const groups = buildDataTree({ nodes: [{ id: 't', type: 'task_completed', label: 'Task completed', config: {} }, nodes[4]], edges: [{ id: 'e', source: 't', target: 'attach' }] })
    expect(groups.flatMap((g) => g.roots).some((r) => r.path === 'task.attachments' && r.schema?.type === 'array')).toBe(true)
    expect(rootsForNode({ ...nodes[4], config: { ...nodes[4].config, _output_prefix: 'filed' } })[0]).toMatchObject({ path: 'filed_attachment', schema: TASK_ATTACHMENT_SCHEMA })
    expect(TASK_VARIABLE_CATALOG.some((v) => v.name === 'task.attachments')).toBe(true)
  })

  it('{{task.attachments}} is part of the task data object', () => {
    const list = [{ id: 'a', name: 'Contract' }]
    expect(buildTaskDataObject({ task: { id: 't' }, attachments: list }).attachments).toEqual(list)
    expect(buildTaskDataObject({ task: { id: 't' } }).attachments).toEqual([])
  })

  it('the Add Task Attachment step is in the catalog, needs a file, and summarises', () => {
    expect(NODE_CATALOG.find((n) => n.type === 'add_task_attachment')).toMatchObject({ category: 'action', label: 'Add Task Attachment' })
    expect(validateNode({ id: 'x', type: 'add_task_attachment', label: 'x', config: {} } as never)).toContain('File required')
    expect(validateNode({ id: 'x', type: 'add_task_attachment', label: 'x', config: { file: '{{doc_file}}' } } as never)).not.toContain('File required')
    expect(getNodeConfigSummary({ type: 'add_task_attachment', config: { name: 'Contract', task_id: '{{user_task_id}}' } } as never)).toBe('"Contract" → {{user_task_id}}')
  })
})
