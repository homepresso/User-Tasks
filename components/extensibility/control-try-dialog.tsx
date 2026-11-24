'use client'

/**
 * Extensibility → Form controls → Try it: the control's declared properties
 * as a generated, typed form (same form as a workflow action's Test tab)
 * driving a live preview of the real control (the sandboxed frame, or
 * inline when trusted — components/forms/custom-control-field.tsx) with
 * sample values. Shows the value the control reports and its validity.
 * Nothing is saved; the last property values are remembered in this
 * browser.
 */

import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { RotateCcw } from 'lucide-react'
import type { FormControlManifest } from '@/lib/forms/custom-controls/contract'
import { customConfigFromManifest } from '@/lib/forms/custom-controls/field'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { controlPropToTestField, previewPropsOf, rememberTestInputs, testInputsStorageKey, validateControlProps } from '@/lib/extensibility-test-inputs'
import { CustomControlField } from '@/components/forms/custom-control-field'
import { FormLookupProvider } from '@/components/forms/lookup-field'
import { TestInputForm, useTestInputs } from './test-input-form'

export function ControlTryDialog({ manifest, open, onClose }: { manifest: FormControlManifest; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="xl" className="max-h-[90vh]" title={`Try ${manifest.name}`} description={<><code className="font-mono text-xs">&lt;{manifest.tag}&gt;</code> · v{manifest.version} · stores {manifest.value.type}</>}>
        <DialogBody>
          {open && <ControlTry key={`${manifest.tag}@${manifest.version}`} manifest={manifest} />}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

export function ControlTry({ manifest }: { manifest: FormControlManifest }) {
  const fields = useMemo(() => manifest.props.map(controlPropToTestField), [manifest])
  const storageKey = testInputsStorageKey('control', manifest.tag, manifest.version)
  const state = useTestInputs(fields, { storageKey })
  const errors = useMemo(() => validateControlProps(manifest.props, state.values), [manifest, state.values])
  const props = useMemo(() => previewPropsOf(manifest.props, state.values), [manifest, state.values])
  const [value, setValue] = useState<unknown>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [required, setRequired] = useState(false)
  const [previewKey, setPreviewKey] = useState(0)
  // Property values apply live (no run step): remember them as they change.
  useEffect(() => { rememberTestInputs(storageKey, fields, state.values) }, [storageKey, fields, state.values])
  const field = useMemo<TaskFieldDef>(() => {
    const custom = { ...customConfigFromManifest(manifest), props }
    return { key: 'preview', label: manifest.name, type: 'custom', required, help_text: manifest.description || undefined, custom } as TaskFieldDef
  }, [manifest, props, required])

  return (
    <form
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      noValidate
      onSubmit={(e) => e.preventDefault()}
      data-testid="control-try"
    >
      <section className="min-w-0 space-y-2" aria-label="Properties">
        <h3 className="text-sm font-semibold text-fg">Properties</h3>
        <TestInputForm
          state={state}
          idBase={`try-${manifest.tag}`}
          errors={errors}
          emptyText="This control declares no properties: the preview uses it as it comes."
        />
        <p className="text-2xs text-fg-muted">Invalid values fall back to the property&apos;s default, as on a real form.</p>
      </section>
      <section className="min-w-0 space-y-3" aria-label="Live preview">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="flex-1 text-sm font-semibold text-fg">Live preview</h3>
          <Switch size="sm" label={<span className="text-xs">Required</span>} checked={required} onCheckedChange={setRequired} />
          <Switch size="sm" label={<span className="text-xs">Read-only</span>} checked={readOnly} onCheckedChange={setReadOnly} />
          <Button type="button" size="sm" variant="ghost" leadingIcon={<RotateCcw />} onClick={() => { setValue(null); setPreviewKey((k) => k + 1) }}>Restart</Button>
        </div>
        <div className="rounded-lg border border-border bg-panel p-3">
          <p className="mb-1.5 text-ui font-medium text-fg" id="try-preview-label">{manifest.name}{required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}</p>
          <FormLookupProvider source={{ kind: 'preview' }}>
            <CustomControlField
              key={previewKey}
              field={field}
              value={value}
              onChange={setValue}
              values={{}}
              id="try-preview"
              invalid={false}
              readOnly={readOnly}
            />
          </FormLookupProvider>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-fg">Value the form receives</p>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-subtle p-2 font-mono text-2xs" aria-live="polite" data-testid="control-try-value">{value === null || value === undefined ? 'null' : JSON.stringify(value, null, 2)}</pre>
        </div>
        <p className="text-2xs text-fg-muted">Lookups, uploads and reports need a real form: the preview gives the control no data access.</p>
      </section>
    </form>
  )
}
