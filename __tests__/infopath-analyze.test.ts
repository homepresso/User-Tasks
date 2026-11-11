import { describe, expect, it } from 'vitest'
import { analyzeInfoPath, walkControls } from '@/lib/infopath/analyze'
import { parseXml } from '@/lib/documents/xml'
import { parseView } from '@/lib/infopath/view'
import { parseSchema, schemaNodes } from '@/lib/infopath/schema'
import { fixtureXsn } from './helpers/infopath-fixtures'
import { writeCab } from './helpers/cab-writer'

const expense = () => analyzeInfoPath(fixtureXsn('expense-report'), { fileName: 'Expense Report.xsn' })
const leave = () => analyzeInfoPath(fixtureXsn('leave-request'), { fileName: 'Leave Request.xsn' })

describe('InfoPath analyzer — schema', () => {
  it('reads types, repeating groups, required, patterns, ranges and rich text', () => {
    const m = expense()
    const nodes = new Map(schemaNodes(m.schema).map((n) => [n.path, n]))
    expect(nodes.get('/expenseReport/items/item')).toMatchObject({ repeating: true, type: 'group' })
    expect(nodes.get('/expenseReport/items/item/unitPrice')).toMatchObject({ type: 'decimal', required: false })
    expect(nodes.get('/expenseReport/employeeName')).toMatchObject({ type: 'string', required: true })
    expect(nodes.get('/expenseReport/costCenter')?.pattern).toBe('[A-Z]{2}-\\d{4}')
    expect(nodes.get('/expenseReport/purpose')?.type).toBe('xhtml')
    expect(nodes.get('/expenseReport/receipts')?.type).toBe('base64Binary')
    const l = new Map(schemaNodes(leave().schema).map((n) => [n.path, n]))
    expect(l.get('/leaveRequest/startDate')).toMatchObject({ type: 'date', required: true }) // not nillable → cannot be blank
    expect(l.get('/leaveRequest/days')).toMatchObject({ type: 'decimal', min: 0.5, max: 60 })
    expect(l.get('/leaveRequest/callTime')?.type).toBe('time')
    expect(l.get('/leaveRequest/@formId')).toMatchObject({ attribute: true })
  })

  it('refuses a DTD in any part (no external entities)', () => {
    const doc = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"/>'
    expect(() => parseXml(doc)).toThrow(/DOCTYPE/)
    const cab = writeCab([{ name: 'manifest.xsf', data: doc }])
    expect(() => analyzeInfoPath(cab)).toThrow(/manifest.xsf could not be read/)
  })

  it('handles named complex types and choices', () => {
    const xsd = parseXml(`<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:my="urn:x">
      <xsd:element name="root" type="my:RootType"/>
      <xsd:complexType name="RootType"><xsd:sequence><xsd:element name="a" type="xsd:integer"/><xsd:choice><xsd:element name="b" type="xsd:boolean" nillable="true"/></xsd:choice><xsd:element name="rows" maxOccurs="unbounded"><xsd:complexType><xsd:sequence><xsd:element name="c" type="xsd:double"/></xsd:sequence></xsd:complexType></xsd:element></xsd:sequence></xsd:complexType>
    </xsd:schema>`)
    const { root } = parseSchema([xsd], 'root')
    const nodes = new Map(schemaNodes(root).map((n) => [n.path, n]))
    expect(nodes.get('/root/a')).toMatchObject({ type: 'integer', required: true })
    expect(nodes.get('/root/b')).toMatchObject({ type: 'boolean', required: false })
    expect(nodes.get('/root/rows')).toMatchObject({ repeating: true })
    expect(nodes.get('/root/rows/c')?.type).toBe('double')
  })
})

