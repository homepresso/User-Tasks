"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  const [displayName, setDisplayName] = useState(profile.display_name)
  const [timezone, setTimezone] = useState(profile.timezone ?? "America/Denver")
  const [description, setDescription] = useState(profile.description ?? "")
  const [skillsText, setSkillsText] = useState((profile.skills ?? []).join(", "))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const timezoneOptions = useMemo(() => getTimezoneOptions(), [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError(null)

    const skills = skillsText
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean)

    const { error: saveError } = await updateUserProfile({
      display_name: displayName,
      timezone,
      description: description.trim() || null,
      skills,
    })

    setSaving(false)

    if (saveError) {
      setError(saveError)
      return
    }

    setSaved(true)
    router.refresh()
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Display name
        </label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Email
        </label>
        <Input value={profile.email} disabled className="opacity-60" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Tell people a little about yourself, your role, or how you work best."
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Skills
        </label>
        <Input
          value={skillsText}
          onChange={(e) => setSkillsText(e.target.value)}
          placeholder="e.g. Workflow design, SQL, Customer support, Python"
        />
        <p className="mt-1 text-xs" style={{ color: "var(--theme-muted-text)" }}>
          Separate skills with commas.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Timezone
        </label>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
            dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        >
          {timezoneOptions.map((tz) => (
            <option key={tz} value={tz}>
              {formatTimezoneLabel(tz)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
        {saved && (
          <span className="text-sm text-green-600">Saved!</span>
        )}
        {error && (
          <span className="text-sm text-red-600">{error}</span>
        )}
      </div>
    </form>
  )
}
