export interface RetentionPolicy {
  id: string
  name: string
  description?: string | null
  policy_mode: 'review' | 'review_on_exact_date' | 'purge_on' | 'purge_on_exact_date' | 'keep_forever'
  duration_value?: number | null
  duration_unit?: 'days' | 'months' | 'years' | null
  exact_date?: string | null
  applies_to?: string[] | null
}

export interface RetentionStatus {
  mode: 'none' | 'review' | 'review_on_exact_date' | 'purge_on' | 'purge_on_exact_date' | 'keep_forever'
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'danger'
}

function formatShortDate(value: Date) {
  return value.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function computeRelativeStatus(mode: 'review' | 'review_on_exact_date' | 'purge_on' | 'purge_on_exact_date', dueAt: Date): RetentionStatus {
  const now = new Date()
  const diffMs = dueAt.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  const formatted = formatShortDate(dueAt)

  if (mode === 'review' || mode === 'review_on_exact_date') {
    if (diffDays < 0) return { mode, label: `Review overdue since ${formatted}`, tone: 'warning' }
    if (diffDays <= 30) return { mode, label: `Review due ${formatted}`, tone: 'warning' }
    return { mode, label: `Review on ${formatted}`, tone: 'success' }
  }

  if (diffDays < 0) return { mode, label: `Purge overdue since ${formatted}`, tone: 'danger' }
  if (diffDays <= 30) return { mode, label: `Purge due ${formatted}`, tone: 'warning' }
  return { mode, label: `Purge on ${formatted}`, tone: 'success' }
}

function addRetentionInterval(baseAt: Date, value: number, unit: 'days' | 'months' | 'years') {
  const dueAt = new Date(baseAt)
  if (unit === 'days') {
    dueAt.setDate(dueAt.getDate() + value)
    return dueAt
  }
  if (unit === 'months') {
    dueAt.setMonth(dueAt.getMonth() + value)
    return dueAt
  }
  dueAt.setFullYear(dueAt.getFullYear() + value)
  return dueAt
}

export function getRetentionStatus(params: {
  directMode?: string | null
  directUntil?: string | null
  policy?: RetentionPolicy | null
  appliedAt?: string | null
  createdAt?: string | null
}): RetentionStatus {
  const { directMode, directUntil, policy, appliedAt, createdAt } = params

  if (policy) {
    if (policy.policy_mode === 'keep_forever') {
      return { mode: 'keep_forever', label: `Policy: ${policy.name}`, tone: 'success' }
    }
    if ((policy.policy_mode === 'review_on_exact_date' || policy.policy_mode === 'purge_on_exact_date') && policy.exact_date) {
      const exactDate = new Date(policy.exact_date)
      if (!Number.isNaN(exactDate.getTime())) {
        return computeRelativeStatus(policy.policy_mode, exactDate)
      }
    }
    const baseAt = appliedAt ?? createdAt
    if (baseAt && policy.duration_value && policy.duration_unit) {
      const dueAt = addRetentionInterval(new Date(baseAt), policy.duration_value, policy.duration_unit)
      return computeRelativeStatus(policy.policy_mode, dueAt)
    }
    return {
      mode: policy.policy_mode,
      label: `Policy: ${policy.name}`,
      tone: policy.policy_mode === 'review' || policy.policy_mode === 'review_on_exact_date' ? 'success' : 'warning',
    }
  }

  if (directMode === 'keep_forever') {
    return { mode: 'keep_forever', label: 'Keep forever', tone: 'success' }
  }

  if ((directMode === 'review' || directMode === 'purge_on') && directUntil) {
    const dueAt = new Date(directUntil)
    if (!Number.isNaN(dueAt.getTime())) {
      return computeRelativeStatus(directMode, dueAt)
    }
  }

  return { mode: 'none', label: 'No retention policy', tone: 'neutral' }
}
