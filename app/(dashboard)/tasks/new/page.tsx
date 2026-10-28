import { CreateTaskForm } from '@/components/tasks/create-task-form'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function NewTaskPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/tasks"
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          Create Task
        </h1>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <CreateTaskForm />
      </div>
    </div>
  )
}
