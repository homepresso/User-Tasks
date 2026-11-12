/**
 * manifest.xsf → views, rules (rule sets with what triggers them), custom
 * validation, calculations, data connections, buttons, roles and submit.
 *
 * Triggers link rule sets to what runs them:
 *   xsf:domEventHandlers/xsf:domEventHandler[@match]  a field changes
 *   xsf:views/…/xsf:button[@name = xd:CtrlId]         a button is clicked
 *   xsf:onLoad                                         the form opens
 *   xsf:submit (with rules)                            submit
 * A rule set can run another (xsf:ruleSetAction): expanded in place.
 * Conditions and assignment targets are relative to the trigger's node.
 */

import { attr, elements, textOf, type XmlElement } from '@/lib/documents/xml'
import { localOf, resolveBinding } from './xpath'
import type { IpButton, IpCalculation, IpDataConnection, IpManifest, IpRule, IpRuleAction, IpRuleActionType, IpTrigger, IpValidation } from './model'

const MAX_RULES = 2000

function all(node: XmlElement, local: string, depth = 0, out: XmlElement[] = []): XmlElement[] {
  if (depth > 60) return out
  for (const c of elements(node)) {
    if (c.local === local) out.push(c)
    all(c, local, depth + 1, out)
  }
  return out
}

function first(node: XmlElement | undefined, local: string): XmlElement | undefined {
  return node ? all(node, local)[0] : undefined
}

/** `/my:root/my:a` → `/root/a` (null when it is not a plain path). */
export function absPath(xpath: string | undefined, context = ''): string | null {
  if (!xpath) return null
  return resolveBinding(context, xpath)
}

const ACTIONS: Record<string, IpRuleActionType> = {
  dialogBoxMessageAction: 'dialog', dialogBoxExpressionAction: 'dialog_expression', assignmentAction: 'assign',
  queryAction: 'query', submitAction: 'submit', switchViewAction: 'switch_view', closeDocumentAction: 'close',
  openNewDocumentAction: 'open_new', ruleSetAction: 'rule_set', signatureAction: 'sign', sendToHostAction: 'send_to_host',
}

function action(el: XmlElement): IpRuleAction {
  const type = ACTIONS[el.local] ?? 'unknown'
  const out: IpRuleAction = { type, element: el.local }
  switch (type) {
    case 'dialog': out.text = textOf(el).trim(); break
    case 'dialog_expression': out.expression = attr(el, 'expression') ?? textOf(el).trim(); break
    case 'assign': out.target = attr(el, 'targetField'); out.expression = attr(el, 'expression') ?? ''; break
    case 'query': case 'submit': out.adapter = attr(el, 'adapter'); break
    case 'switch_view': out.view = attr(el, 'view'); break
    case 'rule_set': out.rule_set = attr(el, 'ruleSet'); break
  }
  return out
}

function connectionOf(dataObject: XmlElement | null, adapter: XmlElement, direction: 'query' | 'submit'): IpDataConnection {
  const local = adapter.local
  const type = /sharepointList/i.test(local) ? 'sharepoint_list'
    : /webService/i.test(local) ? 'web_service'
      : /xmlFile/i.test(local) ? 'xml_file'
        : /ado/i.test(local) ? 'database'
          : /dav/i.test(local) ? 'sharepoint_library'
            : /email/i.test(local) ? 'email'
              : /hwsAdapter|udcAdapter/i.test(local) ? 'connection_file'
                : /host/i.test(local) ? 'hosting' : local
  const name = attr(dataObject ?? adapter, 'name') ?? attr(adapter, 'name') ?? local
  const source = attr(adapter, 'relativeListUrl') ?? attr(adapter, 'siteUrl') ?? attr(adapter, 'siteURL') ?? attr(adapter, 'url') ?? attr(adapter, 'wsdlUrl')
    ?? attr(first(adapter, 'folderURL'), 'value') ?? attr(first(adapter, 'location'), 'url') ?? attr(first(adapter, 'operation'), 'serviceUrl') ?? attr(adapter, 'connectionString')?.replace(/password=[^;]*/gi, 'password=***')
  const fields = all(adapter, 'field').map((f) => attr(f, 'internalName') ?? attr(f, 'name') ?? '').filter(Boolean)
  return {
    name, type, direction,
    ...(source ? { source } : {}),
    ...(dataObject && attr(dataObject, 'initOnLoad') === 'yes' ? { init_on_load: true } : {}),
    ...(fields.length ? { fields } : {}),
  }
}

