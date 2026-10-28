"use client"

import { useState } from "react"
import { updateUserPreferences } from "@/app/actions/profile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useRouter } from "next/navigation"

interface PreferencesFormProps {
  userId: string
  preferences: {
    default_priority?: string
    queue_bypass_priority?: string
    notifications_enabled?: boolean
    available_hours_week?: number
    hours_per_day?: Record<string, number>
  }
}

const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
]

export function PreferencesForm({
  preferences,
}: PreferencesFormProps) {
  const [defaultPriority, setDefaultPriority] = useState(
    preferences.default_priority ?? "medium"
  )
  const [queueBypass, setQueueBypass] = useState(
    preferences.queue_bypass_priority ?? "high"
  )
  const [weeklyHours, setWeeklyHours] = useState(
    String(preferences.available_hours_week ?? 40)
  )
  const [hoursPerDay, setHoursPerDay] = useState<Record<string, string>>(() => {
    const defaults = preferences.hours_per_day ?? {}
    const result: Record<string, string> = {}
    for (const day of DAYS) {
      result[day.key] = String(defaults[day.key] ?? (day.key === "sat" || day.key === "sun" ? 0 : 8))
    }
    return result
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const computedWeekly = DAYS.reduce((sum, d) => sum + (parseFloat(hoursPerDay[d.key]) || 0), 0)

  function syncFromDaily() {
    setWeeklyHours(String(computedWeekly))
  }

  function distributeEvenly() {
    const total = parseFloat(weeklyHours) || 40
    const perDay = Math.round((total / 5) * 10) / 10
    const updated: Record<string, string> = {}
    for (const day of DAYS) {
      updated[day.key] = day.key === "sat" || day.key === "sun" ? "0" : String(perDay)
    }
    setHoursPerDay(updated)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)

    const parsedHoursPerDay: Record<string, number> = {}
    for (const day of DAYS) {
      parsedHoursPerDay[day.key] = parseFloat(hoursPerDay[day.key]) || 0
    }

    setError(null)
    // Merged into the signed-in user's own preferences server-side.
    const result = await updateUserPreferences({
      default_priority: defaultPriority,
      queue_bypass_priority: queueBypass,
      available_hours_week: parseFloat(weeklyHours) || 40,
      hours_per_day: parsedHoursPerDay,
    })

    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setSaved(true)
    router.refresh()
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Default priority */}
      <div>
        <label className="block text-sm font-medium mb-1"
          style={{ color: "var(--theme-card-text)" }}>
          Default priority for new tasks
        </label>
        <select
          value={defaultPriority}
          onChange={(e) => setDefaultPriority(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--theme-surface-border)",
            backgroundColor: "var(--theme-card-bg)",
            color: "var(--theme-card-text)",
          }}
        >
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="none">None</option>
        </select>
      </div>

      {/* Queue bypass threshold */}
      <div>
        <label className="block text-sm font-medium mb-1"
          style={{ color: "var(--theme-card-text)" }}>
          Priority level to skip the Task Queue
        </label>
        <p className="text-xs mb-2" style={{ color: "var(--theme-muted-text)" }}>
          Tasks at this priority level or higher will bypass the Task Queue and go directly to My Tasks.
        </p>
        <select
          value={preferences.queue_bypass_priority ?? 'high'}
          onChange={(e) => setQueueBypass(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--theme-surface-border)",
            backgroundColor: "var(--theme-card-bg)",
            color: "var(--theme-card-text)",
          }}
        >
          <option value="critical">Critical only</option>
          <option value="high">High and above</option>
          <option value="medium">Medium and above</option>
          <option value="low">Low and above (all tasks skip queue)</option>
          <option value="none">None (all tasks go to queue)</option>
        </select>
      </div>

      {/* Weekly available hours */}
      <div style={{ borderTop: "1px solid var(--theme-surface-border)", paddingTop: "1.5rem" }}>
        <h3 className="text-sm font-semibold mb-1"
          style={{ color: "var(--theme-card-text)" }}>
          Availability
        </h3>
        <p className="text-xs mb-4" style={{ color: "var(--theme-muted-text)" }}>
          Set your weekly available hours so managers can plan assignments.
        </p>

        <div className="flex items-end gap-3 mb-4">
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1"
              style={{ color: "var(--theme-muted-text)" }}>
              Weekly hours
            </label>
            <Input
              type="number"
              min="0"
              max="168"
              step="0.5"
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(e.target.value)}
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={distributeEvenly}>
            Distribute evenly
          </Button>
        </div>

        {/* Daily hours */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium"
              style={{ color: "var(--theme-muted-text)" }}>
              Hours per day (for heatmap)
            </label>
            <button
              type="button"
              onClick={syncFromDaily}
              className="text-[10px] font-medium hover:underline"
              style={{ color: "var(--theme-primary-text)" }}
            >
              Sync weekly total ({computedWeekly}h)
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {DAYS.map((day) => (
              <div key={day.key}>
                <label className="block text-[10px] text-center mb-1 font-medium"
                  style={{ color: "var(--theme-muted-text)" }}>
                  {day.label.slice(0, 3)}
                </label>
                <Input
                  type="number"
                  min="0"
                  max="24"
                  step="0.5"
                  value={hoursPerDay[day.key]}
                  onChange={(e) =>
                    setHoursPerDay((prev) => ({ ...prev, [day.key]: e.target.value }))
                  }
                  className="text-center !px-1"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Preferences"}
        </Button>
        {saved && (
          <span className="text-sm" style={{ color: "var(--theme-success)" }}>Saved!</span>
        )}
        {error && (
          <span className="text-sm" style={{ color: "var(--theme-danger)" }}>{error}</span>
        )}
      </div>
    </form>
  )
}
