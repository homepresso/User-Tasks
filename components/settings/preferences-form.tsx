"use client"

import { useState } from "react"
import { updateUserPreferences } from "@/app/actions/profile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { Select } from "@/components/ui/select"
import { SettingsSaveBar, SettingsSection, SettingsSections } from "./settings-section"
import { QueueRulesEditor } from "./queue-rules-editor"
import { FollowPreferenceSwitch } from "@/components/tasks/follow-preferences"
import { resolveQueueRules, type QueueRules } from "@/lib/tasks/queue-rules"
import { useRouter } from "next/navigation"

interface PreferencesFormProps {
  userId: string
  preferences: {
    default_priority?: string
    queue_bypass_priority?: string
    queue_rules?: QueueRules
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

function initialState(preferences: PreferencesFormProps["preferences"]) {
  const defaults = preferences.hours_per_day ?? {}
  const hoursPerDay: Record<string, string> = {}
  for (const day of DAYS) {
    hoursPerDay[day.key] = String(defaults[day.key] ?? (day.key === "sat" || day.key === "sun" ? 0 : 8))
  }
  return {
    defaultPriority: preferences.default_priority ?? "medium",
    // Stored rules, else the legacy threshold as rules (lib/tasks/queue-rules).
    queueRules: resolveQueueRules(preferences),
    weeklyHours: String(preferences.available_hours_week ?? 40),
    hoursPerDay,
  }
}

type PrefState = ReturnType<typeof initialState>

function sameState(a: PrefState, b: PrefState) {
  return a.defaultPriority === b.defaultPriority && JSON.stringify(a.queueRules) === JSON.stringify(b.queueRules) && a.weeklyHours === b.weeklyHours
    && DAYS.every((d) => a.hoursPerDay[d.key] === b.hoursPerDay[d.key])
}

export function PreferencesForm({
  preferences,
}: PreferencesFormProps) {
  const [saved, setSaved] = useState(() => initialState(preferences))
  const [draft, setDraft] = useState(saved)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const dirty = !sameState(draft, saved)
  const update = (patch: Partial<PrefState>) => { setDraft((d) => ({ ...d, ...patch })); setError(null) }

  const computedWeekly = DAYS.reduce((sum, d) => sum + (parseFloat(draft.hoursPerDay[d.key]) || 0), 0)

  function distributeEvenly() {
    const total = parseFloat(draft.weeklyHours) || 40
    const perDay = Math.round((total / 5) * 10) / 10
    const updated: Record<string, string> = {}
    for (const day of DAYS) {
      updated[day.key] = day.key === "sat" || day.key === "sun" ? "0" : String(perDay)
    }
    update({ hoursPerDay: updated })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const parsedHoursPerDay: Record<string, number> = {}
    for (const day of DAYS) {
      parsedHoursPerDay[day.key] = parseFloat(draft.hoursPerDay[day.key]) || 0
    }

    // Merged into the signed-in user's own preferences server-side.
    const result = await updateUserPreferences({
      default_priority: draft.defaultPriority,
      queue_rules: draft.queueRules,
      available_hours_week: parseFloat(draft.weeklyHours) || 40,
      hours_per_day: parsedHoursPerDay,
    })

    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setSaved(draft)
    router.refresh()
  }

  return (
    <form onSubmit={handleSave}>
      <SettingsSections>
        <SettingsSection title="Task defaults" description="Applied to tasks you create.">
          <div className="space-y-4">
            <Field label="Default priority for new tasks">
              <Select value={draft.defaultPriority} onChange={(e) => update({ defaultPriority: e.target.value })}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="none">None</option>
              </Select>
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="Task queue rules" description="Decide which tasks wait for you to accept them (they show as Queued in My tasks) and which go straight onto your list. A workflow step can override these.">
          <QueueRulesEditor value={draft.queueRules} onChange={(queueRules) => update({ queueRules })} />
        </SettingsSection>

        <SettingsSection title="Following" description="Followed processes show on Home → Following, and their open tasks in Task tracker → Following. Saved as soon as you switch.">
          <div className="flex flex-col gap-3" data-follow-preferences>
            <FollowPreferenceSwitch name="auto_follow_runs" size="md" label={<span className="text-ui text-fg">Follow processes I start <span className="block text-xs text-fg-muted">Including the ones my form submissions start.</span></span>} />
            <FollowPreferenceSwitch name="auto_follow_acted_runs" size="md" label={<span className="text-ui text-fg">Follow processes I act on <span className="block text-xs text-fg-muted">When I complete or respond to a workflow task (on someone’s behalf too), I follow its process to see what happens next.</span></span>} />
          </div>
        </SettingsSection>

        <SettingsSection title="Availability" description="Your weekly hours, so managers can plan assignments. The heatmap uses the hours per day.">
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <Field label="Weekly hours" className="flex-1">
                <Input
                  type="number"
                  min="0"
                  max="168"
                  step="0.5"
                  className="num"
                  value={draft.weeklyHours}
                  onChange={(e) => update({ weeklyHours: e.target.value })}
                />
              </Field>
              <Button type="button" variant="secondary" onClick={distributeEvenly}>
                Distribute evenly
              </Button>
            </div>

            <div role="group" aria-labelledby="pref-hours-per-day">
              <div className="mb-1.5 flex items-center justify-between">
                <span id="pref-hours-per-day" className="text-ui font-medium text-fg">Hours per day</span>
                <Button type="button" variant="link" size="sm" onClick={() => update({ weeklyHours: String(computedWeekly) })}>
                  Use as weekly total ({computedWeekly} h)
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {DAYS.map((day) => (
                  <label key={day.key} className="block">
                    <span className="mb-1 block text-center text-xs text-fg-muted">{day.label.slice(0, 3)}</span>
                    <Input
                      type="number"
                      min="0"
                      max="24"
                      step="0.5"
                      aria-label={`${day.label} hours`}
                      value={draft.hoursPerDay[day.key]}
                      onChange={(e) => update({ hoursPerDay: { ...draft.hoursPerDay, [day.key]: e.target.value } })}
                      className="num px-1 text-center"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </SettingsSection>
      </SettingsSections>

      <SettingsSaveBar dirty={dirty} saving={saving} error={error} onDiscard={() => { setDraft(saved); setError(null) }} />
    </form>
  )
}
