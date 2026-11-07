import { BarChart3, ClipboardPen, Database, FileText, SquareCheck, Workflow, type LucideIcon } from 'lucide-react'
import type { Permission } from '@/lib/permissions'

/**
 * "Create" destinations shared by the top bar's "+ New" menu and the ⌘K
 * palette's Actions group. List pages open their create flow on `?new=1`
 * (the page owns the dialog; without support it simply lands on the list).
 */
export interface CreateAction {
  id: 'task' | 'workflow' | 'form' | 'form_wizard' | 'table' | 'report'
  /** Menu label ("Workflow"). */
  label: string
  /** Palette label ("Create workflow"). */
  paletteLabel: string
  keywords: string
  href: string
  icon: LucideIcon
  requires: Permission
}

export const CREATE_ACTIONS: readonly CreateAction[] = [
  { id: 'task', label: 'Task', paletteLabel: 'Create task', keywords: 'new task add todo', href: '/tasks/new', icon: SquareCheck, requires: 'tasks.create' },
  { id: 'workflow', label: 'Workflow', paletteLabel: 'Create workflow', keywords: 'new workflow automation process flow', href: '/automations?new=1', icon: Workflow, requires: 'workflows.create' },
  { id: 'form_wizard', label: 'Form with the wizard', paletteLabel: 'Build a form with the wizard', keywords: 'new form wizard survey questionnaire quiz registration feedback request approval', href: '/forms/wizard/new', icon: ClipboardPen, requires: 'forms.wizard' },
  { id: 'form', label: 'Form', paletteLabel: 'Create form', keywords: 'new form', href: '/automations/forms?new=1', icon: FileText, requires: 'forms.edit' },
  { id: 'table', label: 'Data table', paletteLabel: 'Create data table', keywords: 'new data table records', href: '/data?new=1', icon: Database, requires: 'data.create' },
  { id: 'report', label: 'Report', paletteLabel: 'Create report', keywords: 'new report chart dashboard builder', href: '/reports/builder', icon: BarChart3, requires: 'reports.create' },
]
