import { CreateTaskForm } from '@/components/tasks/create-task-form'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'

export default function NewTaskPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumbs={[{ label: 'My tasks', href: '/tasks' }, { label: 'New task' }]}
        title="Create task"
      />
      <Card padding="lg">
        <CreateTaskForm />
      </Card>
    </div>
  )
}
