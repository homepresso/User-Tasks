"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Radio } from "@/components/ui/checkbox"
import { IconButton } from "@/components/ui/icon-button"
import { Input, SearchInput } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { serverQuery } from "@/lib/server-read"
import {
  DEFAULT_WORKING_HOURS,
  MAX_QUEUE_RULES,
  MAX_RULE_CONDITIONS,
  QUEUE_ASSIGNMENTS,
  QUEUE_ASSIGNMENT_LABELS,
  QUEUE_DAY_LABELS,
  QUEUE_FIELD_GROUPS,
  QUEUE_FIELD_LABELS,
  QUEUE_FIELD_SPECS,
  QUEUE_OP_LABELS,
  QUEUE_ORIGINS,
  QUEUE_ORIGIN_LABELS,
  QUEUE_PRIORITIES,
  QUEUE_PRIORITY_LABELS,
  QUEUE_RELATIONS,
  QUEUE_RELATION_LABELS,
  defaultConditionValue,
  newRuleId,
  type QueueCondition,
  type QueueDecision,
  type QueueField,
  type QueueOp,
  type QueueRule,
  type QueueRules,
} from "@/lib/tasks/queue-rules"
import { cn } from "@/lib/utils"

/**
 * The person's own task queue rules (Settings → Preferences, and the Queue
 * rules dialog on the task lists): what happens to a task assigned to them —
 * Queued (they accept or decline it in My tasks) or added straight to their
 * list. Rules run in order; the first enabled rule that matches wins.
 * Each rule: a name, on / off, match all or any of its conditions, then
 * Queue or Add. Fields and operators: lib/tasks/queue-rules.ts.
 */

export type QueueRuleOption = { id: string; label: string }
export interface QueueRuleOptions {
  workflows: QueueRuleOption[]
  forms: QueueRuleOption[]
  people: QueueRuleOption[]
  teams: QueueRuleOption[]
  units: QueueRuleOption[]
  projects: QueueRuleOption[]
}

const EMPTY_OPTIONS: QueueRuleOptions = { workflows: [], forms: [], people: [], teams: [], units: [], projects: [] }

/** Picker lists (one read; a list the person can't read stays empty). */
export function useQueueRuleOptions(): QueueRuleOptions {
  const { data } = useQuery({
    queryKey: ["tasks", "queue-rule-options"],
    queryFn: async () => (await serverQuery("tasks.queueRuleOptions")) as QueueRuleOptions,
    staleTime: 5 * 60_000,
  })
  return data ?? EMPTY_OPTIONS
}

const THEN_OPTIONS = [
  { value: "queue", label: "Queue it for me to accept" },
  { value: "add", label: "Add it straight to my tasks" },
]

/** The id list a field picks from. */
function idsFor(field: QueueField, options: QueueRuleOptions): { list: QueueRuleOption[]; noun: string } {
  switch (field) {
    case "workflow": return { list: options.workflows, noun: "workflow" }
    case "form": return { list: options.forms, noun: "form" }
    case "assigned_by": return { list: options.people, noun: "person" }
    case "assigned_by_team": case "assigned_team": return { list: options.teams, noun: "team" }
    case "assigned_by_org_unit": return { list: options.units, noun: "org unit" }
    case "assigned_by_project": return { list: options.projects, noun: "project" }
    default: return { list: [], noun: "item" }
  }
}

function enumFor(field: QueueField): QueueRuleOption[] {
  switch (field) {
    case "priority": return QUEUE_PRIORITIES.map((p) => ({ id: p, label: QUEUE_PRIORITY_LABELS[p] }))
    case "source": return QUEUE_ORIGINS.map((o) => ({ id: o, label: QUEUE_ORIGIN_LABELS[o] }))
    case "assignment": return QUEUE_ASSIGNMENTS.map((a) => ({ id: a, label: QUEUE_ASSIGNMENT_LABELS[a] }))
    case "assigned_by_relation": return QUEUE_RELATIONS.map((r) => ({ id: r, label: QUEUE_RELATION_LABELS[r] }))
    case "day_of_week": return QUEUE_DAY_LABELS.map((d, i) => ({ id: String(i), label: d }))
    default: return []
  }
}

const asList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : value === undefined || value === null || value === "" ? [] : [String(value)])