describe('InfoPath analyzer — views', () => {
  it('finds views from the manifest with their controls, labels and options', () => {
    const m = expense()
    expect(m.format).toBe('xsn')
    expect(m.views.map((v) => v.name)).toEqual(['Expense Report'])
    const controls = walkControls(m.views[0].items)
    const byId = new Map(controls.map((c) => [c.id, c]))
    expect(byId.get('CTRL1')).toMatchObject({ kind: 'text', path: '/expenseReport/employeeName', label: 'Employee name', title: 'Your full name' })
    expect(byId.get('CTRL3')).toMatchObject({ kind: 'dropdown', options: [{ value: 'Operations', label: 'Operations' }, { value: 'Sales', label: 'Sales' }, { value: 'Engineering', label: 'Engineering' }], placeholder: 'Select...' })
    expect(byId.get('CTRL5')).toMatchObject({ kind: 'dropdown', options_source: expect.stringContaining('GetDOM("Projects")') })
    expect(byId.get('CTRL6')).toMatchObject({ kind: 'date', path: '/expenseReport/reportDate', label: 'Report date' })
    expect(byId.get('CTRL7')?.kind).toBe('richtext')
    expect(byId.get('CTRL17')?.kind).toBe('attachment')
    expect(byId.get('CTRL20')).toMatchObject({ kind: 'button', caption: 'Submit report' })
    // Same layout row → same row number, different columns.
    expect(byId.get('CTRL1')!.row).toBe(byId.get('CTRL2')!.row)
    expect(byId.get('CTRL2')!.col).toBeGreaterThan(byId.get('CTRL1')!.col)
  })

  it('reads a repeating table: header labels, the repeated row, the footer total', () => {
    const items = walkControls(expense().views[0].items)
    const table = items.find((c) => c.kind === 'repeating_table')!
    expect(table).toMatchObject({ path: '/expenseReport/items/item', label: 'Line items', headers: ['Date', 'Description', 'Category', 'Qty', 'Unit price', 'Line total'] })
    expect(table.children!.map((c) => (c.kind === 'static' ? null : c.label))).toEqual(['Date', 'Description', 'Category', 'Qty', 'Unit price', 'Line total'])
    expect(items.find((c) => c.id === 'CTRL14')).toMatchObject({ read_only: true, format: 'currency' })
    // The footer's total sits after the table, outside it.
    expect(items.find((c) => c.id === 'CTRL15')?.path).toBe('/expenseReport/total')
  })

  it('reads conditional formatting: hide, read only and styling', () => {
    const items = walkControls(expense().views[0].items)
    expect(items.find((c) => c.id === 'CTRL16')!.formatting).toEqual([{ condition: 'my:total <= 1000', effect: 'hide', caption: 'Hide for small reports' }])
    expect(items.find((c) => c.id === 'CTRL18')!.formatting.map((f) => f.effect)).toEqual(['disable', 'style'])
  })

  it('merges option buttons, follows templates into optional sections with their show condition', () => {
    const m = leave()
    expect(m.views.map((v) => [v.name, v.caption])).toEqual([['Request', 'Leave request'], ['Approval', 'Manager approval']])
    const items = walkControls(m.views[0].items)
    expect(items.find((c) => c.kind === 'option')).toMatchObject({ path: '/leaveRequest/leaveType', label: 'Type of leave', options: [{ value: 'Annual', label: 'Annual leave' }, { value: 'Sick', label: 'Sick leave' }, { value: 'Unpaid', label: 'Unpaid leave' }], merged: ['CTRL4', 'CTRL5'] })
    const section = items.find((c) => c.kind === 'optional_section')!
    expect(section).toMatchObject({ path: '/leaveRequest/medical', show_if: 'not(../my:leaveType != "Sick")' })
    expect(walkControls(section.children!).map((c) => c.path)).toEqual(['/leaveRequest/medical/doctor', '/leaveRequest/medical/certificate'])
    expect(items.find((c) => c.id === 'CTRL9')?.kind).toBe('time')
    const approval = walkControls(m.views[1].items)
    expect(approval.find((c) => c.id === 'CTRL31')).toMatchObject({ kind: 'expression', expression: expect.stringContaining('concat(') })
  })

  it('parses a lone view with xsl:for-each repeating sections', () => {
    const xsl = parseXml(`<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:my="urn:x" xmlns:xd="http://schemas.microsoft.com/office/infopath/2003">
      <xsl:template match="my:root"><html><body>
        <div><xsl:for-each select="my:people/my:person"><div>Name: <span xd:xctname="PlainText" xd:CtrlId="CTRL1" xd:binding="my:name"/></div></xsl:for-each></div>
      </body></html></xsl:template></xsl:stylesheet>`)
    const view = parseView(xsl, { name: 'v', caption: 'v', file: 'v.xsl', default: true, hidden: false }, { root: '/root', isRepeating: (p) => p === '/root/people/person', isOptional: () => false })
    const rep = view.items.find((i) => i.kind === 'repeating_section')
    expect(rep).toMatchObject({ path: '/root/people/person' })
    expect(walkControls([rep!])[1]).toMatchObject({ path: '/root/people/person/name', label: 'Name' })
  })
})

