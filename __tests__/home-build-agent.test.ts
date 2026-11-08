/**
 * Home's build quick action: "Build from a process with Agent" replaces
 * "Build a form" when the Agent is available to a builder; otherwise "Build a
 * form" stays exactly as it was (forms.wizard).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HomeBuildActionView, homeBuildAction } from '@/components/assistants/home-build-action'
import { NO_ASSISTANTS } from '@/lib/assistants/types'

const builder = { ...NO_ASSISTANTS, agent: true, designer: true }

describe('Home build action', () => {
  it('the Agent is on and the person can build → "Build from a process with Agent" in the slot', () => {
    expect(homeBuildAction(builder, true)).toBe('agent')
    const html = renderToStaticMarkup(createElement(HomeBuildActionView, { action: 'agent' }))
    expect(html).toContain('Build from a process with Agent')
    expect(html).toContain('data-home-build-agent')
    expect(html).not.toContain('Build a form')
  })

  it('otherwise "Build a form" exactly as before (Agent off, not available, or no build permission)', () => {
    expect(homeBuildAction(null, true)).toBe('wizard')
    expect(homeBuildAction(NO_ASSISTANTS, true)).toBe('wizard')
    expect(homeBuildAction({ ...NO_ASSISTANTS, agent: true }, true)).toBe('wizard')
    expect(homeBuildAction({ ...NO_ASSISTANTS, agent: true }, false)).toBeNull()
    const html = renderToStaticMarkup(createElement(HomeBuildActionView, { action: 'wizard' }))
    expect(html).toContain('href="/forms/wizard/new"')
    expect(html).toContain('data-home-build-form')
    expect(html).toContain('Build a form')
  })
})
