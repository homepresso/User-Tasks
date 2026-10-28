import { EmailTemplateManager } from '@/components/email-templates/email-template-manager'

export default function EmailTemplatesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--theme-card-text)' }}>Email Templates</h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
          Reusable subjects and bodies for the Send Email workflow node.
        </p>
      </div>
      <EmailTemplateManager />
    </div>
  )
}
