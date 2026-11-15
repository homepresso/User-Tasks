/**
 * Browsable reference page for a generated API (lib/extensions/api-reference):
 * groups of operations with their method, path, parameters, request and
 * response schemas and examples, plus where else each operation is
 * available (workflow step, MCP tool). Re-exported by
 * `@user-tasks/extension-sdk/ui` so extension pages render references with
 * core components (no extension CSS). Renders on the server: operations
 * expand with <details>, no client script.
 */

import { Badge, type Tone } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import type { ApiReferenceDoc, ApiReferenceField, ApiReferenceOperation, ApiReferenceSchema } from '@/lib/extensions/api-reference'

const METHOD_TONE: Record<string, Tone> = { GET: 'success', POST: 'info', PUT: 'warning', PATCH: 'brand', DELETE: 'danger' }

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function json(value: unknown): string {
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function FieldsTable({ fields, label }: { fields: ApiReferenceField[]; label: string }) {
  return (
    <Table label={label} minWidth="35rem">
      <THead>
        <tr>
          <TH col="name">Field</TH>
          <TH col="status">Type</TH>
          <TH col="text">Description</TH>
        </tr>
      </THead>
      <TBody>
        {fields.map((f) => (
          <TR key={f.name}>
            <TD><code className="font-mono text-xs text-fg">{f.name}</code>{f.required && !f.readOnly && <span className="text-danger" aria-label="required"> *</span>}</TD>
            <TD>
              <span className="text-xs text-fg">{f.type}{f.items ? `<${f.items}>` : ''}</span>
              {f.format && <span className="block text-2xs text-fg-muted">{f.format}</span>}
              {f.readOnly && <Badge tone="neutral" className="mt-0.5">read-only</Badge>}
            </TD>
            <TD>
              <span className="text-xs text-fg-muted">{f.description ?? ''}</span>
              {f.enum?.length ? <span className="block text-2xs text-fg-subtle">One of: {f.enum.slice(0, 30).join(', ')}{f.enum.length > 30 ? ' …' : ''}</span> : null}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}

function Operation({ op, schemas }: { op: ApiReferenceOperation; schemas: Map<string, ApiReferenceSchema> }) {
  const params = op.params ?? []
  const request = op.requestSchema ? schemas.get(op.requestSchema) : undefined
  const response = op.responseSchema ? schemas.get(op.responseSchema) : undefined
  return (
    <details id={`op-${slug(op.id)}`} className="group border-b border-border-subtle last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-muted">
        <Badge tone={METHOD_TONE[op.method] ?? 'neutral'} className="w-16 justify-center font-mono">{op.method}</Badge>
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{op.path}</code>
        <span className="hidden text-ui text-fg-muted sm:inline">{op.summary}</span>
        {op.deprecated && <Badge tone="warning">deprecated</Badge>}
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <p className="text-ui text-fg sm:hidden">{op.summary}</p>
        {op.description && <p className="text-ui text-fg-muted">{op.description}</p>}
        <p className="text-2xs text-fg-subtle">Operation id <code className="font-mono">{op.id}</code></p>
        {op.availableAs?.length ? (
          <ul className="flex flex-wrap gap-2">
            {op.availableAs.map((a) => <li key={`${a.label}:${a.value}`}><Badge tone="brand">{a.label}: {a.value}</Badge></li>)}
          </ul>
        ) : null}
        {params.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-fg-muted">Parameters</p>
            <Table label={`${op.id} parameters`} minWidth="35rem">
              <THead>
                <tr><TH col="name">Name</TH><TH col="status">In</TH><TH col="status">Type</TH><TH col="text">Description</TH></tr>
              </THead>
              <TBody>
                {params.map((p) => (
                  <TR key={`${p.in}:${p.name}`}>
                    <TD><code className="font-mono text-xs text-fg">{p.name}</code>{p.required && <span className="text-danger" aria-label="required"> *</span>}</TD>
                    <TD><span className="text-xs text-fg-muted">{p.in}</span></TD>
                    <TD><span className="text-xs text-fg">{p.type}</span></TD>
                    <TD>
                      <span className="text-xs text-fg-muted">{p.description ?? ''}</span>
                      {p.enum?.length ? <span className="block text-2xs text-fg-subtle">One of: {p.enum.join(', ')}</span> : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        {request && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-fg-muted">Request body: {request.name}</p>
            <FieldsTable fields={request.fields} label={`${op.id} request body`} />
          </div>
        )}
        {op.requestExample !== undefined && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-fg-muted">Example request</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs text-fg">{json(op.requestExample)}</pre>
          </div>
        )}
        {response && <p className="text-xs text-fg-muted">Returns <a className="text-primary-text underline-offset-4 hover:underline" href={`#schema-${slug(response.name)}`}>{response.name}</a></p>}
        {op.responseExample !== undefined && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-fg-muted">Example response</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs text-fg">{json(op.responseExample)}</pre>
          </div>
        )}
        {op.notes?.length ? <ul className="list-disc space-y-1 pl-5 text-xs text-fg-muted">{op.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
      </div>
    </details>
  )
}

export function ApiReference({ doc }: { doc: ApiReferenceDoc }) {
  const schemas = new Map((doc.schemas ?? []).map((s) => [s.name, s]))
  return (
    <div className="space-y-6">
      {doc.warnings?.map((w) => <InlineNotice key={w} tone="warning">{w}</InlineNotice>)}
      {(doc.description || doc.meta?.length || doc.baseUrl || doc.auth) && (
        <Card className="space-y-3">
          {doc.description && <p className="text-ui text-fg">{doc.description}</p>}
          {(doc.baseUrl || doc.meta?.length) && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {doc.baseUrl && <div><dt className="text-2xs text-fg-subtle">Base URL</dt><dd className="break-all font-mono text-xs text-fg">{doc.baseUrl}</dd></div>}
              {doc.meta?.map((m) => <div key={m.label}><dt className="text-2xs text-fg-subtle">{m.label}</dt><dd className="break-words text-xs text-fg">{m.value}</dd></div>)}
            </dl>
          )}
          {doc.auth && <p className="text-xs text-fg-muted">{doc.auth}</p>}
        </Card>
      )}
      <nav aria-label="Reference sections" className="flex flex-wrap gap-2">
        {doc.groups.map((g) => <a key={g.id} href={`#group-${slug(g.id)}`} className="text-xs text-primary-text underline-offset-4 hover:underline">{g.title} ({g.operations.length})</a>)}
        {doc.schemas?.length ? <a href="#schemas" className="text-xs text-primary-text underline-offset-4 hover:underline">Schemas ({doc.schemas.length})</a> : null}
      </nav>
      {doc.groups.map((group) => (
        <section key={group.id} id={`group-${slug(group.id)}`} className="space-y-2">
          <h2 className="text-sm font-semibold text-fg">{group.title}</h2>
          {group.description && <p className="text-ui text-fg-muted">{group.description}</p>}
          <Card padding="none">
            {group.operations.map((op) => <Operation key={op.id} op={op} schemas={schemas} />)}
          </Card>
        </section>
      ))}
      {doc.schemas?.length ? (
        <section id="schemas" className="space-y-4">
          <h2 className="text-sm font-semibold text-fg">Schemas</h2>
          {doc.schemas.map((s) => (
            <div key={s.name} id={`schema-${slug(s.name)}`} className="space-y-2">
              <h3 className="font-mono text-xs font-semibold text-fg">{s.name}</h3>
              {s.description && <p className="text-xs text-fg-muted">{s.description}</p>}
              <FieldsTable fields={s.fields} label={`${s.name} fields`} />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}