/** A checkbox list (with a filter past 8 options) for "is any of" style values; keeps saved ids that aren't listed. */
function MultiPick({ options, values, onChange, label, missingLabel }: { options: QueueRuleOption[]; values: string[]; onChange: (v: string[]) => void; label: string; missingLabel: string }) {
  const [filter, setFilter] = useState("")
  const all = [...options, ...values.filter((v) => !options.some((o) => o.id === v)).map((id) => ({ id, label: missingLabel }))]
  const shown = all.filter((o) => !filter.trim() || o.label.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 200)
  return (
    <div className="space-y-1.5" role="group" aria-label={label}>
      {all.length > 8 && <SearchInput size="sm" value={filter} onValueChange={setFilter} placeholder="Filter" aria-label={`Filter ${label}`} />}
      <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-border-subtle p-2">
        {shown.length === 0 && <p className="text-xs text-fg-muted">Nothing to choose from.</p>}
        {shown.map((o) => (
          <Checkbox key={o.id} label={o.label} checked={values.includes(o.id)}
            onChange={(e) => onChange(e.target.checked ? [...values, o.id] : values.filter((v) => v !== o.id))} />
        ))}
      </div>
    </div>
  )
}

function ConditionValue({ cond, onChange, options, label }: { cond: QueueCondition; onChange: (value: unknown) => void; options: QueueRuleOptions; label: string }) {
  const kind = QUEUE_FIELD_SPECS[cond.field].ops[cond.op]
  const single = cond.op === "is" || cond.op === "is_not"
  switch (kind) {
    case undefined:
    case "none":
      return null
    case "priority":
      return <Select size="sm" aria-label={label} value={String(cond.value ?? "high")} onChange={(e) => onChange(e.target.value)}
        options={QUEUE_PRIORITIES.map((p) => ({ value: p, label: QUEUE_PRIORITY_LABELS[p] }))} />
    case "priorities": case "origins": case "assignments": case "relations": case "days": {
      const opts = enumFor(cond.field)
      if (single && kind !== "days") {
        return <Select size="sm" aria-label={label} value={asList(cond.value)[0] ?? ""} onChange={(e) => onChange(e.target.value)}
          options={opts.map((o) => ({ value: o.id, label: o.label }))} />
      }
      const values = asList(cond.value)
      return <MultiPick label={label} options={opts} values={values} missingLabel="Unknown"
        onChange={(v) => onChange(kind === "days" ? v.map(Number) : v)} />
    }
    case "ids": {
      const { list, noun } = idsFor(cond.field, options)
      const values = asList(cond.value)
      if (single) {
        const current = values[0] ?? ""
        const opts = [{ value: "", label: `Choose a ${noun}` }, ...list.map((o) => ({ value: o.id, label: o.label }))]
        if (current && !list.some((o) => o.id === current)) opts.push({ value: current, label: `A ${noun} you can't see` })
        return <Select size="sm" aria-label={label} value={current} onChange={(e) => onChange(e.target.value || undefined)} options={opts} />
      }
      return <MultiPick label={label} options={list} values={values} onChange={onChange} missingLabel={`A ${noun} you can't see`} />
    }
    case "duration": {
      const d = (cond.value ?? { amount: 1, unit: "days" }) as { amount: number; unit: string }
      return (
        <span className="flex items-center gap-1.5">
          <Input type="number" size="sm" min={1} aria-label={`${label} amount`} className="w-20" value={String(d.amount ?? "")}
            onChange={(e) => onChange({ ...d, amount: Number(e.target.value) })} />
          <Select size="sm" wrapperClassName="w-28" aria-label={`${label} unit`} value={d.unit} onChange={(e) => onChange({ ...d, unit: e.target.value })}
            options={[{ value: "minutes", label: "minutes" }, { value: "hours", label: "hours" }, { value: "days", label: "days" }]} />
          <span className="text-xs text-fg-muted">from when it arrives</span>
        </span>
      )
    }
    case "keywords": case "tags":
      return <Input size="sm" aria-label={label} placeholder={kind === "tags" ? "urgent, finance" : "invoice, refund"}
        value={asList(cond.value).join(", ")}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
    case "pattern":
      return <Input size="sm" aria-label={label} placeholder="^PO-\d+" value={String(cond.value ?? "")} onChange={(e) => onChange(e.target.value)} />
    case "boolean":
      return <Select size="sm" aria-label={label} value={cond.value === false ? "false" : "true"} onChange={(e) => onChange(e.target.value === "true")}
        options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} />
  }
}

