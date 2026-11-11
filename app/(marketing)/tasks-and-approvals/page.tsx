import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { TasksPage } from '@/components/marketing/tasks-page'
import { TASKS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = pageMetadata({
  path: '/tasks-and-approvals',
  title: TASKS_PAGE.metaTitle,
  description: TASKS_PAGE.description,
  socialTitle: TASKS_PAGE.title,
  keywords: ['task management', 'approval workflow', 'task list', 'team queue', 'SLA escalation', 'approve on behalf', 'approval audit trail', 'open source task management'],
})

export default function Page() {
  return <TasksPage />
}
