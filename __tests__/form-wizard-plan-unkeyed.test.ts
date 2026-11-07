import { describe, expect, it } from 'vitest'
import { wizardPlan } from '@/lib/forms/wizard/build'
import { WizardSpecSchema, WIZARD_TEMPLATES } from '@/lib/forms/wizard/spec'
import { specFromTemplate } from '@/lib/forms/wizard/templates'

/**
 * Regression (production, release-dec25): opening the wizard crashed with
 * 'Question "What do you need?" has no key (assignWizardKeys first)' — the
 * review step's plan is computed on every render from the draft, whose
 * questions have no keys until Create assigns them.
 */
describe('wizardPlan on a fresh draft (questions without keys)', () => {
  for (const template of WIZARD_TEMPLATES) {
    it(`${template}: plans without throwing`, () => {
      const { spec } = specFromTemplate(template, `Test ${template}`)
      const parsed = WizardSpecSchema.safeParse(spec)
      if (!parsed.success) return // incomplete drafts (e.g. blank) never reach wizardPlan in the UI
      expect(parsed.data.questions.every((q) => !q.key)).toBe(true)
      expect(() => wizardPlan(parsed.data)).not.toThrow()
      expect(wizardPlan(parsed.data).length).toBeGreaterThan(3)
    })
  }
})
