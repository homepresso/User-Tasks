'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Check, Plus, Trash2, Loader2 } from 'lucide-react'
import { createIntegrationReference } from '@/app/actions/integration-references'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

interface ReferenceToCreate {
  name: string
  description: string
  type: string // table operation or procedure
  operation: 'read' | 'list' | 'insert' | 'update' | 'delete' | 'execute'
  sourceItem: any
  inputs: { name: string; type: string; required: boolean; default_value: string }[]
  outputs: { name: string; path: string; type: string }[]
  queryTemplate: string
  created: boolean
}

interface WizardStep3Props {
  integration: any
  selectedItems: any[]
  existingReferences: any[]
  onBack: () => void
}

export function WizardStep3References({ integration, selectedItems, existingReferences, onBack }: WizardStep3Props) {
  const [references, setReferences] = useState<ReferenceToCreate[]>(() => generateReferences(selectedItems))
  const [creating, setCreating] = useState(false)
  const [createdCount, setCreatedCount] = useState(0)
  const router = useRouter()

  function generateReferences(items: any[]): ReferenceToCreate[] {
    const refs: ReferenceToCreate[] = []

    for (const item of items) {
      const fullName = item.schema !== 'dbo' && item.schema !== 'public'
        ? `${item.schema}.${item.name}`
        : item.name

      if (item.type === 'procedure' || item.type === 'function') {
        // Stored procedure -> single "Execute" reference
        const inputs = (item.parameters ?? [])
          .filter((p: any) => (p.mode ?? 'IN').includes('IN'))
          .map((p: any) => ({
            name: (p.name ?? '').replace('@', ''),
            type: mapSqlType(p.type),
            required: true,
            default_value: '',
          }))

        refs.push({
          name: `Execute ${item.name}`,
          description: `Execute stored procedure ${fullName}`,
          type: item.type,
          operation: 'execute',
          sourceItem: item,
          inputs,
          outputs: [{ name: 'result', path: '', type: 'array' }],
          queryTemplate: `EXEC ${fullName}`,
          created: false,
        })
      } else {
        // Table or View -> generate full CRUD references
        const columns = item.columns ?? []
        // Use discovered PK if available, otherwise guess from column names
        const pkColName = item.primary_key?.[0]
          ?? columns.find((c: any) => ['id', 'Id', 'ID', `${item.name}ID`, `${item.name}Id`].includes(c.column))?.column
          ?? columns[0]?.column
        const pkColumn = columns.find((c: any) => c.column === pkColName) ?? columns[0]
        const isIdentity = (c: any) => c.column === item.identity_column
        const nonPkCols = columns.filter((c: any) => c.column !== pkColName)

        // 1. List
        refs.push({
          name: `List ${item.name}`,
          description: `Get rows from ${fullName} with pagination`,
          type: item.type,
          operation: 'list',
          sourceItem: item,
          inputs: [
            { name: 'limit', type: 'number', required: false, default_value: '100' },
            { name: 'offset', type: 'number', required: false, default_value: '0' },
          ],
          outputs: [
            { name: 'results', path: '', type: 'array' },
            ...columns.slice(0, 15).map((c: any) => ({
              name: c.column, path: `[].${c.column}`, type: mapSqlType(c.type),
            })),
          ],
          queryTemplate: `SELECT * FROM ${fullName} ORDER BY 1 OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
          created: false,
        })

        // 2. Get by PK
        if (pkColumn) {
          refs.push({
            name: `Get ${item.name}`,
            description: `Get a single row from ${fullName} by ${pkColumn.column}`,
            type: item.type,
            operation: 'read',
            sourceItem: item,
            inputs: [
              { name: pkColumn.column, type: mapSqlType(pkColumn.type), required: true, default_value: '' },
            ],
            outputs: columns.slice(0, 15).map((c: any) => ({
              name: c.column, path: c.column, type: mapSqlType(c.type),
            })),
            queryTemplate: `SELECT TOP 1 * FROM ${fullName} WHERE ${pkColumn.column} = @${pkColumn.column}`,
            created: false,
          })
        }

        // Tables only: Insert, Update, Delete (views are read-only)
        if (item.type === 'table') {
          // 3. Insert — skip identity/auto-increment columns
          const insertCols = columns.filter((c: any) => !isIdentity(c)).slice(0, 20)
          refs.push({
            name: `Insert ${item.name}`,
            description: `Insert a new row into ${fullName}`,
            type: item.type,
            operation: 'insert',
            sourceItem: item,
            inputs: insertCols.map((c: any) => ({
              name: c.column, type: mapSqlType(c.type), required: !c.nullable, default_value: '',
            })),
            outputs: [{ name: 'affected_rows', path: 'affected_rows', type: 'number' }],
            queryTemplate: `INSERT INTO ${fullName} (${insertCols.map((c: any) => c.column).join(', ')}) VALUES (${insertCols.map((c: any) => '@' + c.column).join(', ')})`,
            created: false,
          })

          // 4. Update by PK
          if (pkColumn) {
            const updateCols = nonPkCols.slice(0, 15)
            refs.push({
              name: `Update ${item.name}`,
              description: `Update a row in ${fullName} by ${pkColumn.column}`,
              type: item.type,
              operation: 'update',
              sourceItem: item,
              inputs: [
                ...updateCols.map((c: any) => ({
                  name: c.column, type: mapSqlType(c.type), required: false, default_value: '',
                })),
                { name: pkColumn.column, type: mapSqlType(pkColumn.type), required: true, default_value: '' },
              ],
              outputs: [{ name: 'affected_rows', path: 'affected_rows', type: 'number' }],
              queryTemplate: `UPDATE ${fullName} SET ${updateCols.map((c: any) => `${c.column} = @${c.column}`).join(', ')} WHERE ${pkColumn.column} = @${pkColumn.column}`,
              created: false,
            })
          }

          // 5. Delete by PK
          if (pkColumn) {
            refs.push({
              name: `Delete ${item.name}`,
              description: `Delete a row from ${fullName} by ${pkColumn.column}`,
              type: item.type,
              operation: 'delete',
              sourceItem: item,
              inputs: [
                { name: pkColumn.column, type: mapSqlType(pkColumn.type), required: true, default_value: '' },
              ],
              outputs: [{ name: 'affected_rows', path: 'affected_rows', type: 'number' }],
              queryTemplate: `DELETE FROM ${fullName} WHERE ${pkColumn.column} = @${pkColumn.column}`,
              created: false,
            })
          }
        }
      }
    }

    return refs
  }

  function removeReference(index: number) {
    setReferences(refs => refs.filter((_, i) => i !== index))
  }

  function updateReference(index: number, field: string, value: any) {
    setReferences(refs => refs.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  async function createAllReferences() {
    setCreating(true)

    let count = 0
    for (let i = 0; i < references.length; i++) {
      const ref = references[i]
      if (ref.created) continue

      // Check if already exists
      const exists = existingReferences.some(
        (er: any) => er.name === ref.name && er.integration_id === integration.id
      )
      if (exists) {
        setReferences(prev => prev.map((r, j) => j === i ? { ...r, created: true } : r))
        count++
        continue
      }

      // integrations.manage_references; audited and queued for GitHub sync.
      const result = await createIntegrationReference(integration.id, {
        name: ref.name,
        description: ref.description,
        inputs: ref.inputs.map((inp) => ({
          id: crypto.randomUUID(),
          ...inp,
          source: inp.default_value ? 'static' : 'variable',
        })),
        outputs: ref.outputs.map(out => ({
          id: crypto.randomUUID(),
          ...out,
        })),
        request_config: {
          method: ref.operation === 'execute' ? 'EXEC' : ref.operation === 'list' ? 'QUERY' : ref.operation === 'read' ? 'QUERY' : ref.operation === 'insert' ? 'INSERT' : 'QUERY',
          path_template: ref.queryTemplate,
        },
      })

      if (result.ok) {
        setReferences(prev => prev.map((r, j) => j === i ? { ...r, created: true } : r))
        count++
      }

      setCreatedCount(count)
    }

    setCreating(false)
    router.refresh()
  }

  const allCreated = references.every(r => r.created)
  const opIcons: Record<string, string> = {
    list: '\u{1F4CB}', read: '\u{1F50D}', insert: '\u2795', update: '\u270F\uFE0F', delete: '\u{1F5D1}\uFE0F', execute: '\u2699\uFE0F',
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">References to Create</h3>
            <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              {references.length} references from {selectedItems.length} selected objects.
              Edit names, inputs, or remove any you don't need.
            </p>
          </div>
          {!allCreated && (
            <Button onClick={createAllReferences} disabled={creating || references.length === 0}>
              {creating ? (
                <><Loader2 size={14} className="mr-1 animate-spin" /> Creating ({createdCount}/{references.length})</>
              ) : (
                <><Plus size={14} className="mr-1" /> Create All ({references.length})</>
              )}
            </Button>
          )}
        </div>

        <div className="space-y-3">
          {references.map((ref, i) => (
            <div
              key={i}
              className={cn('rounded-lg p-3 transition-all', ref.created && 'opacity-60')}
              style={{
                backgroundColor: ref.created ? 'var(--theme-surface)' : 'var(--theme-card-bg)',
                border: `1px solid ${ref.created ? 'var(--theme-primary)' : 'var(--theme-surface-border)'}`,
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span>{opIcons[ref.operation] ?? '\u{1F4CC}'}</span>
                  {ref.created ? (
                    <div className="flex items-center gap-1">
                      <Check size={14} style={{ color: 'var(--theme-primary-text)' }} />
                      <span className="text-sm font-medium">{ref.name}</span>
                    </div>
                  ) : (
                    <Input
                      value={ref.name}
                      onChange={(e) => updateReference(i, 'name', e.target.value)}
                      className="!h-7 !text-sm font-medium"
                    />
                  )}
                </div>
                {!ref.created && (
                  <button onClick={() => removeReference(i)} className="shrink-0 p-1 hover:text-red-500" style={{ color: 'var(--theme-muted-text)' }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              <p className="text-[10px] mb-2" style={{ color: 'var(--theme-muted-text)' }}>
                {ref.description}
              </p>

              {/* Query preview */}
              <div className="text-[10px] font-mono px-2 py-1.5 rounded mb-2 overflow-x-auto" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                {ref.queryTemplate}
              </div>

              {/* Inputs summary */}
              {ref.inputs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <span className="text-[9px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Inputs:</span>
                  {ref.inputs.map((inp, j) => (
                    <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-primary-text)' }}>
                      @{inp.name} <span style={{ color: 'var(--theme-muted-text)' }}>({inp.type})</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Outputs summary */}
              {ref.outputs.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  <span className="text-[9px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Outputs:</span>
                  {ref.outputs.slice(0, 5).map((out, j) => (
                    <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}>
                      {out.name}
                    </span>
                  ))}
                  {ref.outputs.length > 5 && (
                    <span className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>+{ref.outputs.length - 5} more</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {allCreated && references.length > 0 && (
          <div className="mt-4 rounded-lg p-4 text-center" style={{ backgroundColor: 'var(--theme-primary-light)' }}>
            <Check size={24} className="mx-auto mb-2" style={{ color: 'var(--theme-primary-text)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--theme-primary-text)' }}>
              All {references.length} references created!
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
              You can edit them in the References section below.
            </p>
          </div>
        )}
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft size={14} className="mr-1" /> Back
        </Button>
      </div>
    </div>
  )
}

function mapSqlType(sqlType: string): string {
  const t = (sqlType ?? '').toLowerCase()
  if (t.includes('int') || t.includes('decimal') || t.includes('numeric') || t.includes('float') || t.includes('real') || t.includes('money')) return 'number'
  if (t.includes('bit') || t.includes('bool')) return 'boolean'
  if (t.includes('date') || t.includes('time')) return 'string'
  return 'string'
}
