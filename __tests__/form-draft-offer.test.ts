/**
 * "Resume your draft from …?" (gap: never shown when the form has defaults or a
 * repeating section). The form writes values by itself when it opens — bound
 * defaults ({{param.x}}), Labels, a repeating section's starting items, form-load
 * rules — and the prompt hid as soon as the values held anything. Only the
 * person's own edits count now (lib/forms/draft-offer.ts, used by standalone-form).
 */
import { describe, expect, it } from 'vitest'
import { isPersonEdit, personHasEntered, shouldOfferDraft } from '@/lib/forms/draft-offer'

const base = { anonymous: false, displayOnly: false, hasDraft: true, decided: false }

describe('the draft resume prompt', () => {
  it('values the form set itself (defaults, labels, repeating items) do not hide it', () => {
    const autoFilled = { account: 'ACC-1', total_label: 12, lines: [{ qty: 1 }], __form_params: { account: 'ACC-1' } }
    // Before: any value hid the prompt.
    expect(Object.keys(autoFilled).some((k) => !k.startsWith('__form_'))).toBe(true)
    expect(personHasEntered(autoFilled, false)).toBe(false)
    expect(shouldOfferDraft({ ...base, entered: personHasEntered(autoFilled, false) })).toBe(true)
  })

  it('the person typing (or changing a control) hides it', () => {
    expect(personHasEntered({ name: 'A' }, true)).toBe(true)
    expect(shouldOfferDraft({ ...base, entered: true })).toBe(false)
    expect(personHasEntered({ __form_params: {} }, true)).toBe(false)
  })

  it('only the person\'s own edit events count', () => {
    expect(isPersonEdit({ type: 'input', isTrusted: true })).toBe(true)
    expect(isPersonEdit({ type: 'change' })).toBe(true)
    expect(isPersonEdit({ type: 'paste', isTrusted: true })).toBe(true)
    expect(isPersonEdit({ type: 'input', isTrusted: false })).toBe(false)
    expect(isPersonEdit({ type: 'keydown', key: 'a' })).toBe(true)
    expect(isPersonEdit({ type: 'keydown', key: 'Backspace' })).toBe(true)
    expect(isPersonEdit({ type: 'keydown', key: 'Tab' })).toBe(false)
    expect(isPersonEdit({ type: 'keydown', key: 'ArrowDown' })).toBe(false)
    expect(isPersonEdit({ type: 'keydown', key: 'c', metaKey: true })).toBe(false)
    expect(isPersonEdit({ type: 'click' }, true)).toBe(true)
    expect(isPersonEdit({ type: 'click' }, false)).toBe(false)
    expect(isPersonEdit({ type: 'focus' })).toBe(false)
  })

  it('still not offered to anonymous visitors, on display forms, without a draft or once decided', () => {
    expect(shouldOfferDraft({ ...base, anonymous: true, entered: false })).toBe(false)
    expect(shouldOfferDraft({ ...base, displayOnly: true, entered: false })).toBe(false)
    expect(shouldOfferDraft({ ...base, hasDraft: false, entered: false })).toBe(false)
    expect(shouldOfferDraft({ ...base, decided: true, entered: false })).toBe(false)
  })
})
