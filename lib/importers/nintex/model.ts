/**
 * The Nintex workflow as the mapper sees it, whatever the export format:
 * Nintex for SharePoint 2010 / 2013 / 2016 (.nwf) and Nintex for Office 365
 * (.nwp) readers both fill it. Action types are the Nintex for SharePoint
 * adapter names (NWSendMessageAdapter, WFIfElseAdapter …): the .nwp reader
 * translates its class names to them, keeping the original in `source`.
 * Values are Nintex inserted-reference text: {WorkflowVariable:X},
 * {ItemProperty:Field}, {Common:Name}, {WFConstant:X}, {Lookup:Field}.
 */

export interface NintexRule { left: string; op: string; right: string }

/** A condition: rules joined by one logic; `exact: false` when part of it could not be read. */
export interface NintexCondition { logic: 'and' | 'or'; rules: NintexRule[]; exact: boolean; text: string }

export interface NintexAction {
  /** Adapter type without namespace, e.g. NWSetFieldAdapter (or the .nwp class translated to one). */
  type: string
  /** The type as written in the export, when it differs (an .nwp class name). */
  source?: string
  label: string
  /** Parameters as Nintex reference text. */
  params: Record<string, string>
  /** Parameters that name a workflow variable (outputs, targets): parameter → variable name. */
  vars?: Record<string, string>
  /** Nested actions: branches of conditions, approvals, switches, state machines; an action set or loop body. */
  branches: Array<{ label: string; actions: NintexAction[]; id?: string; value?: string }>
  /** false: disabled in the Nintex designer (not imported). */
  enabled?: boolean
  /** A custom (non-Nintex) action's assembly, e.g. a third-party Xtension. */
  custom?: string
  condition?: NintexCondition | null
  /** Update / create item: internal field name → value. */
  fields?: Array<{ name: string; value: string }>
  /** Send notification (and task e-mails). */
  message?: { to: string[]; cc: string[]; subject: string; body: string }
  /** Tasks: assignees (people, groups or references), outcomes and behaviours. */
  assignees?: string[]
  outcomes?: string[]
  behaviours?: string[]
  /** Set variable with several assignments (.nwp Set multiple variables). */
  assignments?: Array<{ name: string; value: string }>
  /** State machine: its state variable; Change state: the state it sets. */
  stateVar?: string
}

/** A workflow variable; `startForm`: shown on the Nintex start form ("Show on start form" / Initiate). */
export interface NintexVariable {
  name: string
  type: string
  startForm?: boolean
  required?: boolean
  description?: string | null
  defaultValue?: string | null
  /** The start form control (.nwf ControlType: SingleLine, MultipleLine, User, ChoiceDropDown …). */
  control?: string | null
  /** Choices of a choice start-form control, when the export has them. */
  choices?: string[]
}

/** A column of the workflow's own list as the export knows it (internal name; display name and type when written). */
export interface NintexFieldInfo { name: string; display?: string | null; type?: string | null }

export interface NintexWorkflow {
  name: string
  description: string | null
  listName: string | null
  format: 'nwf' | 'nwp' | 'legacy'
  /** List, Site or GloballyReusable (.nwf); List for .nwp. */
  workflowType: string
  startManually: boolean
  startOnCreate: boolean
  startOnChange: boolean
  /** Start conditions are set (on create / on change): they become a review note. */
  startConditions: boolean
  variables: NintexVariable[]
  actions: NintexAction[]
  warnings: string[]
  /** Columns of the workflow's list named in the export, with their types (lookups, set-field types, .nwp Lists.xml). */
  fields?: NintexFieldInfo[]
  /** Lookups to an item of another (or the same) list: the list as written (id or title) and the field. */
  lookups?: Array<{ list: string | null; field: string; current?: boolean }>
  /** Ids / titles the export uses for its own list (to recognise lookups to the current list). */
  listIds?: string[]
}

export class NintexFormatError extends Error {}