function ConditionRow({ cond, index, ruleLabel, onChange, onRemove, options }: {
  cond: QueueCondition; index: number; ruleLabel: string; onChange: (c: QueueCondition) => void; onRemove: () => void; options: QueueRuleOptions
}) {
  const ops = Object.keys(QUEUE_FIELD_SPECS[cond.field].ops) as QueueOp[]
  const label = `${ruleLabel} condition ${index + 1}`
  return (
    <div className="grid gap-1.5 rounded-md border border-border-subtle bg-subtle p-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-start" data-queue-condition={cond.field}>
      <Select size="sm" aria-label={`${label} field`} value={cond.field} onChange={(e) => {
        const field = e.target.value as QueueField
        const op = Object.keys(QUEUE_FIELD_SPECS[field].ops)[0] as QueueOp
        onChange({ field, op, value: defaultConditionValue(field, op) })
      }}>
        {QUEUE_FIELD_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.fields.map((f) => <option key={f} value={f}>{QUEUE_FIELD_LABELS[f]}</option>)}
          </optgroup>
        ))}
      </Select>
      <Select size="sm" aria-label={`${label} operator`} value={cond.op} onChange={(e) => {
        const op = e.target.value as QueueOp
        const sameKind = QUEUE_FIELD_SPECS[cond.field].ops[op] === QUEUE_FIELD_SPECS[cond.field].ops[cond.op]
        const value = sameKind ? cond.value : (op === "is" || op === "is_not") && Array.isArray(cond.value) ? cond.value[0] : (op === "in" || op === "not_in") && cond.value !== undefined && !Array.isArray(cond.value) ? [cond.value] : defaultConditionValue(cond.field, op)
        onChange({ ...cond, op, value })
      }} options={ops.map((o) => ({ value: o, label: QUEUE_OP_LABELS[o] }))} />
      <div className="min-w-0"><ConditionValue cond={cond} options={options} label={`${label} value`} onChange={(value) => onChange({ ...cond, value })} /></div>
      <IconButton size="sm" label={`Remove ${label}`} icon={<X />} onClick={onRemove} />
    </div>
  )
}

