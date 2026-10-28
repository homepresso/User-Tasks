import { FormsLibrary } from '@/components/forms/forms-library'

export default function FormsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--theme-card-text)' }}>Forms</h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
          Reusable task forms and form themes for User Tasks and task triggers.
        </p>
      </div>
      <FormsLibrary />
    </div>
  )
}