/** Human names of the Nintex actions (report labels, placeholders). */
export const NINTEX_NAMES: Record<string, string> = {
  WFIfElseAdapter: 'Set a condition', NWRunIf2Adapter: 'Run if', NWSwitchAdapter: 'Switch', WFParallelAdapter: 'Run parallel actions',
  NWBusinessProcessAdapter: 'Action set', NWStateMachine2Adapter: 'State machine', NWStateChangeAdapter: 'Change state',
  NWForEachLoopAdapter: 'For each', NWLoopAdapter: 'Loop', NWLoopNTimesAdapter: 'Loop n times', NWCommitAdapter: 'Commit pending changes',
  NWSendMessageAdapter: 'Send notification', SPSetVariableAdapter: 'Set variable', NWWriteToHistoryListAdapter: 'Log in history list',
  SPUpdateItemWithKeyAdapter: 'Update item', SPSetFieldWithKeyAdapter: 'Set field value', NWBuildStringAdapter: 'Build string',
  NWQueryListAdapter: 'Query list', NWCollectionAdapter: 'Collection operation', NWRegularExpressionAdapter: 'Regular expression',
  NWDelayForAdapter: 'Pause for', SPDelayUntilAdapter: 'Pause until', NWSetItemPermissions: 'Set item permissions',
  WFTerminateAdapter: 'End workflow', NWCancelWorkflowAdapter: 'Terminate workflow', SPMathAdapter: 'Math operation', SPSetCustomWorkflowStatusAdapter: 'Set workflow status',
  NWMultiOutcomeAdapter: 'Flexi task', NWApproverAdapter: 'Request approval', NWReviewAdapter: 'Request review',
  NWAssignTodoTaskAdapter: 'Assign to-do task', NWCollectDataAdapter: 'Request data', UserDefinedActionWrapperAdapter: 'User defined action',
  NWReadXmlAdapter: 'Query XML', NWUpdateXmlAdapter: 'Update XML', NWCalculateDateAdapter: 'Calculate date',
  SPWaitForDocumentStatusAdapter: 'Wait for check out status change', SPWaitForWithKeyAdapter: 'Wait for item update',
  NWCreateSiteSpecificItemAdapter: 'Create item in another site', NWCreateItemWithContentTypesAdapter: 'Create item',
  NWCompleteNWTaskAdapter: 'Complete workflow task', NWTaskReminderAdapter: 'Task reminder', NWCallWebServiceAdapter: 'Call web service',
  NWWebRequestAdapter: 'Web request', NWParseValueAdapter: 'Convert value', NWDocGenAdapter: 'Document generation',
  NWAddUserToADGroupAdapter: 'Add user to AD group', NWSetModerationStatusAdapter: 'Set approval status', NWStartWorkflow2Adapter: 'Start workflow',
  NWDelegateNWTaskAdapter: 'Delegate task', NWCopyToSharepointSite2Adapter: 'Copy to SharePoint', SPCheckOutItemWithKeyAdapter: 'Check out item',
  NWCheckInItemWithKeyAdapter: 'Check in item', SPCopyItemWithKeyAdapter: 'Copy item', NWCStartWorkflowAdapter: 'Start a Nintex Workflow Cloud workflow',
  NWCopyToFolderAdapter: 'Copy to file share', SPDeleteItemWithKeyAdapter: 'Delete item', NWCreateADAccountAdapter: 'Create AD user',
  NWProvisionExchangeUserEmailAdapter: 'Provision Exchange mailbox', NWEnableLCSOnADAccountAdapter: 'Enable Lync / OCS', NWUpdateUserProfileAdapter: 'Update user profile',
  NWUpdateMultipleItemAdapter: 'Update multiple items', NWDecommissionUserAdapter: 'Decommission AD user', NWBDCQueryAdapter: 'Query BCS',
  NWQueryLdapAdapter: 'Query LDAP', ProcessStageStartAdapter: 'Start stage (Hawkeye)', ProcessStageStopAdapter: 'End stage (Hawkeye)',
  OnlineActivityAdapter: 'Nintex Live action', NWModifyStringAdapter: 'Modify string',
}

export function nintexName(type: string): string {
  return NINTEX_NAMES[type] ?? type.replace(/Adapter$/, '').replace(/^(NW|SP|WF)/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
}
