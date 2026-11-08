'use client'

import { Select } from '@/components/ui/select'
import { THINKING_LABELS, THINKING_LEVELS, THINKING_UNSUPPORTED_HINT, thinkingSupport, type ThinkingLevel } from '@/lib/agents/reasoning'

const muted = { color: 'var(--theme-muted-text)' }

/**
 * "Thinking level" for a model (Settings → Agent): Default, Low, Medium,
 * High, and Max where the model takes it. `provider` null = not known here
 * (an Integrations connection of an unknown type): every level is offered and
 * sent only if the model supports it. Disabled for models without a thinking
 * level.
 */
export function ThinkingLevelSelect({ id, value, onChange, provider, model, disabled }: {
  id: string
  value: ThinkingLevel | undefined
  onChange: (level: ThinkingLevel) => void
  provider: string | null
  model: string
  disabled?: boolean
}) {
  const support = provider ? thinkingSupport(provider, model) : { levels: ['low', 'medium', 'high', 'max'] as ThinkingLevel[] }
  const unsupported = Boolean(provider && model && !support.levels.length)
  const current = value ?? 'default'
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">Thinking level</label>
      <Select id={id} data-testid={id} value={unsupported ? 'default' : current} disabled={disabled || unsupported} onChange={(e) => onChange(e.target.value as ThinkingLevel)} className="max-w-60">
        {THINKING_LEVELS.filter((l) => l === 'default' || support.levels.includes(l) || l === current).map((l) => <option key={l} value={l}>{THINKING_LABELS[l]}</option>)}
      </Select>
      <p className="text-xs" style={muted}>
        {unsupported ? THINKING_UNSUPPORTED_HINT
          : !model ? 'Pick a model to see which levels it supports.'
          : `Higher thinks longer: better on complex builds, but slower and more output tokens (cost).${'nativeOnly' in support && support.nativeOnly ? ' Claude: applies on Anthropic\'s own API.' : ''}`}
      </p>
    </div>
  )
}
