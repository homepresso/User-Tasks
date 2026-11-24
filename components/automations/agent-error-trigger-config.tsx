"use client"

/**
 * Designer settings for the Agent error trigger (agent_error). Config keys
 * and meaning: lib/agents/error-trigger.ts; dispatch, de-dupe and the loop
 * guard: lib/agents/error-trigger-dispatch.ts.
 */

import { useQuery } from "@tanstack/react-query"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { serverRead } from "@/lib/server-read"
import {
  AGENT_ERROR_DEFAULT_MAX, AGENT_ERROR_DEFAULT_WINDOW_MINUTES, AGENT_ERROR_KIND_INFO, AGENT_ERROR_KINDS, AGENT_ERROR_SOURCE_LABELS,
  AGENT_ERROR_SOURCES, validateAgentErrorConfig,
} from "@/lib/agents/error-trigger"

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

interface Props {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-fg">{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-snug text-fg-muted">{children}</p>
}

function Chips({ label, options, value, onChange }: { label: string; options: ReadonlyArray<{ value: string; label: string; title?: string }>; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <button key={o.value} type="button" aria-pressed={on} title={o.title} onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              on ? "border-primary bg-primary text-primary-fg" : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
            )}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

export function AgentErrorTriggerConfig({ config, onUpdate }: Props) {
  const sources = list(config.sources)
  const kinds = list(config.error_kinds)
  const agentIds = list(config.agent_ids)
  const profileIds = list(config.profile_ids)
  const showAgents = !sources.length || sources.some((s) => s !== "system_agent")
  const showProfiles = !sources.length || sources.includes("system_agent")
  const { data: agents = [] } = useQuery({
    queryKey: ["agents-for-config"],
    queryFn: async () => ((await serverRead("automations.agentOptions")).data ?? []) as { id: string; name: string; is_active: boolean }[],
    staleTime: 60_000,
  })
  const { data: profileOptions } = useQuery({
    queryKey: ["agent-profiles-for-config"],
    queryFn: async () => ((await serverRead("automations.agentProfileOptions")).data ?? { restricted: true, profiles: [] }) as { restricted: boolean; profiles: { id: string; name: string }[] },
    staleTime: 60_000,
    enabled: showProfiles,
  })
  const profiles = [
    ...(profileOptions?.profiles ?? []),
    // Saved ids this person can't list (only Agent admins can read the profiles) stay visible and removable.
    ...profileIds.filter((pid) => !(profileOptions?.profiles ?? []).some((p) => p.id === pid)).map((pid) => ({ id: pid, name: `Profile ${pid.slice(0, 8)}` })),
  ]
  const problems = validateAgentErrorConfig(config)

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()} data-agent-error-config>
      <Hint>Starts when an agent fails for good — after its automatic retries — never for a retry that succeeded or a run someone stopped.</Hint>

      <div className="space-y-1">
        <Label>Source</Label>
        <Chips label="Source" value={sources} onChange={(v) => onUpdate("sources", v.length ? v : undefined)}
          options={AGENT_ERROR_SOURCES.map((s) => ({ value: s, label: AGENT_ERROR_SOURCE_LABELS[s].label, title: AGENT_ERROR_SOURCE_LABELS[s].hint }))} />
        <Hint>None selected = every source.</Hint>
      </div>

      {showAgents && (
        <div className="space-y-1">
          <Label>Agents</Label>
          <Chips label="Agents" value={agentIds} onChange={(v) => onUpdate("agent_ids", v.length ? v : undefined)}
            options={agents.map((a) => ({ value: a.id, label: a.is_active === false ? `${a.name} (inactive)` : a.name }))} />
          {!agents.length && <Hint>No agents yet.</Hint>}
        </div>
      )}

      {showProfiles && (
        <div className="space-y-1">
          <Label>Agent profiles</Label>
          <Chips label="Agent profiles" value={profileIds} onChange={(v) => onUpdate("profile_ids", v.length ? v : undefined)}
            options={profiles.map((p) => ({ value: p.id, label: p.name }))} />
          {profileOptions?.restricted && <Hint>Only people who manage the Agent can list its other profiles.</Hint>}
        </div>
      )}
      {(showAgents || showProfiles) && <Hint>None selected = any. With both, a failure matches either.</Hint>}

      <div className="space-y-1">
        <Label>Error kinds</Label>
        <Chips label="Error kinds" value={kinds} onChange={(v) => onUpdate("error_kinds", v.length ? v : undefined)}
          options={AGENT_ERROR_KINDS.map((k) => ({ value: k, label: AGENT_ERROR_KIND_INFO[k].label, title: `Severity: ${AGENT_ERROR_KIND_INFO[k].severity}` }))} />
        <Hint>None selected = every kind.</Hint>
      </div>

      <div className="space-y-1">
        <Label htmlFor="agent-error-severity">Minimum severity</Label>
        <Select id="agent-error-severity" size="sm" className="text-xs" value={config.min_severity ?? ""} onChange={(e) => onUpdate("min_severity", e.target.value || undefined)}>
          <option value="">Any</option>
          <option value="warning">Warning (provider busy, slow or unreachable) and worse</option>
          <option value="error">Error (this request) and worse</option>
          <option value="critical">Critical only (key, credit, model or setup)</option>
        </Select>
      </div>

      <div className="space-y-1">
        <Label>Burst limit</Label>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg">
          <span className="whitespace-nowrap">At most</span>
          <Input type="number" min={1} max={50} size="sm" className="w-16 text-xs" aria-label="Runs per window" value={config.max_per_window ?? ""} placeholder={String(AGENT_ERROR_DEFAULT_MAX)}
            onChange={(e) => onUpdate("max_per_window", e.target.value === "" ? undefined : Number(e.target.value))} />
          <span className="whitespace-nowrap">runs per agent and kind every</span>
          <Input type="number" min={1} max={1440} size="sm" className="w-16 text-xs" aria-label="Window in minutes" value={config.window_minutes ?? ""} placeholder={String(AGENT_ERROR_DEFAULT_WINDOW_MINUTES)}
            onChange={(e) => onUpdate("window_minutes", e.target.value === "" ? undefined : Number(e.target.value))} />
          <span>min</span>
        </div>
        <Hint>Failures over the limit are skipped and counted in the next run&apos;s <code>{"{{agent_error_suppressed}}"}</code>.</Hint>
      </div>

      {problems.length > 0 && (
        <ul className="space-y-0.5 text-xs text-danger" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}

      <Hint>
        Variables: <code>{"{{agent_error_message}}"}</code>, <code>{"{{agent_error_kind}}"}</code>, <code>{"{{agent_error_severity}}"}</code>, <code>{"{{agent_error_summary}}"}</code>,{" "}
        <code>{"{{agent_error_agent_name}}"}</code>, <code>{"{{agent_error_workflow_name}}"}</code>, <code>{"{{agent_error_step}}"}</code> and the rest under <code>{"{{agent_error.*}}"}</code>.
        Runs this trigger starts never report their own agents&apos; failures. <a href="/docs/ai-assistants" className="text-primary-text underline">Docs</a>
      </Hint>
    </div>
  )
}
