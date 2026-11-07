import { EmailTemplateManager } from '@/components/email-templates/email-template-manager'

// The manager renders the PageHeader: its primary action ("New email template") owns editor state.
export default function EmailTemplatesPage() {
  return <EmailTemplateManager />
}
