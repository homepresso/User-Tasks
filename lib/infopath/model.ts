/**
 * The intermediate model of an InfoPath form template: what the analyzer
 * (lib/infopath/analyze.ts) reads out of an .xsn, before anything is mapped
 * to UserTasks (lib/infopath/generate.ts). JSON-serialisable, so the REST /
 * MCP dry run can return it and tests can assert on it.
 */

export type IpDataType =
  | 'string' | 'boolean' | 'date' | 'dateTime' | 'time' | 'integer' | 'decimal' | 'double'
  | 'anyURI' | 'base64Binary' | 'xhtml' | 'group' | 'unknown'

/** A node of the main data source (myschema.xsd). Paths are absolute, local names: /expenseReport/items/item/amount. */
export interface IpSchemaNode {
  name: string
  path: string
  type: IpDataType
  repeating: boolean
  required: boolean
  nillable?: boolean
  attribute?: boolean
  pattern?: string
  enumeration?: string[]
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  /** Schema default / fixed value. */
  default?: string
  children: IpSchemaNode[]
}

export type IpControlKind =
  | 'text' | 'richtext' | 'date' | 'datetime' | 'time' | 'dropdown' | 'combobox' | 'listbox' | 'multiselect'
  | 'checkbox' | 'option' | 'attachment' | 'button' | 'expression' | 'hyperlink' | 'picture' | 'people'
  | 'signature' | 'ink' | 'activex' | 'bulleted_list'
  | 'section' | 'optional_section' | 'repeating_section' | 'repeating_table'
  | 'unknown'

export interface IpOption { value: string; label: string }

/** Conditional formatting on a control / section (xsl:attribute style / xd:disableEditing under xsl:when). */
export interface IpFormatting {
  /** The XPath test (true → the effect applies). */
  condition: string
  effect: 'hide' | 'disable' | 'style'
  /** InfoPath's own name ("Rule 1") when present. */
  caption?: string
  /** style: the CSS it applies (shown in the report). */
  style?: string
}

export interface IpControl {
  /** xd:CtrlId (CTRL12) or a generated id. */
  id: string
  kind: IpControlKind
  /** The raw xd:xctname / class it was recognised from. */
  xctname: string
  /** Binding as written (my:a/my:b) and resolved (absolute local-name path). */
  binding?: string
  path?: string
  /** The label beside / above it in the view (or its title / header cell). */
  label?: string
  /** Screen tip (title attribute). */
  title?: string
  placeholder?: string
  /** Static options (dropdown / list box / option buttons). */
  options?: IpOption[]
  /** Options from a data connection (xsl:for-each over GetDOM / a repeating node). */
  options_source?: string
  /** Check box values. */
  on_value?: string
  off_value?: string
  /** InfoPath display format (xd:datafmt: number, currency, percentage, date, time, datetime…). */
  format?: string
  /** Read-only in the view (xd:disableEditing="yes"). */
  read_only?: boolean
  formatting: IpFormatting[]
  /** Expression box: the XPath it shows. */
  expression?: string
  /** Button / section caption. */
  caption?: string
  /** The node relative paths (formatting conditions, button rules) are read from. */
  context?: string
  /** Layout position in the view: the layout row and column (0-based), cells it spans. */
  row: number
  col: number
  span?: number
  /** Sections, repeating tables / sections: their contents. */
  children?: IpViewItem[]
  /** Repeating table: the header cells (column titles), in order. */
  headers?: string[]
  /** xsl:if around a section (its show condition, as written). */
  show_if?: string
  /** Option buttons merged into one control: the CtrlIds. */
  merged?: string[]
}

/** Static text in a view: a heading / label / instruction (not bound). */
export interface IpText {
  kind: 'static'
  text: string
  heading: boolean
  row: number
  col: number
}

export type IpViewItem = IpControl | IpText