describe('InfoPath analyzer — manifest', () => {
  it('links rules to fields, buttons and form load, with their context node', () => {
    const m = expense()
    const rules = m.manifest.rules
    expect(rules.find((r) => r.name === 'Sales cost center')).toMatchObject({ trigger: { kind: 'field', path: '/expenseReport/department' }, context: '/expenseReport/department', condition: '. = "Sales"', actions: [{ type: 'assign', target: '../my:costCenter', expression: '"SA-1000"' }] })
    expect(rules.filter((r) => r.trigger.kind === 'button' && r.trigger.control === 'CTRL20').map((r) => r.name)).toEqual(['Large report warning', 'Submit the report'])
    expect(rules.find((r) => r.name === 'Submit the report')!.actions.map((a) => a.type)).toEqual(['assign', 'submit', 'close'])
    expect(rules.find((r) => r.name === 'Managers see status')).toMatchObject({ trigger: { kind: 'load' }, context: '/expenseReport' })
    expect(m.manifest.rules.find((r) => r.name === 'Check the dates')).toBeUndefined()
    const l = leave()
    expect(l.manifest.rules.find((r) => r.name === 'Check the dates')).toMatchObject({ stop_after: true })
    expect(l.manifest.rules.find((r) => r.name === 'Send for approval')!.actions[1]).toEqual({ type: 'switch_view', element: 'switchViewAction', view: 'Approval' })
  })

  it('reads validation, calculations, connections, roles, submit and defaults', () => {
    const m = expense()
    expect(m.manifest.validations.map((v) => [v.kind, v.path, v.short_message])).toEqual([
      ['blank', '/expenseReport/email', 'Cannot be blank'],
      ['custom', '/expenseReport/email', 'Enter a valid email address'],
      ['custom', '/expenseReport/items/item/unitPrice', 'Prices cannot be negative'],
    ])
    expect(m.manifest.calculations.map((c) => [c.path, c.refresh])).toEqual([['/expenseReport/reportDate', 'onInit'], ['/expenseReport/items/item/lineTotal', 'onChange'], ['/expenseReport/total', 'onChange']])
    expect(m.manifest.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Projects', type: 'sharepoint_list', direction: 'query', fields: ['Title', 'Code'], init_on_load: true }),
      expect.objectContaining({ name: 'Main submit', type: 'sharepoint_library', direction: 'submit' }),
    ]))
    expect(m.manifest.roles.map((r) => r.name)).toEqual(['Employee', 'Manager'])
    expect(m.manifest.submit).toMatchObject({ caption: 'Submit', after: 'close', adapters: ['Main submit'] })
    expect(m.manifest.browser_enabled).toBe(true)
    expect(m.manifest.repeating).toContain('/expenseReport/items/item')
    expect(m.defaults).toMatchObject({ '/expenseReport/department': 'Operations', '/expenseReport/items/item/category': 'Travel', '/expenseReport/status': 'Draft' })
  })

  it('stops on time budget overruns', () => {
    let t = 0
    expect(() => analyzeInfoPath(fixtureXsn('expense-report'), { now: () => (t += 30_000) })).toThrow(/took too long/)
  })
})