export function QueueRulesEditor({ value, onChange, options: given }: { value: QueueRules; onChange: (next: QueueRules) => void; options?: QueueRuleOptions }) {
  const loaded = useQueueRuleOptions()
  const options = given ?? loaded
  const usesTime = useMemo(() => value.rules.some((r) => r.conditions.some((c) => c.field === "working_hours" || c.field === "day_of_week")), [value.rules])
  const hours = value.working_hours ?? DEFAULT_WORKING_HOURS

  const setDefault = (d: QueueDecision) => onChange({ ...value, default: d })
  const setRule = (index: number, rule: QueueRule) => onChange({ ...value, rules: value.rules.map((r, i) => (i === index ? rule : r)) })
  const move = (index: number, delta: number) => {
    const next = [...value.rules]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange({ ...value, rules: next })
  }
  const remove = (index: number) => onChange({ ...value, rules: value.rules.filter((_, i) => i !== index) })
  const duplicate = (index: number) => {
    const copy: QueueRule = { ...structuredClone(value.rules[index]), id: newRuleId(value.rules), name: value.rules[index].name ? `${value.rules[index].name} (copy)` : undefined }
    onChange({ ...value, rules: [...value.rules.slice(0, index + 1), copy, ...value.rules.slice(index + 1)] })
  }
  const add = () => onChange({
    ...value,
    rules: [...value.rules, {
      id: newRuleId(value.rules), enabled: true, match: "all",
      conditions: [{ field: "priority", op: "at_least", value: "high" }],
      then: value.default === "queue" ? "add" : "queue",
    }],
  })

  return (
    <div className="space-y-4" data-queue-rules-editor>
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-ui font-medium text-fg">When a task is assigned to me</legend>
        <Radio name="queue-default" value="queue" checked={value.default === "queue"} onChange={() => setDefault("queue")}
          label="Queue new tasks for me to accept" description="They show as Queued in My tasks until you accept or decline them." />
        <Radio name="queue-default" value="add" checked={value.default === "add"} onChange={() => setDefault("add")}
          label="Add straight to my tasks" description="No acceptance step; you start on them when you're ready." />
      </fieldset>

      <div className="space-y-2">
        <div>
          <p className="text-ui font-medium text-fg">Rules</p>
          <p className="text-xs text-fg-muted">Checked in order: the first rule that’s on and matches decides. A task no rule matches follows the choice above. A rule with no conditions matches every task.</p>
        </div>
        {value.rules.length === 0 && <p className="text-xs text-fg-muted" data-queue-rules-empty>No rules yet.</p>}
        <ol className="space-y-2">
          {value.rules.map((rule, index) => {
            const ruleLabel = `Rule ${index + 1}`
            return (
              <li key={rule.id}>
                <Card padding="sm" className={cn("space-y-2", rule.enabled === false && "opacity-70")} data-queue-rule={index}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-fg-muted">{ruleLabel}</span>
                    <Input size="sm" aria-label={`${ruleLabel} name`} placeholder="Name (optional)" className="max-w-56" value={rule.name ?? ""}
                      onChange={(e) => setRule(index, { ...rule, name: e.target.value || undefined })} />
                    <Switch size="sm" checked={rule.enabled !== false} onCheckedChange={(on) => setRule(index, { ...rule, enabled: on })}
                      label={<span className="text-xs text-fg-muted">{rule.enabled !== false ? "On" : "Off"}</span>} aria-label={`${ruleLabel} on`} />
                    <span className="ml-auto flex items-center gap-0.5">
                      <IconButton size="sm" label={`Move ${ruleLabel} up`} icon={<ArrowUp />} disabled={index === 0} onClick={() => move(index, -1)} />
                      <IconButton size="sm" label={`Move ${ruleLabel} down`} icon={<ArrowDown />} disabled={index === value.rules.length - 1} onClick={() => move(index, 1)} />
                      <IconButton size="sm" label={`Duplicate ${ruleLabel}`} icon={<Copy />} disabled={value.rules.length >= MAX_QUEUE_RULES} onClick={() => duplicate(index)} />
                      <IconButton size="sm" label={`Remove ${ruleLabel}`} icon={<Trash2 />} onClick={() => remove(index)} />
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    If the task matches
                    <Select size="sm" wrapperClassName="w-24" aria-label={`${ruleLabel} match`} value={rule.match}
                      onChange={(e) => setRule(index, { ...rule, match: e.target.value as "all" | "any" })}
                      options={[{ value: "all", label: "all" }, { value: "any", label: "any" }]} />
                    of these conditions:
                  </div>
                  <div className="space-y-1.5">
                    {rule.conditions.length === 0 && <p className="text-xs text-fg-muted">No conditions: every task.</p>}
                    {rule.conditions.map((cond, ci) => (
                      <ConditionRow key={ci} cond={cond} index={ci} ruleLabel={ruleLabel} options={options}
                        onChange={(c) => setRule(index, { ...rule, conditions: rule.conditions.map((x, i) => (i === ci ? c : x)) })}
                        onRemove={() => setRule(index, { ...rule, conditions: rule.conditions.filter((_, i) => i !== ci) })} />
                    ))}
                    <Button type="button" size="sm" variant="ghost" leadingIcon={<Plus />} disabled={rule.conditions.length >= MAX_RULE_CONDITIONS}
                      onClick={() => setRule(index, { ...rule, conditions: [...rule.conditions, { field: "assigned_by_relation", op: "is", value: "manager" }] })}>
                      Add condition
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-fg-muted">then</span>
                    <Select size="sm" wrapperClassName="w-60" aria-label={`${ruleLabel} outcome`} value={rule.then}
                      onChange={(e) => setRule(index, { ...rule, then: e.target.value as QueueDecision })} options={THEN_OPTIONS} />
                  </div>
                </Card>
              </li>
            )
          })}
        </ol>
        <Button type="button" variant="secondary" size="sm" leadingIcon={<Plus />} onClick={add} disabled={value.rules.length >= MAX_QUEUE_RULES}>
          Add rule
        </Button>
        {value.rules.length >= MAX_QUEUE_RULES && <p className="text-xs text-fg-muted">You can have up to {MAX_QUEUE_RULES} rules.</p>}
      </div>

      {usesTime && (
        <fieldset className="space-y-2" data-queue-working-hours>
          <legend className="mb-1 text-ui font-medium text-fg">My working hours</legend>
          <p className="text-xs text-fg-muted">For “Time it arrives” and “Day it arrives”. Times are in {hours.time_zone ? hours.time_zone : "your profile’s time zone (UTC if none)"}.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="time" size="sm" aria-label="Working hours start" className="w-28" value={hours.start}
              onChange={(e) => onChange({ ...value, working_hours: { ...hours, start: e.target.value } })} />
            <span className="text-xs text-fg-muted">to</span>
            <Input type="time" size="sm" aria-label="Working hours end" className="w-28" value={hours.end}
              onChange={(e) => onChange({ ...value, working_hours: { ...hours, end: e.target.value } })} />
            <Input size="sm" aria-label="Time zone" placeholder="Time zone, e.g. Pacific/Auckland" className="w-56" value={hours.time_zone ?? ""}
              onChange={(e) => onChange({ ...value, working_hours: { ...hours, time_zone: e.target.value || undefined } })} />
          </div>
          <div className="flex flex-wrap gap-3" role="group" aria-label="Working days">
            {QUEUE_DAY_LABELS.map((d, i) => (
              <Checkbox key={d} label={d.slice(0, 3)} checked={hours.days.includes(i)}
                onChange={(e) => onChange({ ...value, working_hours: { ...hours, days: e.target.checked ? [...hours.days, i].sort() : hours.days.filter((x) => x !== i) } })} />
            ))}
          </div>
        </fieldset>
      )}
    </div>
  )
}