export interface IpView {
  name: string
  caption: string
  file: string
  default: boolean
  /** Hidden from the View menu (showMenuItem="no"): usually a print / workflow view. */
  hidden: boolean
  print_view?: string
  /** Top-level contents in document order (rows / cols on each item). */
  items: IpViewItem[]
  warnings: string[]
}

export type IpRuleActionType =
  | 'dialog' | 'dialog_expression' | 'assign' | 'query' | 'submit' | 'switch_view' | 'close' | 'open_new'
  | 'rule_set' | 'sign' | 'send_to_host' | 'unknown'

export interface IpRuleAction {
  type: IpRuleActionType
  /** The element's local name (e.g. assignmentAction). */
  element: string
  /** assign: the target (as written) and its context; dialog: the text; switch_view: the view; query / submit: the adapter. */
  target?: string
  expression?: string
  text?: string
  view?: string
  adapter?: string
  rule_set?: string
}

export type IpTrigger =
  | { kind: 'field'; path: string; match: string }
  | { kind: 'button'; view: string; control: string; caption?: string }
  | { kind: 'load' }
  | { kind: 'submit' }

export interface IpRule {
  id: string
  name: string
  enabled: boolean
  /** XPath condition (absent = always). Relative to the trigger's node. */
  condition?: string
  /** The node `.` means in the condition / actions (absolute local-name path). */
  context: string
  rule_set: string
  trigger: IpTrigger
  stop_after?: boolean
  actions: IpRuleAction[]
}

export interface IpValidation {
  id: string
  /** The node the error shows on (absolute) and the node the expression is relative to. */
  path: string
  context: string
  expression: string
  short_message: string
  message?: string
  kind: 'custom' | 'blank'
}

export interface IpCalculation {
  id: string
  path: string
  expression: string
  /** onInit = a default value once; onChange = recalculated. */
  refresh: 'onInit' | 'onChange' | 'always'
}

export interface IpDataConnection {
  name: string
  /** sharepoint_list | web_service | xml_file | database | rest | sharepoint_library | email | hosting | unknown */
  type: string
  direction: 'query' | 'submit'
  /** The list / URL / service, as far as the manifest says. */
  source?: string
  init_on_load?: boolean
  /** SharePoint list: the fields it reads. */
  fields?: string[]
}

export interface IpButton {
  view: string
  control: string
  caption?: string
  rule_sets: string[]
  /** Built-in action (submit / switch view / insert a row…) when not rules. */
  action?: string
}

export interface IpRole { name: string; default?: boolean; members?: string[] }

export interface IpSubmit {
  /** The main submit's caption and what happens after (close / new / keep). */
  caption?: string
  after?: string
  adapters: string[]
  rule_sets: string[]
  enabled: boolean
}

export interface IpManifest {
  name: string
  title?: string
  description?: string
  version?: string
  /** InfoPath version / runtime (client, browser-enabled). */
  product_version?: string
  browser_enabled: boolean
  default_view?: string
  views: Array<{ name: string; caption: string; file: string; hidden: boolean; print_view?: string }>
  rules: IpRule[]
  validations: IpValidation[]
  calculations: IpCalculation[]
  connections: IpDataConnection[]
  buttons: IpButton[]
  roles: IpRole[]
  submit: IpSubmit | null
  /** Repeating containers declared for editing (xmlToEdit with xCollection): absolute item paths. */
  repeating: string[]
  /** Optional sections (xOptional): absolute paths. */
  optional: string[]
  /** Fields edited as rich text. */
  rich_text: string[]
  /** Form code (script / managed code) present. */
  code: string[]
  /** The manifest's root node (the schema root's local name). */
  root?: string
  warnings: string[]
}

export interface InfoPathModel {
  file_name: string
  /** sha256 of the uploaded bytes (re-import matching). */
  hash: string
  format: 'xsn' | 'zip'
  files: string[]
  manifest: IpManifest
  schema: IpSchemaNode | null
  /** template.xml default values: absolute path → text (leaf nodes only). */
  defaults: Record<string, string>
  views: IpView[]
  warnings: string[]
}
