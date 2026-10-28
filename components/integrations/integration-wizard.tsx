'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Check, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { deleteIntegration } from '@/app/actions/integrations'
import { WizardStep1Config } from './wizard-step1-config'
import { WizardStep2Browse } from './wizard-step2-browse'
import { WizardStep3References } from './wizard-step3-references'
import { ReferenceList } from './reference-list'
import { DbQueryRunner } from './db-query-runner'

interface IntegrationWizardProps {
  integration: any
  references: any[]
}

const DB_STEPS = [
  { id: 1, title: 'Configure', description: 'Connection & test' },
  { id: 2, title: 'Browse', description: 'Select items' },
  { id: 3, title: 'References', description: 'Create & manage' },
]
const API_STEPS = [
  { id: 1, title: 'Configure', description: 'Connection & auth' },
  { id: 3, title: 'References', description: 'Create & manage' },
]

export function IntegrationWizard({ integration, references }: IntegrationWizardProps) {
  const isDatabase = integration.type === 'database'
  const steps = isDatabase ? DB_STEPS : API_STEPS
  // If references already exist, start on references step
  const [currentStep, setCurrentStep] = useState(references.length > 0 ? 3 : 1)
  const [connectionTested, setConnectionTested] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()
  const [selectedItems, setSelectedItems] = useState<any[]>([])

  // Determine which steps are complete
  const config = integration.config as any
  const hasConnection = integration.type === 'database'
    ? !!(config?.db_config?.host && config?.db_config?.database)
    : !!config?.base_url
  const hasSelectedItems = selectedItems.length > 0

  return (
    <div className="space-y-6">
      {/* Danger zone: delete the integration + every reference under it */}
      <div className="flex justify-end">
        <button onClick={() => setDeleteOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50"
          title="Delete this integration and all its references">
          <Trash2 size={13} /> Delete integration
        </button>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Integration"
        description={`This permanently removes "${integration.name}" and ALL of its API references (${references.length}). Workflows or forms still calling those references will fail until re-pointed.`}
        confirmLabel="Delete integration"
        destructive
        busy={deleting}
        onConfirm={async () => {
          setDeleting(true)
          try {
            await deleteIntegration(integration.id)
            router.push('/integrations')
          } finally {
            setDeleting(false)
          }
        }}
      />
      {/* Step indicator */}
      <div className="flex items-center justify-between">
        {steps.map((step, i) => {
          const isActive = currentStep === step.id
          const isComplete = step.id < currentStep || (step.id === 1 && connectionTested)
          return (
            <div key={step.id} className="flex items-center flex-1">
              <button
                onClick={() => setCurrentStep(step.id)}
                className="flex items-center gap-3"
              >
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all',
                    isActive && 'ring-2 ring-offset-2',
                  )}
                  style={{
                    backgroundColor: isComplete ? 'var(--theme-primary)' : isActive ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                    color: isComplete ? 'var(--theme-on-primary)' : isActive ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                    // @ts-ignore
                    '--tw-ring-color': 'var(--theme-primary)',
                  }}
                >
                  {isComplete ? <Check size={16} /> : i + 1}
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{step.description}</p>
                </div>
              </button>
              {i < steps.length - 1 && (
                <div className="flex-1 h-px mx-4" style={{ backgroundColor: isComplete ? 'var(--theme-primary)' : 'var(--theme-surface-border)' }} />
              )}
            </div>
          )
        })}
      </div>

      {/* Step content */}
      {currentStep === 1 && (
        <WizardStep1Config
          integration={integration}
          onTestSuccess={() => setConnectionTested(true)}
          onNext={() => setCurrentStep(isDatabase ? 2 : 3)}
        />
      )}
      {currentStep === 2 && isDatabase && (
        <WizardStep2Browse
          integration={integration}
          selectedItems={selectedItems}
          onSelectionChange={setSelectedItems}
          onBack={() => setCurrentStep(1)}
          onNext={() => setCurrentStep(3)}
        />
      )}
      {currentStep === 3 && (
        <>
          <WizardStep3References
            integration={integration}
            selectedItems={selectedItems}
            existingReferences={references}
            onBack={() => setCurrentStep(isDatabase ? 2 : 1)}
          />

          {/* Existing references (edit/manage) */}
          {references.length > 0 && (
            <Card>
              <h3 className="text-sm font-semibold mb-4">Manage References</h3>
              <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
                Edit inputs, outputs, and request config for existing references.
              </p>
              <ReferenceList
                integrationId={integration.id}
                integrationBaseUrl={(integration.config as any)?.base_url ?? ''}
                references={references}
              />
            </Card>
          )}

          {/* Query Runner for databases */}
          {integration.type === 'database' && (
            <Card>
              <h3 className="text-sm font-semibold mb-4">Query Runner</h3>
              <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
                Browse tables, run SQL queries, and explore your database.
              </p>
              <DbQueryRunner integrationId={integration.id} />
            </Card>
          )}
        </>
      )}
    </div>
  )
}