/** Parse manifest.xsf. `root` = the schema root's local name (fallback when the manifest's paths are relative). */
export function parseManifest(doc: XmlElement, viewControlContext: (view: string, ctrlId: string) => string | null = () => null): IpManifest {
  const warnings: string[] = []
  const out: IpManifest = {
    name: attr(doc, 'name') ?? '',
    product_version: attr(doc, 'productVersion'),
    browser_enabled: false,
    views: [], rules: [], validations: [], calculations: [], connections: [], buttons: [], roles: [],
    submit: null, repeating: [], optional: [], rich_text: [], code: [], signatures: [], warnings,
  }
  const solutionVersion = attr(doc, 'solutionVersion')
  if (solutionVersion) out.version = solutionVersion
  const props = first(doc, 'solutionProperties')
  const description = attr(first(doc, 'summary'), 'description') ?? attr(props, 'description')
  if (description) out.description = description
  const initial = first(doc, 'initialXmlDocument')
  if (attr(initial, 'caption')) out.title = attr(initial, 'caption')
  const solution2 = all(doc, 'solutionDefinition').find((e) => /2006\/solutionDefinition\/extensions|^xsf2:/.test(e.name) || e.name.startsWith('xsf2'))
  if (solution2 && /server/.test(attr(solution2, 'runtimeCompatibility') ?? '')) out.browser_enabled = true

  // Root element of the main schema (paths in the manifest are absolute from it).
  const rootProp = all(doc, 'property').find((p) => attr(p, 'name') === 'rootElement')
  if (rootProp) out.root = attr(rootProp, 'value')

  // ── Views ──
  const viewsEl = first(doc, 'views')
  out.default_view = attr(viewsEl, 'default')
  for (const v of viewsEl ? elements(viewsEl).filter((e) => e.local === 'view') : []) {
    const name = attr(v, 'name') ?? ''
    const file = attr(first(v, 'mainpane'), 'transform') ?? ''
    const print = attr(first(v, 'printSettings'), 'printView') ?? attr(v, 'printView')
    out.views.push({ name, caption: attr(v, 'caption') ?? name, file, hidden: attr(v, 'showMenuItem') === 'no', ...(print ? { print_view: print } : {}) })
    // Editing declarations: repeating containers, optional sections, rich text.
    for (const x of all(v, 'xmlToEdit')) {
      const item = absPath(attr(x, 'item'))
      const editWith = first(x, 'editWith')
      const component = attr(editWith, 'component') ?? ''
      if (!item) continue
      if (component === 'xCollection' && !out.repeating.includes(item)) out.repeating.push(item)
      if (component === 'xOptional' && !out.optional.includes(item)) out.optional.push(item)
      if (attr(editWith, 'type') === 'rich' && !out.rich_text.includes(item)) out.rich_text.push(item)
    }
  }

  // ── Rule sets ──
  const ruleSets = new Map<string, XmlElement>()
  for (const rs of all(doc, 'ruleSet')) {
    const name = attr(rs, 'name')
    if (name) ruleSets.set(name, rs)
  }
  let ruleCount = 0
  const expand = (setName: string, trigger: IpTrigger, context: string, seen: string[] = []) => {
    const rs = ruleSets.get(setName)
    if (!rs) { warnings.push(`Rule set ${setName} is referenced but not defined`); return }
    if (seen.includes(setName) || seen.length > 8) { warnings.push(`Rule set ${setName} runs itself: expanded once`); return }
    const rules = elements(rs).filter((e) => e.local === 'rule')
    rules.forEach((r, i) => {
      if (++ruleCount > MAX_RULES) { if (ruleCount === MAX_RULES + 1) warnings.push(`More than ${MAX_RULES} rules: the rest are skipped`); return }
      const actions: IpRuleAction[] = []
      for (const a of elements(r)) {
        const parsed = action(a)
        if (parsed.type === 'rule_set' && parsed.rule_set) {
          // Inline the called rule set's rules after this one (as InfoPath runs them).
          actions.push(parsed)
        } else actions.push(parsed)
      }
      const condition = attr(r, 'condition')
      const rule: IpRule = {
        id: `${setName}#${i + 1}${seen.length ? `@${seen.join('>')}` : ''}#${triggerKey(trigger)}`,
        name: attr(r, 'caption') ?? `Rule ${i + 1}`,
        enabled: attr(r, 'isEnabled') !== 'no',
        ...(condition ? { condition } : {}),
        context, rule_set: setName, trigger,
        ...(attr(r, 'stopProcessingRules') === 'yes' ? { stop_after: true } : {}),
        actions,
      }
      out.rules.push(rule)
      for (const a of actions) if (a.type === 'rule_set' && a.rule_set) expand(a.rule_set, trigger, context, [...seen, setName])
    })
  }
  const rootCtx = out.root ? `/${localOf(out.root)}` : ''

  for (const h of all(doc, 'domEventHandler')) {
    const match = attr(h, 'match') ?? ''
    const path = absPath(match) ?? rootCtx
    for (const a of all(h, 'ruleSetAction')) expand(attr(a, 'ruleSet') ?? '', { kind: 'field', path, match }, path)
  }
  const onLoad = first(doc, 'onLoad')
  if (onLoad) for (const a of all(onLoad, 'ruleSetAction')) expand(attr(a, 'ruleSet') ?? '', { kind: 'load' }, rootCtx)

  // Buttons: <xsf:button name="CTRLn"> under a view (editing / unboundControls); toolbar buttons have an action.
  for (const v of viewsEl ? elements(viewsEl).filter((e) => e.local === 'view') : []) {
    const viewName = attr(v, 'name') ?? ''
    for (const b of all(v, 'button')) {
      const name = attr(b, 'name')
      const sets = all(b, 'ruleSetAction').map((a) => attr(a, 'ruleSet') ?? '').filter(Boolean)
      if (!name) continue
      const button: IpButton = { view: viewName, control: name, rule_sets: sets, ...(attr(b, 'caption') ? { caption: attr(b, 'caption') } : {}), ...(attr(b, 'action') ? { action: attr(b, 'action') } : {}) }
      out.buttons.push(button)
      const context = viewControlContext(viewName, name) ?? rootCtx
      for (const s of sets) expand(s, { kind: 'button', view: viewName, control: name, ...(button.caption ? { caption: button.caption } : {}) }, context)
    }
  }

  // ── Submit ──
  const submit = all(doc, 'submit').find((s) => s.name.endsWith(':submit') || s.local === 'submit')
  if (submit) {
    const adapters = elements(submit).filter((e) => /Adapter/.test(e.local))
    const sets = all(submit, 'ruleSetAction').map((a) => attr(a, 'ruleSet') ?? '').filter(Boolean)
    out.submit = {
      ...(attr(submit, 'caption') ? { caption: attr(submit, 'caption') } : {}),
      ...(attr(submit, 'onAfterSubmit') ? { after: attr(submit, 'onAfterSubmit') } : {}),
      adapters: adapters.map((a) => attr(a, 'name') ?? a.local),
      rule_sets: sets,
      enabled: attr(submit, 'disableMenuItem') !== 'yes',
    }
    for (const a of adapters) out.connections.push(connectionOf(null, a, 'submit'))
    for (const s of sets) expand(s, { kind: 'submit' }, rootCtx)
  }

  // ── Data connections ──
  for (const d of all(doc, 'dataObject')) {
    const query = first(d, 'query')
    const adapter = query ? elements(query)[0] : undefined
    if (adapter) out.connections.push(connectionOf(d, adapter, 'query'))
  }
  // Submit-only adapters declared under xsf:dataAdapters.
  const dataAdapters = first(doc, 'dataAdapters')
  if (dataAdapters) for (const a of elements(dataAdapters)) if (!out.connections.some((c) => c.name === attr(a, 'name'))) out.connections.push(connectionOf(null, a, 'submit'))
  // Main data source query (a form whose main source is a list / service).
  const mainQuery = elements(doc).find((e) => e.local === 'query')
  if (mainQuery) for (const a of elements(mainQuery)) out.connections.push(connectionOf(null, a, 'query'))

  // ── Validation ──
  let vid = 0
  for (const cv of all(doc, 'customValidation')) {
    for (const ec of elements(cv)) {
      const match = attr(ec, 'match') ?? ''
      const base = absPath(match) ?? rootCtx
      const exprCtx = attr(ec, 'expressionContext') ?? '.'
      const path = absPath(exprCtx, base) ?? base
      if (ec.local === 'errorCondition') {
        const msg = first(ec, 'errorMessage')
        const v: IpValidation = {
          id: `v${++vid}`, path, context: path, expression: attr(ec, 'expression') ?? '',
          short_message: attr(msg, 'shortMessage') ?? 'This value is not valid', kind: 'custom',
        }
        const long = msg ? textOf(msg).trim() : ''
        if (long) v.message = long
        out.validations.push(v)
      } else if (ec.local === 'errorBlank') {
        out.validations.push({ id: `v${++vid}`, path, context: path, expression: attr(ec, 'expression') ?? '', short_message: 'Cannot be blank', kind: 'blank' })
      }
    }
  }

  // ── Calculations ──
  let cid = 0
  for (const c of all(doc, 'calculatedField')) {
    const path = absPath(attr(c, 'target'))
    if (!path) continue
    const refresh = attr(c, 'refresh')
    out.calculations.push({ id: `c${++cid}`, path, expression: attr(c, 'expression') ?? '', refresh: refresh === 'onInit' ? 'onInit' : refresh === 'onChange' ? 'onChange' : 'always' } satisfies IpCalculation)
  }

  // ── Roles ──
  const roles = first(doc, 'roles')
  if (roles) {
    const defaultRole = attr(roles, 'default') ?? attr(roles, 'initiator')
    for (const r of elements(roles).filter((e) => e.local === 'role')) {
      const name = attr(r, 'name') ?? ''
      const members = all(doc, 'membership').flatMap((m) => all(m, 'userName').concat(all(m, 'group')).filter((u) => attr(u, 'memberOf') === name).map((u) => attr(u, 'name') ?? '')).filter(Boolean)
      out.roles.push({ name, ...(name === defaultRole ? { default: true } : {}), ...(members.length ? { members } : {}) })
    }
  }

  // ── Digital signatures ──
  for (const b of all(doc, 'signedDataBlock')) out.signatures.push(attr(b, 'message') || attr(b, 'name') || 'Signature')
  if (!out.signatures.length && first(doc, 'documentSignatures')) out.signatures.push('Form signature')

  // ── Code ──
  const script = first(doc, 'script') ?? first(doc, 'scripts')
  if (script) out.code.push(`Script (${attr(first(doc, 'script'), 'language') ?? 'JScript/VBScript'})`)
  const managed = first(doc, 'managedCode')
  if (managed) out.code.push(`Managed code (${attr(managed, 'name') ?? attr(managed, 'projectPath') ?? 'assembly'})`)
  const enabledCode = all(doc, 'solutionDefinition').some((s) => attr(s, 'allowClientOnlyCode') === 'yes')
  if (enabledCode && !out.code.length) out.code.push('Client-only code')

  return out
}

function triggerKey(t: IpTrigger): string {
  return t.kind === 'field' ? `f:${t.path}` : t.kind === 'button' ? `b:${t.view}:${t.control}` : t.kind
}
