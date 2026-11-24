import { describe, expect, it } from 'vitest'
import { cleanXfaXml, parseXfaTemplate } from '@/lib/importers/pdf/xfa'
import { xfaScriptRules } from '@/lib/importers/pdf/xfa-rules'
import { modelFromXfa } from '@/lib/importers/pdf/xfa-model'
import { DYNAMIC_XFA_TEMPLATE } from './fixtures/pdf-forms'

describe('XFA template reading', () => {
  const t = parseXfaTemplate(DYNAMIC_XFA_TEMPLATE)

  it('names fields as AcroForm does (SOM with indices) and reads captions, rich text, items and required', () => {
    const family = t.fields.find((f) => f.name === 'FamilyName')!
    expect(family.som).toBe('form1[0].Part1[0].Applicant[0].FamilyName[0]')
    expect(family).toMatchObject({ caption: '*Family name', type: 'text', maxChars: 40 })
    const group = t.fields.find((f) => f.name === 'CoSignerInd')!
    expect(group).toMatchObject({ kind: 'exclGroup', type: 'choice', required: true, context: expect.stringContaining('co-signer') })
    expect(group.options).toEqual([{ value: 'Y', label: 'Yes' }, { value: 'N', label: 'No' }])
    expect(t.fields.find((f) => f.name === 'Lang')!.options).toEqual([{ value: 'EN', label: 'English' }, { value: 'FR', label: 'French' }])
    expect(t.fields.find((f) => f.name === 'Amount')!.type).toBe('currency')
    expect(t.fields.find((f) => f.name === 'Validate')!.type).toBeNull()
    expect(t.sections.find((s) => s.som.endsWith('CoSigner[0]'))).toMatchObject({ hidden: true, title: 'Section B - Co-signer' })
  })

  it('strips a DOCTYPE (with entities) and processing instructions instead of resolving them', () => {
    const xml = '<?xml version="1.0"?><!DOCTYPE t [ <!ENTITY x SYSTEM "file:///etc/passwd"> ]><template><subform name="a"><field name="f"><caption><value><text>&x;</text></value></caption></field></subform></template>'
    expect(cleanXfaXml(xml)).not.toMatch(/DOCTYPE|ENTITY/)
    const parsed = parseXfaTemplate(xml)
    expect(parsed.fields[0].caption).toBe('&x;')
  })

  it('turns presence scripts into rules (JavaScript and FormCalc, radio option clicks)', () => {
    const ids = { field: (som: string) => som.split('.').pop()!.replace(/\[\d+\]/, ''), section: (som: string) => `section:${som.split('.').pop()!.replace(/\[\d+\]/, '')}` }
    const r = xfaScriptRules(t, ids)
    expect(r.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'show', targets: ['section:CoSigner'], when: { item: 'CoSignerInd', op: 'equals', value: 'Y' }, confidence: 'high' }),
      expect.objectContaining({ mode: 'hide', targets: ['section:CoSigner'], when: { item: 'CoSignerInd', op: 'equals', value: 'N' }, confidence: 'high' }),
      expect.objectContaining({ mode: 'hide', targets: ['Reason'], when: { item: 'Agree', op: 'equals', value: 'true' }, confidence: 'high' }),
      expect.objectContaining({ mode: 'show', targets: ['Reason'], when: { item: 'Agree', op: 'equals', value: 'false' }, confidence: 'high' }),
    ]))
  })

  it('marks scripts that do more than toggle presence as low confidence', () => {
    const xml = `<template><subform name="f"><subform name="p"><field name="a"><ui><checkButton/></ui><items><integer>1</integer></items>
      <event activity="click"><script>if (util.check()) { xfa.host.messageBox("x"); B.presence = "visible"; }</script></event></field>
      <field name="B"/></subform></subform></template>`
    const r = xfaScriptRules(parseXfaTemplate(xml), { field: (s) => s, section: () => null })
    expect(r.rules[0]).toMatchObject({ confidence: 'low', reason: expect.any(String) })
  })
})

describe('dynamic XFA → model', () => {
  const m = modelFromXfa(parseXfaTemplate(DYNAMIC_XFA_TEMPLATE), 'Sponsor form')

  it('builds items with captions, required (nullTest and asterisk), sections and merged split dates', () => {
    expect(m.kind).toBe('xfa')
    const byLabel = (l: string) => m.items.find((i) => i.label === l)
    expect(byLabel('Family name')).toMatchObject({ required: true, requiredSource: 'asterisk', maxLength: 40 })
    expect(m.items.find((i) => i.id === 'CoSignerInd')).toMatchObject({ type: 'choice', display: 'radio', required: true, label: '1. Do you have a co-signer?' })
    const dob = m.items.find((i) => i.id === 'DOBDay')!
    expect(dob).toMatchObject({ type: 'date', label: 'Date of birth' })
    expect(m.items.some((i) => i.id === 'DOBMonth')).toBe(false)
    expect(m.sections.map((s) => s.title)).toEqual(['Section A - About you', 'Section B - Co-signer'])
    expect(m.sections[1].hidden).toBe(true)
    expect(m.notes.join(' ')).toMatch(/left out.*Validate/)
  })

  it('links presence rules to items and sections', () => {
    expect(m.rules.filter((r) => r.confidence === 'high').length).toBeGreaterThanOrEqual(4)
    expect(m.rules.some((r) => r.targets.some((t) => t.startsWith('section:')))).toBe(true)
  })
})
