/**
 * Shapes of the form accessibility checker (lib/forms/accessibility): what a
 * rule reports, the fixes it offers and the result the designer panel, the
 * API / MCP tool and the report job share. Pure and isomorphic.
 */

import type { FormThemeOverrides } from '@/lib/forms/form-theme'
import type { ThemeMode, ThemePalette } from '@/lib/theme/schema'

export const SEVERITIES = ['critical', 'serious', 'moderate', 'minor', 'review'] as const
export type Severity = (typeof SEVERITIES)[number]

export type WcagLevel = 'A' | 'AA'

/**
 * A change that resolves a finding, applied with applyAccessibilityFix (the
 * designer applies it through its undo history):
 *   field   patch the field `field_key` (Partial<TaskFieldDef>)
 *   header  patch the header (Partial<FormHeader>)
 *   theme   replace the theme reference: patch = { theme: FormThemeRef }
 *   button  patch the button `button_id` (Partial<FormButton>)
 * `prompt` asks the author for a value first (alt text, a label): the answer
 * is written to patch[prompt.property].
 */
export interface AccessibilityFix {
  kind: 'field' | 'header' | 'theme' | 'button'
  label: string
  field_key?: string
  button_id?: string
  patch: Record<string, unknown>
  prompt?: { property: string; question: string; suggestion?: string }
}

export interface AccessibilityFinding {
  /** Stable id: rule + subject (dedupe, list keys). */
  id: string
  rule: string
  severity: Severity
  /** WCAG 2.2 success criteria, e.g. ['1.3.1', '4.1.2']. */
  wcag: string[]
  level: WcagLevel
  field_key?: string
  /** Light / dark palette a contrast finding is about. */
  mode?: ThemeMode
  message: string
  help: string
  fix?: AccessibilityFix
  /** checker (static rules) or axe (a scan of the rendered preview). */
  source?: 'checker' | 'axe'
  /** axe: CSS selectors of the offending nodes. */
  targets?: string[]
}

export interface AccessibilityRuleInfo {
  rule: string
  title: string
  wcag: string[]
  level: WcagLevel
}

export interface AccessibilitySummary {
  total: number
  critical: number
  serious: number
  moderate: number
  minor: number
  review: number
}

export interface AccessibilityResult {
  /** 0–100; 100 = no findings. */
  score: number
  findings: AccessibilityFinding[]
  summary: AccessibilitySummary
  /** Rules that ran and found nothing. */
  passed: AccessibilityRuleInfo[]
  /** Checker version (reports). */
  version: number
}

/** Steps / tabs (pages) of a form, when the layout has them. Read generically: that feature may not exist yet. */
export interface FormPageInfo {
  id?: string
  title?: string | null
  field_keys?: string[]
}

export interface CheckOptions {
  /**
   * Colours: the workspace palettes the form draws on (light AND dark) and
   * the concrete mini theme (a saved theme reference resolved by the caller).
   * Without palettes the platform default theme is assumed.
   */
  theme?: {
    light?: ThemePalette
    dark?: ThemePalette
    overrides?: FormThemeOverrides | null
  }
  /** Which palettes to check (default both). */
  modes?: ThemeMode[]
  /** The page language (BCP 47). The app renders lang="en"; null = unknown. */
  language?: string | null
  /** Steps / tabs, when the caller knows them (otherwise read from the layout). */
  pages?: FormPageInfo[]
  /** The task the form belongs to expires on its own / shows a countdown. */
  timeouts?: { auto_expire?: boolean; time_limit_seconds?: number | null; extendable?: boolean } | null
  /** Skip the colour rules (server side without theme colours). */
  structuralOnly?: boolean
  /** Where the form is used: a task form must be completable (Application mode needs an in-form Submit). */
  surface?: 'task' | 'page'
}
