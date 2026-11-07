"use client"

import { useMemo, useState } from "react"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SettingsSaveBar, SettingsSection, SettingsSections } from "./settings-section"
import { useRouter } from "next/navigation"
import { updateUserProfile } from "@/app/actions/profile"

interface ProfileFormProps {
  profile: {
    id: string
    display_name: string
    email: string
    avatar_url: string | null
    timezone: string | null
    description?: string | null
    skills?: string[] | null
  }
}

function getTimezoneOptions() {
  const fallback = [
    "Africa/Cairo",
    "Africa/Johannesburg",
    "America/Anchorage",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/New_York",
    "America/Phoenix",
    "America/Sao_Paulo",
    "Asia/Bangkok",
    "Asia/Dubai",
    "Asia/Hong_Kong",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Europe/Amsterdam",
    "Europe/Berlin",
    "Europe/London",
    "Europe/Paris",
    "Pacific/Auckland",
    "Pacific/Honolulu",
    "UTC",
  ]

  const supported = typeof Intl !== "undefined" && "supportedValuesOf" in Intl
    ? ((Intl as any).supportedValuesOf("timeZone") as string[])
    : fallback

  return [...new Set(supported)].sort((a: string, b: string) => a.localeCompare(b))
}

function formatTimezoneLabel(timezone: string) {
  return timezone.replaceAll("_", " ")
}

export function ProfileForm({ profile }: ProfileFormProps) {
  const initial = useMemo(() => ({
    displayName: profile.display_name,
    timezone: profile.timezone ?? "America/Denver",
    description: profile.description ?? "",
    skillsText: (profile.skills ?? []).join(", "),
  }), [profile])
  const [saved, setSaved] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const timezoneOptions = useMemo(() => getTimezoneOptions(), [])
  const dirty = (Object.keys(draft) as Array<keyof typeof draft>).some((k) => draft[k] !== saved[k])
  const update = (patch: Partial<typeof draft>) => { setDraft((d) => ({ ...d, ...patch })); setError(null) }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const skills = draft.skillsText
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean)

    const { error: saveError } = await updateUserProfile({
      display_name: draft.displayName,
      timezone: draft.timezone,
      description: draft.description.trim() || null,
      skills,
    })

    setSaving(false)

    if (saveError) {
      setError(saveError)
      return
    }

    setSaved(draft)
    router.refresh()
  }

  return (
    <form onSubmit={handleSave}>
      <SettingsSections>
        <SettingsSection title="Name and email" description="Your name appears on tasks, comments and the audit log.">
          <div className="space-y-4">
            <Field label="Display name">
              <Input value={draft.displayName} onChange={(e) => update({ displayName: e.target.value })} required />
            </Field>
            <Field label="Email" description="Your sign-in address. Ask an administrator to change it.">
              <Input value={profile.email} disabled />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="About you" description="Helps people and assignment rules find the right person.">
          <div className="space-y-4">
            <Field label="Description" optional>
              <Textarea
                value={draft.description}
                onChange={(e) => update({ description: e.target.value })}
                rows={4}
                placeholder="Tell people a little about yourself, your role, or how you work best."
              />
            </Field>
            <Field label="Skills" optional description="Separate skills with commas.">
              <Input
                value={draft.skillsText}
                onChange={(e) => update({ skillsText: e.target.value })}
                placeholder="e.g. Workflow design, SQL, Customer support, Python"
              />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="Timezone" description="Due dates, SLAs and your working hours use this timezone.">
          <Field label="Timezone">
            <Select value={draft.timezone} onChange={(e) => update({ timezone: e.target.value })}>
              {timezoneOptions.map((tz) => (
                <option key={tz} value={tz}>
                  {formatTimezoneLabel(tz)}
                </option>
              ))}
            </Select>
          </Field>
        </SettingsSection>
      </SettingsSections>

      <SettingsSaveBar dirty={dirty} saving={saving} error={error} onDiscard={() => { setDraft(saved); setError(null) }} />
    </form>
  )
}
