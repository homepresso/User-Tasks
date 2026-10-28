'use client'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DbConnectionForm } from './db-connection-form'
import { IntegrationConfig } from './integration-config'
import { ArrowRight } from 'lucide-react'

interface WizardStep1Props {
  integration: any
  onTestSuccess: () => void
  onNext: () => void
}

export function WizardStep1Config({ integration, onTestSuccess, onNext }: WizardStep1Props) {
  return (
    <div className="space-y-4">
      {integration.type === 'database' ? (
        <Card>
          <DbConnectionForm integration={integration} />
        </Card>
      ) : (
        <IntegrationConfig integration={integration} />
      )}

      <div className="flex justify-end">
        <Button onClick={onNext}>
          Next: Browse Objects <ArrowRight size={14} className="ml-1" />
        </Button>
      </div>
    </div>
  )
}
